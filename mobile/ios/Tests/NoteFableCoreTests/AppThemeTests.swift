import Foundation
import XCTest
@testable import NoteFableCore

/// 外观设置（网页 src/lib/theme.test.ts、Android AppThemeTest 的同一套规则）和它经 JS 桥交给网页编辑器的部分。
final class AppThemeTests: XCTestCase {
    private struct StorageError: Error {}

    func testParsesTheThreeStoredValuesAndIgnoresAnythingElse() {
        XCTAssertEqual(ThemePreference.parse("system"), .system)
        XCTAssertEqual(ThemePreference.parse("light"), .light)
        XCTAssertEqual(ThemePreference.parse("dark"), .dark)
        // 网页 parseThemePreference：去掉首尾空白、不分大小写。
        XCTAssertEqual(ThemePreference.parse("  Dark\n"), .dark)
        XCTAssertEqual(ThemePreference.parse("LIGHT"), .light)
        XCTAssertNil(ThemePreference.parse(nil))
        XCTAssertNil(ThemePreference.parse(""))
        XCTAssertNil(ThemePreference.parse("auto"))
        XCTAssertNil(ThemePreference.parse("dark mode"))
        XCTAssertEqual(ThemePreference.allCases.map(\.rawValue), ["system", "light", "dark"])
    }

    func testResolvesAgainstTheSystemAppearanceOnlyWhenFollowingIt() {
        XCTAssertEqual(ThemePreference.system.resolve(systemDark: true), .dark)
        XCTAssertEqual(ThemePreference.system.resolve(systemDark: false), .light)
        XCTAssertEqual(ThemePreference.light.resolve(systemDark: true), .light)
        XCTAssertEqual(ThemePreference.dark.resolve(systemDark: false), .dark)
        XCTAssertEqual(ResolvedTheme.dark.rawValue, "dark")
        XCTAssertEqual(ResolvedTheme.light.rawValue, "light")
    }

    func testEachOptionHasItsOwnLabelKey() {
        XCTAssertEqual(ThemePreference.allCases.map(\.labelKey), ["theme_system", "theme_light", "theme_dark"])
    }

    @MainActor
    func testTheStoreFallsBackToSystemForMissingBrokenOrUnreadableValues() async {
        XCTAssertEqual(AppThemeStore(read: { nil }, write: { _ in true }).preference, .system)
        XCTAssertEqual(AppThemeStore(read: { "sepia" }, write: { _ in true }).preference, .system)
        XCTAssertEqual(AppThemeStore(read: { throw StorageError() }, write: { _ in true }).preference, .system)
        XCTAssertEqual(AppThemeStore(read: { "dark" }, write: { _ in true }).preference, .dark)
        XCTAssertEqual(AppThemeStore(read: { " Light " }, write: { _ in true }).preference, .light)
    }

    @MainActor
    func testSavingWritesTheRawValueAndAFailedWriteKeepsTheCurrentChoice() async {
        var written: [String] = []
        let store = AppThemeStore(read: { nil }, write: { written.append($0); return true })
        XCTAssertTrue(store.save(.dark))
        XCTAssertEqual(store.preference, .dark)
        XCTAssertTrue(store.save(.system))
        XCTAssertEqual(store.preference, .system)
        XCTAssertEqual(written, ["dark", "system"])

        var fail = false
        let broken = AppThemeStore(read: { "light" }, write: { _ in
            if fail { throw StorageError() }
            return false
        })
        XCTAssertFalse(broken.save(.dark))
        fail = true
        XCTAssertFalse(broken.save(.dark))
        XCTAssertEqual(broken.preference, .light)
    }

    @MainActor
    func testTheChoiceSurvivesInUserDefaultsUnderItsOwnKey() async throws {
        let suite = "AppThemeTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(AppThemeDefaults.store(defaults).preference, .system)
        XCTAssertTrue(AppThemeDefaults.store(defaults).save(.dark))
        XCTAssertEqual(defaults.string(forKey: "app_theme.theme"), "dark")
        XCTAssertEqual(AppThemeDefaults.store(defaults).preference, .dark)
    }

