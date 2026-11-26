import SwiftUI
import UIKit
import UniformTypeIdentifiers

// 回答下面的操作行（网页 answer-actions.tsx，Android `AssistantTurn.kt` 的 AnswerActions + `AnswerActions.kt`，手机 412 宽实测）：
// 36×36 的按钮（圆角 4.8、图标 16、线宽 1.9、Muted 色、间距 2），整体往行首挪 10.4 让图标和正文的行首对齐，距正文 6.4。
// 从行首起：版本切换「‹ 2/3 ›」（重新生成过的回答）、复制（复制后图标换成 ✓ 停 2 秒）、"…"（Ellipsis 18）。
// "…"的菜单使用原生 `.nfPopover`（带加载状态与行内错误）：
// 重新生成、在新聊天中分支（已经保存到服务端的回答才有；这个聊天在发送或生成时不能点）、存到笔记（保存中转圈、
// 保存后变 ✓ 并多出"打开已保存的笔记"）、画成图（Workflow；已经保存到服务端的回答才有）、下载对话、报告回答。
// 错误和网页一样只有一处：任何一个操作开始时清掉上一条；菜单开着时显示在菜单里，关着时显示在操作行下方。
// 这一行的状态跟着列表项的 key（对账把 local-N 换成服务端 ID 时不变）；"存到笔记"的状态在 App 级的 `AnswerExportStore`。

/// 菜单里或操作行下方的错误（网页 error：保存、下载共用这一处；iOS 的剪贴板写入不会失败，没有复制的错误）。
private enum AnswerMenuError: Equatable {
    case save(AnswerSaveError)
    case download
}

struct AnswerActions: View {
    let message: UiMessage
    /// 回答所在的对话；没有时不显示"…"（网页要求有 sessionId）。
    let sessionId: String?

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    /// 每次复制加一，2 秒后归零；连续点时重新计时。
    @State private var copiedTick = 0
    @State private var menuOpen = false
    /// Popover 是否仍处于呈现或收起动画中（点击外部关闭期间 `menuOpen` 可能先变 false）。
    @State private var popoverActive = false
    @State private var downloading = false
    @State private var reporting = false
    @State private var menuError: AnswerMenuError? = nil
    @State private var downloadTask: Task<Void, Never>? = nil
    /// 等着写进用户选的位置的对话 Markdown。
    @State private var exportDocument: MarkdownExportDocument? = nil
    @State private var exportName = ""
    @State private var exporting = false
    /// `.popover` 收起完成后立刻拉起 `.fileExporter` 的待导出载荷。
    @State private var pendingExport: (document: MarkdownExportDocument, name: String)? = nil

