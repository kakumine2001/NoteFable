import Foundation

/// Chat / Workspace 切换两键的宽度（网页 `.notion-segmented` 的 `repeat(2, minmax(max-content, 1fr))`，Android `segmentWidths`）。
/// 两边的名字都放得下一半时各占一半；一边比一半宽时它按自己的宽度、另一边拿剩下的；
/// 两边加起来都放不下时按各自宽度的比例分（文字自己省略）。
func workspaceSegmentWidths(available: Double, first: Double, second: Double) -> (first: Double, second: Double) {
    guard available > 0 else { return (0, 0) }
    let half = available / 2
    if first <= half && second <= half { return (half, available - half) }
    if first + second <= available {
        return first > half ? (first, available - first) : (available - second, second)
    }
    let share = available * first / (first + second)
    return (share, available - share)
}
