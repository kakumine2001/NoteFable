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

/// 侧栏的小标题（网页 .chat-section-label，Android roleLabelStyle）：12 等宽 / 500、大写、字距 .06em、灰色、行高 18。
/// 等宽字体没有非拉丁字形，这些字用普通界面字体；阿拉伯字母有字距会断开连写，字距归零。
struct NotesSectionLabel: View {
    private let text: String

    init(_ text: String) {
        self.text = text.uppercased()
    }

    var body: some View {
        let scalars = text.unicodeScalars
        let nonMonospace = scalars.contains { $0.value >= 0x0590 }
        let arabic = scalars.contains { scalar in
            (0x0600...0x08FF).contains(scalar.value) || (0xFB50...0xFDFF).contains(scalar.value)
                || (0xFE70...0xFEFF).contains(scalar.value)
        }
        Text(text)
            .font(nonMonospace ? Font.nf(12, weight: 500) : Font.nfMono(12, weight: 500))
            .tracking(arabic ? 0 : 0.72)
            .nfLineHeight(18, fontSize: 12)
            .foregroundStyle(Sm.muted)
            .accessibilityAddTraits(.isHeader)
    }
}

/// 行右侧的小按钮（网页 .chat-row-action）：25.6 见方、圆角 4、灰色图标，右距 3.2。触屏上常显。
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

/// `.notion-sidebar-action`（手机）：侧栏最下面的回收站行（Search 行是共用的 `SidebarSearchRow`，同一个样式）。
/// 高 44、圆角 4.8、左右内边距 8、图标 16 + 间距 8.8 + 16 / 500 正文色；按下灰底并缩到 .97。
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
                LucideIcon(icon, size: 16, color: Sm.text)
                Text(title)
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 4.8, scale: 0.97))
    }
}

/// `.notes-empty-new`：圆角 8、墨色底、左右 12、图标 16 + 间距 6、14 / 550 白字。首页的“新笔记”高 40，空状态里高 32。
struct NotesInkButton: View {
    private let title: String
    private let height: CGFloat
    private let action: () -> Void

    init(_ title: String, height: CGFloat, action: @escaping () -> Void) {
        self.title = title
        self.height = height
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                LucideIcon(Lucide.plus, size: 16, color: .white)
                Text(title)
                    .font(.nf(14, weight: 550))
                    .foregroundStyle(Color.white)
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

/// 笔记图标：设置了表情就显示表情，否则是 lucide 的 FileText。表情和图标的大小分开给（回收站里是 17 / 16）。
struct NoteIconGlyph: View {
    private let icon: String?
    private let emojiSize: CGFloat
    private let iconSize: CGFloat
    private let color: Color

    init(_ icon: String?, emojiSize: CGFloat, iconSize: CGFloat, color: Color = Sm.muted) {
        self.icon = icon
        self.emojiSize = emojiSize
        self.iconSize = iconSize
        self.color = color
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
                LucideIcon(Lucide.fileText, size: iconSize, color: color)
            }
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// `.notes-group-members` / `.notes-subpages`：项目里的笔记、展开的子页面。左距 12、1px 竖线、内左距 4。
    func notesIndentedMembers() -> some View {
        self
            .padding(.leading, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Sm.border)
                    .frame(width: 1)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 12)
    }
}
