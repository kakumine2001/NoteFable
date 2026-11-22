import SwiftUI
import UIKit

// 回答里的代码块（网页 assistant-markdown.tsx 的 MarkdownCodeBlock + globals.css 的 .markdown-code-* / .hljs-*，Android `CodeBlock.kt`）：
//  - 外框：1px #e5e7eb、圆角 5.6、--notion-sidebar 底，上下外边距 16（由 AnswerMarkdown 的块间距给）；
//  - 头部：最低 48、下边线 #e5e7eb、白 .72 底、左 16 右 12.8；语言名 14.72 / 600 / #0f172a，前面 Code2 15（描边 2.2），间距 8；
//    复制键 32×32、圆角 8.8、#111827，Copy 20 / 复制后 Check 18 停 1.2 秒；
//  - 代码：内边距 15.2 / 24 / 21.6，等宽 15.2、行高 1.65、#111827，不折行，横向滚动；
//  - 高亮的颜色来自 `CodeHighlighter`（和网页的 highlight.js 主题同一套类别）。
// 代码始终从左往右排（网页 direction: ltr）。

// 深色（:root[data-theme="dark"] .markdown-code-*）：外框 --notion-border-strong、底 #1f1f22、标题栏底 rgba(255,255,255,.04)、
// 标题栏下的线 --notion-border、语言名 #e6e5e3、复制键 rgba(230,229,227,.72)（按下 rgba(255,255,255,.1)）。
// 代码本身的字网页深色下没有另外的值（仍是 #111827，在深色底上看不见），这里用语言名的 #e6e5e3。
private let codeBorder = Color(light: 0xFFE5E7EB, dark: 0x2EFFFFFF)
private let codeHeaderLine = Color(light: 0xFFE5E7EB, dark: 0x1AFFFFFF)
private let codeBackground = Color(light: 0xFFF7F7F5, dark: 0xFF1F1F22)
private let codeHeaderBackground = Color(light: 0xB8FFFFFF, dark: 0x0AFFFFFF)
private let codeInk = Color(light: CodeHighlighter.ink, dark: 0xFFE6E5E3)
private let codeCopyInk = Color(light: CodeHighlighter.ink, dark: 0xB8E6E5E3)
private let codeCopyPressed = Color(light: 0xFFECECF1, dark: 0x1AFFFFFF)
private let codeLabelInk = Color(light: 0xFF0F172A, dark: 0xFFE6E5E3)
private let codeFontSize: CGFloat = 15.2
private let codeLineHeight: CGFloat = 25.08

struct CodeBlock: View, Equatable {
    let code: String
    let language: String?

    /// 每次复制成功加一，1.2 秒后归零；连续点时重新计时（网页 setTimeout 1200）。
    @State private var copiedTick = 0
    @State private var highlighter = CodeBlockHighlighter()

    static func == (lhs: CodeBlock, rhs: CodeBlock) -> Bool {
        lhs.code == rhs.code && lhs.language == rhs.language
    }

    var body: some View {
        let highlighted = highlighter.highlight(code, language)
        VStack(alignment: .leading, spacing: 0) {
            // 语言名每次重画时取：纯文本的"代码"跟着界面语言变（缓存里只记语言）。
            header(label: CodeHighlighter.label(highlighted.language))
            ScrollView(.horizontal) {
                Text(highlighted.text)
                    .font(.nfMono(codeFontSize))
                    .nfLineHeight(codeLineHeight, fontSize: codeFontSize)
                    .foregroundStyle(codeInk)
                    .fixedSize()
                    .padding(.top, 15.2)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 21.6)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize, axes: [.horizontal])
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(codeBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5.6))
        .overlay {
            RoundedRectangle(cornerRadius: 5.6)
                .strokeBorder(codeBorder, lineWidth: 1)
        }
        .environment(\.layoutDirection, .leftToRight)
        .task(id: copiedTick) {
            guard copiedTick > 0 else { return }
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if !Task.isCancelled { copiedTick = 0 }
        }
    }

    private func header(label: String) -> some View {
        let copied = copiedTick > 0
        return HStack(spacing: 12) {
            HStack(spacing: 8) {
                LucideIcon(Lucide.code2, size: 15, strokeWidth: 2.2, color: codeLabelInk)
                Text(label)
                    .font(.nf(14.72, weight: 600))
                    .foregroundStyle(codeLabelInk)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                guard !code.isEmpty else { return }
                UIPasteboard.general.string = code
                copiedTick += 1
            } label: {
                Group {
                    if copied {
                        LucideIcon(Lucide.check, size: 18, color: codeCopyInk)
                    } else {
                        LucideIcon(Lucide.copy, size: 20, color: codeCopyInk)
                    }
                }
                .frame(width: 32, height: 32)
            }
            // .markdown-code-copy:hover 的 #ececf1 放在按下的时候。
            .buttonStyle(.pressable(pressedBackground: codeCopyPressed, cornerRadius: 8.8))
            .accessibilityLabel(copied ? L("code_copied_code") : L("code_copy_code"))
        }
        .padding(.leading, 16)
        .padding(.trailing, 12.8)
        .frame(minHeight: 48)
        .background(codeHeaderBackground)
        .overlay(alignment: .bottom) { NFDivider(.horizontal, color: codeHeaderLine) }
    }
}

/// 高亮好的代码。
private struct HighlightedCode {
    /// 认出来的语言（`CodeHighlighter.plain` 是纯文本）。
    let language: String
    let text: AttributedString
}

/// 记着上一次高亮的结果：复制键的状态变化引起重画时不用重新分词。
private final class CodeBlockHighlighter {
    private var code: String?
    private var language: String?
    private var result = HighlightedCode(language: "", text: AttributedString())

    func highlight(_ code: String, _ language: String?) -> HighlightedCode {
        if code == self.code, language == self.language { return result }
        let highlighted = CodeHighlighter.highlight(code, language)
        var text = AttributedString()
        for run in highlighted.runs(code) {
            var part = AttributedString(run.text)
            if let kind = run.kind {
                part.swiftUI.foregroundColor = Color(light: kind.color, dark: kind.darkColor)
                // 声明名（.hljs-title）650，注释斜体；其余跟着代码的字体。
                if let weight = kind.fontWeight {
                    part.swiftUI.font = Font.nfMono(codeFontSize, weight: weight)
                } else if kind.isItalic {
                    part.swiftUI.font = Font.nfMono(codeFontSize).italic()
                }
            }
            text.append(part)
        }
        result = HighlightedCode(language: highlighted.language, text: text)
        self.code = code
        self.language = language
        return result
    }
}
