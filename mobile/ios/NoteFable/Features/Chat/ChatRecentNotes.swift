import SwiftUI

/// 空白聊天页输入栏上方的「最近编辑」（Android ui/ChatRecentNotes.kt；网页 412×915 下实测）：
/// 标题行（13 / 600 灰，右边"全部笔记" 13 灰 + ChevronRight 14，触控区高 48），下面一排可以横向滚动的卡片（间距 8）。
/// 卡片固定 152×108、圆角 14.4、白底 1px 描边：顶上 32 的封面条（有封面显示封面，没有就是页面类型色的渐变），
/// 32 的图标格（白底描边、圆角 8；表情 16 或页面类型图标 17）压在封面条下沿 16，下面标题 14 / 600 单行、
/// 底部状态 12 灰（"添加" / ✓ "已添加"）。有没有封面、哪种页面，卡片都一样大。点卡片把笔记加到下一条消息（再点取消），
/// 已添加的是浅蓝底蓝描边；加满了、或正在上传附件时没添加的变淡（.55）不能点。右上角 48 的触控区里是 26 的 ↗ 圆钮，打开那篇笔记。
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

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let title = page.title.isEmpty ? L("sb_untitled") : page.title
        let shape = RoundedRectangle(cornerRadius: 14.4)
        let iconShape = RoundedRectangle(cornerRadius: 8)
        Button(action: onToggle) {
            // 每张卡都有同样的封面条和固定尺寸，有没有封面都对齐（网页 .chat-recent .notes-recent-card）。
            VStack(alignment: .leading, spacing: 0) {
                NoteCoverBanner(cover: page.cover, coverPosition: page.coverPosition, kind: page.kind)
                    .frame(height: 32)
                    .overlay(alignment: .bottom) { NFDivider() }
                // 图标压住封面条 16，标题从图标下面 4 开始。
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.nf(14, weight: 600))
                        .nfLineHeight(21, fontSize: 14)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    HStack(spacing: 4) {
                        if attached { LucideIcon(Lucide.check, size: 12, color: Sm.muted) }
                        Text(L(attached ? "note_attached" : "attach_pages_submit"))
                            .font(.nf(12))
                            .nfLineHeight(18, fontSize: 12)
                            .foregroundStyle(Sm.muted)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 20)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .overlay(alignment: .topLeading) {
                NoteIconGlyph(page.icon, emojiSize: 16, iconSize: 17, color: pageKindColor(page.kind), kind: page.kind)
                    .frame(width: 32, height: 32)
                    .background(Sm.surface, in: iconShape)
                    .overlay { iconShape.strokeBorder(Sm.border, lineWidth: 1) }
                    .shadow(color: Color(argb: 0x120F172A), radius: 2, x: 0, y: 1)
                    .padding(.leading, 12)
                    .padding(.top, 16)
            }
            .frame(width: 152, height: 108, alignment: .topLeading)
            .background {
                // 白底上叠选中的浅蓝；1dp 的投影。
                shape.fill(Sm.surface)
                    .shadow(color: Color.black.opacity(0.12), radius: 1, x: 0, y: 1)
                    .overlay { shape.fill(attached ? Sm.accentSoft : Color.clear) }
            }
            .overlay { shape.strokeBorder(attached ? Sm.accentLine : Sm.border, lineWidth: 1) }
            .clipShape(shape)
            .contentShape(shape)
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 14.4, disabledOpacity: 0.55))
        .disabled(!canToggle)
        .accessibilityLabel(title)
        .accessibilityAddTraits(attached ? .isSelected : [])
        .overlay(alignment: .topTrailing) {
            // 48 的触控区，看得见的是封面条上 26 的圆钮。
            Button(action: onOpen) {
                LucideIcon(Lucide.arrowUpRight, size: 14, color: chromePath == .native ? chromePath.primaryInk : Sm.muted)
                    .frame(width: 26, height: 26)
                    .background(chromePath == .solid ? AnyShapeStyle(Sm.surface.opacity(0.9)) : AnyShapeStyle(.regularMaterial), in: Circle())
                    .overlay { Circle().strokeBorder(Sm.border, lineWidth: 1) }
                    .padding(4)
                    .frame(width: 48, height: 48, alignment: .topTrailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 13, scale: 0.92))
            .accessibilityLabel(L("open_note_title", title))
            .padding(1)
        }
    }
}
