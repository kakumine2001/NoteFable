import Foundation

/// 抽屉和首页在看聊天还是笔记（网页的 Chat / Note 切换）。
enum Workspace: Equatable, Sendable {
    case chat
    case notes
}

/// 给用户看的错误。服务端返回的原句（[detail]，英文，和聊天一样原样显示）优先；
/// 网络错误这类没有原句的，用 [kind] 对应的网页文案（[notesErrorText]）。
struct NotesError: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case load, create, trash, trashUnsaved, group, trashLoad, trashAction, unsavedDraft
        /// 导出失败；打开着的这一篇有存不上的草稿，所以不导出（网页 exportPage）。
        case export, exportUnsaved
        /// 导入失败（请求）；选的文件太多 / 不是 Markdown / 单个太大 / 总共太大（网页 importMarkdown 发请求前的检查）。
        case importFailed, importTooMany, importBadType, importFileTooLarge, importTooLarge
    }

    var kind: Kind
    var detail: String?

    init(_ kind: Kind, _ detail: String? = nil) {
        self.kind = kind
        self.detail = detail
    }
}

/// 正在编辑的笔记。标题和图标随网页编辑器的 meta 消息更新。
/// [editor] 是这个编辑器（WebView）最初打开的页面 id，编辑器没换就不变；冲突后"另存为新笔记"时网页换到新页面，
/// [id] 跟着变成新页面，[editor] 不变，所以 WebView 不重新加载。
/// [kind] 是页面类型（顶栏没有图标时按它画默认图标）：从列表打开时取列表的，编辑器的 ready 带来时以它为准。
/// [reveal] 是从检索结果打开时命中的块（笔记）或元素（白板）的 id：编辑器第一次加载时经 `/note-embed` 的 `reveal=` 交给网页定位过去，
/// 之后重新加载（网页进程崩溃）不再用。
struct OpenNote: Equatable, Sendable {
    var id: String
    var title: String
    var icon: String?
    var editor: String
    var kind: PageKind
    var reveal: String?

    init(_ id: String, _ title: String, _ icon: String?, editor: String? = nil, kind: PageKind = .note, reveal: String? = nil) {
        self.id = id
        self.title = title
        self.icon = icon
        self.editor = editor ?? id
        self.kind = kind
        self.reveal = reveal
    }

    /// 列表里的一篇。
    init(page: NotePageSummary) {
        self.init(page.id, page.title, page.icon, kind: page.kind)
    }
}

/// 让网页保存的结果。[draftKept]：没保存成功，但草稿已留在 WebView 里、之后会重试（不是冲突），可以先离开。
struct FlushResult: Equatable, Sendable {
    var ok: Bool
    var draftKept: Bool

    init(_ ok: Bool, draftKept: Bool = false) {
        self.ok = ok
        self.draftKept = draftKept
    }
}

struct TrashUiState: Equatable, Sendable {
    /// nil 表示还在读。
    var items: [NoteTrashItem]? = nil
    var loadError: NotesError? = nil
    var error: NotesError? = nil
    var busy: Bool = false
    var confirmAll: Bool = false
    var confirmId: String? = nil
}

/// 拖动失败：[id] 是被拖的笔记。[detail] 是服务端原句（经词典翻译后显示）；没有时 [wait] 为真显示
/// "Wait for the previous move to finish."，否则 "Could not move the item. Try again."（[reorderFailureText]）。
struct ReorderFailure: Equatable, Sendable {
    var id: String
    var detail: String?
    var wait: Bool

    init(_ id: String, _ detail: String? = nil, wait: Bool = false) {
        self.id = id
        self.detail = detail
        self.wait = wait
    }
}

/// 笔记编辑器里的 AI 面板或幻灯片生图撞到使用次数上限（429 usage_limit）时的档位和类别（chat / image）。
struct UsageLimitInfo: Equatable, Sendable {
    var tier: String
    var kind: String
}

