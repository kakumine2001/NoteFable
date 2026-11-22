import SwiftUI
import UIKit

// 回答上方的过程面板（网页 chat-activity.tsx + globals.css 的 .chat-activity*，Android `ChatActivity.kt`，412×915 实测）：
//  - 整体 13.12 / 行高 20.336、灰色，下距 10.4；
//  - 标题行：左移 5.6、内边距 5.6×2.4、圆角 4、间距 4.8、500 字重，单行省略；箭头 14（描边 2），展开时转 90°；
//    等待中文字上有流动的高光（chat-activity-shimmer，1.8 秒一轮）；
//  - 步骤列表：上 5.6、左 3.2，1px 左线（.18），左内边距 13.6、上下 1.6，最高 352 可滚动，等待中跟到最新一步；
//  - 每步：上下 4.8、间距 8；图标 13（描边 1.9）浅灰，放在高 20.8 的格子里；标题 500 正文色，正文灰色上距 2.4；
//  - 来源标签：上距 6.4、间距 4.8；全圆角、1px .09 描边、#F7F7F5 底、12 / 18.6 灰字、内边距 7.2×0.8、最宽 224、地球 11。

private let activityFontSize: CGFloat = 13.12
private let activityLineHeight: CGFloat = 20.336
private let visibleSources = 6

// MARK: - 文字（Android 里是 @Composable 的小函数，这里是纯函数）

enum ChatActivityText {
    /// 标题行的"现在在做什么"：最后一步的一句话（网页 describeCurrent）。
    static func describeCurrent(_ steps: [ActivityStep], _ systemText: SystemTextTranslator) -> String {
        let thinking = L("activity_thinking")
        guard let last = steps.last(where: {
            if case .web(_, let done, let action) = $0 { return !done || action != nil }
            return true
        }) else { return thinking }
        switch last {
        case .thought(_, let text):
            let title = Activity.splitThought(text).title
            return title.isEmpty ? thinking : title
        case .tool(_, let done, let name, let label):
            if done, let label { return systemText.localize(label) }
            return toolRunningLabel(name)
        case .context(_, let info):
            return L("activity_using_project", info.projectName)
        case .web(_, let done, let action):
            guard done, let action else { return L("activity_searching_web") }
            switch action {
            case .search(let queries, _):
                if let query = queries.first { return L("activity_searching_query", query) }
                return L("activity_searching_web")
            case .openPage(let url):
                return L("activity_reading_host", Activity.hostOf(url))
            case .findInPage(let url, _):
                return L("activity_scanning_host", Activity.hostOf(url))
            }
        case .failure, .proposal:
            return thinking
        }
    }

    static func toolRunningLabel(_ name: String) -> String {
        L(name == "search_notes" ? "activity_searching_notes" : "activity_reading_note")
    }

    /// 完成后的统计（网页 summarize）：搜索次数、来源数、笔记查询、项目笔记 / 项目指示。
    static func summaryParts(_ summary: ActivitySummary) -> [String] {
        var parts: [String] = []
        if summary.searches == 1 {
            parts.append(L("activity_one_search"))
        } else if summary.searches > 1 {
            parts.append(L("activity_searches", String(summary.searches)))
        }
        if summary.sources == 1 {
            parts.append(L("activity_one_source"))
        } else if summary.sources > 1 {
            parts.append(L("activity_sources", String(summary.sources)))
        }
        if summary.noteLookups == 1 {
            parts.append(L("activity_one_note_lookup"))
        } else if summary.noteLookups > 1 {
            parts.append(L("activity_note_lookups", String(summary.noteLookups)))
        }
        if summary.projectNotes == 1 {
            parts.append(L("activity_one_project_note"))
        } else if summary.projectNotes > 1 {
            parts.append(L("activity_project_notes", String(summary.projectNotes)))
        } else if summary.projectInstructions {
            parts.append(L("activity_project_instructions"))
        }
        return parts
    }

    /// 标题行的整句。等待中："当前一步 · N s"；完成后："已思考 N s · 统计"（没有秒数时是"思考过程"）。
    static func header(steps: [ActivityStep], thinking: Bool, seconds: Int?, systemText: SystemTextTranslator) -> String {
        let time = seconds.map { "\($0)s" }
        if thinking {
            return ([describeCurrent(steps, systemText)] + (time.map { [$0] } ?? [])).joined(separator: " · ")
        }
        let lead = time.map { L("activity_thought_for", $0) } ?? L("activity_thought_process")
        return ([lead] + summaryParts(ActivitySummary.of(steps))).joined(separator: " · ")
    }

