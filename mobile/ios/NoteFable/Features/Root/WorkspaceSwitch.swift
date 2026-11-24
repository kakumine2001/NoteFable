import SwiftUI

/// Chat / Workspace 切换（网页 `.notion-segmented`，Android `WorkspaceSwitch`）：高 48、底色 --notion-active、圆角 8、内边距 2、两键间距 2；
/// 每键高 44、圆角 6.4、16 / 500（抽屉里 14 / 500，与网页宽 240 的侧栏相同）、图标 16 + 间距 6.4、左右内距 4；选中白底、墨色字、蓝色图标、1px 细环 + 浅阴影；按下缩到 .97。
/// 两键平时各占一半，名字比一半宽时那一侧按名字宽度变宽（`WorkspaceSegmentsLayout`）：日文「ワークスペース」在抽屉里放不下一半。
/// 抽屉里在头部下方（左右 8、上距 4），空白聊天页和笔记首页在顶栏下方（左右 24、上距 4）：外边距由用的地方加。
/// 切换前先关抽屉（网页从抽屉里切换时先关）；在笔记里时先保存笔记，存不上就留在笔记里（`NotesViewModel.setWorkspace`）。
struct WorkspaceSwitch: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    /// 抽屉里（宽 240）用 14 号字；空白聊天页和笔记首页是 16。
    private let inDrawer: Bool

    init(inDrawer: Bool = false) {
        self.inDrawer = inDrawer
    }

    var body: some View {
        let workspace = app.notes.state.workspace
        let fontSize: CGFloat = inDrawer ? 13.5 : 15
        let trackShape = RoundedRectangle(cornerRadius: 10)
        WorkspaceSegmentsLayout(spacing: 2) {
            WorkspaceSegment(title: L("chat_mode"), icon: Lucide.messageSquareText, fontSize: fontSize, active: workspace == .chat) {
                select(.chat)
            }
            WorkspaceSegment(title: L("note_mode"), icon: Lucide.layoutGrid, fontSize: fontSize, active: workspace == .notes) {
                select(.notes)
            }
        }
        .padding(3)
        .frame(maxWidth: .infinity)
        .frame(height: 46)
        .background(Sm.hover, in: trackShape)
        .overlay { trackShape.strokeBorder(Sm.border, lineWidth: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("workspace_mode"))
    }

    private func select(_ target: Workspace) {
        router.closeDrawer()
        app.notes.setWorkspace(target)
    }
}

/// 两键的排法（网页 `.notion-segmented` 的 `repeat(2, minmax(max-content, 1fr))`，Android `WorkspaceSwitch` 的 Layout）：
/// 宽度由 `workspaceSegmentWidths` 按两边的理想宽度决定。从右到左的界面由 SwiftUI 整体镜像。
private struct WorkspaceSegmentsLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let width = proposal.width ?? sizes.reduce(spacing * CGFloat(max(subviews.count - 1, 0))) { $0 + $1.width }
        return CGSize(width: width, height: proposal.height ?? (sizes.map(\.height).max() ?? 0))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let ideal = subviews.map { $0.sizeThatFits(.unspecified).width }
        let widths = workspaceSegmentWidths(available: Double(bounds.width - spacing), first: Double(ideal[0]), second: Double(ideal[1]))
        let first = CGFloat(widths.first)
        subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: first, height: bounds.height))
        subviews[1].place(at: CGPoint(x: bounds.minX + first + spacing, y: bounds.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: CGFloat(widths.second), height: bounds.height))
    }
}

private struct WorkspaceSegment: View {
    let title: String
    let icon: [String]
    let fontSize: CGFloat
    let active: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 7.2)
        Button(action: action) {
            HStack(spacing: 6) {
                LucideIcon(icon, size: 15, color: active ? Sm.blue : Sm.muted)
                Text(title)
                    .font(.nf(fontSize, weight: 550))
                    .foregroundStyle(active ? Sm.ink : Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 5)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background {
                if active {
                    shape
                        .fill(Sm.surface)
                        .shadow(color: Color(argb: 0x140F172A), radius: 1, x: 0, y: 1)
                        .overlay {
                            shape.strokeBorder(Color(light: 0x0D0F172A, dark: 0x17FFFFFF), lineWidth: 1)
                        }
                }
            }
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 6.4, scale: 0.97))
        // transition: background 100ms ease, color 100ms ease。
        .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.1), reduceMotion), value: active)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