struct NotesUiState: Equatable, Sendable {
    var workspace: Workspace = .chat
    var pages: [NotePageSummary] = [] {
        didSet { treeCache = TreeCache() }
    }
    var groups: [NoteGroupSummary] = []
    /// 还没读到过列表（首次加载中）。
    var loading: Bool = false
    var loaded: Bool = false
    var error: NotesError? = nil
    /// 新建、移到回收站进行中：和网页一样期间禁用列表操作。
    var busy: Bool = false
    var groupError: NotesError? = nil
    var collapsed: Set<String> = []
    /// 展开了哪些页面（子页面的树）。侧栏和首页共用，重开 App 后保留（网页 notefable:note-pages-expanded:v1）。
    var expanded: Set<String> = []
    /// 折叠了哪些分区（笔记 / 幻灯片 / 白板），重开 App 后保留（网页 notefable:workspace-sections-collapsed:v1）。
    var collapsedSections: Set<PageKind> = []
    /// 各类型能用的功能表（服务端的 kinds，[PageKindTable]）。分区和新建菜单按它画。
    var kindFeatures: [PageKind: PageKindFeatures] = PageKindTable.shared.snapshot
    var open: OpenNote? = nil
    /// 网页编辑器报来的保存状态：saved / saving / unsaved / error / conflict。
    var saveState: String? = nil
    /// 离开笔记时没能保存：提示后留在笔记里。
    var notice: NotesError? = nil
    /// 编辑器里的上传因为文件存储空间不够被拒绝（网页经桥发来的 storageLimit）：编辑器上方显示提示，关掉为止。
    var storageLimit: StorageLimitInfo? = nil
    /// 编辑器里的 AI 面板或幻灯片生图撞到使用次数上限（网页经桥发来的 usageLimit）：编辑器上方显示提示，关掉为止。
    var usageLimit: UsageLimitInfo? = nil
    /// 编辑器导出、已经收齐的文件（白板的 PNG / SVG / PDF；网页分块送来，[ExportFileAssembler] 拼成临时文件）：
    /// 界面交给系统的“存储到文件”，结束后调 [NotesViewModel.finishExportFile]。换了编辑器就作废。
    var exportFile: ExportedFile? = nil
    /// 导出的文件没能收下（类型不对、太大、缺了块、写不进去）：界面提示一次“Could not save the file.”，
    /// 再调 [NotesViewModel.dismissExportFileFailure]。
    var exportFileFailed: Bool = false
    /// 幻灯片放映中（网页的 presentation start / end）：编辑页收起顶栏，横屏、全屏、屏幕常亮。
    var presenting: Bool = false
    /// 回收站窗口；nil 表示没打开。
    var trash: TrashUiState? = nil
    /// 侧栏里改图标没成功（网页 notes-sidebar 的 iconError："Could not change the icon. Try again."）。
    var iconError: Bool = false
    /// 有一次 POST /api/pages/reorder 还没完（网页 use-note-pages 的 reorderBusy）：这时再排序会提示等上一次完成。
    var reorderBusy: Bool = false
    /// 正在移动（排序或拖进项目）的笔记：这些行不能拖（网页每个 ReorderRowButton 自己的 busy）。
    var moveBusy: Set<String> = []
    /// 拖动失败的行和原因（网页 ReorderRowButton 的 list-reorder-error）。
    var reorderError: ReorderFailure? = nil

    init(workspace: Workspace = .chat, collapsed: Set<String> = [], expanded: Set<String> = [], collapsedSections: Set<PageKind> = []) {
        self.workspace = workspace
        self.collapsed = collapsed
        self.expanded = expanded
        self.collapsedSections = collapsedSections
    }

    /// 能新建的类型（网页 creatablePageKinds）：分区、新建菜单、首页的新建按钮只出这些。
    var kinds: [PageKind] { PageKindTable.creatable(in: kindFeatures) }

