import SwiftUI
import UIKit

// 整个聊天界面（Android ui/ChatScreen.kt 的 `ChatScreen` + NoteFableRoot.kt 里接到 ChatViewModel 的那部分）。
// 顶栏（56）和输入栏用 `nfFloatingHeader` 浮在内容上面。iOS 26 的 safeAreaBar 把滚动边缘效果延伸到两条栏，
// iOS 17–18 用系统毛玻璃底，“降低透明度”时用实色底。
// 输入栏随底部安全区移动：键盘弹出时留 16，收起后在标签栏上方留 8。
// 模型抽屉、「＋」抽屉、选笔记的窗口、「整理成笔记」窗口、系统的文件 / 照片 / 相机选择器都挂在这里。

/// 聊天画面浮动输入栏和标签栏的开关（#195），供真机验证时切回旧行为。
enum ChatChrome {
    /// 浮动输入栏用 safeAreaBar（iOS 26，有滚动边缘效果）。如果它不像 safeAreaInset 那样跟着键盘（含拖动收起），改成 false。
    static let composerUsesSystemBar = true
    /// 聊天标签里标签栏的收起方式（iOS 26）：往上翻旧消息时收起，回到最新的消息时展开。有问题时改成 `.never`。
    static let tabBarMinimize: NFTabBarMinimize = .onScrollUp
}

/// 聊天界面（顶栏、消息、输入栏）。
@MainActor
struct ChatWorkspace: View {
    @Environment(AppEnvironment.self) private var app

    @State private var modelSheetOpen = false
    @State private var attachSheetOpen = false
    @State private var pendingAttachAction: (() -> Void)? = nil
    @State private var pagesOpen = false
    @State private var pickingFiles = false
    @State private var composerFocused = false
    /// 每加一就聚焦输入框一次（引用了回答、点了最近的笔记：接着打提问）。
    @State private var focusRequest = 0
    /// 空白页输入栏上方的「最近编辑」（GET /api/pages?recent=1）。
    @State private var recentNotes: [NotePageSummary] = []

    init() {}

