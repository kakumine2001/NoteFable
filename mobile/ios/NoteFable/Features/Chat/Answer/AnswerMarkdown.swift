import SwiftUI

// 回答正文（Android `AnswerMarkdown.kt`），对照网页 .markdown-body（src/app/globals.css）：
//  - 正文 16 / 行高 1.72；标题 24.8 / 20.8 / 17.28，字重 650、颜色 --nf-ink、行高 1.3、字距 -0.015em；
//  - 块之间的间距照 CSS 的外边距（相邻两块取大的那个）：段落、列表、引用、表格、分隔线 11.2，标题上 25.6 下 8.8，
//    代码块 16，独立公式 14.4；列表缩进 24（21.6 + 2.4），实心圆点，列表项间距 1.28（松散列表的段落上下 4）；
//  - 引用：左侧 3px 浅灰条，文字灰色，左内边距 14.4；链接蓝色、加粗、下划线；
//  - 行内代码、行内公式见 AnswerInlineText.swift；代码块见 CodeBlock.swift；表格见 AnswerTable.swift；独立公式见 MathRendering.swift。
// Android 用现成的 Markdown 渲染库；这里照 `MarkdownDocument` 的值树自己画。每个块是按块 id 认的 Equatable 视图：
// 回答一边生成，只有内容变了的那一块（通常是最后一块）重画。

/// 一条回答的正文。`content` 是 Markdown 原文；`muted` 是灰色的版本（引用块里用的那种）。
/// 文字能不能选中、有没有「问 NoteFable」由环境决定（`answerSelectable`、`answerQuote`，见 `AssistantTurn`）。
struct AnswerMarkdown: View {
    private let content: String
    private let muted: Bool
    @State private var parser = AnswerMarkdownParser()

    init(_ content: String, muted: Bool = false) {
        self.content = content
        self.muted = muted
    }

    var body: some View {
        AnswerBlocks(blocks: parser.document(content).blocks, muted: muted, paragraphMargin: AnswerSpacing.blockMargin)
    }
}

/// 记着上一次解析的结果：别的原因引起重画（比如操作行的状态变了）时不用再解析一遍。
private final class AnswerMarkdownParser {
    private var content: String?
    private var document = MarkdownDocument.empty

    func document(_ content: String) -> MarkdownDocument {
        if content != self.content {
            document = MarkdownDocument.parse(content)
            self.content = content
        }
        return document
    }
}

// MARK: - 间距

enum AnswerSpacing {
    /// 段落、列表、引用、表格、分隔线的上下外边距（0.7rem）。
    static let blockMargin: CGFloat = 11.2
    /// li 的上下外边距（0.08rem）。
    static let listItem: CGFloat = 1.28
    /// 松散列表里段落的上下外边距（li > p：0.25rem）。
    static let looseParagraph: CGFloat = 4

    /// 一个块的上、下外边距。`paragraph` 是段落的外边距：正文里 11.2，紧凑列表的项里 0（网页不包 <p>），松散列表的项里 4。
    static func margins(_ block: MarkdownBlock, paragraph: CGFloat) -> (top: CGFloat, bottom: CGFloat) {
        switch block.content {
        case .paragraph, .html: return (paragraph, paragraph)
        case .heading: return (25.6, 8.8)
        case .codeBlock: return (16, 16)
        case .math: return (14.4, 14.4)
        case .list, .blockQuote, .table, .thematicBreak: return (blockMargin, blockMargin)
        }
    }

    /// 相邻两块之间的距离：上一块的下外边距和下一块的上外边距取大的（CSS 的外边距折叠）。
    static func gap(_ previous: MarkdownBlock, _ next: MarkdownBlock, paragraph: CGFloat) -> CGFloat {
        max(margins(previous, paragraph: paragraph).bottom, margins(next, paragraph: paragraph).top)
    }
}

// MARK: - 一串块

/// 从上到下的一串块。第一块上面、最后一块下面不留距离（由外面决定）。
struct AnswerBlocks: View {
    let blocks: [MarkdownBlock]
    let muted: Bool
    let paragraphMargin: CGFloat

    private struct Entry: Identifiable {
        let block: MarkdownBlock
        let top: CGFloat
        var id: String { block.id }
    }

