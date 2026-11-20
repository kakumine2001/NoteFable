import XCTest
@testable import NoteFableCore

/// Android AppIconTest 的移植。
final class AppIconTests: XCTestCase {
    private let image = "data:image/png;base64,AAEC"

    private struct StorageError: Error {}

    func testUncustomizedEmptyLegacyEmojiAndUnknownValuesNormalizeToDefaultQuill() {
        XCTAssertNil(validAppIcon(nil))
        XCTAssertNil(validAppIcon(""))
        XCTAssertNil(validAppIcon("quill"))
        XCTAssertNil(validAppIcon("character:quill"))
        // 旧版的表情回到 nil -> 默认 Quill。
        XCTAssertNil(validAppIcon("🦊"))
        XCTAssertNil(validAppIcon("👩🏽‍💻"))
        XCTAssertNil(validAppIcon("character:unknown_future"))
        XCTAssertNil(validAppIcon("two words"))
        XCTAssertNil(validAppIcon(String(repeating: "x", count: 65)))
        XCTAssertNil(validAppIcon("character:character:foldie"))

        XCTAssertEqual(resolveAppIcon(nil), .character(.quill))
        XCTAssertEqual(resolveAppIcon("🦊"), .character(.quill))
    }

    func testAllSevenPresetCharactersAndCustomUploadedImagesResolveAndRoundTrip() {
        XCTAssertEqual(validAppIcon(image), image)
        XCTAssertEqual(resolveAppIcon(image), .image(dataUrl: image))

        for character in CharacterId.allCases {
            let encoded = toCharacterIcon(character)
            if character == .default {
                XCTAssertNil(encoded)
            } else {
                XCTAssertEqual(encoded, "character:\(character.id)")
                XCTAssertEqual(encoded.flatMap(parseCharacterIcon), character)
            }
            XCTAssertEqual(parseCharacterIcon(character.id), character)
            XCTAssertEqual(resolveAppIcon(encoded), .character(character))
            XCTAssertEqual(resolveAppIcon(character.id), .character(character))
            XCTAssertEqual(normalizeAppIcon(character.id), encoded)
        }
    }

    func testTheImageIsCroppedToACentredSquareLikeTheWebImageFileToIcon() {
        XCTAssertEqual(appIconCrop(width: 400, height: 200), AppIconCrop(left: 100, top: 0, side: 200))
        XCTAssertEqual(appIconCrop(width: 100, height: 400), AppIconCrop(left: 0, top: 150, side: 100))
        XCTAssertEqual(appIconCrop(width: 96, height: 96), AppIconCrop(left: 0, top: 0, side: 96))
    }

    func testDecodingKeepsAtLeastTwiceTheSavedSizeOnTheShortSide() {
        XCTAssertEqual(appIconSampleSize(width: 96, height: 96), 1)
        XCTAssertEqual(appIconSampleSize(width: 383, height: 4000), 1)
        XCTAssertEqual(appIconSampleSize(width: 384, height: 4000), 2)
        XCTAssertEqual(appIconSampleSize(width: 3000, height: 4000), 8)
        XCTAssertGreaterThanOrEqual(appIconSampleSize(width: 300, height: 200_000), 2)
    }

    func testTheSavedImageIsAPngDataUrlThatReadsBackToTheSameBytes() {
        let bytes = Data([0, 1, 2, 255])
        let url = appIconDataUrl(bytes)
        XCTAssertTrue(url.hasPrefix("data:image/png;base64,"))
        XCTAssertTrue(isImageIcon(url))
        XCTAssertEqual(appIconImageBytes(url), bytes)
        XCTAssertEqual(appIconImageBytes(image), Data([0, 1, 2]))
        XCTAssertNil(appIconImageBytes("character:foldie"))
        XCTAssertNil(appIconImageBytes("data:image/svg+xml,<svg/>"))
        XCTAssertNil(appIconImageBytes("data:image/png;base64,***"))
        // 省略了末尾 "=" 的 base64 也读得出来（和 Android 一样）。
        XCTAssertEqual(appIconImageBytes("data:image/png;base64,AAECAw"), Data([0, 1, 2, 3]))
        XCTAssertEqual(appIconImageBytes("data:image/png;base64,AAECAw=="), Data([0, 1, 2, 3]))
        XCTAssertNil(appIconImageBytes("data:image/png;base64,AAECA"))
    }

    @MainActor
    func testTheStorePreservesCustomUploadsAndPresetCharactersWhileMigratingLegacyEmojiOnStartup() async {
        let image = self.image
        XCTAssertEqual(AppIconStore(read: { image }, write: { _ in true }).icon, image)
        XCTAssertEqual(AppIconStore(read: { "character:foldie" }, write: { _ in true }).icon, "character:foldie")
        XCTAssertNil(AppIconStore(read: { "🦊" }, write: { _ in true }).icon)
        XCTAssertNil(AppIconStore(read: { "not an icon" }, write: { _ in true }).icon)
        XCTAssertNil(AppIconStore(read: { throw StorageError() }, write: { _ in true }).icon)
    }

    @MainActor
    func testSavingWritesPresetCharactersAndCustomImagesAndQuillOrNilClearsBackToDefault() async {
        var written: [String?] = []
        let store = AppIconStore(read: { nil }, write: { written.append($0); return true })
        XCTAssertTrue(store.save("character:piko"))
        XCTAssertEqual(store.icon, "character:piko")
        XCTAssertTrue(store.save(image))
        XCTAssertEqual(store.icon, image)
        XCTAssertTrue(store.save("quill"))
        XCTAssertNil(store.icon)
        XCTAssertEqual(written, ["character:piko", image, nil])

        XCTAssertTrue(store.save("foldie"))
        XCTAssertEqual(store.icon, "character:foldie")
        XCTAssertTrue(store.save(""))
        XCTAssertNil(store.icon)
    }

    @MainActor
    func testAFailedOrInvalidSaveKeepsTheCurrentlyActiveIconUnchanged() async {
        var fail = false
        let store = AppIconStore(read: { "character:sora" }, write: { _ in
            if fail { throw StorageError() }
            return false
        })
        XCTAssertFalse(store.save("character:loop"))
        fail = true
        XCTAssertFalse(store.save(nil))
        XCTAssertEqual(store.icon, "character:sora")

        // 旧版的表情和随便的字符串存不进去。
        let writable = AppIconStore(read: { "character:velo" }, write: { _ in true })
        XCTAssertFalse(writable.save("🦊"))
        XCTAssertFalse(writable.save("two words"))
        XCTAssertEqual(writable.icon, "character:velo")
    }
}
