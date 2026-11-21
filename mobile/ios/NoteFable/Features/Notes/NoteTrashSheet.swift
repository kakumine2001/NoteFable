import SwiftUI
import UIKit

// 回收站（网页 NoteTrashDialog，手机是从下方出来的全宽面板；Android TrashSheet）：顶部圆角 16、没有把手；
// 头部内边距 12 / 12 / 12 / 16、下边 1px 线：垃圾桶 16 灰 + “回收站”16 / 600，“清空回收站”红字按钮，40 的关闭键（✕ 16）；
// 说明 13 / 18.85 灰（上 9.6、左右 16）；列表外边距 8；每行内边距 6.4×8：图标 24（表情 17）、标题 15 / 500、时间 12 灰；
// 按钮（高 44、15 / 500）在下一行靠右。

extension View {
    /// 回收站面板：`NotesViewModel.state.trash` 不为 nil 时显示，点遮罩关闭。只在笔记页挂一次。
    func noteTrashSheet() -> some View {
        modifier(NoteTrashSheetModifier())
    }
}

private struct NoteTrashSheetModifier: ViewModifier {
    @Environment(AppEnvironment.self) private var app

    func body(content: Content) -> some View {
        let notes = app.notes
        let presented = Binding<Bool>(
            get: { notes.state.trash != nil },
            set: { open in
                if !open { notes.closeTrash() }
            }
        )
        content.nfBottomSheet(isPresented: presented, style: .plain(cornerRadius: 16)) {
            NoteTrashSheetContent()
        }
    }
}

@MainActor
private struct NoteTrashSheetContent: View {
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        if let trash = app.notes.state.trash {
            header(trash)
            Text(L("trash_hint", TRASH_RETENTION_DAYS))
                .font(.nf(13))
                .nfLineHeight(18.85, fontSize: 13)
                .foregroundStyle(Sm.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 9.6)
            if trash.confirmAll {
                confirmAll(trash)
            }
            if let error = trash.error {
                Text(notesErrorText(error, app.systemText))
                    .font(.nf(13))
                    .nfLineHeight(18.2, fontSize: 13)
                    .foregroundStyle(Sm.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            list(trash)
        }
    }

    private func header(_ trash: TrashUiState) -> some View {
        let notes = app.notes
        return HStack(spacing: 8) {
            LucideIcon(Lucide.trash2, size: 16, color: Sm.muted)
            Text(L("trash"))
                .font(.nf(16, weight: 600))
                .foregroundStyle(Sm.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            NotionButton(L("empty_trash"), kind: .danger, large: true) { notes.confirmEmptyTrash(true) }
                .disabled(trash.busy || (trash.items ?? []).isEmpty)
            NFIconButton(Lucide.x, label: L("close_trash"), iconSize: 16) { notes.closeTrash() }
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { NFDivider() }
    }

    /// `.note-th-confirm`：外边距 9.6 / 16 / 0、内边距 9.6×12、1px 浅红框、圆角 6、13 的字；按钮在下一行靠行尾。
    private func confirmAll(_ trash: TrashUiState) -> some View {
        let notes = app.notes
        let count = trash.items?.count ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            Text(count == 1 ? L("empty_trash_one") : L("empty_trash_all", count))
                .font(.nf(13))
                .nfLineHeight(18.2, fontSize: 13)
                .foregroundStyle(Sm.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 5.6) {
                Spacer(minLength: 0)
                NotionButton(L("cancel"), large: true) { notes.confirmEmptyTrash(false) }
                    .disabled(trash.busy)
                NotionButton(L("empty_trash"), kind: .danger, large: true) { notes.emptyTrash() }
                    .disabled(trash.busy)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9.6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(Color(argb: 0x40B91C1C), lineWidth: 1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 9.6)
    }

    /// 列表最高 560，再多在里面滚动；屏幕矮时让头部留在面板里（面板本身最高 88% 屏高）。
    private var listMaxHeight: CGFloat {
        min(560, max(160, UIScreen.main.bounds.height * 0.88 - 220))
    }

    private func list(_ trash: TrashUiState) -> some View {
        let notes = app.notes
        return FittingScrollView(maxHeight: listMaxHeight) {
            VStack(alignment: .leading, spacing: 0) {
                if let loadError = trash.loadError {
                    VStack(spacing: 8) {
                        status(notesErrorText(loadError, app.systemText))
                        NotionButton(L("try_again"), large: true) { notes.loadTrash() }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 24)
                } else if let items = trash.items {
                    if items.isEmpty {
                        status(L("trash_is_empty"))
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 24)
                    } else {
                        ForEach(items) { item in
                            NoteTrashRow(item: item, confirming: trash.confirmId == item.id, busy: trash.busy)
                        }
                    }
                } else {
                    status(L("loading_trash"))
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 24)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
    }

    private func status(_ text: String) -> some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(21, fontSize: 14)
            .foregroundStyle(Sm.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// 回收站里的一篇：图标 24（表情 17 / 文件图标 16）+ 间距 12 + 标题 15 / 500 和时间 12 灰；下一行是靠行尾的按钮
/// （“恢复”“永久删除”，点了“永久删除”换成“永久删除？”“取消”“永久删除”）。
@MainActor
private struct NoteTrashRow: View {
    let item: NoteTrashItem
    let confirming: Bool
    let busy: Bool
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        VStack(alignment: .leading, spacing: 6.4) {
            HStack(spacing: 12) {
                NoteIconGlyph(item.icon, emojiSize: 17, iconSize: 16)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1.6) {
                    Text(item.title)
                        .font(.nf(15, weight: 500))
                        .nfLineHeight(22.5, fontSize: 15)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                    Text(trashTimeLabel(item))
                        .font(.nf(12))
                        .nfLineHeight(18, fontSize: 12)
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 39)
            HStack(spacing: 5.6) {
                Spacer(minLength: 0)
                if confirming {
                    Text(L("delete_forever_q"))
                        .font(.nf(13, weight: 500))
                        .foregroundStyle(Sm.danger)
                        .lineLimit(1)
                    NotionButton(L("cancel"), large: true) { notes.confirmDeleteForever(nil) }
                        .disabled(busy)
                    NotionButton(L("delete_forever"), kind: .danger, large: true) { notes.deleteForever(item.id) }
                        .disabled(busy)
                } else {
                    NotionButton(L("restore"), large: true) { notes.restore(item.id) }
                        .disabled(busy)
                    NotionButton(L("delete_forever"), kind: .danger, large: true) { notes.confirmDeleteForever(item.id) }
                        .disabled(busy)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6.4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