    /// 页面所在的分区（网页 sectionKindOf）：还不能新建的类型（没有编辑器）的页面放在笔记的分区，不会看不到。
    func sectionKind(of page: NotePageSummary) -> PageKind {
        kinds.contains(page.kind) ? page.kind : .note
    }

    /// 工作区的分区（网页 workspaceSections，Android `NotesUiState.sections`，#168）：不在项目里的最上层页面按类型分成
    /// 笔记、幻灯片、白板（[kinds] 的顺序），子页面跟着父页面。[WorkspaceSection.count] 含子页面（首页小标题后的数字）。
    var sections: [WorkspaceSection] {
        let loose = loosePages
        let types = kinds
        func size(_ page: NotePageSummary) -> Int { 1 + children(page.id).reduce(0) { $0 + size($1) } }
        return types.map { kind in
            let members = loose.filter { (types.contains($0.kind) ? $0.kind : .note) == kind }
            return WorkspaceSection(kind: kind, roots: members, count: members.reduce(0) { $0 + size($1) })
        }
    }

    private func isLoose(_ page: NotePageSummary) -> Bool {
        guard let groupId = page.groupId else { return true }
        return !groups.contains { $0.id == groupId }
    }

    /// 项目被删后残留的 groupId 也算未分组（网页 notes-sidebar.tsx 的 loose）。只列最上层的页面，子页面缩进在父页面下。
    var loosePages: [NotePageSummary] {
        roots.filter(isLoose)
    }

    /// 未分组的页面数（含子页面），"No project" 标题后的数字。
    var looseCount: Int {
        pages.filter(isLoose).count
    }

    /// 项目里最上层的页面（列表用）。
    func members(_ groupId: String) -> [NotePageSummary] {
        roots.filter { $0.groupId == groupId }
    }

    /// 项目里的页面数（含子页面），项目标题后的数字。
    func memberCount(_ groupId: String) -> Int {
        pages.filter { $0.groupId == groupId }.count
    }

    // 父页面 → 子页面（列表顺序）。父页面不在列表里（回收站等）的子页面当最上层，键是 nil（网页 note-tree.ts 的 childrenByParent）。
    // 每个状态只算一次（pages 一变就作废）：侧栏和首页按项目、按节点反复读。只在主线程读。
    private final class TreeBox: @unchecked Sendable {
        var tree: [String?: [NotePageSummary]]?
    }

    private struct TreeCache: Equatable, Sendable {
        let box = TreeBox()
        // 缓存不算状态的一部分。
        static func == (lhs: TreeCache, rhs: TreeCache) -> Bool { true }
    }

    private var treeCache = TreeCache()

    private var tree: [String?: [NotePageSummary]] {
        if let tree = treeCache.box.tree { return tree }
        let ids = Set(pages.map(\.id))
        let tree = Dictionary(grouping: pages) { page -> String? in
            guard let parent = page.parentId, ids.contains(parent), parent != page.id else { return nil }
            return parent
        }
        treeCache.box.tree = tree
        return tree
    }

    var roots: [NotePageSummary] {
        tree[nil] ?? []
    }

    func children(_ parentId: String) -> [NotePageSummary] {
        tree[parentId] ?? []
    }

    /// 祖先（从上往下，不含自己）。数据坏了成环时也会停。
    func ancestors(_ id: String) -> [NotePageSummary] {
        var byId: [String: NotePageSummary] = [:]
        for page in pages { byId[page.id] = page }
        var chain: [NotePageSummary] = []
        var seen: Set<String> = [id]
        var parent = byId[id]?.parentId
        while let current = parent, !seen.contains(current) {
            guard let page = byId[current] else { break }
            seen.insert(current)
            chain.insert(page, at: 0)
            parent = page.parentId
        }
        return chain
    }

    /// 子孙的 id（不含自己）。
    func descendants(_ id: String) -> Set<String> {
        var result: Set<String> = []
        var stack = children(id)
        while let page = stack.popLast() {
            if page.id == id || !result.insert(page.id).inserted { continue }
            stack.append(contentsOf: children(page.id))
        }
        return result
    }

