import XCTest
@testable import NoteFableCore

private final class MemoryLanguageStore: LanguagePreferenceStore {
    var code: String?
    var saves: [String?] = []

    init(_ code: String? = nil) { self.code = code }

    func load() -> String? { code }

    func save(_ code: String?) {
        self.code = code
        saves.append(code)
    }
}

private final class SystemLanguages {
    var tags: [String]
    init(_ tags: [String]) { self.tags = tags }
}

/// 服务端的语言推断：测试里决定它什么时候、返回什么。
private final class InferenceGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String?, Never>?
    private var opened: String??
    private var requests: [[String]] = []

    var calls: [[String]] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    func infer(_ tags: [String]) async -> String? {
        await withCheckedContinuation { continuation in
            lock.lock()
            requests.append(tags)
            if let opened {
                self.opened = nil
                lock.unlock()
                continuation.resume(returning: opened)
            } else {
                self.continuation = continuation
                lock.unlock()
            }
        }
    }

    /// 让（正在等的或下一次的）请求返回这个语言代码。
    func open(_ code: String?) {
        lock.lock()
        if let continuation {
            self.continuation = nil
            lock.unlock()
            continuation.resume(returning: code)
        } else {
            opened = .some(code)
            lock.unlock()
        }
    }
}

final class LanguageControllerTests: XCTestCase {
    private let hello: [String: String] = [
        "en": "Hello", "ja": "こんにちは", "zh-Hans": "你好", "zh-Hant": "哈囉", "ar": "مرحبا",
    ]

