import XCTest
@testable import NoteFableCore

// Android 的 AppLanguageTest 的移植。那边"账号 JSON 里的 locale"和"请求带 Accept-Language"两条属于 DTO 和网络层的测试。
final class AppLanguageTests: XCTestCase {
    typealias Preference = AppLanguage.Preference

    func testReadsALanguageTagLikeTheWebLocaleFromTag() {
        XCTAssertEqual(AppLanguage.preferenceOf(nil), .auto)
        XCTAssertEqual(AppLanguage.preferenceOf("nl"), .auto)
        XCTAssertEqual(AppLanguage.preferenceOf("en-GB"), .english)
        XCTAssertEqual(AppLanguage.preferenceOf("ja"), .japanese)
        XCTAssertEqual(AppLanguage.preferenceOf("zh-CN"), .simplified)
        XCTAssertEqual(AppLanguage.preferenceOf("zh"), .simplified)
        XCTAssertEqual(AppLanguage.preferenceOf("zh-Hans-HK"), .simplified)
        XCTAssertEqual(AppLanguage.preferenceOf("zh-TW"), .traditional)
        XCTAssertEqual(AppLanguage.preferenceOf("zh-HK"), .traditional)
        XCTAssertEqual(AppLanguage.preferenceOf("zh-Hant"), .traditional)
        XCTAssertEqual(AppLanguage.preferenceOf("ko-KR"), .korean)
        XCTAssertEqual(AppLanguage.preferenceOf("es-MX"), .spanish)
        XCTAssertEqual(AppLanguage.preferenceOf("fr-CA"), .french)
        XCTAssertEqual(AppLanguage.preferenceOf("de-DE"), .german)
        XCTAssertEqual(AppLanguage.preferenceOf("pt-BR"), .portugueseBrazil)
        XCTAssertEqual(AppLanguage.preferenceOf("pt-PT"), .portugueseBrazil)
        XCTAssertEqual(AppLanguage.preferenceOf("it-IT"), .italian)
        XCTAssertEqual(AppLanguage.preferenceOf("id-ID"), .indonesian)
        XCTAssertEqual(AppLanguage.preferenceOf("in-ID"), .indonesian)
        XCTAssertEqual(AppLanguage.preferenceOf("vi-VN"), .vietnamese)
        XCTAssertEqual(AppLanguage.preferenceOf("th-TH"), .thai)
        XCTAssertEqual(AppLanguage.preferenceOf("hi-IN"), .hindi)
        XCTAssertEqual(AppLanguage.preferenceOf("ar-SA"), .arabic)
        XCTAssertEqual(AppLanguage.preferenceOf("tr-TR"), .turkish)
        XCTAssertEqual(AppLanguage.preferenceOf("ru-RU"), .russian)
    }

    func testEveryOptionRoundTripsThroughItsTag() {
        for option in Preference.allCases {
            guard let tag = option.tag else { continue }
            XCTAssertEqual(AppLanguage.preferenceOf(tag), option)
        }
    }

    func testSendsTheWebLocaleTagAsAcceptLanguage() {
        XCTAssertEqual(AppLanguage.acceptLanguage("en"), "en")
        XCTAssertEqual(AppLanguage.acceptLanguage("zh"), "zh-CN")
        XCTAssertEqual(AppLanguage.acceptLanguage("zh-Hant"), "zh-TW")
        XCTAssertEqual(AppLanguage.acceptLanguage("ja"), "ja")
        XCTAssertEqual(AppLanguage.acceptLanguage("pt-BR"), "pt-BR")
        XCTAssertEqual(AppLanguage.acceptLanguage("id"), "id")
        XCTAssertEqual(AppLanguage.acceptLanguage("ar"), "ar")
        XCTAssertEqual(AppLanguage.acceptLanguage(nil), "en")
    }

    func testMenuNamesAreWrittenInTheirOwnLanguageLikeTheWebLocaleNames() {
        XCTAssertEqual(
            Preference.allCases.map(AppLanguage.nativeName),
            [
                nil,
                "English", "简体中文", "繁體中文", "日本語",
                "한국어", "Español", "Français", "Deutsch", "Português (Brasil)", "Italiano",
                "Bahasa Indonesia", "Tiếng Việt", "ไทย", "हिन्दी", "العربية", "Türkçe", "Русский",
            ]
        )
    }

