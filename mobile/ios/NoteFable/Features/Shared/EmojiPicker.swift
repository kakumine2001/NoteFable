import Observation
import SwiftUI

// 表情选择器（网页 src/components/emoji-picker.tsx + full-emoji-picker.tsx，基于 emoji-picker-react；Android ui/EmojiPicker.kt）。
// 412×915 手机视口下量的值（1pt = 1 CSS px）：
// - 弹出框（.notes-popover.chat-floating-picker）：宽 min(408, 屏宽 − 24)，白底、圆角 8、阴影 0 4 14 .12 + 1px .05 细环；
//   位置照 floatingPositionFor：行首边对齐按钮（离边至少 12），下方放得下就在按钮下 6，否则在按钮上方 6。
// - 顶部条（.notes-picker-bar）：高 36、左 12 右 8、下边 1px 线；左边"Emoji"14/500 + 当前表情（选中标记），
//   右边"Random"（Shuffle 13 + 4 + 文字）和"Remove"两个高 28、左右 8、圆角 4 的 13 灰字按钮。
// - 下面是表情区（EmojiPickerGrid.swift）：高 min(380, 屏高 − 60)。
// - 打开时和 .notes-popover 一样淡入上移（motion-menu-enter 120ms ease-out）；数据读不出来时显示"Could not load emoji."和"Try again"。
// - 点表情：选中并关闭（记入"最近使用"）；Random：随便换一个，不关；Remove：去掉图标并关闭。点外面关闭。

// MARK: - 挂在按钮上的弹出框

extension View {
    /// 贴着这个视图（触发按钮）弹出表情选择器。`onPick(nil)` = 去掉图标。选中、Remove、点外面都会把 `isPresented` 设回 false；
    /// Random 只调 `onPick`、不关。`removeLabel` 换掉"Remove"上的字（账号头像写"使用 Google 头像"）。
    /// 需要根上装了 `.nfOverlayHost()`。
    ///
    /// ```swift
    /// Button { picking.toggle() } label: { NFIconTile(emoji: icon, fallback: Lucide.messageSquareText, box: 40, glyph: 15) }
    ///     .emojiPicker(isPresented: $picking, current: icon) { icon in save(icon) }
    /// ```
    func emojiPicker(
        isPresented: Binding<Bool>,
        current: String?,
        removeLabel: String? = nil,
        onPick: @escaping (String?) -> Void
    ) -> some View {
        modifier(EmojiPickerModifier(isPresented: isPresented, current: current, removeLabel: removeLabel, onPick: onPick))
    }
}

/// 跨系统 `.popover` / `.sheet` 呈现边界保留表情搜索词与肤色选择，窗口尺寸类切换时不丢输入。
@MainActor
@Observable
final class EmojiPickerDraft {
    var query = ""
    var tone: SkinTone = .neutral

    init() {}
}

private struct EmojiPickerModifier: ViewModifier {
    @Binding var isPresented: Bool
    let current: String?
    let removeLabel: String?
    let onPick: (String?) -> Void
    @State private var draft = EmojiPickerDraft()

    func body(content: Content) -> some View {
        content
            .nfPopover(
                isPresented: $isPresented,
                width: 380,
                adaptCompactToSheet: true,
                contentInsets: EdgeInsets(top: 8, leading: 0, bottom: 0, trailing: 0),
                onDismiss: { draft.query = "" }
            ) {
                EmojiPickerBody(
                    current: current,
                    removeLabel: removeLabel,
                    draft: draft,
                    onClose: { isPresented = false },
                    onPick: onPick
                )
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("em_choose"))
            }
    }
}

// MARK: - 选择器的内容

/// 表情选择器的内容（网页 EmojiPickerBody）：上面一条 Emoji / Random / Remove，下面是自适应高度或定高 `height` 的表情区。
/// 可以放进原生 `.nfPopover`（自动适配手机 `.sheet` 与 iPad `.popover`），也可以定高放在页面里（账号头像的表情页）。
/// 点表情：`onPick(表情)` 再 `onClose()`；Random：只调 `onPick`；Remove：`onPick(nil)` 再 `onClose()`。
struct EmojiPickerBody: View {
    private let current: String?
    private let height: CGFloat?
    private let removeLabel: String?
    private let externalDraft: EmojiPickerDraft?
    private let onClose: () -> Void
    private let onPick: (String?) -> Void

    @Environment(AppEnvironment.self) private var app
    @State private var localDraft = EmojiPickerDraft()
    @State private var load: EmojiCatalogLoad = .loading
    @State private var attempt = 0