    // ---- 交给网页编辑器 ----

    func testTheEmbedUrlCarriesTheResolvedTheme() {
        let api = makeApi(FakeTransport(), baseUrl: "https://example.test")
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: "ja", model: nil, reasoning: nil, theme: "dark"),
            "https://example.test/note-embed?page=abc&lang=ja&theme=dark"
        )
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: "zh", model: "gpt-5.5", reasoning: "high", theme: "light"),
            "https://example.test/note-embed?page=abc&lang=zh&model=gpt-5.5&reasoning=high&theme=light"
        )
        // 不给外观时地址和以前一样。
        XCTAssertEqual(api.noteEmbedUrl(pageId: "abc", lang: nil, model: nil, reasoning: nil, theme: nil), "https://example.test/note-embed?page=abc")
    }

    func testTheEmbedUrlCarriesTheSearchHitToRevealLast() {
        // 检索结果命中的块 / 元素（网页 note-embed.tsx 的 reveal）放在最后；空字符串和没给一样。
        let api = makeApi(FakeTransport(), baseUrl: "https://example.test")
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: "ja", model: "gpt-5.5", reasoning: "high", theme: "dark", reveal: "el_3-x"),
            "https://example.test/note-embed?page=abc&lang=ja&model=gpt-5.5&reasoning=high&theme=dark&reveal=el_3-x"
        )
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: nil, model: nil, reasoning: nil, theme: nil, reveal: "a&b c"),
            "https://example.test/note-embed?page=abc&reveal=a%26b%20c"
        )
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: nil, model: nil, reasoning: nil, theme: "light", reveal: ""),
            "https://example.test/note-embed?page=abc&theme=light"
        )
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: nil, model: nil, reasoning: nil, theme: nil, reveal: nil),
            "https://example.test/note-embed?page=abc"
        )
    }

    func testTheBootstrapDefinesTheSynchronousThemeGetterOnlyWhenGiven() {
        let dark = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en", theme: "dark")
        XCTAssertTrue(dark.contains(#"language:function(){return lang},canOpenPage:function(){return true},canShowStorageLimit:function(){return true},canShowUsageLimit:function(){return true},canPresent:function(){return true},canSaveFile:function(){return true},canOpenChat:function(){return true},canShowSlidesWizard:function(){return true},canShowPptxImport:function(){return true},canShowQuiz:function(){return true},theme:function(){return "dark"}}})()"#))
        let none = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertFalse(none.contains("theme:"))
        XCTAssertTrue(none.hasSuffix("language:function(){return lang},canOpenPage:function(){return true},canShowStorageLimit:function(){return true},canShowUsageLimit:function(){return true},canPresent:function(){return true},canSaveFile:function(){return true},canOpenChat:function(){return true},canShowSlidesWizard:function(){return true},canShowPptxImport:function(){return true},canShowQuiz:function(){return true}}})()"))
    }

    func testTheThemeScriptCallsTheEmbedApiWithAQuotedValue() {
        XCTAssertEqual(
            NoteEmbedScripts.theme("dark"),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.theme==='function')e.theme("dark")})()"#
        )
        XCTAssertTrue(NoteEmbedScripts.theme(#"a"b"#).contains(#"e.theme("a\"b")"#))
    }

    @MainActor
    func testTheBridgePushesThemeChangesAndRepeatsTheLatestWhenThePageIsReady() async {
        let editor = NotesTestEditor()
        let bridge = NoteEmbedBridge(currentLanguage: { "ja" }, onMessage: { _ in })
        // 还没有 WebView：只记下来。
        bridge.pushTheme("dark")
        XCTAssertEqual(bridge.theme, "dark")
        XCTAssertEqual(editor.calls, [])
        bridge.attach(editor)
        bridge.pushTheme("light")
        XCTAssertEqual(editor.calls, ["theme:light"])
        // 页面读好时再对一次（加载期间可能换过）。
        bridge.postMessage(#"{"type":"ready","page":{"id":"p1","title":"Bio","icon":null}}"#)
        XCTAssertEqual(editor.calls, ["theme:light", "lang:ja", "theme:light"])
    }
}