    /// 一个只有几种语言的资源包：`<lproj>.lproj/Localizable.strings`，每个文件里有 hello 和带占位符的 count。
    private func makeResources(_ lprojs: [String] = ["en", "ja", "zh-Hans", "zh-Hant", "ar"]) throws -> Bundle {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nf-language-\(UUID().uuidString)", isDirectory: true)
        for lproj in lprojs {
            let directory = root.appendingPathComponent("\(lproj).lproj", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let body = "/* test */\n\"hello\" = \"\(hello[lproj] ?? lproj)\";\n\"count\" = \"%1$d \\\"\(lproj)\\\"\";\n"
            try Data(body.utf8).write(to: directory.appendingPathComponent("Localizable.strings"))
        }
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return try XCTUnwrap(Bundle(path: root.path))
    }

    @MainActor
    private func makeController(
        stored: String? = nil,
        system: [String] = ["en-US"],
        resources: Bundle? = nil,
        gate: InferenceGate? = nil
    ) throws -> (controller: LanguageController, store: MemoryLanguageStore, system: SystemLanguages, l10n: L10n) {
        let store = MemoryLanguageStore(stored)
        let languages = SystemLanguages(system)
        let l10n = L10n()
        var infer: (([String]) async -> String?)?
        if let gate { infer = { tags in await gate.infer(tags) } }
        let controller = LanguageController(
            store: store,
            resources: try resources ?? makeResources(),
            systemLanguages: { languages.tags },
            inferLocale: infer,
            l10n: l10n
        )
        return (controller, store, languages, l10n)
    }

    @MainActor
    func testShowsTheStoredChoiceAndHandsItsStringsToL10n() async throws {
        let saved = AppLanguage.uiLocale
        defer { AppLanguage.uiLocale = saved }
        let (controller, store, _, l10n) = try makeController(stored: "ja", system: ["en-US"])
        XCTAssertEqual(controller.preference, .japanese)
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertEqual(controller.uiLocale, "ja")
        XCTAssertEqual(controller.acceptLanguage, "ja")
        XCTAssertFalse(controller.isRightToLeft)
        XCTAssertEqual(l10n.locale, "ja")
        XCTAssertEqual(l10n.template("hello"), "こんにちは")
        XCTAssertEqual(L10n.format(l10n.template("count"), [3]), "3 \"ja\"")
        XCTAssertEqual(l10n.template("missing_key"), "missing_key")
        XCTAssertEqual(AppLanguage.uiLocale, "ja")
        // 只是读出来显示，不重新保存。
        XCTAssertEqual(store.saves.count, 0)
    }

    @MainActor
    func testAutoFollowsTheFirstEnabledSystemLanguage() async throws {
        let (controller, store, system, l10n) = try makeController(system: ["nl-NL", "zh-Hant-HK", "ja-JP"])
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(controller.active, .traditional)
        XCTAssertEqual(l10n.template("hello"), "哈囉")
        XCTAssertEqual(controller.acceptLanguage, "zh-TW")
        XCTAssertNil(controller.inference)

        // 系统语言变了：就地换，不存成明确的选择。
        system.tags = ["ar-EG", "en"]
        controller.systemLanguagesChanged()
        XCTAssertEqual(controller.active, .arabic)
        XCTAssertTrue(controller.isRightToLeft)
        XCTAssertEqual(l10n.locale, "ar")
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(store.saves.count, 0)
    }

    @MainActor
    func testAStoredCodeThatIsNotALanguageMeansAuto() async throws {
        let (controller, _, _, _) = try makeController(stored: "nl", system: ["ja"])
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(controller.active, .japanese)
    }

    @MainActor
    func testChoosingALanguageSavesItAndAutoClearsIt() async throws {
        let (controller, store, _, l10n) = try makeController(system: ["ja-JP"])
        controller.choose(.arabic)
        XCTAssertEqual(controller.preference, .arabic)
        XCTAssertEqual(controller.active, .arabic)
        XCTAssertTrue(controller.isRightToLeft)
        XCTAssertEqual(store.code, "ar")
        XCTAssertEqual(l10n.template("hello"), "مرحبا")
        XCTAssertFalse(controller.changeFailed)

        // 系统语言变了也不动明确的选择。
        controller.systemLanguagesChanged()
        XCTAssertEqual(controller.active, .arabic)

        controller.choose(.auto)
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertNil(store.code)
        XCTAssertEqual(store.saves.map { $0 ?? "auto" }, ["ar", "auto"])
    }

    @MainActor
    func testChoosingOnDeviceTheLanguageAlreadyShownByAutoStillSavesIt() async throws {
        let (controller, store, _, _) = try makeController(system: ["ja-JP"])
        controller.chooseOnDevice(.japanese)
        XCTAssertEqual(controller.preference, .japanese)
        XCTAssertEqual(store.code, "ja")
        // 已经是这个选择：不再保存。
        controller.chooseOnDevice(.japanese)
        XCTAssertEqual(store.saves.count, 1)
    }

    @MainActor
    func testAMissingLanguageKeepsTheCurrentOneAndReportsTheFailure() async throws {
        let (controller, store, _, l10n) = try makeController(stored: "ja", resources: makeResources(["en", "ja"]))
        controller.choose(.arabic)
        XCTAssertTrue(controller.changeFailed)
        XCTAssertEqual(controller.preference, .japanese)
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertEqual(l10n.template("hello"), "こんにちは")
        XCTAssertEqual(store.code, "ja")
        // 再选一个有的（设置里的"重试"），失败标记清掉。
        controller.choose(.english)
        XCTAssertFalse(controller.changeFailed)
        XCTAssertEqual(l10n.template("hello"), "Hello")
    }

    @MainActor
    func testAsksTheServerWhenNoSystemLanguageIsEnabledAndRemembersTheAnswerInMemoryOnly() async throws {
        let gate = InferenceGate()
        let (controller, store, _, l10n) = try makeController(system: ["nl-NL", "sv-SE"], gate: gate)
        // 先显示英文。
        XCTAssertEqual(controller.active, .english)
        XCTAssertEqual(l10n.template("hello"), "Hello")
        gate.open("ja")
        await controller.inference?.value
        XCTAssertEqual(gate.calls, [["nl-NL", "sv-SE"]])
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertEqual(l10n.template("hello"), "こんにちは")
        // 不写进明确的选择。
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(store.saves.count, 0)

        // 同一份系统语言列表不再问。
        controller.systemLanguagesChanged()
        XCTAssertNil(controller.inference)
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertEqual(gate.calls.count, 1)

        // 手动选过再回到自动：还是那份列表，用记住的结果。
        controller.choose(.english)
        controller.choose(.auto)
        XCTAssertEqual(controller.active, .japanese)
        XCTAssertEqual(gate.calls.count, 1)
    }

    @MainActor
    func testAnInferenceThatFailsOrNamesAnUnknownLanguageLeavesEnglish() async throws {
        for answer in [nil, "nl", "auto"] as [String?] {
            let gate = InferenceGate()
            let (controller, _, _, _) = try makeController(system: ["nl-NL"], gate: gate)
            gate.open(answer)
            await controller.inference?.value
            XCTAssertEqual(controller.active, .english)
            XCTAssertEqual(controller.preference, .auto)
        }
    }

    @MainActor
    func testALateInferenceIsDroppedAfterAManualChoice() async throws {
        let gate = InferenceGate()
        let (controller, _, _, _) = try makeController(system: ["nl-NL"], gate: gate)
        let pending = try XCTUnwrap(controller.inference)
        controller.choose(.arabic)
        XCTAssertNil(controller.inference)
        gate.open("ja")
        await pending.value
        XCTAssertEqual(controller.active, .arabic)
        XCTAssertEqual(controller.preference, .arabic)
    }

    @MainActor
    func testALateInferenceIsDroppedWhenTheSystemLanguagesChanged() async throws {
        let gate = InferenceGate()
        let (controller, _, system, _) = try makeController(system: ["nl-NL"], gate: gate)
        let pending = try XCTUnwrap(controller.inference)
        // 出行、改了系统设置：结果对不上现在的列表。
        system.tags = ["sv-SE"]
        gate.open("ja")
        await pending.value
        XCTAssertEqual(controller.active, .english)
    }

    @MainActor
    func testFollowsTheAccountLanguageAndForgetsTheChoiceAfterSignOut() async throws {
        let (controller, store, _, _) = try makeController(stored: "ja", system: ["en-US"])
        // 没读到账号、没登录、账号的语言不知道、正在退出：都不动。
        controller.syncWithAccount(loaded: false, configured: true, signedIn: true, saved: .code("ar"))
        controller.syncWithAccount(loaded: true, configured: true, signedIn: false, saved: .code("ar"))
        controller.syncWithAccount(loaded: true, configured: true, signedIn: true, saved: .unknown)
        controller.syncWithAccount(loaded: true, configured: true, signedIn: true, signingOut: true, saved: .code("ar"))
        XCTAssertEqual(controller.preference, .japanese)
        XCTAssertEqual(store.saves.count, 0)

        // 账号上的语言是权威的，本机跟着换并存下来。
        controller.syncWithAccount(loaded: true, configured: true, signedIn: true, saved: .code("ar"))
        XCTAssertEqual(controller.preference, .arabic)
        XCTAssertEqual(controller.active, .arabic)
        XCTAssertEqual(store.code, "ar")

        // 账号上是 null = 自动：清掉本机的选择。
        controller.syncWithAccount(loaded: true, configured: true, signedIn: true, saved: .auto)
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertEqual(controller.active, .english)
        XCTAssertNil(store.code)

        // 已经一致：不重复保存。
        let saves = store.saves.count
        controller.syncWithAccount(loaded: true, configured: true, signedIn: true, saved: .auto)
        XCTAssertEqual(store.saves.count, saves)

        controller.choose(.japanese)
        controller.forgetChoice()
        XCTAssertEqual(controller.preference, .auto)
        XCTAssertNil(store.code)
    }

    @MainActor
    func testFindsLprojDirectoriesInsideTheResourceBundle() async throws {
        let resources = try makeResources(["en", "zh-Hans"])
        XCTAssertNotNil(LanguageController.lprojBundle("zh-Hans", in: resources))
        XCTAssertNil(LanguageController.lprojBundle("ko", in: resources))
    }

    func testUserDefaultsStoreKeepsTheCodeAndClearsItForAuto() throws {
        let suite = "nf-language-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsLanguagePreferenceStore(defaults: defaults)
        XCTAssertNil(store.load())
        store.save("zh-Hant")
        XCTAssertEqual(UserDefaultsLanguagePreferenceStore(defaults: defaults).load(), "zh-Hant")
        store.save(nil)
        XCTAssertNil(store.load())
    }

    /// 生成的 17 份 Localizable.strings 都能被 Foundation 读出来（键齐全、转义没坏）。
    @MainActor
    func testTheGeneratedStringsLoadInEveryLanguage() async throws {
        let directory = try TextTestSupport.generatedResources()
        let resources = try XCTUnwrap(Bundle(path: directory.path))
        var keyCount: Int?
        for language in AppLanguage.Preference.allCases {
            guard let lproj = language.lproj else { continue }
            let bundle = try XCTUnwrap(LanguageController.lprojBundle(lproj, in: resources), lproj)
            func text(_ key: String) -> String { bundle.localizedString(forKey: key, value: key, table: nil) }
            XCTAssertEqual(text("ui_locale"), language.code, lproj)
            XCTAssertEqual(text("app_name"), "NoteFable", lproj)
            XCTAssertEqual(text("plan_pro"), "Pro", lproj)
            XCTAssertNotEqual(text("send"), "send", lproj)
            // %% 和占位符照 Android 的写法留着（土耳其语把 % 写在数字前面）。
            XCTAssertTrue(text("upload_progress").contains("%%"), lproj)
            let progress = L10n.format(text("upload_progress"), [1, 3, "2 MB", 40])
            XCTAssertTrue(progress.contains("1/3") && progress.contains("2 MB") && (progress.contains("40%") || progress.contains("%40")), "\(lproj): \(progress)")
            XCTAssertFalse(progress.contains("%%") || progress.contains("$"), "\(lproj): \(progress)")

            let file = directory.appendingPathComponent("\(lproj).lproj/Localizable.strings")
            let parsed = try PropertyListSerialization.propertyList(from: Data(contentsOf: file), options: [], format: nil)
            let strings = try XCTUnwrap(parsed as? [String: String], lproj)
            XCTAssertGreaterThan(strings.count, 400, lproj)
            XCTAssertEqual(strings.count, keyCount ?? strings.count, lproj)
            keyCount = strings.count
        }
        let english = try XCTUnwrap(LanguageController.lprojBundle("en", in: resources))
        XCTAssertEqual(english.localizedString(forKey: "sb_delete_name_q", value: nil, table: nil), "Delete “%1$s”?")
        // Android 里用 "…" 包着的值：结尾的空格留着。
        XCTAssertEqual(english.localizedString(forKey: "search_speaker_you", value: nil, table: nil), "You: ")
        XCTAssertEqual(english.localizedString(forKey: "em_cat_smileys_people", value: nil, table: nil), "Smileys & people")
    }
}