    var body: some View {
        let copied = copiedTick > 0
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 2) {
                if let versions = message.versions {
                    AnswerVersionNav(versions: versions)
                }
                NFIconButton(
                    copied ? Lucide.check : Lucide.copy,
                    // 网页复制后有一段读屏才读的"Copied"：复制成功的 2 秒内把按钮的说明换成它。
                    label: copied ? L("answer_copied") : L("copy"),
                    size: 36, iconSize: 16, strokeWidth: copied ? 2 : 1.9
                ) {
                    menuError = nil
                    UIPasteboard.general.string = message.content
                    Haptics.light()
                    copiedTick += 1
                }
                if let sessionId {
                    NFIconButton(Lucide.ellipsis, label: L("answer_more_options"), size: 36, iconSize: 18, strokeWidth: 1.9) {
                        popoverActive = true
                        menuOpen = true
                    }
                    .nfPopover(
                        isPresented: $menuOpen,
                        width: 256,
                        adaptCompactToSheet: false,
                        onDismiss: {
                            popoverActive = false
                            guard let pending = pendingExport else { return }
                            pendingExport = nil
                            exportDocument = pending.document
                            exportName = pending.name
                            exporting = true
                        }
                    ) {
                        VStack(alignment: .leading, spacing: 0) {
                            menu(sessionId: sessionId)
                        }
                        .onAppear { popoverActive = true }
                    }
                }
            }
            // 菜单关着时的错误（例如保存文件失败）：左 8、上 2.4、13 / 1.4、#933b34。
            if !menuOpen, let menuError {
                Text(errorText(menuError))
                    .font(.nf(13))
                    .nfLineHeight(18.2, fontSize: 13)
                    .foregroundStyle(Sm.errorText)
                    .padding(.leading, 8)
                    .padding(.top, 2.4)
            }
        }
        .padding(.top, 6.4)
        .padding(.leading, -10.4)
        .task(id: copiedTick) {
            guard copiedTick > 0 else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled { copiedTick = 0 }
        }
        // 读取对话时离开这条回答（滚出屏幕）就不再弹出保存位置的选择。
        .onDisappear {
            downloadTask?.cancel()
            pendingExport = nil
            popoverActive = false
        }
        .reportDialog(.answer(messageId: message.id), isPresented: $reporting)
        .fileExporter(
            isPresented: $exporting,
            document: exportDocument,
            contentType: MarkdownExportDocument.markdown,
            defaultFilename: exportName
        ) { result in
            exportDocument = nil
            switch result {
            case .success:
                // 网页这里只有读屏通知；和 Android 一样给一句提示。
                Toast.show(L("answer_conversation_downloaded"))
            case .failure(let failure):
                // 取消选择什么也不做。
                if (failure as? CocoaError)?.code == .userCancelled { return }
                menuError = .download
            }
        }
    }

    // MARK: 菜单

    @ViewBuilder
    private func menu(sessionId: String) -> some View {
        let state = app.chat.state
        // 这个聊天在发送、上传或读取时不能重新生成、分支（Android TurnActions.busy）。
        let busy = answerTurnBusy(state)
        // 还没换成服务端 ID 的回答（local-N）不能重新生成、分支、报告（网页 isSavedMessageId）。
        let stored = !message.id.hasPrefix(ChatViewModel.LOCAL_ID_PREFIX)
        let save = app.answerExports.saves[AnswerExportStore.key(sessionId, message.id)]
        let savedPageId = Self.savedPageId(save)

        if stored {
            ActionsMenuItem(L("regenerate"), icon: Lucide.refreshCw) {
                menuOpen = false
                app.chat.regenerate(message.id)
            }
            .disabled(busy)
            ActionsMenuItem(L("branch_in_new_chat"), icon: Lucide.gitBranch) {
                menuOpen = false
                // 分支出的新聊天叫「分支 · 原标题」（网页 branchChat）。
                app.chat.branch(message.id, title: L("branch_title", state.activeTitle ?? L("new_chat")))
            }
            .disabled(busy)
        }
        // 保存中也保持菜单打开，在同一项里显示进度和结果。
        ActionsMenuItem(
            saveTitle(save),
            icon: savedPageId != nil ? Lucide.check : Lucide.filePlus2,
            isBusy: save == .saving
        ) {
            saveToNotes(sessionId: sessionId)
        }
        .disabled(save != nil)
        if let savedPageId {
            ActionsMenuItem(L("answer_open_saved_page"), icon: Lucide.arrowUpRight) {
                menuOpen = false
                router.openNote(savedPageId)
            }
        }
        if stored {
            // 「画成图」：马上开始并打开进度窗口（窗口挂在根上，状态在 `app.diagrams`）；同一条回答已有任务时只是重新打开窗口。
            let drawing = app.diagrams.job(.answer(sessionId: sessionId, messageId: message.id)) == .working
            ActionsMenuItem(L(drawing ? "diagram_working" : "diagram_draw"), icon: Lucide.workflow, isBusy: drawing) {
                menuOpen = false
                menuError = nil
                router.drawDiagram(.answer(sessionId: sessionId, messageId: message.id))
            }
        }
        ActionsMenuItem(
            downloading ? L("downloading") : L("answer_download_conversation"),
            icon: Lucide.download,
            isBusy: downloading
        ) {
            download(sessionId: sessionId)
        }
        .disabled(downloading)
        if stored {
            ActionsMenuItem(L("report_answer"), icon: Lucide.flag) {
                menuOpen = false
                reporting = true
            }
        }
        if let menuError {
            ActionsMenuError(errorText(menuError), tone: .answer)
        }
    }

    private static func savedPageId(_ save: AnswerSave?) -> String? {
        if case .saved(let pageId)? = save { return pageId }
        return nil
    }

    private func saveTitle(_ save: AnswerSave?) -> String {
        switch save {
        case .saving?:
            return L("save_saving")
        case .saved?:
            return L("answer_saved_to_page")
        case nil:
            if case .save? = menuError { return L("answer_retry_save") }
            return L("answer_save_to_page")
        }
    }

    @MainActor
    private func errorText(_ error: AnswerMenuError) -> String {
        switch error {
        case .download:
            return L("answer_download_failed")
        case .save(let failure):
            if failure.tooLarge { return L("answer_save_too_large") }
            if let message = failure.serverMessage { return app.systemText.localize(message) }
            return L("answer_save_failed")
        }
    }

    // MARK: 操作

    @MainActor
    private func saveToNotes(sessionId: String) {
        let exports = app.answerExports
        // 保存中、已保存再点什么也不做（不重复建笔记）。
        guard exports.saves[AnswerExportStore.key(sessionId, message.id)] == nil else { return }
        menuError = nil
        let saving = exports.save(sessionId: sessionId, messageId: message.id, markdown: message.content, savedOn: answerLocalDate())
        Task { @MainActor in
            if case .failed(let failure) = await saving.value { menuError = .save(failure) }
        }
    }

    @MainActor
    private func download(sessionId: String) {
        if downloading { return }
        downloading = true
        menuError = nil
        let exports = app.answerExports
        downloadTask = Task { @MainActor in
            do {
                // 不管点的是哪条回答，都读这个对话保存在服务端的全部记录。
                let export = try await exports.exportConversation(sessionId: sessionId, date: answerLocalDate())
                if !Task.isCancelled {
                    let document = MarkdownExportDocument(text: export.markdown)
                    let name = MarkdownExportDocument.baseName(export.fileName)
                    if menuOpen || popoverActive {
                        // 等 `.popover` 的 UIKit 收起完成回调再拉起 `.fileExporter`，即使下载途中用户点外部关闭也不冲突。
                        pendingExport = (document, name)
                        menuOpen = false
                    } else {
                        exportDocument = document
                        exportName = name
                        exporting = true
                    }
                }
            } catch is CancellationError {
                // 离开了这条回答：不算失败。
            } catch {
                if !Task.isCancelled { menuError = .download }
            }
            downloading = false
        }
    }
}

