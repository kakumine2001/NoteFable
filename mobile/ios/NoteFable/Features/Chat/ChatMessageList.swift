import SwiftUI

/// 定位请求（检索结果、?chat=&message= 链接）要重新看一遍的时机：请求本身、当前会话、读取状态、消息条数任何一个变了
/// （Android `revealMessage` 里 LaunchedEffect 的 key）。
struct ChatRevealTrigger: Equatable {
    let token: Int?
    let sessionId: String?
    let loading: Bool
    let failed: Bool
    let count: Int

    init(_ state: ChatUiState) {
        token = state.reveal?.token
        sessionId = state.activeSessionId
        loading = state.messagesLoading
        failed = state.messagesFailed
        count = state.messages.count
    }
}

/// 消息列表（Android ChatScreen.kt 的 `MessageList` 里有消息的那一支）：正向排列，短对话从顶部开始。
/// 左右 24、顶部 4、底部 96（网页消息列的 pb-12 + 输入栏区顶部"滚动到底部"那一行），消息间距 36。
/// 列表铺到浮动顶栏和输入栏下面，两条栏通过安全区为消息留出空间。
/// 提问由 `UserTurn` 画，回答交给 `AssistantTurn`。跟随底部的规则在 `ChatScrollController`。
@MainActor
struct ChatMessageList: View {
    /// 这个聊天在发送、上传或读取：提问下面的编辑、版本切换不能点（Android TurnActions.busy）。
    let busy: Bool
    /// 提问的编辑框最高到多少（窗口高度的 40%）。
    let maxEditorHeight: CGFloat

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scroll = ChatScrollController()
    @State private var atBottom = true
    @State private var flash: RevealFlash?
    /// iOS 27 起哪些行放在懒加载栈里（`turns`）；跟着这个列表走，换对话时是新的列表（`ChatListRepair`）。
    @State private var split = ChatTailSplit()