    var body: some View {
        let state = app.chat.state
        let hasDraft = !ApiText.isBlank(app.chat.draft)
        // 空白页（网页 emptyState：没有消息）：标题在页面中间，顶栏不放标题和"新建聊天"。读历史中 / 失败时不算。
        let isEmptyChat = state.messages.isEmpty && !state.messagesLoading && !state.messagesFailed
        let heroState = state.heroCharacterState(isTyping: composerFocused || hasDraft)
        let keyboardUp = KeyboardObserver.shared.top.isFinite
        // 「最近编辑」：会话列表读到之后才显示（Android showRecentNotes）。
        let showRecent = isEmptyChat && !state.sessionsLoading
        // 顶栏“…”菜单的对象：空白首页没有。
        let activeSession: SessionSummary? = isEmptyChat ? nil : state.sessions.first(where: { $0.id == state.activeSessionId })
        GeometryReader { proxy in
            // 键盘算在底部安全区里：用当前窗口的可用高度加上下安全区，键盘升降时编辑框的高度上限不变。
            let windowHeight = proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
            content(state, heroState: heroState, hasDraft: hasDraft, showRecent: showRecent, maxEditorHeight: windowHeight * 0.4)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // 在两条浮动栏里面量，让 toast 按输入栏和标签栏合计的遮挡高度摆放。
                .nfReportsBottomChrome(.chat)
                .nfFloatingHeader(edge: .top) {
                    ChatTopBar(
                        title: isEmptyChat ? nil : state.activeTitle,
                        icon: state.activeIcon,
                        session: activeSession,
                        // 网页的空白首页顶栏没有"新建聊天"，因为已经在新聊天里。
                        showTrailing: !isEmptyChat,
                        onModelClick: {
                            // 和输入栏的模型按钮一样：先收起键盘再开抽屉。
                            hideKeyboard()
                            modelSheetOpen = true
                        }
                    )
                }
                .nfFloatingHeader(edge: .bottom, divider: true, systemBar: ChatChrome.composerUsesSystemBar) {
                    NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                        ChatComposer(
                            bottomPadding: keyboardUp ? 16 : 8,
                            focusRequest: focusRequest,
                            onFocusChange: { value in composerFocused = value },
                            onModelClick: {
                                // 键盘开着时抽屉会浮在键盘上面：先收起（网页 openSheet 的 blur）。
                                hideKeyboard()
                                modelSheetOpen = true
                            },
                            onAddClick: {
                                hideKeyboard()
                                attachSheetOpen = true
                            }
                        )
                    }
                }
        }
        .background(Sm.background)
        // 回答里选中文字点了「问 NoteFable」：引用放到输入栏上方后聚焦输入框，接着打提问（Android composerFocus.requestFocus()）。
        .onChange(of: state.quote) { old, new in
            if let new, new != old, state.upload == nil { focusRequest += 1 }
        }
        // 定位请求平常由消息列表处理；读取失败、或读完是空会话时列表不在界面上，在这里作废请求
        // （Android 的 revealMessage 在分支外面，四种情况都会处理到），免得它一直挂着、之后挡住贴底。
        .task(id: ChatRevealTrigger(state)) {
            consumeRevealWithoutList()
        }
        .task(id: ChatRecentNotesTrigger(
            show: showRecent,
            pages: app.notes.state.pages,
            email: app.account.state.user?.email,
            identity: app.identityGeneration
        )) {
            await loadRecentNotes(show: showRecent)
        }
        .nfSheet(
            isPresented: $modelSheetOpen,
            detents: .fitted,
            showsDragIndicator: true,
            contentInsets: EdgeInsets(top: 12, leading: 16, bottom: 16, trailing: 16)
        ) {
            ChatModelSheet()
        }
        .nfSheet(
            isPresented: $attachSheetOpen,
            detents: .fitted,
            showsDragIndicator: true,
            contentInsets: EdgeInsets(top: 12, leading: 16, bottom: 16, trailing: 16),
            onDismiss: {
                guard let action = pendingAttachAction else { return }
                pendingAttachAction = nil
                action()
            }
        ) {
            ChatAttachSheetContent(
                onScheduleAction: { action in pendingAttachAction = action },
                onPickFiles: { pickingFiles = true },
                onAttachPages: { pagesOpen = true }
            )
        }
        .attachPagesDialog(isPresented: $pagesOpen)
        .createPageDialog()
        .chatAttachmentPicker(isChoosing: $pickingFiles)
        .onChange(of: ScreenshotHooks.dismissTick) { _, _ in
            modelSheetOpen = false
            attachSheetOpen = false
        }
        .task(id: "\(ScreenshotHooks.sceneTick)-\(!state.messages.isEmpty)-\(!state.models.isEmpty)") {
            guard ScreenshotHooks.isActive, !state.messages.isEmpty, !state.models.isEmpty else { return }
            if ScreenshotHooks.consume(.modelSheet) {
                modelSheetOpen = true
                ScreenshotHooks.markReady(.modelSheet)
            } else if ScreenshotHooks.consume(.attachSheet) {
                attachSheetOpen = true
                ScreenshotHooks.markReady(.attachSheet)
            }
        }
    }

    @ViewBuilder
    private func content(
        _ state: ChatUiState,
        heroState: CharacterState,
        hasDraft: Bool,
        showRecent: Bool,
        maxEditorHeight: CGFloat
    ) -> some View {
        if state.messagesLoading {
            // Android：24 的转圈、灰色、线宽 2。
            Spinner(size: 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if state.messagesFailed {
            loadFailed
        } else if state.messages.isEmpty {
            ChatEmptyState(
                hasDraft: hasDraft,
                heroState: heroState,
                recentNotes: showRecent ? recentNotes : [],
                onFocusComposer: { focusRequest += 1 }
            )
        } else {
            ChatMessageList(
                // 这个聊天在发送、上传或读取：提问下面的编辑、版本切换不能点（Android turnBusy）。
                busy: state.sending || state.upload != nil || state.messagesLoading,
                maxEditorHeight: maxEditorHeight
            )
        }
    }

    /// 读历史失败：居中的一句 15 灰字 + 蓝色的"重试"（Android 的 TextButton：14 / 500、最小高 40、左右 12）。四周留 24。
    private var loadFailed: some View {
        VStack(spacing: 0) {
            Text(L("messages_load_failed"))
                .font(.nf(15))
                .foregroundStyle(Sm.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                app.chat.reloadActive()
            } label: {
                Text(L("retry"))
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(Sm.blue)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
            }
            .buttonStyle(.pressable(cornerRadius: 4.8, scale: 0.97))
        }
        .padding(ChatMetrics.pageGutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// 列表不显示（读取失败 / 没有消息）时，这段聊天的定位请求找不到目标：作废。
    private func consumeRevealWithoutList() {
        let state = app.chat.state
        guard let request = state.reveal, state.messagesFailed || state.messages.isEmpty else { return }
        let step = revealStep(
            requestSessionId: request.sessionId,
            activeSessionId: state.activeSessionId,
            messagesLoading: state.messagesLoading,
            messagesFailed: state.messagesFailed,
            messageIds: state.messages.map(\.id),
            messageId: request.messageId
        )
        if step == .notFound { app.chat.consumeReveal(request.token) }
    }

    /// 笔记列表变了（导出、应用了提案）或换了身份就重读；读不到当作没有。不显示时清空，回来时从空的开始。
    private func loadRecentNotes(show: Bool) async {
        guard show else {
            if !recentNotes.isEmpty { recentNotes = [] }
            return
        }
        let loaded = (try? await app.api.recentNotes()) ?? []
        if Task.isCancelled { return }
        if recentNotes != loaded { recentNotes = loaded }
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

/// 「最近编辑」要重读的时机（Android：key(account.user?.email) + produceState(notes.pages)）。
private struct ChatRecentNotesTrigger: Equatable {
    let show: Bool
    let pages: [NotePageSummary]
    let email: String?
    let identity: Int
}

/// 「＋」抽屉里的内容：自己读聊天状态，抽屉开着时「生成图片」的勾和「整理成笔记」能不能点跟着变。
@MainActor
private struct ChatAttachSheetContent: View {
    let onScheduleAction: (@escaping () -> Void) -> Void
    let onPickFiles: () -> Void
    let onAttachPages: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let state = app.chat.state
        AttachSheet(
            imageMode: state.imageMode,
            onScheduleAction: onScheduleAction,
            onPickFiles: onPickFiles,
            onAttachPages: onAttachPages,
            onToggleImageMode: { app.chat.setImageMode(!app.chat.state.imageMode) },
            onCreatePage: createPageAction(state),
            // 网页：当前聊天在发送（含上传附件）时不能点，最后的回答还没存下。
            createPageEnabled: !state.sending && state.upload == nil
        )
    }

    /// 「整理成笔记」：有消息的已保存聊天才有（读历史中 / 失败时也算有，和 Android 的 isEmptyChat 一样）。
    private func createPageAction(_ state: ChatUiState) -> (() -> Void)? {
        let isEmptyChat = state.messages.isEmpty && !state.messagesLoading && !state.messagesFailed
        guard let sessionId = state.activeSessionId, !isEmptyChat else { return nil }
        let router = self.router
        return { router.createPageSessionId = sessionId }
    }
}
