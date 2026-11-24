import Foundation

/// 笔记顶栏"…"菜单的操作（网页 note-page-menu.tsx；Android ui/NotePageMenu.kt）。菜单本身在界面层。
/// 选了操作先关菜单再执行（和网页 run() 一样，不和对话框、换页叠在一起）；字体和开关留在菜单里。
/// 出哪些项按页面类型（[PageKindFeatures]）：字体、小字号、全宽（typography）和导出 Markdown（markdownExport）只给笔记，
/// 锁定、收藏、复制、添加子页面、移动到、移到回收站所有类型都有；"报告 AI 内容"只给 AI 写过的页面（[notePageReportable]），
/// 它的窗口由菜单按钮自己开（网页 NotePageMenu 的 reporting），不经这里。
@MainActor
struct NotePageMenuActions {
    var error: NotesError?
    var busy: Bool
    var onSettings: (NotePageSettings) -> Void
    var onFavorite: (Bool) -> Void
    var onDuplicate: () -> Void
    var onAddInside: () -> Void
    var onMove: () -> Void
    /// "导出 Markdown"（网页 onExport）。
    var onExport: () -> Void
    var onTrash: () -> Void
    /// 放映和导出（网页 `window.notefableEmbed.slides` 的 JSON 命令）。nil 时不显示。
    var onSlides: ((String) -> Void)? = nil
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

    /// 这一类页面的菜单里有哪些开关：小字号、全宽只给能调排版的类型（网页 features.typography），锁定所有类型都有。
    static func visible(for kind: PageKind) -> [NotePageToggle] {
        kind.features.typography ? allCases : [.locked]
    }
}

/// 收藏项的文案键：已收藏是 "Remove from Favorites"，否则 "Add to Favorites"。
func notePageFavoriteLabel(_ page: NotePageSummary) -> String {
    page.favoritedAt != nil ? "pg_remove_from_favorites" : "pg_add_to_favorites"
}

/// 菜单里有"报告 AI 内容"：AI 写过这个页面的内容（`aiUpdatedAt` 不是 nil；应用商店对 AI 生成内容的要求）。
func notePageReportable(_ page: NotePageSummary) -> Bool {
    page.aiUpdatedAt != nil
}

/// 笔记和幻灯片都支持在"…"菜单里放映（导出仅幻灯片可用；Android `supportsPresentation`）。
func notePageSupportsPresentation(_ kind: PageKind) -> Bool {
    kind == .note || kind == .slides
}
