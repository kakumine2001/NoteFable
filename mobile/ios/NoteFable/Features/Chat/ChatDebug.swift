#if DEBUG
import SwiftUI

/// 排查工具：iOS 27 模拟器上聊天消息区偶尔整个空白（顶栏和输入栏照常），原因还没确定。只编进 Debug。
///
/// - 启动参数（默认全关，各自单独打开，行为见 `ChatScrollController` / `ChatWorkspace`）：
///   `-NFChatListIdentity YES` 候选修复 A：每换一次对话用一个新的消息列表；
///   `-NFChatPinPastEnd YES` 候选修复 B：离底部的距离保留负数，滚过末尾时贴回去；
///   下面三个针对"内容一下子变短后懒加载列表还留着旧高度"，在开着的对话里有行换掉时（`debugBranchId`）起作用：
///   `-NFChatBranchIdentity YES` 候选修复 C：整个消息列表换新的（新的 UIScrollView 和控制器，回到最底部）；
///   `-NFChatScrollToRow YES` 候选修复 D：用 SwiftUI 的 `ScrollViewReader` 滚到最后一行（没在跟随时滚到换上来的行），
///   让它排出来，这期间控制器不贴底；
///   `-NFChatStackIdentity YES` 候选修复 E：只换里面的 `LazyVStack`（UIScrollView 和位置保留），跟随中的话再贴一次底；
///   `-NFChatNoPin YES` 滚动控制器从不贴底（看是不是我们的代码引起的）。
/// - 截图场景就绪时向 stderr 记一行 `NF_CHAT_GEOMETRY`（`FixtureLaunch`），`chat-blank-check.py` 按它在截图里查消息区。
@MainActor
enum ChatDebug {
    static let listIdentity = UserDefaults.standard.bool(forKey: "NFChatListIdentity")
    static let pinPastEnd = UserDefaults.standard.bool(forKey: "NFChatPinPastEnd")
    static let noPin = UserDefaults.standard.bool(forKey: "NFChatNoPin")
    static let branchIdentity = UserDefaults.standard.bool(forKey: "NFChatBranchIdentity")
    static let scrollToRow = UserDefaults.standard.bool(forKey: "NFChatScrollToRow")
    static let stackIdentity = UserDefaults.standard.bool(forKey: "NFChatStackIdentity")

    private struct Entry {
        weak var controller: ChatScrollController?
    }

    private static var entries: [Entry] = []

    /// 滚动控制器接 UIScrollView 时记下来。
    static func track(_ controller: ChatScrollController) {
        entries.removeAll { $0.controller == nil || $0.controller === controller }
        entries.append(Entry(controller: controller))
    }

    /// 现在画在窗口里的消息列表（最近接上的那个）；空白首页、读取中、不在聊天标签时是 nil。
    static var list: ChatScrollController? {
        entries.reversed().compactMap(\.controller).first(where: { $0.debugInWindow })
    }

    /// READY 前的一行：当前聊天和消息列表的几何；不在聊天画面时是 nil。
    static func geometryLine(scene: String, idxPart: String, app: AppEnvironment, router: AppRouter) -> String? {
        guard router.selectedTab == .chat, !router.settingsOpen, !router.signInOpen else { return nil }
        let state = app.chat.state
        var line = "NF_CHAT_GEOMETRY\(idxPart) scene=\(scene) session=\(state.activeSessionId ?? "new")"
        line += " messages=\(state.messages.count) loading=\(state.messagesLoading)"
        if let list {
            line += " list=1 \(list.debugGeometry)"
        } else {
            line += " list=0"
        }
        return line + "\n"
    }
}

@MainActor
extension View {
    /// 记下懒加载列表里出现着、出现过的行。
    func chatDebugRow(_ key: String, of scroll: ChatScrollController) -> some View {
        // 按次数记：整个 LazyVStack 换掉时（候选修复 E），同一个 key 的新行可能比旧行消失得早。
        onAppear {
            scroll.debugRowsOn[key, default: 0] += 1
            scroll.debugRowsEver.insert(key)
        }
        .onDisappear { scroll.debugRowsOn[key, default: 0] -= 1 }
    }

    /// 候选修复 A（每段对话）和 C（对话里有行换掉）：换一个新列表（新的 UIScrollView 和控制器）。
    /// 两个开关都关着时原样返回，不加 id。
    @ViewBuilder
    func chatDebugListIdentity(conversation: Int, branch: Int) -> some View {
        if ChatDebug.listIdentity || ChatDebug.branchIdentity {
            self.id("\(ChatDebug.listIdentity ? conversation : 0)-\(ChatDebug.branchIdentity ? branch : 0)")
        } else {
            self
        }
    }

    /// 候选修复 E：对话里有行换掉时换一个新的懒加载栈（里面的行重新建、重新量高）。
    @ViewBuilder
    func chatDebugStackIdentity(_ branch: Int) -> some View {
        if ChatDebug.stackIdentity {
            self.id(branch)
        } else {
            self
        }
    }
}
#endif