    /// 等待了几秒（网页 thinkingSeconds：最少 1 秒）。
    static func waitingSeconds(since start: Date, now: Date) -> Int {
        max(1, Int((now.timeIntervalSince(start)).rounded()))
    }
}

// MARK: - 面板

/// `steps` 是进度步骤（不含提案和失败位置）。`thinking` 为 true 时还没收到正文：显示"当前一步 · N 秒"并自动展开；
/// 否则显示"已思考 N 秒 · 统计"并收起。等待中的秒数从 `startedAt`（毫秒时间戳）算，没有就从第一次显示算；
/// 完成后用 `thinkingMs`（正文出现前用的时间，最少 1 秒），没有时显示"思考过程"。
struct ChatActivity: View {
    let steps: [ActivityStep]
    let thinking: Bool
    let startedAt: Int?
    let thinkingMs: Int?

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.layoutDirection) private var layoutDirection
    /// nil 表示用户还没点过：等待中展开，正文来了自动收起。
    @State private var manualOpen: Bool? = nil
    @State private var firstShown = Date()

    private var open: Bool {
        !steps.isEmpty && (manualOpen ?? thinking)
    }

    private var start: Date {
        startedAt.map { Date(timeIntervalSince1970: Double($0) / 1000) } ?? firstShown
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if thinking {
                // 每秒更新一次秒数。
                TimelineView(.periodic(from: start, by: 1)) { context in
                    headerRow(seconds: ChatActivityText.waitingSeconds(since: start, now: context.date))
                }
            } else {
                headerRow(seconds: thinkingMs.map { max(1, Int((Double($0) / 1000).rounded())) })
            }
            if open { stepList }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 10.4)
    }

    private func headerRow(seconds: Int?) -> some View {
        let label = ChatActivityText.header(steps: steps, thinking: thinking, seconds: seconds, systemText: app.systemText)
        let isOpen = open
        return Button {
            if !steps.isEmpty { manualOpen = !isOpen }
        } label: {
            HStack(spacing: 4.8) {
                ActivityHeaderText(text: label, shimmering: thinking)
                if !steps.isEmpty {
                    // 展开时箭头朝下（图标在从右到左的界面里已经镜像，所以反着转）。
                    LucideIcon(Lucide.chevronRight, size: 14, strokeWidth: 2, color: Sm.muted)
                        .rotationEffect(.degrees(isOpen ? (layoutDirection == .rightToLeft ? -90 : 90) : 0))
                }
            }
            .padding(.horizontal, 5.6)
            .padding(.vertical, 2.4)
        }
        .buttonStyle(.pressable(pressedBackground: steps.isEmpty ? nil : Sm.hover, cornerRadius: 4))
        // 往行首方向挪 5.6，文字和正文的行首对齐（用行首的负内边距，从右到左的界面里也是往行首挪）。
        .padding(.leading, -5.6)
    }

    private var stepList: some View {
        ScrollViewReader { proxy in
            FittingScrollView(maxHeight: 352) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(steps) { step in
                        ActivityStepRow(step: step, systemText: app.systemText) { noteId in
                            router.openNote(noteId)
                        }
                    }
                    Color.clear
                        .frame(height: 0)
                        .id(ActivityScrollAnchor.bottom)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 13.6)
                .padding(.vertical, 1.6)
            }
            // 等待中列表有高度上限，跟到最新一步。
            .onChange(of: steps, initial: true) { _, _ in
                if thinking { proxy.scrollTo(ActivityScrollAnchor.bottom, anchor: .bottom) }
            }
        }
        .overlay(alignment: .leading) { NFDivider(.vertical, color: Sm.borderStrong) }
        .padding(.leading, 3.2)
        .padding(.top, 5.6)
    }
}

private enum ActivityScrollAnchor: Hashable {
    case bottom
}

