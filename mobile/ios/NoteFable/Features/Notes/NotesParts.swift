import SwiftUI

// 笔记界面里几处共用的小部件（Android ui/NotesUi.kt 里的 RowAction、InkButton、ErrorBar、NoteIcon 和侧栏的小标题）。
// 数值来自网页在 412×915 手机视口下的实测，对照表见 docs/architecture/android-native.md。

/// 拖动排序是从哪个列表开始的（侧栏或首页）。
enum NoteListSurface {
    case drawer
    case home
}

/// 最近一次拖动是从哪个列表开始的。抽屉盖在首页上时两个列表同时在界面里，
/// 失败提示只显示在发起拖动的那个列表里（Android NoteReorder.surface）。
@MainActor
@Observable
final class NoteReorderOrigin {
    static let shared = NoteReorderOrigin()

    var surface: NoteListSurface?

    init() {}
}

/// 侧栏分区标题左侧的 20×20 圆角语义图标徽章（网页 .sidebar-section-badge，Android SidebarSectionBadge）。
struct SidebarSectionBadge: View {
    let icon: [String]
    let background: Color
    let iconColor: Color
    var border: Color? = nil

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        LucideIcon(icon, size: 12, color: iconColor)
            .frame(width: 20, height: 20)
            .background(background, in: shape)
            .overlay {
                if let border {
                    shape.strokeBorder(border, lineWidth: 1)
                }
            }
            .accessibilityHidden(true)
    }
}

/// 侧栏分区之间的顶部分隔线（网页 .sidebar-group + .sidebar-group，Android sidebarSectionTopDivider）。
struct SidebarSectionDivider: View {
    var body: some View {
        NFDivider()
            .padding(.top, 8)
            .padding(.bottom, 10)
    }
}

/// 侧栏的小标题（网页 .chat-section-label，Android NotesUi.kt）：高对比 UI 字体 13 / 620。
struct NotesSectionLabel: View {
    private let text: String
    private let icon: [String]?
    private let iconColor: Color

    init(_ text: String, icon: [String]? = nil, iconColor: Color = Sm.sectionTitle) {
        self.text = text
        self.icon = icon
        self.iconColor = iconColor
    }