    func testCodesLprojNamesAndDirection() {
        XCTAssertEqual(
            Preference.allCases.map(\.code),
            ["auto", "en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "id", "vi", "th", "hi", "ar", "tr", "ru"]
        )
        XCTAssertEqual(
            Preference.allCases.map(\.lproj),
            [nil, "en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "id", "vi", "th", "hi", "ar", "tr", "ru"]
        )
        XCTAssertNil(Preference.auto.tag)
        XCTAssertEqual(Preference.allCases.filter(\.isRightToLeft), [.arabic])
    }

    func testNormalizesBcpTagsAndAppliesManualSystemCountryEnglishPriority() {
        XCTAssertEqual(AppLanguage.localeFromTag("zh_HK"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-Hans-HK"), .simplified)
        XCTAssertEqual(AppLanguage.localeFromTag("jpn-JP"), .japanese)
        XCTAssertEqual(AppLanguage.localeFromTag("ko-KR"), .korean)
        XCTAssertEqual(AppLanguage.localeFromTag("es-419"), .spanish)
        XCTAssertEqual(AppLanguage.localeFromTag("pt-BR"), .portugueseBrazil)
        XCTAssertEqual(AppLanguage.localeFromTag("ar-SA"), .arabic)
        XCTAssertEqual(AppLanguage.localeFromTag("in-ID"), .indonesian)
        XCTAssertEqual(AppLanguage.localeFromTag("id-ID"), .indonesian)
        for tag in ["nl-NL", "sv-SE", "pl-PL", "he-IL", "zh--HK", "en-!", "*"] {
            XCTAssertNil(AppLanguage.localeFromTag(tag), tag)
        }
        XCTAssertEqual(AppLanguage.resolveLocale(.japanese, preferredTags: ["en"], country: "CN"), .japanese)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["ko-KR", "zh-HK"], country: "JP"), .korean)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["nl-NL", "zh-HK"], country: "JP"), .traditional)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["nl-NL"], country: "JP"), .japanese)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["nl-NL"], country: "SA"), .arabic)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["nl-NL"], country: "IN"), .english)
        XCTAssertEqual(AppLanguage.resolveLocale(.auto, preferredTags: ["nl-NL"]), .english)
    }

    // iOS 的 Locale.preferredLanguages 给的写法，以及网页 Intl.Locale 接受 / 拒绝的结构（结果是在 Node 里对过的）。
    func testParsesTheTagStructureLikeIntlLocale() {
        XCTAssertEqual(AppLanguage.localeFromTag("zh-Hans-CN"), .simplified)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-Hant-TW"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-Hant-CN"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-Latn-TW"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-SG"), .simplified)
        XCTAssertEqual(AppLanguage.localeFromTag("zh-MO"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("ZH-HANT"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("  en_us  "), .english)
        XCTAssertEqual(AppLanguage.localeFromTag("en-US-u-ca-gregory"), .english)
        XCTAssertEqual(AppLanguage.localeFromTag("ja-JP-u-ca-japanese-x-app"), .japanese)
        XCTAssertEqual(AppLanguage.localeFromTag("en-US-posix"), .english)
        XCTAssertEqual(AppLanguage.localeFromTag("es-0419"), .spanish)
        XCTAssertEqual(AppLanguage.localeFromTag("ar-001"), .arabic)
        XCTAssertEqual(AppLanguage.localeFromTag("en-x-a"), .english)
        XCTAssertEqual(AppLanguage.localeFromTag("chi-TW"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromTag("cmn-Hans"), .simplified)
        XCTAssertEqual(AppLanguage.localeFromTag("fre"), .french)
        XCTAssertEqual(AppLanguage.localeFromTag("ger-AT"), .german)
        for tag in [
            "", " ", "e", "zh-", "-zh", "zh-yue", "zh-cmn-Hans", "zh-HK-HK", "zh-Hant-Hans", "zh-TW-Hant", "en-a", "en-u", "en-x",
            "en-a-b", "de-1996-1996", "en-a-bb-a-cc", "zh-12", "zh-AAA", "en-123456789", "yue-Hant-HK", "fil", "abcd-US",
            "\u{212A}o-KR", "zh-ＨＫ",
        ] {
            XCTAssertNil(AppLanguage.localeFromTag(tag), tag)
        }
    }

    func testCountryFallbackIsConservative() {
        XCTAssertEqual(AppLanguage.localeFromCountry(" jp "), .japanese)
        XCTAssertEqual(AppLanguage.localeFromCountry("HK"), .traditional)
        XCTAssertEqual(AppLanguage.localeFromCountry("AT"), .german)
        XCTAssertEqual(AppLanguage.localeFromCountry("BR"), .portugueseBrazil)
        for country in ["IN", "CH", "CA", "BE", "PT", "", "ZZ"] {
            XCTAssertNil(AppLanguage.localeFromCountry(country), country)
        }
        XCTAssertNil(AppLanguage.localeFromCountry(nil))
    }

    func testLanguageMenuSearchMatchesNamesCodesAndTags() {
        XCTAssertEqual(AppLanguage.options(matching: "  "), Preference.allCases)
        XCTAssertEqual(AppLanguage.options(matching: "TÜR"), [.auto, .turkish])
        XCTAssertEqual(AppLanguage.options(matching: "zh-tw"), [.auto, .traditional])
        XCTAssertEqual(AppLanguage.options(matching: "中文"), [.auto, .simplified, .traditional])
        XCTAssertEqual(AppLanguage.options(matching: "pt"), [.auto, .portugueseBrazil])
        XCTAssertEqual(AppLanguage.options(matching: "xyz"), [.auto])
    }

    func testUiLocaleIsSharedWithTheNetworkLayer() {
        let saved = AppLanguage.uiLocale
        defer { AppLanguage.uiLocale = saved }
        AppLanguage.uiLocale = "zh-Hant"
        XCTAssertEqual(AppLanguage.acceptLanguage(AppLanguage.uiLocale), "zh-TW")
    }

    // ---- 界面语言跟着账号走（和网页 src/lib/locale-sync.test.ts 同样的情况） ----

    private let en = Preference.english
    private let zh = Preference.simplified
    private let ja = Preference.japanese
    private let auto = Preference.auto

    private func sync(
        loaded: Bool = true,
        configured: Bool = true,
        signedIn: Bool = true,
        saved: AppLanguage.SavedLocale = .auto,
        preference: Preference = .auto,
        active: Preference = .english,
        target: Preference? = nil
    ) -> LocaleSyncAction? {
        localeSyncAction(loaded: loaded, configured: configured, signedIn: signedIn, saved: saved, preference: preference, active: active, target: target)
    }

    func testLocaleSyncDoesNothingUntilTheAccountIsKnownOrWhenSignInIsNotSetUp() {
        XCTAssertNil(sync(loaded: false, preference: ja))
        XCTAssertNil(sync(configured: false, signedIn: false, preference: ja))
    }

    func testSignedOutUsersKeepTheirOwnChoice() {
        XCTAssertNil(sync(signedIn: false, preference: ja, active: ja))
        XCTAssertNil(sync(signedIn: false, preference: auto))
    }

    func testFollowsTheLanguageSavedOnTheAccount() {
        XCTAssertEqual(sync(saved: .code("zh"), preference: auto), .switchTo(zh))
        XCTAssertEqual(sync(saved: .code("zh"), preference: ja, active: ja), .switchTo(zh))
        XCTAssertNil(sync(saved: .code("zh"), preference: zh, active: zh))
        XCTAssertNil(sync(saved: .code("zh"), preference: zh, active: en, target: zh))
        XCTAssertEqual(sync(saved: .code("ja"), preference: ja, active: zh), .switchTo(ja))
        XCTAssertEqual(sync(saved: .code("zh-Hant")), .switchTo(.traditional))
        XCTAssertEqual(sync(saved: .code("ar")), .switchTo(.arabic))
    }

    func testGoesBackToTheSystemLanguageWhenAFirstChoiceWasNotSaved() {
        XCTAssertEqual(sync(saved: .code("zh"), preference: zh, active: zh, target: ja), .switchTo(zh))
        XCTAssertEqual(sync(preference: ja, active: ja), .switchTo(auto))
        XCTAssertEqual(sync(preference: auto, target: ja), .switchTo(auto))
    }

    func testAccountAutoWinsOverAnEarlierDeviceChoiceOnEveryLaunch() {
        XCTAssertEqual(sync(preference: ja, active: ja), .switchTo(auto))
        XCTAssertNil(sync(preference: auto))
        XCTAssertNil(sync(preference: ja, target: auto))
    }

    func testNeverOverwritesTheAccountWhenItsSavedLanguageIsUnknown() {
        XCTAssertNil(sync(saved: .unknown, preference: ja))
        // 账号上是这个版本不认识的语言代码：同样不动。
        XCTAssertNil(sync(saved: .code("nl"), preference: ja))
    }

    func testReadsTheAccountLanguageCodes() {
        XCTAssertEqual(AppLanguage.preferenceOfCode("zh-Hant"), .traditional)
        XCTAssertEqual(AppLanguage.preferenceOfCode("fr"), .french)
        XCTAssertEqual(AppLanguage.preferenceOfCode("pt-BR"), .portugueseBrazil)
        XCTAssertEqual(AppLanguage.preferenceOfCode("ar"), .arabic)
        XCTAssertNil(AppLanguage.preferenceOfCode("auto"))
        XCTAssertNil(AppLanguage.preferenceOfCode("nl"))
        XCTAssertNil(AppLanguage.preferenceOfCode(nil))
    }

    func testAccountLocaleMissingIsUnknownNullIsAuto() {
        XCTAssertEqual(AppLanguage.SavedLocale(accountLocale: "?", unknownMarker: "?"), .unknown)
        XCTAssertEqual(AppLanguage.SavedLocale(accountLocale: nil, unknownMarker: "?"), .auto)
        XCTAssertEqual(AppLanguage.SavedLocale(accountLocale: "ja", unknownMarker: "?"), .code("ja"))
    }

    func testReadsTheServerInferenceResponse() {
        XCTAssertEqual(AppLanguage.inferredLocaleCode(from: Data(#"{"locale":"ja"}"#.utf8)), "ja")
        XCTAssertNil(AppLanguage.inferredLocaleCode(from: Data(#"{"locale":3}"#.utf8)))
        XCTAssertNil(AppLanguage.inferredLocaleCode(from: Data("<html>".utf8)))
    }
}
