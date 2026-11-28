import Foundation

/// 消息列表分成两段（只在 iOS 27 起用，`ChatListRepair`）：历史放在懒加载栈里；最后一个回合（最后一条提问和它后面的行）
/// 以及开着对话时在它后面新来的行放在下面不懒加载的栈里，它们换掉、变短时高度都是当场量的。一个列表用一个实例：
/// - 画过的行留在原来那一段（搬了 SwiftUI 会重建它，没发出去的改写、开着的菜单和对话框、进行中的对话下载就丢了）；
/// - 没画过的行，在最后一个回合之前的进懒加载栈（切换或改写更早的提问后，换上来的长对话不会整段当场建出来）；
///   接在下面那一段的行后面的只能也在下面（两段是前后相接的）；
/// - 下面超过 `tailLimit` 行时，只把最早的几行搬进懒加载栈，最后一个回合不搬。
final class ChatTailSplit {
    static let tailLimit = 20

    /// 画过的行在哪一段（`true` 是懒加载栈）；没有记录的行还没画过。
    private var lazyByKey: [String: Bool] = [:]

    /// `messages` 开头有几条放在懒加载栈里。
    func historyCount(_ messages: [UiMessage]) -> Int {
        let lastQuestion = messages.lastIndex { $0.role == .user } ?? 0
        let kept = messages.indices.first { !(lazyByKey[messages[$0].key] ?? ($0 < lastQuestion)) } ?? messages.count
        let count = max(kept, min(messages.count - Self.tailLimit, lastQuestion))
        for (index, message) in messages.enumerated() { lazyByKey[message.key] = index < count }
        return count
    }
}