    init(
        current: String?,
        height: CGFloat? = nil,
        removeLabel: String? = nil,
        draft: EmojiPickerDraft? = nil,
        onClose: @escaping () -> Void = {},
        onPick: @escaping (String?) -> Void
    ) {
        self.current = current
        self.height = height
        self.removeLabel = removeLabel
        self.externalDraft = draft
        self.onClose = onClose
        self.onPick = onPick
    }

    var body: some View {
        VStack(spacing: 0) {
            EmojiPickerBar(
                current: current,
                removeLabel: removeLabel ?? L("em_remove"),
                onRandom: {
                    if case .ready(let catalog) = load, let item = catalog.emojis.randomElement() {
                        Haptics.selection()
                        onPick(item.emoji)
                    }
                },
                onRemove: {
                    Haptics.light()
                    onPick(nil)
                    onClose()
                }
            )
            content
                .frame(maxWidth: .infinity, maxHeight: height == nil ? .infinity : nil)
                .frame(height: height)
        }
        .frame(maxWidth: .infinity)
        // 关键词按界面语言：换了语言重新读；"Try again"也是重新读。
        .task(id: EmojiLoadKey(locale: app.language.uiLocale, attempt: attempt)) {
            await loadCatalog()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch load {
        case .failed:
            // emoji-picker-react 的 LoadError：一句"Could not load emoji."和一个"Try again"按钮。
            VStack(spacing: 8) {
                Text(L("em_load_failed"))
                    .font(.nf(14))
                    .foregroundStyle(EmojiPickerColors.text)
                    .multilineTextAlignment(.center)
                EmojiBarButton(L("try_again"), icon: nil) { attempt += 1 }
            }
        case .loading:
            // 网页 .emoji-picker-loading：居中的 14 灰字。
            Text(L("em_loading"))
                .font(.nf(14))
                .foregroundStyle(Sm.muted)
        case .ready(let catalog):
            EmojiGrid(catalog: catalog, height: height, draft: externalDraft ?? localDraft) { emoji in
                onPick(emoji)
                onClose()
            }
        }
    }

    private func loadCatalog() async {
        load = .loading
        // 本机画不出来的表情不进面板：App 启动时把 `EmojiGlyphs.isSupported` 接到了 `app.emojiGlyphSupported` 上。
        do {
            let catalog = try await app.loadEmojiCatalog()
            if !Task.isCancelled {
                load = .ready(catalog)
                if ScreenshotHooks.isActive, ScreenshotHooks.scene == .emojiPicker {
                    // 等系统自适应 .sheet / .popover 进场动画与表情网格排版落稳再报就绪。
                    try? await Task.sleep(for: .milliseconds(450))
                    if !Task.isCancelled {
                        ScreenshotHooks.markReady(.emojiPicker)
                    }
                }
            }
        } catch {
            if !Task.isCancelled { load = .failed }
        }
    }
}

private enum EmojiCatalogLoad {
    case loading
    case failed
    case ready(EmojiCatalog)
}

private struct EmojiLoadKey: Equatable {
    let locale: String
    let attempt: Int
}

// MARK: - 顶部条

private struct EmojiPickerBar: View {
    let current: String?
    let removeLabel: String
    let onRandom: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Text(L("em_emoji"))
                .font(.nf(14, weight: 500))
                .foregroundStyle(Sm.text)
                .lineLimit(1)
            // 选中标记：网页在"Emoji"后面接一个空格和当前表情（aria-label "Current emoji"）。
            // 笔记的图标是上传图片时没有文字形式，和网页一样不显示（Remove 照常可用）。
            if let current = NoteIcons.text(current), !current.isEmpty {
                Text(" " + current)
                    .font(.nf(14))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .accessibilityLabel(L("em_current") + " " + current)
            }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                EmojiBarButton(L("em_random"), icon: Lucide.shuffle, action: onRandom)
                EmojiBarButton(removeLabel, icon: nil, action: onRemove)
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .frame(height: EmojiPopoverSize.barHeight)
        .overlay(alignment: .bottom) { NFDivider() }
    }
}

/// 顶部条的小胶囊按钮：高 28、左右 10，图标 13 + 间距 4 + 13 灰字；按下柔和胶囊底。
private struct EmojiBarButton: View {
    private let title: String
    private let icon: [String]?
    private let action: () -> Void

    init(_ title: String, icon: [String]?, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon { LucideIcon(icon, size: 13, color: Sm.muted) }
                Text(title)
                    .font(.nf(13))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(height: 28)
        }
        .buttonStyle(.pressable(cornerRadius: 14))
    }
}
