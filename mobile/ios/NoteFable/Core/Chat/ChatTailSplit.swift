import Foundation

/// 消息列表分成两段（只在 iOS 27 起用，`ChatListRepair`）：列表建好时已有的历史放在懒加载栈里；当时的最后一个回合
/// （最后一条提问和它后面的行）以及之后新来的行放在下面不懒加载的栈里，它们换掉、变短时高度都是当场量的。
/// 哪些行算历史只在第一次分的时候定下，一个列表用一个实例：留着的行从不在两段之间搬
/// （搬了 SwiftUI 会重建它，没发出去的改写、开着的菜单和对话框、进行中的对话下载就丢了）。
final class ChatTailSplit {
    private var historyKeys: Set<String>?

    /// `messages` 开头有几条放在懒加载栈里：开头连续的历史行。
    func historyCount(_ messages: [UiMessage]) -> Int {
        let history = historyKeys ?? Set(messages.prefix(messages.lastIndex { $0.role == .user } ?? 0).map(\.key))
        historyKeys = history
        return messages.firstIndex { !history.contains($0.key) } ?? messages.count
    }
}