/// 标题行的文字。等待中有一道从行尾扫到行首的高光：灰 → 浅灰 → 灰，渐变宽 250%，1.8 秒一轮（网页 chat-activity-shimmer）。
/// "减弱动态效果"时不动。
private struct ActivityHeaderText: View {
    let text: String
    let shimmering: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if shimmering, !reduceMotion {
            TimelineView(.animation) { context in
                let progress = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
                // 高光的中心从文字宽度的 1.75 倍处移到 -0.75 倍处；渐变前后各 1.25 倍宽。
                let center = 1.75 - 2.5 * progress
                label.foregroundStyle(
                    LinearGradient(
                        stops: [
                            .init(color: Sm.muted, location: 0),
                            .init(color: Sm.muted, location: 0.4),
                            .init(color: Sm.faint, location: 0.5),
                            .init(color: Sm.muted, location: 0.6),
                            .init(color: Sm.muted, location: 1),
                        ],
                        startPoint: UnitPoint(x: center - 1.25, y: 0.5),
                        endPoint: UnitPoint(x: center + 1.25, y: 0.5)
                    )
                )
            }
        } else {
            label.foregroundStyle(Sm.muted)
        }
    }

    private var label: some View {
        Text(text)
            .font(.nf(activityFontSize, weight: 500))
            .nfLineHeight(activityLineHeight, fontSize: activityFontSize)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

// MARK: - 一步

private struct ActivityStepRow: View {
    let step: ActivityStep
    let systemText: SystemTextTranslator
    let onOpenNote: (String) -> Void

    var body: some View {
        switch step {
        case .thought(_, let text):
            let thought = Activity.splitThought(text)
            ActivityStepShell(icon: Lucide.lightbulb) {
                if !thought.title.isEmpty { ActivityStepTitle(thought.title) }
                if !thought.body.isEmpty {
                    activityText(thought.body, color: Sm.muted)
                        .padding(.top, 2.4)
                }
            }
        case .context(_, let info):
            ActivityStepShell(icon: Lucide.folderOpen) {
                ActivityStepTitle(L("activity_used_project", info.projectName, usedText(info)))
                if !info.notes.isEmpty {
                    ActivityChips {
                        ForEach(info.notes, id: \.id) { note in
                            ActivityChip(icon: Lucide.notebookText, text: note.title, badge: note.truncated ? L("activity_partial") : nil) {
                                onOpenNote(note.id)
                            }
                        }
                    }
                }
            }
        case .tool(_, let done, let name, let label):
            ActivityStepShell(icon: name == "search_notes" ? Lucide.fileSearch : Lucide.notebookText, spinning: !done) {
                if done, let label {
                    ActivityStepTitle(systemText.localize(label))
                } else {
                    ActivityStepTitle(ChatActivityText.toolRunningLabel(name) + "…")
                }
            }
        case .web(_, let done, let action):
            if !done {
                ActivityStepShell(icon: Lucide.loaderCircle, spinning: true) {
                    ActivityStepTitle(L("activity_searching_web_running"))
                }
            } else if let action {
                webStep(action)
            }
        case .failure, .proposal:
            // 提案和失败位置不进步骤列表（`progressSteps()` 已经去掉）。
            EmptyView()
        }
    }

    private func usedText(_ info: ContextInfo) -> String {
        var used: [String] = []
        if info.hasInstructions { used.append(L("activity_instructions")) }
        if info.notes.count == 1 {
            used.append(L("activity_one_reference_note"))
        } else if info.notes.count > 1 {
            used.append(L("activity_reference_notes", String(info.notes.count)))
        }
        return used.joined(separator: " + ")
    }

    @ViewBuilder
    private func webStep(_ action: WebAction) -> some View {
        switch action {
        case .search(let queries, let sources):
            ActivityStepShell(icon: Lucide.search) {
                ActivityStepTitle(L("activity_searched"))
                VStack(alignment: .leading, spacing: 0) {
                    let shown = queries.isEmpty ? [L("activity_the_web")] : queries
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, query in
                        activityText("“\(query)”", color: Sm.muted)
                    }
                }
                .padding(.top, 3.2)
                ActivitySourceChips(urls: sources)
            }
        case .openPage(let url):
            ActivityStepShell(icon: Lucide.fileText) {
                pageLink(lead: L("activity_read"), url: url)
            }
        case .findInPage(let url, let pattern):
            ActivityStepShell(icon: Lucide.textSearch) {
                pageLink(lead: L("activity_looked_for", pattern), url: url)
            }
        }
    }

    /// 标题 500 正文色，后面的地址是灰色、400、带下划线的链接；点一下用系统浏览器打开。
    private func pageLink(lead: String, url: String) -> some View {
        let title = Text(lead + " ")
            .font(.nf(activityFontSize, weight: 500))
            .foregroundColor(Sm.text)
        let address = Text(shortUrl(url))
            .font(.nf(activityFontSize))
            .foregroundColor(Sm.muted)
            .underline()
        return Button {
            openInBrowser(url)
        } label: {
            (title + address)
                .nfLineHeight(activityLineHeight, fontSize: activityFontSize)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
}

/// 来源和链接用系统浏览器打开。
@MainActor
private func openInBrowser(_ address: String) {
    guard let url = URL(string: address) else { return }
    UIApplication.shared.open(url)
}

/// 过程面板里的一段文字：13.12 / 行高 20.336。
private func activityText(_ text: String, color: Color, weight: Int = 400) -> some View {
    Text(text)
        .font(.nf(activityFontSize, weight: weight))
        .nfLineHeight(activityLineHeight, fontSize: activityFontSize)
        .foregroundStyle(color)
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
}

private struct ActivityStepTitle: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        activityText(text, color: Sm.text, weight: 500)
    }
}

