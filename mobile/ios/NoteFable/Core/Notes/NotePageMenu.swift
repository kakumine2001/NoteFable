import Foundation

/// 笔记顶栏"…"菜单的操作（网页 note-page-menu.tsx；Android ui/NotePageMenu.kt）。菜单本身在界面层。
/// 选了操作先关菜单再执行（和网页 run() 一样，不和对话框、换页叠在一起）；字体和开关留在菜单里。
@MainActor
struct NotePageMenuActions {
    var error: NotesError?
    var busy: Bool
    var onSettings: (NotePageSettings) -> Void
    var onFavorite: (Bool) -> Void
    var onDuplicate: () -> Void
    var onAddInside: () -> Void
    var onMove: () -> Void
    var onTrash: () -> Void
}

/// 菜单 "Style" 一栏的字体：[key] 是 NotePageSummary.font 的值，[label] 是文案的键。
struct NotePageFontOption: Equatable, Sendable {
    var key: String
    var label: String

    static let all = [
        NotePageFontOption(key: "default", label: "pg_font_default"),
        NotePageFontOption(key: "serif", label: "pg_font_serif"),
        NotePageFontOption(key: "mono", label: "pg_font_mono"),
    ]
}

/// 菜单里的三个开关（Small text / Full width / Lock page）：点一下只送这一项的反值。
enum NotePageToggle: CaseIterable, Sendable {
    case smallText, fullWidth, locked

    var label: String {
        switch self {
        case .smallText: return "pg_small_text"
        case .fullWidth: return "pg_full_width"
        case .locked: return "pg_lock_page"
        }
    }

    func isOn(_ page: NotePageSummary) -> Bool {
        switch self {
        case .smallText: return page.smallText
        case .fullWidth: return page.fullWidth
        case .locked: return page.locked
        }
    }

    func toggled(_ page: NotePageSummary) -> NotePageSettings {
        switch self {
        case .smallText: return NotePageSettings(smallText: !page.smallText)
        case .fullWidth: return NotePageSettings(fullWidth: !page.fullWidth)
        case .locked: return NotePageSettings(locked: !page.locked)
        }
    }
}

/// 收藏项的文案键：已收藏是 "Remove from Favorites"，否则 "Add to Favorites"。
func notePageFavoriteLabel(_ page: NotePageSummary) -> String {
    page.favoritedAt != nil ? "pg_remove_from_favorites" : "pg_add_to_favorites"
}
