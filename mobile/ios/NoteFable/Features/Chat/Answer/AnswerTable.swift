import SwiftUI
import UIKit

/// GFM 表格（网页 .markdown-body table / th / td，Android `AnswerTable`）：单元格 1px --notion-border-strong 边框、
/// 内边距 7.2×11.2、左上对齐、最窄 88（手机）；表头 --nf-user-bubble 底、--nf-ink、600。
/// 列宽按浏览器自动表格布局的做法分配（`AnswerTableLayout.columnWidths`）：每列最窄 = max(88, 最长的词)，最宽 = 不折行的宽度；
/// 全放得下用最宽，最窄都放不下就用最窄并横向滚动，中间情况按比例分。单元格一律左对齐、顶端对齐（网页的 CSS 盖过了 GFM 的对齐标记）。
struct AnswerTable: View, Equatable {
    let table: MarkdownTable
    let muted: Bool

    @Environment(AppEnvironment.self) private var app
    /// 正文的宽度（量出来之前是 0，这时先不画）。
    @State private var available: CGFloat = 0

    static func == (lhs: AnswerTable, rhs: AnswerTable) -> Bool {
        lhs.table == rhs.table && lhs.muted == rhs.muted
    }

    /// 表头（第 0 行）和各行摊平后的单元格。
    private var rows: [[[AnswerInlinePiece]]] {
        ([table.header] + table.rows).map { row in row.map { AnswerInlinePiece.flatten($0) } }
    }

    private func style(row: Int) -> AnswerTextStyle {
        row == 0 ? .tableHeader : .body(muted: muted)
    }

    var body: some View {
        let rows = self.rows
        let columns = table.columnCount
        VStack(alignment: .leading, spacing: 0) {
            // 量正文的宽度（不占高度）。
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 0)
                .nfOnSizeChange { size in
                    if abs(size.width - available) > 0.5 { available = size.width }
                }
            if available > 0, columns > 0 {
                let widths = columnWidths(rows, columns: columns)
                ScrollView(.horizontal) {
                    grid(rows, widths: widths)
                }
                .scrollIndicators(.hidden)
                // 放得下时不能横向拖动。
                .scrollBounceBehavior(.basedOnSize, axes: [.horizontal])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @MainActor
    private func columnWidths(_ rows: [[[AnswerInlinePiece]]], columns: Int) -> [CGFloat] {
        let links = AnswerLinkResolver(baseURL: app.config.baseURL)
        let widths = AnswerTableLayout.columnWidths(rows: rows.count, columns: columns, available: Double(available)) { row, column in
            guard row < rows.count, column < rows[row].count else { return AnswerTableLayout.CellWidth(min: 0, max: 0) }
            let text = AnswerInlineRenderer.attributedString(rows[row][column], style: style(row: row), links: links)
            return AnswerInlineRenderer.measure(text)
        }
        return widths.map { CGFloat($0) }
    }

    private func grid(_ rows: [[[AnswerInlinePiece]]], widths: [CGFloat]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(widths.enumerated()), id: \.offset) { column, width in
                        cell(column < row.count ? row[column] : [], row: rowIndex, width: width)
                    }
                }
                // 一行里的单元格一样高（最高的那个），边框才连得上。
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        // 表格的上边和行首边；每个单元格自己画行尾边和下边（border-collapse）。
        .overlay(alignment: .top) { NFDivider(.horizontal, color: Sm.borderStrong) }
        .overlay(alignment: .leading) { NFDivider(.vertical, color: Sm.borderStrong) }
    }

    private func cell(_ pieces: [AnswerInlinePiece], row: Int, width: CGFloat) -> some View {
        AnswerRichText(pieces: pieces, style: style(row: row))
            .padding(.horizontal, CGFloat(AnswerTableLayout.cellPaddingH))
            .padding(.vertical, CGFloat(AnswerTableLayout.cellPaddingV))
            .frame(width: width, alignment: .topLeading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            // 表头的底：--nf-user-bubble；深色是 rgba(255,255,255,.05)。
            .background(row == 0 ? Color(light: 0xFFF3F5F9, dark: 0x0DFFFFFF) : Color.clear)
            .overlay(alignment: .trailing) { NFDivider(.vertical, color: Sm.borderStrong) }
            .overlay(alignment: .bottom) { NFDivider(.horizontal, color: Sm.borderStrong) }
    }
}