    var body: some View {
        let state = app.chat.state
        let messages = state.messages
        // 检索结果 / 链接要定位到某条消息：定位完之前不贴底（网页 openChatFromLink 关掉 pinToBottom）。
        let revealPending = state.reveal != nil && state.reveal?.sessionId == state.activeSessionId
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                turns(state)
                    .padding(.horizontal, ChatMetrics.pageGutter)
                    .padding(.top, 4)
                    .padding(.bottom, ChatMetrics.listBottomPadding)
                    // 对照网页 .notion-page-column：常规上限 47.5rem，1440 起按 48vw 在 50–55rem 间变化。
                    // 只收窄消息列；滚动视图仍铺满可用宽度，横向调整时也不会重建消息行。
                    .containerRelativeFrame(.horizontal) { width, _ in
                        let maxWidth: CGFloat = width < 1440 ? 760 : min(880, max(800, width * 0.48))
                        return min(width, maxWidth)
                    }
                    .frame(maxWidth: .infinity)
                    .background { ChatScrollProbe(controller: scroll) }
            }
            // 往下拖列表时键盘跟着手指收起。
            .scrollDismissesKeyboard(.interactively)
            .nfOnSizeChange { _ in scroll.viewportChanged() }
            // 浮动的顶栏 / 底栏、键盘、标签栏改的是安全区（UIScrollView 的 adjustedContentInset），不改列表的大小：
            // 安全区变了也重新看一遍跟随和贴底。
            .nfOnSafeAreaChange { _ in scroll.viewportChanged() }
            .onAppear {
                // 打开会话先到最底部；懒加载的列表按 id 跳最稳，剩下的底部留白由跟随规则贴齐。
                if let last = messages.last, !revealPending { proxy.scrollTo(last.key, anchor: .bottom) }
            }
            .task(id: ChatRevealTrigger(state)) { await reveal(proxy) }
        }
        .overlay(alignment: .bottom) {
            ChatScrollToBottomButton(visible: !atBottom) {
                Haptics.light()
                scroll.scrollToBottom(animated: !state.sending && !reduceMotion)
            }
        }
        .onAppear {
            scroll.hasItems = !messages.isEmpty
            scroll.onAtBottomChange = { value in atBottom = value }
        }
        // 换了会话、发出或收到新消息：重新跟随（Android LaunchedEffect(activeSessionId, messages.size)）。
        // 几个 onChange 的先后没有保证：跟随前先同步定位状态，打开另一段聊天的检索结果时不先贴一次底。
        .onChange(of: state.activeSessionId) { _, _ in
            scroll.revealPending = revealPending
            scroll.follow()
        }
        .onChange(of: messages.count) { _, count in
            scroll.hasItems = count > 0
            scroll.revealPending = revealPending
            scroll.follow()
        }
        .onChange(of: revealPending, initial: true) { _, pending in
            scroll.revealPending = pending
            scroll.evaluate()
        }
        // 闪完就作废（网页 clearFlash 在 2 秒后去掉 class）：从侧栏重开这段聊天时不再闪。
        .task(id: flash) {
            guard let current = flash else { return }
            try? await Task.sleep(nanoseconds: UInt64(RevealFlash.durationMs + 50) * 1_000_000)
            if !Task.isCancelled, flash == current { flash = nil }
        }
        .task(id: "\(ScreenshotHooks.sceneTick)-\(messages.count)") {
            await runScrolledHook(hasMessages: !messages.isEmpty)
        }
    }

    /// CI 截图 chat-scrolled：离开底部，让消息在玻璃顶栏下面、"滚动到底部"按钮也显示出来。
    /// 应用商店的回答、表格两张（store-answer / store-table）滚回最上面，提问也在画面里。
    private func runScrolledHook(hasMessages: Bool) async {
        guard ScreenshotHooks.isActive, hasMessages, let scene = ScreenshotHooks.scene,
              scene == .chatScrolled || scene == .storeAnswer || scene == .storeTable
        else { return }
        // 等打开会话时的贴底先做完。
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        guard ScreenshotHooks.consume(scene) else { return }
        #if DEBUG
        // 比内容还长的距离就是滚到最上面。
        await scroll.fixtureScroll(distanceFromBottom: scene == .chatScrolled ? 360 : CGFloat.greatestFiniteMagnitude)
        #endif
        ScreenshotHooks.markReady(scene)
    }

    /// 所有消息。iOS 26 及更早是一个懒加载栈。iOS 27 起分成两段（`ChatTailSplit`）：历史仍然懒加载，最后一个回合和
    /// 之后新来的行放在下面的普通栈里，它们换掉、变短时懒加载栈里不会留下旧高度（`ChatListRepair`）。
    @ViewBuilder
    private func turns(_ state: ChatUiState) -> some View {
        let count = state.messages.count
        if ChatListRepair.isNeeded {
            let history = split.historyCount(state.messages)
            VStack(alignment: .leading, spacing: 0) {
                LazyVStack(alignment: .leading, spacing: ChatMetrics.turnGap) {
                    rows(state, in: 0..<history)
                }
                VStack(alignment: .leading, spacing: ChatMetrics.turnGap) {
                    rows(state, in: history..<count)
                }
                // 两段之间也是消息间距；有一段是空的时不留。
                .padding(.top, history > 0 && history < count ? ChatMetrics.turnGap : 0)
            }
        } else {
            LazyVStack(alignment: .leading, spacing: ChatMetrics.turnGap) {
                rows(state, in: 0..<count)
            }
        }
    }

    private func rows(_ state: ChatUiState, in range: Range<Int>) -> some View {
        let messages = state.messages
        return ForEach(Array(messages.enumerated())[range], id: \.element.key) { index, message in
            row(
                message,
                reply: index + 1 < messages.count ? messages[index + 1] : nil,
                isLatest: index == messages.count - 1,
                sessionId: state.activeSessionId,
                rejectedEdit: state.rejectedEdit
            )
        }
    }

    @ViewBuilder
    private func row(_ message: UiMessage, reply: UiMessage?, isLatest: Bool, sessionId: String?, rejectedEdit: RejectedEdit?) -> some View {
        Group {
            if message.role == .user {
                // 生成图片的提问不能编辑（改写后会按文字回答重做；网页 page.tsx 的 canEdit）。
                let imageReply = reply?.role == .assistant && reply?.isImageAnswer == true
                UserTurn(
                    message: message,
                    canEdit: !imageReply,
                    editDraft: rejectedEdit?.messageId == message.id ? rejectedEdit?.text : nil,
                    busy: busy,
                    maxEditorHeight: maxEditorHeight
                )
            } else {
                AssistantTurn(message: message, sessionId: sessionId, isLatest: isLatest)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(ChatRevealFlashModifier(flash: flash?.messageId == message.id ? flash : nil))
    }

    /// 读完后滚到那条消息、放在可视区中间并闪一下；滚到了就停止跟随（否则马上被拉回底部），
    /// 消息已不存在就恢复跟随，和平常一样停在最底部（Android SearchScreen.kt 的 revealMessage）。
    private func reveal(_ proxy: ScrollViewProxy) async {
        let state = app.chat.state
        guard let request = state.reveal else { return }
        let step = revealStep(
            requestSessionId: request.sessionId,
            activeSessionId: state.activeSessionId,
            messagesLoading: state.messagesLoading,
            messagesFailed: state.messagesFailed,
            messageIds: state.messages.map(\.id),
            messageId: request.messageId
        )
        switch step {
        case .wait:
            return
        case .notFound:
            scroll.following = true
            app.chat.consumeReveal(request.token)
        case .scroll(let index):
            guard index < state.messages.count else { return }
            let key = state.messages[index].key
            // 等这段聊天的列表排好再滚。
            try? await Task.sleep(nanoseconds: 60_000_000)
            if Task.isCancelled { return }
            scroll.following = false
            // 先跳过去（目标可能还没被懒加载出来），行高量准后再平滑地对到中间。
            proxy.scrollTo(key, anchor: .center)
            try? await Task.sleep(nanoseconds: 80_000_000)
            if Task.isCancelled { return }
            withAnimation(reduceMotion ? nil : Animation.easeOut(duration: 0.25)) {
                proxy.scrollTo(key, anchor: .center)
            }
            flash = RevealFlash(
                messageId: request.messageId,
                token: request.token,
                startMs: Int(Date().timeIntervalSince1970 * 1000)
            )
            app.chat.consumeReveal(request.token)
        }
    }
}

/// 定位到的消息闪 2 秒（search-dialog.css 的 .search-reveal-flash）：圆角 6 的黄色底 rgba(255,207,0,.42) 保持 1.2 秒，
/// 再连同 3px 的外圈 rgba(255,207,0,.5) 一起淡出。强度按开始时间算：滚出屏幕再回来接着当前进度，不从头再闪。
private struct ChatRevealFlashModifier: ViewModifier {
    let flash: RevealFlash?

    func body(content: Content) -> some View {
        content.background {
            if let flash {
                TimelineView(.animation) { context in
                    let level = flash.level(at: Int(context.date.timeIntervalSince1970 * 1000))
                    let color = Color(argb: RevealFlash.color)
                    let ring = CGFloat(RevealFlash.ringWidth)
                    let radius = CGFloat(RevealFlash.cornerRadius)
                    ZStack {
                        RoundedRectangle(cornerRadius: radius)
                            .fill(color.opacity(RevealFlash.fillAlpha * level))
                        // 外圈画在边界外面：线的中心在外扩半个线宽的地方。
                        RoundedRectangle(cornerRadius: radius + ring / 2)
                            .stroke(color.opacity(RevealFlash.ringAlpha * level), lineWidth: ring)
                            .padding(-ring / 2)
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
    }
}

/// "滚动到底部"（.notion-scroll-bottom 里的 .notion-icon-button）：40 的玻璃圆（iOS 26 Liquid Glass；iOS 17–18 毛玻璃；
/// “降低透明度”时白底加描边），ArrowDown 20 / 描边 2.1。离开底部时 150ms 淡入 + 从 .95 放大。
/// 按钮在列表可见区的底边上方 8：整颗圆都在浮动输入栏的上面（不被输入栏的底条、分隔线或点按区挡住）。
private struct ChatScrollToBottomButton: View {
    let visible: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NFGlassIconButton(Lucide.arrowDown, label: L("scroll_to_bottom"), size: 40, iconSize: 20, strokeWidth: 2.1, action: action)
            .opacity(visible ? 1 : 0)
            .scaleEffect(visible ? 1 : 0.95)
            .animation(NFMotion.unlessReduced(Animation.timingCurve(0.4, 0, 0.2, 1, duration: 0.15), reduceMotion), value: visible)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
            .padding(.bottom, 8)
    }
}
