import UIKit

/// 系统“存储到文件”（UIDocumentPickerViewController 导出模式）关掉后（存好或取消），删掉导出用的临时文件夹。
@MainActor
final class ExportPickerCleanup: NSObject, UIDocumentPickerDelegate {
    static let shared = ExportPickerCleanup()
    private var folders: [ObjectIdentifier: URL] = [:]

    func track(_ picker: UIDocumentPickerViewController, folder: URL) {
        folders[ObjectIdentifier(picker)] = folder
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(controller)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(controller)
    }

    private func finish(_ controller: UIDocumentPickerViewController) {
        if let folder = folders.removeValue(forKey: ObjectIdentifier(controller)) {
            try? FileManager.default.removeItem(at: folder)
        }
    }
}
