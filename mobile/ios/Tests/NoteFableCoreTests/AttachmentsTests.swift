import Foundation
import XCTest
@testable import NoteFableCore

final class AttachmentsTests: XCTestCase {
    private func file(_ name: String, _ type: String, _ size: Int) -> LocalFile {
        LocalFile(uri: "file:///\(name)", name: name, mimeType: type, size: size)
    }

    func testSizesAreWrittenTheWayTheWebComposerWritesThem() {
        XCTAssertEqual(formatUploadSize(1), "1 KiB")
        XCTAssertEqual(formatUploadSize(100_000), "98 KiB")
        XCTAssertEqual(formatUploadSize(110_000), "0.1 MiB")
        XCTAssertEqual(formatUploadSize(1_572_864), "1.5 MiB")
        XCTAssertEqual(formatUploadSize(MAX_UPLOAD_FILE_BYTES), "20 MiB")
    }

    func testAcceptsImagesPDFsTextFilesAndKnownExtensionsWithAnUnhelpfulType() {
        let files = [
            file("a.png", "image/png", 10),
            file("b.pdf", "application/pdf", 10),
            file("c.txt", "text/plain", 10),
            file("d.MD", "application/octet-stream", 10),
        ]
        XCTAssertNil(attachmentError(files, supportsImages: true))
    }

    func testNamesTheFirstProblemInTheSameOrderAsTheWeb() {
        XCTAssertEqual(attachmentError([file("a.txt", "text/plain", 0)], supportsImages: true), .empty(name: "a.txt"))
        XCTAssertEqual(attachmentError([file("a.zip", "application/zip", 5)], supportsImages: true), .unsupported(name: "a.zip"))
        XCTAssertEqual(attachmentError([file("a.png", "image/png", 5)], supportsImages: false), .modelCannotReadImages)
        XCTAssertEqual(
            attachmentError([file("a.pdf", "application/pdf", MAX_UPLOAD_FILE_BYTES + 1)], supportsImages: true),
            .fileTooLarge(name: "a.pdf", limitBytes: MAX_UPLOAD_FILE_BYTES)
        )
        let six = (1...6).map { file("\($0).pdf", "application/pdf", MAX_UPLOAD_FILE_BYTES) }
        XCTAssertEqual(attachmentError(six, supportsImages: true), .totalTooLarge(limitBytes: MAX_UPLOAD_TOTAL_BYTES))
    }

    func testASelectionThatDoesNotFitIsRefusedWhole() {
        let nine = (1...9).map { file("\($0).txt", "text/plain", 5) }
        let two = (1...2).map { file("new\($0).txt", "text/plain", 5) }
        XCTAssertEqual(
            selectionError(current: nine, incoming: two, supportsImages: true),
            .roomForFewer(remaining: 1, max: MAX_UPLOAD_FILES, count: 2)
        )
        XCTAssertEqual(
            selectionError(current: nine + two.prefix(1), incoming: two, supportsImages: true), .slotsFull(max: MAX_UPLOAD_FILES)
        )
        XCTAssertEqual(
            selectionError(current: Array(nine.prefix(1)), incoming: [file("x.zip", "application/zip", 5)], supportsImages: true),
            .notAdded(cause: .unsupported(name: "x.zip"))
        )
        XCTAssertNil(selectionError(current: nine, incoming: Array(two.prefix(1)), supportsImages: true))
    }
}
