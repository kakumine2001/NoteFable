#if DEBUG
import Foundation

/// iOS 27 模拟器上聊天消息区空白的对照场景（`ci-screenshots.sh` 的对照轮次，见 `scripts/ci-chat-control.sh`）。
/// 每个场景先回到空白首页（停掉进行中的回答、清掉缓存、等消息列表从界面上拿掉），再自己做准备：和场景顺序无关。
/// 就绪只看状态；消息区是不是空白由 `chat-blank-check.py` 在截图里查。
@MainActor
struct FixtureChatControl {
    private let app: AppEnvironment
    private let router: AppRouter
    private let deadline = Date().addingTimeInterval(45)

    init(app: AppEnvironment, router: AppRouter) {
        self.app = app
        self.router = router
    }

    func prepare(_ scene: ScreenshotScene) async -> Bool {
        guard await reset() else { return false }
        switch scene {
        case .chatEditorSend:
            // 原来出问题的顺序（chat-streamed 紧跟在编辑页场景后面）：刚从编辑页回到聊天就在同一轮里开新聊天并发送。
            guard await show(FixtureCatalog.IDs.kyotoSession), await openNote(), await returnToChat() else { return false }
            return await startNewChatAndSend()

        case .chatAfterEditor:
            // 看着长的京都聊天时打开一篇笔记，再回到聊天：对话没换。
            guard await show(FixtureCatalog.IDs.kyotoSession), await openNote(), await returnToChat() else { return false }
            await pause(1000)
            return chatShown(FixtureCatalog.IDs.kyotoSession)

        case .chatStreamedSettled:
            // 同 chat-editor-send，但回到聊天停稳 1.5 秒后才开新聊天并发送。
            guard await show(FixtureCatalog.IDs.kyotoSession), await openNote(), await returnToChat() else { return false }
            await pause(1500)
            return await startNewChatAndSend()

        case .chatSwitchVisible:
            // 聊天标签停在京都聊天上，打开一段读过的短聊天（侧栏点聊天走的就是 openChat）：没有编辑页、不换标签。
            guard await show(FixtureCatalog.IDs.glassSession), await show(FixtureCatalog.IDs.kyotoSession) else { return false }
            router.openChat(FixtureCatalog.IDs.glassSession)
            return await shownAndSettled(FixtureCatalog.IDs.glassSession)

        case .chatEditorLink:
            // 笔记里的聊天链接 / 反向链接（不带 messageId）：离开编辑页、切标签、换对话在同一轮里。
            guard await show(FixtureCatalog.IDs.glassSession), await show(FixtureCatalog.IDs.kyotoSession),
                  await openNote()
            else { return false }
            router.openChat(FixtureCatalog.IDs.glassSession)
            return await shownAndSettled(FixtureCatalog.IDs.glassSession)

        case .chatNewSend:
            // 真实的第一次发送：开新聊天，空白首页画出来之后才发。
            guard await show(FixtureCatalog.IDs.kyotoSession) else { return false }
            app.chat.newChat()
            await waitForListGone()
            await pause(500)
            app.chat.send(FixtureCatalog.Prompts.streamed)
            return await answered()

        case .chatRegenerate:
            // 很长的最后回答停在底部时重新生成：条数不变、内容一下子变短，新回答保持生成中。
            guard await show(FixtureCatalog.IDs.longSession), let answer = app.chat.state.messages.last else { return false }
            app.chat.regenerate(answer.id)
            let replaced = await poll {
                app.chat.state.messages.last.map { $0.id != answer.id && !$0.content.isEmpty } == true
            }
            await pause(1000)
            return replaced && app.chat.state.sending

        default:
            return false
        }
    }

    // MARK: - 步骤

    /// 回到空白首页：停掉进行中的回答、清掉缓存（和登录 / 退出时一样），等消息列表从界面上拿掉。
    private func reset() async -> Bool {
        guard await returnToChat() else { return false }
        app.chat.onIdentityChanged()
        guard await poll({ app.chat.state.messages.isEmpty && !app.chat.state.sessionsLoading }) else { return false }
        await waitForListGone()
        await pause(300)
        return true
    }

    /// 等消息列表从界面上拿掉（空白首页画出来了），最多 5 秒。没拿掉也接着做，往日志记一行（脚本写进结果）。
    private func waitForListGone() async {
        let limit = Date().addingTimeInterval(5)
        while ChatDebug.list != nil && Date() < limit {
            try? await Task.sleep(for: .milliseconds(50))
        }
        if ChatDebug.list != nil { FixtureLaunch.writeStderr("NF_CHAT_NOTE list-still-on-screen\n") }
    }

    /// 切到聊天标签（笔记开着时先保存），等界面切过去。
    private func returnToChat() async -> Bool {
        router.selectTab(.chat)
        return await poll { onChat }
    }

    private var onChat: Bool {
        router.selectedTab == .chat && app.notes.state.workspace == .chat && app.notes.state.open == nil
    }

    private func chatShown(_ sessionId: String) -> Bool {
        onChat && app.chat.state.activeSessionId == sessionId && !app.chat.state.messagesLoading
            && !app.chat.state.messages.isEmpty
    }

    /// 打开一段聊天，等消息列表建好、停在底部。
    private func show(_ sessionId: String) async -> Bool {
        app.chat.openSession(sessionId)
        guard await poll({ chatShown(sessionId) }) else { return false }
        await pause(800)
        return true
    }

    private func shownAndSettled(_ sessionId: String) async -> Bool {
        guard await poll({ chatShown(sessionId) }) else { return false }
        await pause(1000)
        return true
    }

    /// 在工作区打开一篇笔记，等编辑页就绪（底栏收起）。
    private func openNote() async -> Bool {
        let id = FixtureCatalog.IDs.tripPage
        guard let page = FixtureCatalog.editorPages[id] else { return false }
        if !app.notes.state.loaded || app.notes.state.pages.isEmpty { app.notes.refresh() }
        guard await poll({ app.notes.state.loaded && app.notes.state.pages.contains { $0.id == id } }) else { return false }
        router.openNote(id, title: page.title, icon: page.icon, kind: page.kind)
        let ready = await poll {
            router.selectedTab == .workspace && app.notes.state.open?.id == id && app.notes.state.saveState == "saved"
        }
        await pause(700)
        return ready
    }

    private func startNewChatAndSend() async -> Bool {
        app.chat.newChat()
        app.chat.send(FixtureCatalog.Prompts.streamed)
        return await answered()
    }

    /// 发出去的提问答完了。
    private func answered() async -> Bool {
        await poll {
            onChat && !app.chat.state.sending
                && app.chat.state.messages.last.map { $0.role == .assistant && !$0.content.isEmpty } == true
        }
    }

    // MARK: - 小工具

    private func poll(_ condition: () -> Bool) async -> Bool {
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    private func pause(_ milliseconds: Int) async {
        try? await Task.sleep(for: .milliseconds(milliseconds))
    }
}
#endif