    var body: some View {
        HStack(spacing: 6) {
            if let icon {
                LucideIcon(icon, size: 12.5, color: iconColor)
            }
            Text(text)
                .font(.nf(13, weight: 620))
                .nfLineHeight(18, fontSize: 13)
                .foregroundStyle(Sm.sectionTitle)
                .lineLimit(1)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// 数量胶囊（侧栏分区标题、项目行和首页分组标题共用）。
struct NotesCountPill: View {
    let count: Int

    var body: some View {
        Text(String(count))
            .font(.nf(11, weight: 620).monospacedDigit())
            .nfLineHeight(14, fontSize: 11)
            .foregroundStyle(Sm.countText)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 1.5)
            .frame(minWidth: 20, minHeight: 18)
            .background(Sm.countBg, in: Capsule())
            .layoutPriority(1)
    }
}

/// 行右侧的小按钮（网页 .chat-row-action）：25.6 见方、圆角 4、灰色图标，右距 3.2。触屏上常显。
/// 新建按钮外面的一层（网页 NewPageButton，Android `NewPageMenuAnchor`，#168）：能新建的类型（[kinds]）只有一种时
/// [content] 的点击直接建它，两种以上时在按钮下方开类型菜单（笔记 / 幻灯片 / 白板，与"…"菜单同一外框 `actionsMenu`）。
@MainActor
struct NewPageMenuAnchor<Content: View>: View {
    private let kinds: [PageKind]
    private let label: String
    private let alignment: ActionsMenuAlignment
    private let onCreate: (PageKind) -> Void
    private let onGenerateSlides: (() -> Void)?
    private let content: (@escaping () -> Void) -> Content
    @State private var open = false
    @Environment(AppEnvironment.self) private var app

    init(
        kinds: [PageKind],
        label: String,
        alignment: ActionsMenuAlignment = .trailing,
        onCreate: @escaping (PageKind) -> Void,
        onGenerateSlides: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (@escaping () -> Void) -> Content
    ) {
        self.kinds = kinds
        self.label = label
        self.alignment = alignment
        self.onCreate = onCreate
        self.onGenerateSlides = onGenerateSlides
        self.content = content
    }

    var body: some View {
        let kinds = self.kinds
        let onCreate = self.onCreate
        let showGenerateSlides = onGenerateSlides != nil && kinds.contains(.slides)
        content {
            if kinds.count > 1 || showGenerateSlides { open = true } else { onCreate(kinds.first ?? .note) }
        }
        .actionsMenu(isPresented: $open, alignment: alignment, label: label) {
            ForEach(kinds, id: \.self) { kind in
                ActionsMenuItem(L(pageKindLabel(kind)), icon: pageKindIcon(kind)) {
                    open = false
                    onCreate(kind)
                }
            }
            if showGenerateSlides, let onGenerateSlides {
                ActionsMenuDivider()
                ActionsMenuItem(L("slides_generate_with_ai"), leading: {
                    AppIconView(icon: app.appIcon.icon, size: 16)
                }) {
                    open = false
                    onGenerateSlides()
                }
            }
        }
    }
}

/// 侧栏的分区标题（网页 .notes-section-heading，Android `SectionHeading`）：语义图标徽章 + 高对比标题 + 数量胶囊 + 折叠箭头 + "+"。
@MainActor
struct NotesSectionHeading: View {
    let kind: PageKind
    let count: Int
    let isOpen: Bool
    let busy: Bool
    let onToggle: () -> Void
    let onCreate: () -> Void
    var onGenerateSlides: (() -> Void)? = nil
    @State private var slidesMenuOpen = false
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let name = L(pageKindSectionLabel(kind))
        HStack(spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 6) {
                    SidebarSectionBadge(
                        icon: pageKindIcon(kind),
                        background: pageKindSoft(kind),
                        iconColor: pageKindColor(kind),
                        border: pageKindBorder(kind)
                    )
                    NotesSectionLabel(name)
                    if count > 0 {
                        NotesCountPill(count: count)
                    }
                    LucideIcon(isOpen ? Lucide.chevronDown : Lucide.chevronRight, size: 13, color: Sm.muted)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable(cornerRadius: 7))
            .accessibilityLabel(isOpen ? L("pg_collapse_title", name) : L("pg_expand_title", name))
            if kind == .slides, let onGenerateSlides {
                let label = L(pageKindNewLabel(kind))
                NFIconButton(Lucide.plus, label: label, iconSize: 15, color: Sm.tabMuted) {
                    slidesMenuOpen = true
                }
                .disabled(busy)
                .actionsMenu(isPresented: $slidesMenuOpen, alignment: .trailing, label: label) {
                    ActionsMenuItem(L("ws_new_slides"), icon: Lucide.presentation) {
                        slidesMenuOpen = false
                        onCreate()
                    }
                    ActionsMenuDivider()
                    ActionsMenuItem(L("slides_generate_with_ai"), leading: {
                        AppIconView(icon: app.appIcon.icon, size: 16)
                    }) {
                        slidesMenuOpen = false
                        onGenerateSlides()
                    }
                }
            } else {
                NFIconButton(Lucide.plus, label: L(pageKindNewLabel(kind)), iconSize: 15, color: Sm.tabMuted, action: onCreate)
                    .disabled(busy)
            }
        }
        .padding(.leading, 6)
        .padding(.trailing, 2)
        .padding(.bottom, 3)
    }
}

struct NoteRowAction: View {
    private let icon: [String]
    private let iconSize: CGFloat
    private let label: String
    private let action: () -> Void

    init(icon: [String], iconSize: CGFloat, label: String, action: @escaping () -> Void) {
        self.icon = icon
        self.iconSize = iconSize
        self.label = label
        self.action = action
    }

    var body: some View {
        NFIconButton(icon, label: label, size: 25.6, iconSize: iconSize, cornerRadius: 4, action: action)
            .padding(.trailing, 3.2)
    }
}

/// `.notion-sidebar-action.is-subtle`（手机）：侧栏最下面工具区的导入 Markdown / 回收站行。
/// 高 40、圆角 8、左右内边距 10、图标 15 + 间距 8.8 + 14 / 500 灰字。
struct NotesSidebarActionRow: View {
    private let icon: [String]
    private let title: String
    private let action: () -> Void