    private var entries: [Entry] {
        var out: [Entry] = []
        out.reserveCapacity(blocks.count)
        for (index, block) in blocks.enumerated() {
            let top = index == 0 ? 0 : AnswerSpacing.gap(blocks[index - 1], block, paragraph: paragraphMargin)
            out.append(Entry(block: block, top: top))
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(entries) { entry in
                AnswerBlockView(block: entry.block, muted: muted)
                    .equatable()
                    .padding(.top, entry.top)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 一个块

struct AnswerBlockView: View, Equatable {
    let block: MarkdownBlock
    let muted: Bool
    @Environment(\.layoutDirection) private var layoutDirection

    static func == (lhs: AnswerBlockView, rhs: AnswerBlockView) -> Bool {
        lhs.block == rhs.block && lhs.muted == rhs.muted
    }

    var body: some View {
        switch block.content {
        case .paragraph(let inlines):
            AnswerParagraph(inlines: inlines, style: .body(muted: muted))
        case .heading(let level, let inlines):
            AnswerParagraph(inlines: inlines, style: .heading(level: level, rtl: layoutDirection == .rightToLeft))
                .accessibilityAddTraits(.isHeader)
        case .list(let list):
            AnswerList(list: list, muted: muted)
        case .blockQuote(let blocks):
            // 引用里的内容一律灰色；左边 3px 的竖条和内容一样高。
            AnswerBlocks(blocks: blocks, muted: true, paragraphMargin: AnswerSpacing.blockMargin)
                .padding(.leading, 17.4)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Sm.borderStrong)
                        .frame(width: 3)
                }
        case .codeBlock(let language, let code):
            CodeBlock(code: code, language: language)
                .equatable()
        case .table(let table):
            AnswerTable(table: table, muted: muted)
                .equatable()
        case .thematicBreak:
            NFDivider()
        case .math(let latex):
            DisplayMath(latex: latex, ink: muted ? .muted : .text)
                .equatable()
        case .html(let text):
            // HTML 块当普通文字显示。
            AnswerParagraph(inlines: [.text(text)], style: .body(muted: muted))
        }
    }
}

// MARK: - 列表

/// 有序 / 无序 / 任务列表。标记放在 24 宽的缩进里，和每一项的第一行对齐；嵌套的列表在项的内容里接着画。
struct AnswerList: View {
    let list: MarkdownList
    let muted: Bool

    private struct Row: Identifiable {
        let index: Int
        let item: MarkdownListItem
        let top: CGFloat
        var id: String { item.id }
    }

    /// 紧凑列表的项里不包 <p>，段落没有外边距；松散列表的是 4。
    private var paragraphMargin: CGFloat {
        list.tight ? 0 : AnswerSpacing.looseParagraph
    }

    private var rows: [Row] {
        var out: [Row] = []
        out.reserveCapacity(list.items.count)
        for (index, item) in list.items.enumerated() {
            var top: CGFloat = 0
            if index > 0 {
                // li 之间 1.28；项里第一块 / 最后一块的外边距比它大时取大的（外边距穿过 li 折叠在一起）。
                top = AnswerSpacing.listItem
                if let last = list.items[index - 1].blocks.last {
                    top = max(top, AnswerSpacing.margins(last, paragraph: paragraphMargin).bottom)
                }
                if let first = item.blocks.first {
                    top = max(top, AnswerSpacing.margins(first, paragraph: paragraphMargin).top)
                }
            }
            out.append(Row(index: index, item: item, top: top))
        }
        return out
    }

    private var ink: Color {
        muted ? Sm.muted : Sm.text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                HStack(alignment: .top, spacing: 0) {
                    marker(row)
                    AnswerBlocks(blocks: row.item.blocks, muted: muted, paragraphMargin: paragraphMargin)
                }
                .padding(.top, row.top)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 缩进 24（ul / ol 的 padding 21.6 + li 的 2.4）里的标记，高度是正文的一行（27.52），和第一行文字对齐。
    @ViewBuilder
    private func marker(_ row: Row) -> some View {
        if let checked = row.item.checkbox {
            // 任务列表：不能点的小方框（网页是禁用的 <input type="checkbox">）。
            RoundedRectangle(cornerRadius: 3)
                .fill(checked ? Sm.blue : Color.clear)
                .overlay {
                    RoundedRectangle(cornerRadius: 3)
                        .strokeBorder(checked ? Sm.blue : Sm.borderStrong, lineWidth: 1)
                }
                .overlay {
                    if checked { LucideIcon(Lucide.check, size: 10, strokeWidth: 3, color: .white) }
                }
                .frame(width: 13, height: 13)
                .frame(width: 24, height: 27.52, alignment: .leading)
                .accessibilityHidden(true)
        } else if list.ordered {
            // 编号靠着正文（右边留 6），长编号向行首延伸，不挤正文也不折行。
            Text(orderedListMarker(start: list.start, index: row.index))
                .font(.nf(16))
                .nfLineHeight(27.52, fontSize: 16)
                .foregroundStyle(ink)
                .lineLimit(1)
                .fixedSize()
                .frame(width: 18, alignment: .trailing)
                .padding(.trailing, 6)
        } else {
            // 实心圆点：直径 5.6，圆心在缩进的行首起 7 处，比行的正中略高。
            Circle()
                .fill(ink)
                .frame(width: 5.6, height: 5.6)
                .padding(.leading, 4.2)
                .padding(.bottom, 4)
                .frame(width: 24, height: 27.52, alignment: .leading)
                .accessibilityHidden(true)
        }
    }
}
