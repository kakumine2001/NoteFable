import SwiftUI
import UIKit
import UniformTypeIdentifiers

// 笔记的 Markdown 导入 / 导出里要用系统界面的部分（网页 use-note-pages.ts 的 importMarkdown / exportPage；规则在 Core 的 NoteIO.swift 和 NotesViewModel）：
// - 导入：系统的文件选择器（`fileImporter`，可多选）。选好的地址是带访问权限的（security-scoped），读名字、大小和内容时各自申请、用完就还；
//   iCloud 里还没下载的由 NSFileCoordinator 等它下载好。数量、扩展名、大小先在本机查（`noteImportProblem`），再读、再传。
//   有项目的人先问"导入到"哪里（网页 ImportTargetDialog；`NotesViewModel.beginImport` 决定要不要问），没有项目的直接导入。
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

    /// 最多读到单个文件上限多 1 个字节：系统没给出大小、或选完以后文件变大时，也不会把整个大文件读进内存；
    /// 多出来的那 1 个字节让 ViewModel 按"文件太大"提示。
    private static func boundedContents(of url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let limit = MAX_IMPORT_FILE_BYTES + 1
        var data = Data()
        while data.count < limit, let chunk = try handle.read(upToCount: limit - data.count), !chunk.isEmpty {
            data.append(chunk)
        }
        return data
    }

    private static func contents(of url: URL) throws -> Data {
        try withAccess(url) {
            var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
            var coordinationError: NSError?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
                result = Result { try boundedContents(of: readable) }
            }
            if let coordinationError { throw coordinationError }
            return try result.get()
        }
    }
}

extension View {
    /// "导入 Markdown"的系统文件选择器：把 `isPresented` 设成 true 就打开，选好后交给 `NotesViewModel.beginImport`：
    /// 没有项目就直接导入，有项目就先显示"导入到"窗口，选好去处再导入
    /// （建好后打开第一篇；出错的提示显示在笔记首页 / 编辑页的错误条里）。`onPicked` 在选好文件时调用（抽屉用它先收起自己）。
    func noteMarkdownImporter(isPresented: Binding<Bool>, onPicked: (() -> Void)? = nil) -> some View {
        modifier(NoteMarkdownImporterModifier(isPresented: isPresented, onPicked: onPicked))
    }
}

/// 选好了、等着选"导入到"哪里的一批文件。
private struct NotePendingImport: Identifiable {
    let id = UUID()
    let sources: [NoteImportSource]
    /// 选文件时的身份（`AppEnvironment.identityGeneration`）。
    let generation: Int
}

private struct NoteMarkdownImporterModifier: ViewModifier {
    @Binding var isPresented: Bool
    let onPicked: (() -> Void)?
    /// 有值时显示"导入到"窗口。
    @State private var pending: NotePendingImport?

    @Environment(AppEnvironment.self) private var app

    func body(content: Content) -> some View {
        let pendingBinding = $pending
        let current = app
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
                    let environment = app
                    let notes = environment.notes
                    let generation = environment.identityGeneration
                    Task { @MainActor in
                        let sources = await NoteImportFiles.sources(urls)
                        // 看文件大小的期间换了身份（登录 / 退出）：旧身份选的文件不交给新身份导入。
                        guard environment.identityGeneration == generation else { return }
                        // 有项目：文件合格才问导入到哪里；没有项目的在 beginImport 里已经直接导入了。
                        guard await notes.beginImport(sources) else { return }
                        guard environment.identityGeneration == generation else { return }
                        pendingBinding.wrappedValue = NotePendingImport(sources: sources, generation: generation)
                    }
                }
            }
            .nfDialog(item: pendingBinding) { item in
                NoteImportTargetDialog(
                    onChoose: { groupId in
                        pendingBinding.wrappedValue = nil
                        let notes = current.notes
                        // 窗口开着的期间换了身份：旧身份选的文件不交给新身份导入。
                        guard current.identityGeneration == item.generation else { return }
                        Task { @MainActor in
                            await notes.importMarkdown(item.sources, groupId: groupId)
                        }
                    },
                    close: { pendingBinding.wrappedValue = nil }
                )
            }
            // 登录 / 退出后：旧身份的"导入到"窗口关掉（和笔记的其他对话框一样）。
            .onChange(of: app.identityGeneration) { _, _ in pending = nil }
    }
}

/// 选择导入到哪里（网页 ImportTargetDialog；样子和"移到"窗口 MoveNoteDialog 的项目列表相同）：
/// "无项目"在最前，后面是各个项目（列表里的顺序）；点一行就开始导入，"取消"不导入。
@MainActor
private struct NoteImportTargetDialog: View {
    let onChoose: (String?) -> Void
    let close: () -> Void
    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfWindowFrame) private var windowFrame

    var body: some View {
        let groups = app.notes.state.groups
        NFDialogTitle(L("import_to"))
        // .notes-import-targets：最高 50dvh（按 App 窗口的高度，不按整块屏幕），行间距 2。
        FittingScrollView(maxHeight: nfWindowHeight(windowFrame) * 0.5) {
            VStack(spacing: 2) {
                NFOptionRow(L("no_project")) { onChoose(nil) }
                ForEach(groups) { group in
                    NFOptionRow(group.name) { onChoose(group.id) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 12)
        NFDialogButtons(topSpacing: 16) {
            NotionButton(L("cancel")) { close() }
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