    init(icon: [String], title: String, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8.8) {
                LucideIcon(icon, size: 15, color: Sm.tabMuted)
                Text(title)
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(Sm.tabMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
        }
        .buttonStyle(.pressable(cornerRadius: 8, scale: 0.98))
    }
}

/// `.notes-empty-new`：圆角 8、墨色底、左右 12、图标 16 + 间距 6、14 / 550 白字。首页的“新笔记”高 40，空状态里高 32。
struct NotesInkButton: View {
    private let title: String
    private let height: CGFloat
    private let icon: [String]
    private let action: () -> Void

    init(_ title: String, height: CGFloat, icon: [String] = Lucide.plus, action: @escaping () -> Void) {
        self.title = title
        self.height = height
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                LucideIcon(icon, size: 16, color: Sm.onInk)
                Text(title)
                    .font(.nf(14, weight: 550))
                    .foregroundStyle(Sm.onInk)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(height: height)
        }
        .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: 8, scale: 0.97))
    }
}

/// `.notion-error`：浅红底、#933b34、圆角 4.8、内边距 8.8×10.4、12.8 的字；`onRetry` 不为 nil 时右边有“重试”。
struct NotesErrorBar: View {
    private let text: String
    private let onRetry: (() -> Void)?

    init(_ text: String, onRetry: (() -> Void)? = nil) {
        self.text = text
        self.onRetry = onRetry
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(text)
                .font(.nf(12.8))
                .foregroundStyle(Sm.errorText)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let onRetry {
                NotionButton(L("retry"), action: onRetry)
            }
        }
        .padding(.horizontal, 10.4)
        .padding(.vertical, 8.8)
        .background(Sm.errorBackground, in: RoundedRectangle(cornerRadius: 4.8))
    }
}

/// 笔记图标：设置了表情 / 上传的图片就显示它，否则是页面类型的图标（`pageKindIcon`：笔记 FileText、白板 Shapes、幻灯片 Presentation，
/// 网页 NoteIcon 的 fallback = PageKindIcon）。表情和图标的大小分开给（回收站里是 17 / 16）。
struct NoteIconGlyph: View {
    private let icon: String?
    private let emojiSize: CGFloat
    private let iconSize: CGFloat
    private let color: Color
    private let kind: PageKind

    init(_ icon: String?, emojiSize: CGFloat, iconSize: CGFloat, color: Color = Sm.muted, kind: PageKind = .note) {
        self.icon = icon
        self.emojiSize = emojiSize
        self.iconSize = iconSize
        self.color = color
        self.kind = kind
    }

    var body: some View {
        Group {
            if let image = NoteIcons.imagePath(icon) {
                RemoteImage(path: image)
                    .frame(width: emojiSize, height: emojiSize)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            } else if let icon, !icon.isEmpty {
                Text(icon)
                    .font(.system(size: emojiSize))
                    .lineLimit(1)
                    .fixedSize()
            } else {
                LucideIcon(pageKindIcon(kind), size: iconSize, color: color)
            }
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// 侧栏选中行的浮起卡片样式与行头 3pt 语义指示条（网页 .notion-session-row.is-active + ::before，Android sidebarActiveRow）。
    /// 阴影画在 background 里的形状上不被裁剪；RTL 下 alignment: .leading 自动镜像到右侧。
    func sidebarActiveRow(active: Bool, accent: Color, cornerRadius: CGFloat = 8) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        return self
            .background {
                if active {
                    shape
                        .fill(Sm.activeRow)
                        .shadow(color: Color(light: 0x160F172A, dark: 0x59000000), radius: 1.5, x: 0, y: 1)
                }
            }
            .overlay {
                if active {
                    shape.strokeBorder(Sm.borderStrong, lineWidth: 1).allowsHitTesting(false)
                }
            }
            .overlay(alignment: .leading) {
                if active {
                    Capsule()
                        .fill(accent)
                        .frame(width: 3, height: 18)
                        .padding(.leading, 2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
    }

    /// `.notes-group-members` / `.notes-subpages`：项目里的笔记、展开的子页面。左距 10、1px 竖线、内左距 4。
    func notesIndentedMembers() -> some View {
        self
            .padding(.leading, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Sm.border)
                    .frame(width: 1)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 10)
    }
}
