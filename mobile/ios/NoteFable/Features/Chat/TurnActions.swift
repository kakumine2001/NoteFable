import SwiftUI
import UIKit

// 一条提问上的操作（网页 turn-actions.tsx，手机 412 宽；Android ui/TurnActions.kt）：
// 操作行和回答的操作行一样（上距 6.4、整体往行首移 10.4、按钮 36×36、圆角 4.8、间距 2、图标 16 线宽 1.9、Muted 色）。
// 版本切换「‹ 2/3 ›」：两个箭头按钮夹着 13 号的数字（最小宽 28、居中、Muted）；到头的箭头和忙的时候是 Faint 色、不能点。
// 提问下面依次是版本切换、复制、编辑（触屏上一直显示；网页在有鼠标的设备上移上去才显示复制和编辑）。

/// 版本切换「‹ 2/3 ›」。`busy` 时这个聊天在发送或生成，不能切。
struct VersionNav: View {
    let versions: MessageVersions
    let busy: Bool
    let onShow: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            NFIconButton(Lucide.chevronLeft, label: L("previous_version"), size: 36, iconSize: 16, strokeWidth: 1.9) {
                if let id = versions.prevId { onShow(id) }
            }
            .disabled(busy || versions.prevId == nil)
            Text(versionLabel(versions))
                .font(.nf(13))
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
                .frame(minWidth: 28)
            NFIconButton(Lucide.chevronRight, label: L("next_version"), size: 36, iconSize: 16, strokeWidth: 1.9) {
                if let id = versions.nextId { onShow(id) }
            }
            .disabled(busy || versions.nextId == nil)
        }
    }
}

/// 提问下面的操作行。只给已经保存到服务端的提问显示（本机 ID 的还不能编辑）。
struct UserTurnActions: View {
    let message: UiMessage
    let busy: Bool
    let canEdit: Bool
    let onEdit: () -> Void

    @Environment(AppEnvironment.self) private var app
    /// 每复制一次加一；2 秒后归零，图标从 ✓ 变回复制。
    @State private var copiedTick = 0

    var body: some View {
        let copied = copiedTick > 0
        HStack(spacing: 2) {
            if let versions = message.versions {
                VersionNav(versions: versions, busy: busy) { id in app.chat.showVersion(id) }
            }
            if !message.content.isEmpty {
                NFIconButton(
                    copied ? Lucide.check : Lucide.copy,
                    label: L(copied ? "answer_copied" : "copy_message"),
                    size: 36, iconSize: 16, strokeWidth: copied ? 2 : 1.9
                ) {
                    UIPasteboard.general.string = message.content
                    Haptics.light()
                    copiedTick += 1
                }
            }
            if canEdit {
                NFIconButton(Lucide.pencil, label: L("edit_message"), size: 36, iconSize: 16, strokeWidth: 1.9, action: onEdit)
                    .disabled(busy)
            }
        }
        .padding(.top, 6.4)
        .padding(.leading, -10.4)
        .task(id: copiedTick) {
            guard copiedTick > 0 else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled { copiedTick = 0 }
        }
    }
}

/// 在提问块里直接改写（网页 UserMessageEditor）：文字 15 / 行高 28、透明底，最高到 `maxHeight`（屏高的 40%）、超过就在里面滚动；
/// 下面一行靠行尾两个按钮（.notion-button：取消；.notion-button-primary：发送），上距 8、间距 8。空白或聊天在生成时不能发送。
struct UserMessageEditor: View {
    let busy: Bool
    let maxHeight: CGFloat
    let onCancel: () -> Void
    let onSubmit: (String) -> Void

    @State private var text: String
    @FocusState private var focused: Bool

    /// 行高 28：系统字体 15 的自然行高之外的部分。
    private static let extraLeading: CGFloat = 28 - 15 * 1.193

    init(initial: String, busy: Bool, maxHeight: CGFloat, onCancel: @escaping () -> Void, onSubmit: @escaping (String) -> Void) {
        self.busy = busy
        self.maxHeight = maxHeight
        self.onCancel = onCancel
        self.onSubmit = onSubmit
        _text = State(initialValue: initial)
    }

    var body: some View {
        let lines = max(3, Int(maxHeight / 28))
        VStack(alignment: .leading, spacing: 0) {
            TextField("", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.nf(15))
                .lineSpacing(Self.extraLeading)
                .foregroundStyle(Sm.text)
                .tint(Sm.text)
                .lineLimit(1...lines)
                .focused($focused)
                .padding(.vertical, Self.extraLeading / 2)
                .accessibilityLabel(L("edit_message"))
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                NotionButton(L("cancel"), action: onCancel)
                // 这个聊天在生成时不能发送（文字留在编辑框里）。
                NotionButton(L("turn_send"), kind: .primary) { onSubmit(ApiText.trim(text)) }
                    .disabled(ApiText.isBlank(text) || busy)
            }
            .padding(.top, 8)
        }
        .task {
            // 等编辑框进了窗口再聚焦，太早设会被忽略。
            try? await Task.sleep(nanoseconds: 80_000_000)
            focused = true
        }
    }
}
