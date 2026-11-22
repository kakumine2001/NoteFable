import Foundation

// 笔记界面里不依赖 SwiftUI 的部分（Android ui/NotesUi.kt、ui/NoteEditor.kt 里的文案和列表规则）。

/// 错误提示：服务端原句经词典翻译，没有原句时用 [NotesError.kind] 对应的网页文案。
func notesErrorText(_ error: NotesError, _ system: SystemTextTranslator) -> String {
    if let detail = error.detail { return system.localize(detail) }
    switch error.kind {
    case .load: return L("err_load_notes")
    case .create: return L("err_create_note")
    case .trash: return L("err_trash_note")
    case .trashUnsaved: return L("err_trash_unsaved")
    case .group: return L("err_group")
    case .trashLoad: return L("err_trash_load")
    case .trashAction: return L("err_trash_request")
    case .unsavedDraft: return L("err_save_draft")
    case .export: return L("note_export_failed")
    case .exportUnsaved: return L("note_export_unsaved")
    case .importFailed: return L("note_import_failed")
    case .importTooMany: return L("note_import_too_many", MAX_IMPORT_FILES)
    case .importBadType: return L("note_import_bad_type")
    case .importFileTooLarge: return L("note_import_file_too_large")
    case .importTooLarge: return L("note_import_too_large")
    }
}

/// 拖动失败的提示（.list-reorder-error）。
func reorderFailureText(_ failure: ReorderFailure, _ system: SystemTextTranslator) -> String {
    if failure.wait { return L("sb_err_wait_move") }
    if let detail = failure.detail { return system.localize(detail) }
    return L("sb_err_move_item")
}

/// 顶栏的保存状态（网页上部栏：pending 和 saving 都显示 "Saving…"）。不认识的状态不显示。
func noteSaveStateText(_ saveState: String?) -> String {
    switch saveState {
    case "saved": return L("save_saved")
    case "saving", "unsaved": return L("save_saving")
    case "error": return L("save_not_saved")
    case "conflict": return L("save_conflict")
    default: return ""
    }
}

/// 出错 / 冲突时保存状态用警告色（#b45309），其余是灰色。
func noteSaveStateIsWarning(_ saveState: String?) -> Bool {
    saveState == "error" || saveState == "conflict"
}

private func noteIsoInstant(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

/// 网页 `toLocaleDateString(tag, { month: "short", day: "numeric" })`：英文 "Nov 14"、中日文 "11月14日"。
/// tag 是界面语言对应的网页 LOCALE_TAGS，不是系统语言（系统是德语等时界面落到英文，日期也用英文）。读不出日期时是空字符串。
func noteShortDate(_ iso: String, uiLocale: String = AppLanguage.uiLocale, timeZone: TimeZone = .current) -> String {
    guard let date = noteIsoInstant(iso) else { return "" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: AppLanguage.acceptLanguage(uiLocale))
    formatter.timeZone = timeZone
    formatter.setLocalizedDateFormatFromTemplate("MMMd")
    return formatter.string(from: date)
}

/// "Deleted 3 days ago · 27 days left"（网页 trashTimeLabel）：经过天数向下取整，剩余天数向上取整。
func trashTimeLabel(_ item: NoteTrashItem, now: Date = Date()) -> String {
    let day = 24.0 * 60 * 60
    let deletedAt = noteIsoInstant(item.deletedAt) ?? now
    let purgeAt = noteIsoInstant(item.purgeAt) ?? now
    let ago = max(0, Int((now.timeIntervalSince(deletedAt) / day).rounded(.down)))
    let left = Int((purgeAt.timeIntervalSince(now) / day).rounded(.up))
    let deleted: String
    switch ago {
    case 0: deleted = L("deleted_today")
    case 1: deleted = L("deleted_one_day")
    default: deleted = L("deleted_days", ago)
    }
    let remaining: String
    if left <= 0 {
        remaining = L("removing_soon")
    } else if left == 1 {
        remaining = L("one_day_left")
    } else {
        remaining = L("days_left", left)
    }
    return "\(deleted) · \(remaining)"
}

// ---- 移动对话框（网页 MoveNoteDialog） ----

/// "移到"对话框里的一个目标页面；[depth] 是缩进层数（筛选时平铺，都是 0）。
struct NoteMoveTarget: Equatable, Sendable, Identifiable {
    var page: NotePageSummary
    var depth: Int

    var id: String { page.id }
}

/// 可以移到其下的页面，按树的顺序（父页面后紧跟子页面）；自己和自己的子孙不列出。
func noteMoveTargets(_ state: NotesUiState, moving pageId: String) -> [NoteMoveTarget] {
    let blocked = state.descendants(pageId).union([pageId])
    var targets: [NoteMoveTarget] = []
    func walk(_ list: [NotePageSummary], _ depth: Int) {
        for entry in list where !blocked.contains(entry.id) {
            targets.append(NoteMoveTarget(page: entry, depth: depth))
            walk(state.children(entry.id), depth + 1)
        }
    }
    walk(state.roots, 0)
    return targets
}

/// 按标题筛选（不分大小写）：有筛选词时只平铺列出匹配的页面。
func filterNoteMoveTargets(_ targets: [NoteMoveTarget], _ filter: String) -> [NoteMoveTarget] {
    let query = ApiText.trim(filter).lowercased()
    if query.isEmpty { return targets }
    return targets.filter { $0.page.title.lowercased().contains(query) }.map { NoteMoveTarget(page: $0.page, depth: 0) }
}

/// 项目选项打不打勾：子页面不在任何项目的最上层，所以项目都不打勾（网页 !page.parentId）。[groupId] 为 nil 是"无项目"。
func noteMoveGroupChecked(_ page: NotePageSummary, groupId: String?) -> Bool {
    page.parentId == nil && page.groupId == groupId
}
