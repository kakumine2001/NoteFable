import SwiftUI
import UniformTypeIdentifiers

// 笔记的 Markdown 导入 / 导出里要用系统界面的部分（网页 use-note-pages.ts 的 importMarkdown / exportPage；规则在 Core 的 NoteIO.swift 和 NotesViewModel）：
// - 导入：系统的文件选择器（`fileImporter`，可多选）。选好的地址是带访问权限的（security-scoped），读名字、大小和内容时各自申请、用完就还；
//   iCloud 里还没下载的由 NSFileCoordinator 等它下载好。数量、扩展名、大小先在本机查（`noteImportProblem`），再读、再传。
// - 导出：服务端给的 `{ fileName, markdown }` 交给系统的"存储到文件"（`fileExporter`，UTF-8 的 .md），和下载对话用的是同一个文档类型
//   （`MarkdownExportDocument`）。入口在笔记顶栏的"…"菜单（NoteEditorScreen）。

/// 导入时选的文件。
enum NoteImportFiles {
    /// 文件选择器里能选的类型（网页 accept=".md,.markdown,.txt,text/markdown,text/plain"）：纯文本，加上系统按扩展名认出来的 Markdown 类型。
    /// 选到别的扩展名的文本文件时，由 `noteImportProblem` 提示"只能导入 Markdown"。
    static let pickerTypes: [UTType] = {
        var types: [UTType] = [.plainText]
        for fileExtension in ["md", "markdown"] {
            if let type = UTType(filenameExtension: fileExtension), !types.contains(type) { types.append(type) }
        }
        return types
    }()

    /// 选好的地址 → 名字、大小和读内容的办法。读大小要访问文件，所以在后台线程做。
    static func sources(_ urls: [URL]) async -> [NoteImportSource] {
        await Task.detached(priority: .userInitiated) { () -> [NoteImportSource] in
            urls.map { url in
                NoteImportSource(name: url.lastPathComponent, size: byteCount(of: url), read: { try contents(of: url) })
            }
        }.value
    }

    /// 申请到访问权限再做 `body`，做完就还。
    private static func withAccess<T>(_ url: URL, _ body: () throws -> T) rethrows -> T {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        return try body()
    }

    /// 文件的字节数；系统没给出来时是 0（读完以后 ViewModel 按实际读到的再查一遍）。
    private static func byteCount(of url: URL) -> Int {
        withAccess(url) {
            (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        }
    }

    private static func contents(of url: URL) throws -> Data {
        try withAccess(url) {
            var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
            var coordinationError: NSError?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
                result = Result { try Data(contentsOf: readable) }
            }
            if let coordinationError { throw coordinationError }
            return try result.get()
        }
    }
}

extension View {
    /// "导入 Markdown"的系统文件选择器：把 `isPresented` 设成 true 就打开，选好后交给 `NotesViewModel.importMarkdown`
    /// （建好后打开第一篇；出错的提示显示在笔记首页 / 编辑页的错误条里）。`onPicked` 在选好文件时调用（抽屉用它先收起自己）。
    func noteMarkdownImporter(isPresented: Binding<Bool>, onPicked: (() -> Void)? = nil) -> some View {
        modifier(NoteMarkdownImporterModifier(isPresented: isPresented, onPicked: onPicked))
    }
}

private struct NoteMarkdownImporterModifier: ViewModifier {
    @Binding var isPresented: Bool
    let onPicked: (() -> Void)?

    @Environment(AppEnvironment.self) private var app

    func body(content: Content) -> some View {
        content
            // 挂在自己的视图上，不和同一处的别的系统界面（对话框、别的选择器）互相影响。
            .background {
                Color.clear.fileImporter(
                    isPresented: $isPresented,
                    allowedContentTypes: NoteImportFiles.pickerTypes,
                    allowsMultipleSelection: true
                ) { result in
                    // 取消选择什么也不做；系统打不开选择器（极少见）时也只是不导入。
                    guard case .success(let urls) = result, !urls.isEmpty else { return }
                    onPicked?()
                    let notes = app.notes
                    Task { @MainActor in
                        let sources = await NoteImportFiles.sources(urls)
                        await notes.importMarkdown(sources)
                    }
                }
            }
    }
}

/// `.notion-button.notes-home-new-group`（笔记首页和空状态里的"新项目""导入 Markdown"）：高 40、左右 12、圆角 4.8、
/// 图标 16 + 间距 6.4 + 12.8 / 500 正文色；按下灰底并缩到 .97。
struct NotesHomeTextButton: View {
    private let icon: [String]
    private let title: String
    private let action: () -> Void

    init(icon: [String], title: String, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6.4) {
                LucideIcon(icon, size: 16, color: Sm.text)
                Text(title)
                    .font(.nf(12.8, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
        }
        .buttonStyle(.pressable(scale: 0.97))
    }
}
