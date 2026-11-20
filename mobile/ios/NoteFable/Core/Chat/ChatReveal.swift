import Foundation

// 定位到消息（网页 src/lib/search-reveal.ts 的 revealChatMessage，Android ui/SearchScreen.kt 的后半）：消息读完后滚到它、
// 放在可视区中间，然后闪 2 秒（search-dialog.css 的 .search-reveal-flash：圆角 6，黄色底 rgba(255,207,0,.42) 保持到 60%，
// 再连同 3px 的外圈 rgba(255,207,0,.5) 一起淡出）。消息已不存在（删了）就和平常一样停在最底部。
// 这里只有纯逻辑：该不该滚、滚到哪、闪到什么程度；滚动和绘制在界面层。

/// 正在闪的消息：`startMs` 是开始闪的时刻（界面用的那个时钟的毫秒数），条目滚出屏幕再回来时按它接着闪，不从头重放。
struct RevealFlash: Equatable, Sendable {
    let messageId: String
    let token: Int
    let startMs: Int

    /// 闪烁的总时长和保持不变的那一段（网页 animation 2s，关键帧 0%–60% 保持）。
    static let durationMs = 2000
    static let holdMs = 1200

    /// 黄色（0xAARRGGBB，不含透明度）和各部分的透明度、尺寸。
    static let color: UInt32 = 0xFFFF_CF00
    static let fillAlpha: Double = 0.42
    static let ringAlpha: Double = 0.5
    static let ringWidth: Double = 3
    static let cornerRadius: Double = 6

    /// 开始闪之后 `nowMs` 时刻的强度（0…1）。
    func level(at nowMs: Int) -> Double {
        revealFlashLevel(nowMs - startMs)
    }
}

/// 拿到定位请求后先做什么。
enum RevealStep: Equatable, Sendable {
    /// 还不是这段聊天，或者消息还在读：等状态变了再看。
    case wait
    /// 消息不在这段聊天里（删了、读取失败）：和平常一样停在最底部，请求作废。
    case notFound
    /// 滚到第 `index` 条消息（正常顺序，最新的在最后）。
    case scroll(index: Int)
}

/// 定位请求的第一步判断（Android `revealMessage` 里 LaunchedEffect 的开头）。
func revealStep(
    requestSessionId: String,
    activeSessionId: String?,
    messagesLoading: Bool,
    messagesFailed: Bool,
    messageIds: [String],
    messageId: String
) -> RevealStep {
    if activeSessionId != requestSessionId || messagesLoading { return .wait }
    let index = messagesFailed ? -1 : revealIndex(messageIds, messageId)
    return index < 0 ? .notFound : .scroll(index: index)
}

/// 目标消息在列表里的位置（列表是正常顺序，最新的在最后）；没有就是 -1。
func revealIndex(_ messageIds: [String], _ messageId: String) -> Int {
    messageIds.firstIndex(of: messageId) ?? -1
}

/// 列表的这次布局是不是当前这段聊天的：项数对得上，且可见项的 key 都是当前消息的 id（消息 id 跨聊天唯一）。
/// 列表和上一段聊天共用滚动状态时，要等这段聊天的列表真正量好再判断目标在不在屏幕上。
func layoutIsCurrent(totalItems: Int, visibleKeys: [String], messageCount: Int, ids: Set<String>) -> Bool {
    totalItems == messageCount && !visibleKeys.isEmpty && visibleKeys.allSatisfy(ids.contains)
}

/// 把目标放到可视区中间要滚多少（正数往下滚）。
func revealScrollDelta(viewportStart: Double, viewportEnd: Double, itemOffset: Double, itemSize: Double) -> Double {
    (itemOffset + itemSize / 2) - (viewportStart + viewportEnd) / 2
}

/// 开始闪之后 `elapsedMs` 时的强度：1.2 秒保持 1，之后 0.8 秒 ease-out 淡到 0。
func revealFlashLevel(_ elapsedMs: Int) -> Double {
    if elapsedMs < RevealFlash.holdMs { return 1 }
    if elapsedMs >= RevealFlash.durationMs { return 0 }
    let fraction = Double(elapsedMs - RevealFlash.holdMs) / Double(RevealFlash.durationMs - RevealFlash.holdMs)
    return 1 - cubicBezier(fraction, x1: 0, y1: 0, x2: 0.58, y2: 1)
}

/// CSS 的 cubic-bezier(x1, y1, x2, y2)（ease-out 是 0, 0, 0.58, 1）：给定时间比例求进度。
func cubicBezier(_ fraction: Double, x1: Double, y1: Double, x2: Double, y2: Double) -> Double {
    if fraction <= 0 { return 0 }
    if fraction >= 1 { return 1 }
    func curve(_ t: Double, _ a: Double, _ b: Double) -> Double {
        let u = 1 - t
        return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
    }
    // x(t) 在 x1、x2 都落在 0…1 时单调，二分求 t。
    var low = 0.0
    var high = 1.0
    for _ in 0..<40 {
        let middle = (low + high) / 2
        if curve(middle, x1, x2) < fraction { low = middle } else { high = middle }
    }
    return curve((low + high) / 2, y1, y2)
}