    /// 收藏（按收藏的先后；同一时刻的保持列表顺序）。
    var favorites: [NotePageSummary] {
        notesStableSorted(pages.filter { $0.favoritedAt != nil }) { ($0.favoritedAt ?? "") < ($1.favoritedAt ?? "") }
    }

    /// 打开着的页面的类型：列表里有这一篇就用列表的，否则用打开时知道的（检索结果、编辑器的 ready）。编辑页的顶栏也这样取。
    var openKind: PageKind? {
        guard let open else { return nil }
        return pages.first { $0.id == open.id }?.kind ?? open.kind
    }

    /// 打开着的编辑器自己要用从屏幕边缘开始的单指拖动（白板，[PageKind.capturesEdgeSwipes]）：编辑页不做边缘返回，
    /// 抽屉也不从屏幕边缘拉出（顶栏的菜单键照常能开，拉出来以后照常能推回去）。
    var editorCapturesEdgeSwipes: Bool {
        workspace == .notes && openKind?.capturesEdgeSwipes == true
    }

    /// 展开着：自己展开了，或者是打开着的笔记的祖先（网页侧栏同样会展开）。
    func isExpanded(_ id: String) -> Bool {
        if expanded.contains(id) { return true }
        guard let open, !children(id).isEmpty else { return false }
        return ancestors(open.id).contains { $0.id == id }
    }
}

/// 稳定排序（Kotlin 的 sortedWith）：比不出先后的保持原来的顺序。
func notesStableSorted<T>(_ items: [T], by areInIncreasingOrder: (T, T) -> Bool) -> [T] {
    items.enumerated().sorted { a, b in
        if areInIncreasingOrder(a.element, b.element) { return true }
        if areInIncreasingOrder(b.element, a.element) { return false }
        return a.offset < b.offset
    }.map(\.element)
}

/// 一个分区（网页 WorkspaceSection）：类型、最上层的页面（列表顺序）、含子页面的数量。
struct WorkspaceSection: Equatable, Sendable {
    var kind: PageKind
    var roots: [NotePageSummary]
    var count: Int
}

/// 折叠了哪些项目、分区，展开了哪些页面，重开 App 后保留（网页存在 localStorage）。
protocol NotesPrefs: AnyObject {
    var collapsedGroups: Set<String> { get set }
    var expandedPages: Set<String> { get set }
    /// 折叠了的分区（类型的 wire 值："note" 等）。
    var collapsedSections: Set<String> { get set }
}

/// 只留在内存里（测试、预览）。
final class MemoryNotesPrefs: NotesPrefs {
    var collapsedGroups: Set<String>
    var expandedPages: Set<String>
    var collapsedSections: Set<String>

    init(collapsedGroups: Set<String> = [], expandedPages: Set<String> = [], collapsedSections: Set<String> = []) {
        self.collapsedGroups = collapsedGroups
        self.expandedPages = expandedPages
        self.collapsedSections = collapsedSections
    }
}

/// 存在 UserDefaults 里（Android 的 SharedPreferences "notes" 的 collapsed / expanded）。
final class UserDefaultsNotesPrefs: NotesPrefs {
    private let defaults: UserDefaults
    private let collapsedKey = "notes.collapsed"
    private let expandedKey = "notes.expanded"
    private let sectionsKey = "notes.collapsedSections"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var collapsedGroups: Set<String> {
        get { Set(defaults.stringArray(forKey: collapsedKey) ?? []) }
        set { defaults.set(newValue.sorted(), forKey: collapsedKey) }
    }

    var expandedPages: Set<String> {
        get { Set(defaults.stringArray(forKey: expandedKey) ?? []) }
        set { defaults.set(newValue.sorted(), forKey: expandedKey) }
    }

    var collapsedSections: Set<String> {
        get { Set(defaults.stringArray(forKey: sectionsKey) ?? []) }
        set { defaults.set(newValue.sorted(), forKey: sectionsKey) }
    }
}