/// 本机日期 YYYY-MM-DD（savedOn / date）：出处里的日期按用户所在时区，与网页一致。
private func answerLocalDate() -> String {
    let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: Date())
    func pad(_ value: Int, _ width: Int) -> String {
        let digits = String(value)
        return String(repeating: "0", count: max(0, width - digits.count)) + digits
    }
    return "\(pad(parts.year ?? 1970, 4))-\(pad(parts.month ?? 1, 2))-\(pad(parts.day ?? 1, 2))"
}

/// 下载的对话：一个 Markdown 文本文件，交给系统的"存储到文件"（Android 的 SAF CreateDocument）。
struct MarkdownExportDocument: FileDocument {
    /// `.md`（系统认识的 Markdown 类型；认不出来时当纯文本）。
    static let markdown = UTType(filenameExtension: "md") ?? UTType.plainText
    static var readableContentTypes: [UTType] { [markdown, .plainText] }
    static var writableContentTypes: [UTType] { [markdown] }

    var text: String

    init(text: String) {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }

    /// 服务端给的文件名带 `.md`；系统会按类型自己加扩展名，所以先去掉。
    static func baseName(_ fileName: String) -> String {
        fileName.lowercased().hasSuffix(".md") ? String(fileName.dropLast(3)) : fileName
    }
}

// MARK: - 版本切换

/// 回答的「‹ 2/3 ›」：用提问那边的 `VersionNav`（TurnActions.swift），忙的判断和提问相同（Android TurnActions.busy）。
struct AnswerVersionNav: View {
    let versions: MessageVersions

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        VersionNav(versions: versions, busy: answerTurnBusy(app.chat.state)) { id in app.chat.showVersion(id) }
    }
}

/// 这个聊天在发送、上传或读取：不能重新生成、分支、切换版本（Android NoteFableRoot 的 turnBusy）。
func answerTurnBusy(_ state: ChatUiState) -> Bool {
    state.sending || state.upload != nil || state.messagesLoading
}

// MARK: - 只有"报告"的操作行

/// 只有图片的回答没有复制 / "…"，但要能报告（网页 ReportAnswerButton，应用商店的 AI 生成内容政策）：
/// 和操作行同样 36×36、往行首挪 10.4、上距 6.4，旗子 16。还没换成服务端 ID（local-N）的回答不显示。
struct AnswerReportOnlyAction: View {
    let messageId: String
    @State private var reporting = false

    var body: some View {
        if !messageId.hasPrefix(ChatViewModel.LOCAL_ID_PREFIX) {
            NFIconButton(Lucide.flag, label: L("report_answer"), size: 36, iconSize: 16, strokeWidth: 1.9) {
                reporting = true
            }
            .padding(.top, 6.4)
            .padding(.leading, -10.4)
            .reportDialog(.answer(messageId: messageId), isPresented: $reporting)
        }
    }
}