private struct ActivityStepShell<Content: View>: View {
    private let icon: [String]
    private let spinning: Bool
    private let content: Content

    init(icon: [String], spinning: Bool = false, @ViewBuilder content: () -> Content) {
        self.icon = icon
        self.spinning = spinning
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Group {
                if spinning {
                    Spinner(size: 13, color: Sm.faint, strokeWidth: 1.9)
                } else {
                    LucideIcon(icon, size: 13, strokeWidth: 1.9, color: Sm.faint)
                }
            }
            .frame(width: 13)
            .frame(minHeight: 20.8)
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4.8)
    }
}

// MARK: - 标签

/// 一行行排开、放不下就换行的标签（间距 4.8，上距 6.4）。
private struct ActivityChips<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        AnswerFlowLayout(spacing: 4.8) {
            content
        }
        .padding(.top, 6.4)
    }
}

private struct ActivityChip: View {
    let icon: [String]?
    let text: String
    var badge: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon { LucideIcon(icon, size: 11, strokeWidth: 2, color: Sm.muted) }
                Text(text)
                    .font(.nf(12))
                    .nfLineHeight(18.6, fontSize: 12)
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let badge {
                    Text(badge)
                        .font(.nf(11))
                        .foregroundStyle(Sm.faint)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 7.2)
            .padding(.vertical, 0.8)
            .overlay { Capsule().strokeBorder(Sm.border, lineWidth: 1) }
        }
        .buttonStyle(.pressable(background: Sm.sidebar, cornerRadius: 999))
        .frame(maxWidth: 224, alignment: .leading)
    }
}

/// 一次搜索可能带回近 20 个来源，先显示 6 个，其余收在"+N"里（网页 SourceChips）。
private struct ActivitySourceChips: View {
    let urls: [String]
    @State private var showAll = false

    var body: some View {
        if !urls.isEmpty {
            let hidden = showAll ? 0 : max(0, urls.count - visibleSources)
            ActivityChips {
                ForEach(Array(urls.prefix(urls.count - hidden).enumerated()), id: \.offset) { _, url in
                    ActivityChip(icon: Lucide.globe, text: sourceLabel(url)) {
                        openInBrowser(url)
                    }
                }
                if hidden > 0 {
                    ActivityChip(icon: nil, text: L("activity_more", String(hidden))) {
                        showAll = true
                    }
                }
            }
        }
    }
}

/// 从行首排到行尾、放不下就换到下一行（CSS 的 flex-wrap，Android 的 FlowRow）。
struct AnswerFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = arrange(subviews, maxWidth: maxWidth)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, maxWidth: bounds.width) {
            var x = bounds.minX
            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: y + (row.height - item.size.height) / 2),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(width: item.size.width, height: item.size.height)
                )
                x += item.size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Item {
        let index: Int
        let size: CGSize
    }

    private struct Row {
        var items: [Item] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            var size = subviews[index].sizeThatFits(.unspecified)
            // 比一整行还宽的压到一行的宽度（文字自己省略）。
            if size.width > maxWidth { size.width = maxWidth }
            let needed = current.items.isEmpty ? size.width : current.width + spacing + size.width
            if !current.items.isEmpty, needed > maxWidth {
                rows.append(current)
                current = Row()
            }
            current.width = current.items.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.items.append(Item(index: index, size: size))
        }
        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}
