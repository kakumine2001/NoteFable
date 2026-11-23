import SwiftUI

/// 空白聊天页输入栏上方的「最近编辑」（Android ui/ChatRecentNotes.kt；网页 412×915 下实测）：
/// 标题行（13 / 600 灰，右边"全部笔记" 13 灰 + ChevronRight 14，触控区高 48），下面一排可以横向滚动的卡片（间距 8）。
/// 卡片 152×101、圆角 14.4、白底 1px 描边、内边距 11×13、行距 4：32 的图标格（圆角 8、浅底；表情 16 或页面类型图标 18）、
/// 标题 14 / 600 单行、状态 12 灰（"添加" / ✓ "已添加"）。点卡片把笔记加到下一条消息（再点取消），已添加的是浅蓝底蓝描边；
/// 加满了、或正在上传附件时没添加的变淡（.55）不能点。右上角 48 的 ↗ 打开那篇笔记。
struct ChatRecentNotes: View {
    let pages: [NotePageSummary]
    let selected: [ChatProjectNote]
    /// 上传附件时不能改。
    let enabled: Bool
    let onToggle: (ChatProjectNote) -> Void
    let onOpen: (String) -> Void
    let onViewAll: () -> Void

    var body: some View {
        let recent = recentChatNotes(pages)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text(L("recently_edited"))
                    .font(.nf(13, weight: 600))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button(action: onViewAll) {
                    HStack(spacing: 4) {
                        Text(L("all_notes"))
                            .font(.nf(13))
                            .foregroundStyle(Sm.muted)
                            .lineLimit(1)
                        LucideIcon(Lucide.chevronRight, size: 14, color: Sm.muted)
                    }
                    .padding(.horizontal, 4)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.pressable(cornerRadius: 4.8))
            }
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(recent) { page in
                        ChatRecentNoteCard(
                            page: page,
                            attached: selected.contains { $0.id == page.id },
                            canToggle: canToggleRecentNote(page.id, selected: selected, enabled: enabled),
                            onToggle: { onToggle(ChatProjectNote(page: page)) },
                            onOpen: { onOpen(page.id) }
                        )
                    }
                }
                .padding(.horizontal, 3.2)
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.top, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ChatRecentNoteCard: View {
    let page: NotePageSummary
    let attached: Bool
    let canToggle: Bool
    let onToggle: () -> Void
    let onOpen: () -> Void

    var body: some View {
        let title = page.title.isEmpty ? L("sb_untitled") : page.title
        let shape = RoundedRectangle(cornerRadius: 14.4)
        Button(action: onToggle) {
            VStack(alignment: .leading, spacing: 4) {
                Group {
                    NoteIconGlyph(page.icon, emojiSize: 16, iconSize: 18, kind: page.kind)
                }
                .frame(width: 32, height: 32)
                .background(Sm.sidebar, in: RoundedRectangle(cornerRadius: 8))
                Text(title)
                    .font(.nf(14, weight: 600))
                    .nfLineHeight(21, fontSize: 14)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if attached { LucideIcon(Lucide.check, size: 12, color: Sm.muted) }
                    Text(L(attached ? "note_attached" : "attach_pages_submit"))
                        .font(.nf(12))
                        .nfLineHeight(18, fontSize: 12)
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(width: 152, alignment: .leading)
            .frame(minHeight: 101, alignment: .top)
            .background {
                // 白底上叠选中的浅蓝；1dp 的投影。
                shape.fill(Sm.surface)
                    .shadow(color: Color.black.opacity(0.12), radius: 1, x: 0, y: 1)
                    .overlay { shape.fill(attached ? Sm.accentSoft : Color.clear) }
            }
            .overlay { shape.strokeBorder(attached ? Sm.accentLine : Sm.border, lineWidth: 1) }
            .contentShape(shape)
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 14.4, disabledOpacity: 0.55))
        .disabled(!canToggle)
        .accessibilityLabel(title)
        .accessibilityAddTraits(attached ? .isSelected : [])
        .overlay(alignment: .topTrailing) {
            NFIconButton(
                Lucide.arrowUpRight, label: L("open_note_title", title), size: 48, iconSize: 16, cornerRadius: 12,
                action: onOpen
            )
            .padding(1)
        }
    }
}
