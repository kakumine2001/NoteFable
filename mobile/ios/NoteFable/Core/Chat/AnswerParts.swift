import Foundation

// 回答各部分里不属于界面的计算（Android ui/AnswerMarkdown.kt、ui/ChatActivity.kt 里能单独测试的函数，对应 AnswerPartsTest）。
// 长度都用 Double（1pt = 网页的 1 CSS px）。

/// GFM 表格（网页 .markdown-body table / th / td）的尺寸和列宽分配。
enum AnswerTableLayout {
    /// 手机上 th / td 的 min-width 5.5rem（含内边距和边框）。
    static let cellMinWidth: Double = 88
    static let cellPaddingH: Double = 11.2
    static let cellPaddingV: Double = 7.2

    /// 一个单元格里的文字要多宽（不含内边距）：`min` 是最长的那个不能折行的词，`max` 是整段不折行。
    struct CellWidth: Equatable, Sendable {
        let min: Double
        let max: Double
    }

    /// 按浏览器自动表格布局的做法分配列宽：每列最窄 = max(88, 最长的词)，最宽 = 不折行的宽度；
    /// 全放得下用最宽，最窄都放不下就用最窄（表格比可用宽度宽，由界面横向滚动），中间情况按 (最宽 − 最窄) 的比例分配多出来的宽度。
    /// 量文字由界面注入（`measure(行, 列)`，行 0 是表头；没有这个单元格时返回 0）：Core 不依赖 UIKit。
    static func columnWidths(
        rows: Int,
        columns: Int,
        available: Double,
        measure: (_ row: Int, _ column: Int) -> CellWidth
    ) -> [Double] {
        guard rows > 0, columns > 0 else { return [] }
        var minWidths = [Double](repeating: cellMinWidth, count: columns)
        var maxWidths = [Double](repeating: cellMinWidth, count: columns)
        for row in 0..<rows {
            for column in 0..<columns {
                let width = measure(row, column)
                // 向上取整：差零点几个点就会让最后一个词折行。
                minWidths[column] = Swift.max(minWidths[column], (width.min + cellPaddingH * 2).rounded(.up))
                maxWidths[column] = Swift.max(maxWidths[column], (width.max + cellPaddingH * 2).rounded(.up))
            }
        }
        for column in 0..<columns { maxWidths[column] = Swift.max(maxWidths[column], minWidths[column]) }
        return tableColumnWidths(minWidths: minWidths, maxWidths: maxWidths, available: available)
    }
}

/// 浏览器自动表格布局的列宽分配（单独拿出来便于单元测试）。
func tableColumnWidths(minWidths: [Double], maxWidths: [Double], available: Double) -> [Double] {
    let minSum = minWidths.reduce(0, +)
    let maxSum = maxWidths.reduce(0, +)
    if maxSum <= available { return maxWidths }
    if minSum >= available || maxSum == minSum { return minWidths }
    let extra = available - minSum
    let spread = maxSum - minSum
    var widths = zip(minWidths, maxWidths).map { minimum, maximum in minimum + (maximum - minimum) * extra / spread }
    // 浮点误差补给最后一列，总宽正好等于可用宽度。
    if !widths.isEmpty { widths[widths.count - 1] += available - widths.reduce(0, +) }
    return widths
}

/// 有序列表第 `index` 项（从 0 数）的编号文字：从源文里写的起始号码接着数（网页 `<ol start>`）。
func orderedListMarker(start: Int, index: Int) -> String {
    "\(start + index)."
}

// 标签上同时写站点和页面名，同一站点的几条结果也能分开（网页 chat-activity.tsx 的 sourceLabel）。
func sourceLabel(_ url: String) -> String {
    guard let parsed = HttpUrl.parse(url) else { return url }
    // pathSegments 已经解码（网页 decodeURIComponent）。
    guard let segment = parsed.pathSegments.last(where: { !$0.isEmpty }) else { return Activity.hostOf(url) }
    return "\(Activity.hostOf(url)) › \(segment)"
}

// 主机名 + 路径（网页 shortUrl）。
func shortUrl(_ url: String) -> String {
    guard let parsed = HttpUrl.parse(url) else { return url }
    let path = parsed.encodedPath == "/" ? "" : ChatText.percentDecode(parsed.encodedPath)
    return Activity.hostOf(url) + path
}
