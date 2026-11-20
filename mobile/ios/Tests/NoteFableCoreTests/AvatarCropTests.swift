import Foundation
import XCTest
@testable import NoteFableCore

final class AvatarCropTests: XCTestCase {
    private let eps = 0.0001

    func testThePhotoCoversTheCircleByItsShortSideLikeTheWebLayoutFor() {
        // 400×200 横图：短边 200 对上圆，宽 400，左右各多出 100。
        let layout = cropLayout(imageWidth: 400, imageHeight: 200, zoom: 1, offsetX: 0, offsetY: 0, view: 200)
        XCTAssertEqual(layout.w, 400, accuracy: eps)
        XCTAssertEqual(layout.h, 200, accuracy: eps)
        XCTAssertEqual(layout.dx, -100, accuracy: eps)
        XCTAssertEqual(layout.dy, 0, accuracy: eps)
    }

    func testOffsetsAreClampedSoNoGapShowsAndZoomWidensTheRange() {
        let clamped = cropLayout(imageWidth: 400, imageHeight: 200, zoom: 1, offsetX: 500, offsetY: 50, view: 200)
        XCTAssertEqual(clamped.offsetX, 100, accuracy: eps)
        XCTAssertEqual(clamped.offsetY, 0, accuracy: eps)
        XCTAssertEqual(clamped.dx, 0, accuracy: eps)

        let zoomed = cropLayout(imageWidth: 400, imageHeight: 200, zoom: 2, offsetX: -500, offsetY: 500, view: 200)
        XCTAssertEqual(zoomed.w, 800, accuracy: eps)
        XCTAssertEqual(zoomed.offsetX, -300, accuracy: eps)
        XCTAssertEqual(zoomed.offsetY, 100, accuracy: eps)
        XCTAssertEqual(zoomed.dx, -600, accuracy: eps)
        XCTAssertEqual(zoomed.dy, 0, accuracy: eps)
    }

    func testDecodingKeepsAtLeast512TimesTheMaxZoomOnTheShortSide() {
        XCTAssertEqual(avatarSampleSize(1000, 3000), 1)
        XCTAssertEqual(avatarSampleSize(3071, 4000), 1)
        XCTAssertEqual(avatarSampleSize(3072, 4096), 2)
        XCTAssertEqual(avatarSampleSize(8000, 6144), 4)
    }

    func testVeryLongImagesAreAlsoCappedByTotalPixels() {
        // 长截图 / 全景图：短边不到 1536，但整张解码会超过画布能画的 100 MiB。
        XCTAssertEqual(avatarSampleSize(1080, 25000), 2)
        XCTAssertEqual(avatarSampleSize(3000, 9000), 2)
        XCTAssertEqual(avatarSampleSize(3000, 6000), 1)
        for (w, h) in [(1080, 25000), (3000, 9000), (400, 200_000), (3071, 30000)] {
            let s = Int64(avatarSampleSize(w, h))
            XCTAssertLessThan((Int64(w) / s) * (Int64(h) / s) * 4, 100 * 1024 * 1024, "\(w) x \(h) / \(s)")
        }
    }

    func testPickedFilesMustBeImagesUnder10MB() {
        XCTAssertEqual(checkPickedPhoto(mimeType: "application/pdf", size: 10), .notImage)
        XCTAssertEqual(checkPickedPhoto(mimeType: nil, size: 10), .notImage)
        XCTAssertEqual(checkPickedPhoto(mimeType: "image/jpeg", size: MAX_PICKED_PHOTO_BYTES + 1), .tooLarge)
        XCTAssertNil(checkPickedPhoto(mimeType: "image/png", size: MAX_PICKED_PHOTO_BYTES))
        XCTAssertNil(checkPickedPhoto(mimeType: "image/webp", size: nil), "size unknown: the decoder decides")
    }

    func testNonRoundImageSizesNeverProduceANegativeClampRange() {
        for (w, h) in [(309.0, 400.0), (400.0, 309.0), (201.0, 333.0), (777.0, 213.0)] {
            for zoom in [1.0, 1.37, 3.0] {
                let layout = cropLayout(imageWidth: w, imageHeight: h, zoom: zoom, offsetX: 1000, offsetY: -1000, view: 200)
                XCTAssertTrue(layout.w >= 199.99 && layout.h >= 199.99)
                // 夹过的偏移不会让圆里露出空白。
                XCTAssertLessThanOrEqual(layout.dx, eps)
                XCTAssertGreaterThanOrEqual(layout.dx + layout.w, 200 - eps)
                XCTAssertLessThanOrEqual(layout.dy, eps)
                XCTAssertGreaterThanOrEqual(layout.dy + layout.h, 200 - eps)
            }
        }
    }

    func testTheSavedSquareShowsWhatTheCircleShows() {
        // 预览圆 200 → 输出 512：位置和大小都乘 2.56。
        let layout = cropLayout(imageWidth: 400, imageHeight: 200, zoom: 2, offsetX: 50, offsetY: 0, view: 200)
        let rect = avatarOutputRect(layout, view: 200)
        XCTAssertEqual(Double(rect.minX), layout.dx * 2.56, accuracy: eps)
        XCTAssertEqual(Double(rect.width), 800 * 2.56, accuracy: eps)
        XCTAssertEqual(Double(rect.height), 400 * 2.56, accuracy: eps)
    }

    func testPhotosWithAShortSideUnder200AreRefused() {
        XCTAssertEqual(checkAvatarSource(width: 199, height: 4000), .tooSmall)
        XCTAssertNil(checkAvatarSource(width: 200, height: 200))
        XCTAssertEqual(checkAvatarSource(width: 0, height: 0), .unreadable)
    }
}
