import Foundation

// 笔记列表、项目（分组）、回收站的服务端 JSON，字段与 src/types/notes.ts 和 src/app/api/pages 一致。
// 笔记正文不在这里：编辑器是网页的 /note-embed，App 只管列表和导航。

/// 页面类型能用的功能（网页 src/lib/page-kinds.ts 的 PageKindFeatures，Android `PageKindFeatures`）。表本身只在网页的
/// PAGE_KIND_FEATURES 里定义，App 从服务端读（[PageKindTable]）。服务端也按同一张表拒绝笔记专用的操作（400，`code: "wrong_page_kind"`）。
struct PageKindFeatures: Equatable, Sendable {
    /// 有能编辑它的编辑器；没有的类型 /note-embed 显示只读的占位画面。也是"能不能新建"的开关：分区、新建菜单、检索的类型筛选只出 true 的类型（#168）。
    var editor: Bool = false
    /// Markdown 导出（GET /api/pages/:id/export）。
    var markdownExport: Bool = false
    /// 字体、小字号、全宽（页面设置里只影响正文外观的几项）。锁定所有类型都能用。
    var typography: Bool = false
    /// 公开分享（/s/:token）：只有有公开视图的类型。
    var publicShare: Bool = false
    /// AI 的编辑提案（propose_note_edit 和应用）。
    var aiEdit: Bool = false

    static let note = PageKindFeatures(editor: true, markdownExport: true, typography: true, publicShare: true, aiEdit: true)

    /// 服务端 JSON 的一项（`{ editor, markdownExport, … }`）：缺的、不是布尔值的字段按 false，不是对象时 nil。
    init?(json: JSONValue) {
        guard let object = json.objectValue else { return nil }
        editor = object["editor"]?.boolValue ?? false
        markdownExport = object["markdownExport"]?.boolValue ?? false
        typography = object["typography"]?.boolValue ?? false
        publicShare = object["publicShare"]?.boolValue ?? false
        aiEdit = object["aiEdit"]?.boolValue ?? false
    }

    init(editor: Bool = false, markdownExport: Bool = false, typography: Bool = false, publicShare: Bool = false, aiEdit: Bool = false) {
        self.editor = editor
        self.markdownExport = markdownExport
        self.typography = typography
        self.publicShare = publicShare
        self.aiEdit = aiEdit
    }
}

/// 各页面类型能用的功能表（网页 PAGE_KIND_FEATURES，Android `PageKindTable`）。服务端 `GET /api/pages` 的 `kinds` 一到就换成它，
/// 之前用安装包里的 page-kinds.json（scripts/gen-native-page-kinds.ts 从网页生成，Android 的 assets 同一份），两者都没有时只有笔记能用。
/// 所以白板 / 幻灯片的开关在网页部署后三端一起切换，不用重新发 App。界面按 [NotesUiState.kindFeatures] 画（那份会触发重绘），
/// 这里给不在笔记状态里的地方（页面菜单、编辑页顶栏）读。
final class PageKindTable: @unchecked Sendable {
    static let shared = PageKindTable()

    /// 画面上的顺序（网页 PAGE_KIND_ORDER）：笔记、幻灯片、白板。
    static let displayOrder: [PageKind] = [.note, .slides, .whiteboard]
    static let fallback: [PageKind: PageKindFeatures] = [.note: .note]

    private let lock = NSLock()
    private var table: [PageKind: PageKindFeatures] = PageKindTable.fallback

    var snapshot: [PageKind: PageKindFeatures] {
        lock.lock(); defer { lock.unlock() }
        return table
    }

    func features(_ kind: PageKind) -> PageKindFeatures {
        Self.features(kind, in: snapshot)
    }

    /// 换成服务端 / 安装包的表（[parse] 读出来的）。
    func update(_ next: [PageKind: PageKindFeatures]) {
        lock.lock(); defer { lock.unlock() }
        table = next
    }

    /// 安装包里的 page-kinds.json（读不出来时保持只有笔记）。
    func loadBundled(_ data: Data) {
        if let json = JSONValue.parse(data), let parsed = Self.parse(json) { update(parsed) }
    }

    /// 单元测试用：回到只有笔记的表。
    func reset() { update(Self.fallback) }

    static func features(_ kind: PageKind, in table: [PageKind: PageKindFeatures]) -> PageKindFeatures {
        table[kind] ?? (kind == .note ? .note : PageKindFeatures())
    }

    /// 能新建的类型（网页 creatablePageKinds）：[displayOrder] 里 editor 为 true 的；笔记总能新建。
    static func creatable(in table: [PageKind: PageKindFeatures]) -> [PageKind] {
        displayOrder.filter { $0 == .note || features($0, in: table).editor }
    }

    /// 服务端的 `kinds`（`{ "note": { editor, … }, … }`）。不是对象时 nil（不动）；不认识的类型忽略；表里缺了笔记也让笔记能用。
    static func parse(_ json: JSONValue) -> [PageKind: PageKindFeatures]? {
        guard let object = json.objectValue else { return nil }
        var result: [PageKind: PageKindFeatures] = [:]
        for (wire, value) in object {
            guard let kind = PageKind(rawValue: wire), let features = PageKindFeatures(json: value) else { continue }
            result[kind] = features
        }
        if result[.note] == nil { result[.note] = .note }
        return result
    }
}

/// 工作区页面的类型（网页 PAGE_KINDS，Android `PageKind`）：笔记、白板、幻灯片，建好后不会变。JSON 里是小写的 "note" / "whiteboard" / "slides"；
/// 旧服务端没有这个字段，null 和不认识的值也都按笔记（网页 pageKindOf）。三种都用同一个 /note-embed 打开：白板是网页的白板编辑器，
/// 幻灯片是网页的幻灯片编辑器。
enum PageKind: String, CaseIterable, Sendable {
    case note
    case whiteboard
    case slides

    /// JSON 里的值。
    var wire: String { rawValue }

    /// 这个类型能用的功能（[PageKindTable]，服务端的表）。
    var features: PageKindFeatures { PageKindTable.shared.features(self) }

    /// 白板和幻灯片：正文不是 BlockNote，另存在 NoteCanvas（网页 isCanvasKind）。
    var isCanvas: Bool { self != .note }

    /// 编辑器自己要用单指拖动，从屏幕边缘开始的也是（白板：画笔、图形、框选）。iOS 在这类页面上关掉编辑页的边缘返回，
    /// 抽屉也不从屏幕边缘拉出，离开只用顶栏的“<”和菜单键；Android 只在网页报来正在用画画的工具（drawing）时让开边缘。
    var capturesEdgeSwipes: Bool { self == .whiteboard }

    /// 没有或不认识的值按笔记。
    static func of(_ value: String?) -> PageKind {
        value.flatMap(PageKind.init(rawValue:)) ?? .note
    }
}

extension PageKind: Codable {
    /// 读到不是字符串（数字、对象）或不认识的类型时按笔记，不让整个列表因为一个字段读不出来。
    init(from decoder: Decoder) throws {
        self = PageKind.of(try? decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wire)
    }
}

/// 页面类型的名字（网页 PAGE_KIND_LABELS，Android `pageKindLabel`）的文案键：检索结果里白板 / 幻灯片标题后面的小字、新建菜单的项。
func pageKindLabel(_ kind: PageKind) -> String {
    switch kind {
    case .note: return "page_kind_note"
    case .whiteboard: return "page_kind_whiteboard"
    case .slides: return "page_kind_slides"
    }
}

/// 分区的名字（网页 PAGE_KIND_SECTION_LABELS，Android `sectionLabel`）的文案键：侧栏和首页的分区标题、检索的类型筛选。
func pageKindSectionLabel(_ kind: PageKind) -> String {
    switch kind {
    case .note: return "notes"
    case .slides: return "page_kind_slides"
    case .whiteboard: return "ws_section_whiteboards"
    }
}

/// 一次建这个类型的按钮（网页 PAGE_KIND_NEW_LABELS，Android `newPageLabel`）的文案键：分区的"+"、首页和空状态的新建按钮。
func pageKindNewLabel(_ kind: PageKind) -> String {
    switch kind {
    case .note: return "new_note"
    case .slides: return "ws_new_slides"
    case .whiteboard: return "ws_new_whiteboard"
    }
}

/// 笔记图标：表情一个，或者和封面同样形式的上传图片（`upload:page-covers/<所有者>/<UUID>.<扩展名>`，网页 src/lib/note-icon.ts、
/// Android `NoteIcons`）。图片返回要读的相对路径（带 App 的 Cookie、服务端核对归属），表情返回 nil。
enum NoteIcons {
    static func imagePath(_ icon: String?) -> String? {
        guard let icon, icon.hasPrefix("upload:") else { return nil }
        let path = String(icon.dropFirst("upload:".count))
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "page-covers" else { return nil }
        let owner = parts[1]
        guard (1...64).contains(owner.count), owner.allSatisfy({ ("a"..."z").contains($0) || ("0"..."9").contains($0) }) else { return nil }
        let file = parts[2].split(separator: ".", omittingEmptySubsequences: false)
        guard file.count == 2, file[0].count == 36, file[0].allSatisfy({ $0 == "-" || $0.isHexDigit && !$0.isUppercase }),
              ["jpg", "png", "webp", "gif"].contains(String(file[1])) else { return nil }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return "/api/pages/covers?key=" + (path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path)
    }

    /// 只能用文字的地方：图片图标不显示。
    static func text(_ icon: String?) -> String? {
        imagePath(icon) == nil ? icon : nil
    }
}

/// 笔记封面（网页 src/lib/note-document.ts 的 NOTE_COVERS 和 uploadedCoverPath）：
/// 12 种预设渐变 / 纯色，或上传到 `/api/pages/covers?key=` 的图片。
enum NoteCovers {
    struct Preset: Equatable, Sendable {
        let startArgb: UInt32
        let endArgb: UInt32
    }

    static let presets: [String: Preset] = [
        "gradient-sunset": Preset(startArgb: 0xFFF6D365, endArgb: 0xFFFDA085),
        "gradient-peach": Preset(startArgb: 0xFFFFECD2, endArgb: 0xFFFCB69F),
        "gradient-mint": Preset(startArgb: 0xFFD4FC79, endArgb: 0xFF96E6A1),
        "gradient-ocean": Preset(startArgb: 0xFF89F7FE, endArgb: 0xFF66A6FF),
        "gradient-lavender": Preset(startArgb: 0xFFE0C3FC, endArgb: 0xFF8EC5FC),
        "gradient-night": Preset(startArgb: 0xFF30CFD0, endArgb: 0xFF330867),
        "solid-red": Preset(startArgb: 0xFFE16259, endArgb: 0xFFE16259),
        "solid-yellow": Preset(startArgb: 0xFFDFAB01, endArgb: 0xFFDFAB01),
        "solid-green": Preset(startArgb: 0xFF4DAB9A, endArgb: 0xFF4DAB9A),
        "solid-blue": Preset(startArgb: 0xFF529CCA, endArgb: 0xFF529CCA),
        "solid-purple": Preset(startArgb: 0xFF9A6DD7, endArgb: 0xFF9A6DD7),
        "solid-beige": Preset(startArgb: 0xFFE9E5E3, endArgb: 0xFFE9E5E3),
    ]

    static func preset(_ cover: String?) -> Preset? {
        cover.flatMap { presets[$0] }
    }

    static func imagePath(_ cover: String?) -> String? {
        NoteIcons.imagePath(cover)
    }
}

struct NotePageSummary: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var cover: String? = nil
    var coverPosition: Int? = nil
    var version: Int = 0
    /// 所属项目；nil 是"未分组"。子页面和最上层的祖先在同一个项目。
    var groupId: String? = nil
    var position: Int = 0
    var createdAt: String = ""
    var updatedAt: String = ""
    /// 父页面（Notion 的子页面）；nil 是最上层。父页面不在列表里（回收站等）时当最上层显示。
    var parentId: String? = nil
    /// 加入收藏的时刻（ISO）；nil 是没收藏。
    var favoritedAt: String? = nil
    /// 页面的显示设置（网页上部栏的"…"）。和正文的 version 分开保存。
    var fullWidth: Bool = false
    var smallText: Bool = false
    /// "default" / "serif" / "mono"
    var font: String = "default"
    /// 锁定：编辑器只读（界面上的防误改，不是权限）。
    var locked: Bool = false
    /// 公开分享状态（用于顶栏分享按钮高亮）。
    var shareEnabled: Bool = false
    var shareExpiresAt: String? = nil
    /// 页面类型（笔记 / 白板 / 幻灯片）。旧服务端不返回，按笔记。
    var kind: PageKind = .note
    /// AI 最后一次写这个页面内容的时刻（ISO）；nil 是 AI 没写过（或旧服务端）。有值时页面的"…"菜单里有"报告 AI 内容"。
    var aiUpdatedAt: String? = nil

    func isShared(now: Date = Date()) -> Bool {
        guard shareEnabled else { return false }
        guard let expires = shareExpiresAt else { return true }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: expires) { return date > now }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: expires) else { return false }
        return date > now
    }
}

extension NotePageSummary: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"),
            cover: try f.opt("cover"), coverPosition: try f.opt("coverPosition"), version: try f.or("version", 0),
            groupId: try f.opt("groupId"), position: try f.or("position", 0), createdAt: try f.or("createdAt", ""),
            updatedAt: try f.or("updatedAt", ""), parentId: try f.opt("parentId"), favoritedAt: try f.opt("favoritedAt"),
            fullWidth: try f.or("fullWidth", false), smallText: try f.or("smallText", false),
            font: try f.or("font", "default"), locked: try f.or("locked", false),
            shareEnabled: try f.or("shareEnabled", false), shareExpiresAt: try f.opt("shareExpiresAt"),
            kind: try f.or("kind", .note), aiUpdatedAt: try f.opt("aiUpdatedAt")
        )
    }
}

struct NoteShareAncestor: Equatable, Sendable, Decodable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var token: String
    var url: String
    var expiresAt: String? = nil

    init(id: String, title: String = "", icon: String? = nil, token: String, url: String, expiresAt: String? = nil) {
        self.id = id
        self.title = title
        self.icon = icon
        self.token = token
        self.url = url
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"),
            token: try f.req("token"), url: try f.req("url"), expiresAt: try f.opt("expiresAt")
        )
    }
}

struct NoteShareState: Equatable, Sendable, Decodable {
    var enabled: Bool = false
    var active: Bool = false
    var expired: Bool = false
    var token: String? = nil
    var url: String? = nil
    var includeSubpages: Bool = true
    var expiresAt: String? = nil
    var excludeFromParent: Bool = false
    var hasParent: Bool = false
    var inheritedFrom: NoteShareAncestor? = nil
    var inheritedUrl: String? = nil

    init(
        enabled: Bool = false, active: Bool = false, expired: Bool = false, token: String? = nil, url: String? = nil,
        includeSubpages: Bool = true, expiresAt: String? = nil, excludeFromParent: Bool = false,
        hasParent: Bool = false, inheritedFrom: NoteShareAncestor? = nil, inheritedUrl: String? = nil
    ) {
        self.enabled = enabled
        self.active = active
        self.expired = expired
        self.token = token
        self.url = url
        self.includeSubpages = includeSubpages
        self.expiresAt = expiresAt
        self.excludeFromParent = excludeFromParent
        self.hasParent = hasParent
        self.inheritedFrom = inheritedFrom
        self.inheritedUrl = inheritedUrl
    }

    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            enabled: try f.or("enabled", false), active: try f.or("active", false), expired: try f.or("expired", false),
            token: try f.opt("token"), url: try f.opt("url"), includeSubpages: try f.or("includeSubpages", true),
            expiresAt: try f.opt("expiresAt"), excludeFromParent: try f.or("excludeFromParent", false),
            hasParent: try f.or("hasParent", false), inheritedFrom: try f.opt("inheritedFrom"),
            inheritedUrl: try f.opt("inheritedUrl")
        )
    }
}

struct NoteSharePatch: Equatable, Sendable {
    var enabled: Bool? = nil
    var includeSubpages: Bool? = nil
    var setExpiresAt: Bool = false
    var expiresAt: String? = nil
    var excludeFromParent: Bool? = nil
}

struct ShareStateResponse: Decodable {
    var share: NoteShareState
    var page: NotePageSummary? = nil
}

struct ShareUpdateResult: Equatable, Sendable {
    var share: NoteShareState
    var page: NotePageSummary? = nil
}

/// 页面设置的改动（PUT /api/pages/:id/settings 只改送去的项）。
struct NotePageSettings: Equatable, Sendable {
    var fullWidth: Bool? = nil
    var smallText: Bool? = nil
    var font: String? = nil
    var locked: Bool? = nil
}

/// POST /api/pages/:id/duplicate：复制后的最上层页面、所有复制件、全部笔记的新 position。
struct DuplicateResult: Equatable, Sendable {
    var page: NotePageSummary
    var pages: [NotePageSummary]
    var order: [NoteOrderUpdate]
}

struct NoteGroupSummary: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var position: Int = 0
}

extension NoteGroupSummary: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(id: try f.req("id"), name: try f.req("name"), position: try f.or("position", 0))
    }
}

struct NotesList: Encodable, Equatable, Sendable {
    var pages: [NotePageSummary] = []
    var groups: [NoteGroupSummary] = []
    /// 各类型能用的功能表（网页 PAGE_KIND_FEATURES，[PageKindTable.parse] 读出来的）；旧服务端没有、读不出来时 nil。
    var kinds: [PageKind: PageKindFeatures]? = nil

    enum CodingKeys: String, CodingKey { case pages, groups }
}

extension NotesList: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        // kinds 读不出来也不让整个列表失败。
        let kinds = (try? f.opt("kinds", JSONValue.self)).flatMap { $0 }.flatMap(PageKindTable.parse)
        self.init(pages: try f.or("pages", []), groups: try f.or("groups", []), kinds: kinds)
    }
}

/// deletedAt 是移进回收站的时刻，purgeAt 是不能再恢复、会被永久删除的时刻（ISO 字符串）。
struct NoteTrashItem: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var deletedAt: String
    var purgeAt: String
    /// 页面类型（没有图标时按它画默认图标）。旧服务端不返回，按笔记。
    var kind: PageKind = .note
}

extension NoteTrashItem: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"),
            deletedAt: try f.req("deletedAt"), purgeAt: try f.req("purgeAt"), kind: try f.or("kind", .note)
        )
    }
}

/// `POST /api/pages/reorder` 返回的新顺序（`{items:[{id, position, groupId?}]}`）。只有被移动的那一篇带 groupId
/// （跨项目拖动时服务端顺便改它的项目），null 也是有效值（移出项目），所以用 [movedGroup] 记字段在不在。
struct NoteOrderUpdate: Equatable, Sendable {
    var id: String
    var position: Int
    var groupId: String? = nil
    var movedGroup: Bool = false
    /// 被拖的那一篇变成目标的兄弟，也带回新的 parentId（null 也是有效值：最上层）。
    var parentId: String? = nil
    var movedParent: Bool = false

    /// [response] 是整个响应对象；格式不对的项跳过。
    static func parse(_ response: JSONValue) -> [NoteOrderUpdate] {
        guard let items = response["items"]?.arrayValue else { return [] }
        return items.compactMap { item in
            guard let fields = item.objectValue, let id = fields["id"]?.stringValue,
                  let position = fields["position"]?.intValue else { return nil }
            // 看键在不在（JSONValue 自己也能写成 nil 字面量，这里不拿它和 nil 比）。
            let movedGroup = fields.keys.contains("groupId")
            let movedParent = fields.keys.contains("parentId")
            return NoteOrderUpdate(
                id: id, position: position, groupId: fields["groupId"]?.stringValue, movedGroup: movedGroup,
                parentId: fields["parentId"]?.stringValue, movedParent: movedParent
            )
        }
    }
}

struct PageResponse: Decodable {
    var page: NotePageSummary

    init(from decoder: Decoder) throws {
        page = try DtoFields(decoder).req("page")
    }
}

/// 复原（一起移进回收站的子页面也回来）、移到别的页面之下：page 是这一篇，pages 是全部受影响的页面。
struct PagesResponse: Decodable {
    var page: NotePageSummary?
    var pages: [NotePageSummary]

    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        page = try f.opt("page")
        pages = try f.or("pages", [])
    }
}

/// 移进回收站、移进项目：ids 是一起被移动的页面（含子页面）。
struct IdsResponse: Decodable {
    var ids: [String]

    init(from decoder: Decoder) throws {
        ids = try DtoFields(decoder).or("ids", [])
    }
}

struct GroupResponse: Decodable {
    var group: NoteGroupSummary

    init(from decoder: Decoder) throws {
        group = try DtoFields(decoder).req("group")
    }
}

struct TrashResponse: Decodable {
    var pages: [NoteTrashItem]

    init(from decoder: Decoder) throws {
        pages = try DtoFields(decoder).or("pages", [])
    }
}

/// 只需要知道成功与否的接口（`{ ok: true }` 之类），内容不用。响应必须是一个 JSON 对象。
struct JsonObjectResponse: Decodable {
    init(from decoder: Decoder) throws {
        _ = try DtoFields(decoder)
    }
}

/// 笔记相关的服务端能力。拆成协议是为了单元测试时换成假实现。
protocol NotesBackend {
    func notes() async throws -> NotesList

    /// 和网页的新建一样，建一篇空白的 Untitled 页面（[kind]：笔记，或空的白板 / 幻灯片）。[parentId] 指定时建在那一篇里面
    /// （子页面，项目随父页面），否则建在 [groupId] 项目的最上层（nil 是不进项目）。
    func createNote(parentId: String?, kind: PageKind, groupId: String?) async throws -> NotePageSummary

    /// 移到回收站（服务端只记 deletedAt，30 天内可恢复），子页面一起移进去。返回所有被移进去的 id（含这一篇）。
    func trashNote(id: String) async throws -> [String]

    /// 移进项目（nil 是移出），同时脱离父页面；返回一起移动的 id（含子页面）。
    func moveNote(id: String, groupId: String?) async throws -> [String]

    /// 移到另一页面之下（nil 回到最上层）；返回被移动的页面（含子页面）的新状态。
    func moveToPage(id: String, parentId: String?) async throws -> [NotePageSummary]

    func setFavorite(id: String, favorite: Bool) async throws -> NotePageSummary
    func updateSettings(id: String, settings: NotePageSettings) async throws -> NotePageSummary
    func getShare(id: String) async throws -> NoteShareState
    func updateShare(id: String, patch: NoteSharePatch) async throws -> ShareUpdateResult

    /// 复制这一篇和子页面（网页"Duplicate"）。
    func duplicate(id: String) async throws -> DuplicateResult

    /// 拖动排序：把 [id] 放到 [targetId] 的前 / 后（网页 ReorderRequest）。目标在别的项目里时也一起移过去。
    func reorderNote(id: String, targetId: String, after: Bool) async throws -> [NoteOrderUpdate]
    func createGroup(name: String) async throws -> NoteGroupSummary
    func renameGroup(id: String, name: String) async throws -> NoteGroupSummary
    func deleteGroup(id: String) async throws
    func renameNote(id: String, title: String) async throws -> NoteIconWrite

    func trash() async throws -> [NoteTrashItem]
    /// 复原；一起移进回收站的子页面也回来。返回所有复原的页面（第一篇是这一篇）。
    func restoreNote(id: String) async throws -> [NotePageSummary]
    /// 永久删除；回收站里它的子页面也一起删。返回删掉的 id（另一时刻移进去、单独列着的子页面也在里面）。
    func deleteForever(id: String) async throws -> [String]

    /// 清空回收站；[before] 是确认时看到的最新一条的 deletedAt，确认后别处新扔的不会被删。
    func emptyTrash(before: String) async throws

    /// 导出一篇笔记的 Markdown（`GET /api/pages/:id/export`）。服务端导出的是已保存的内容。
    func exportNote(id: String) async throws -> ExportedNote

    /// 把一个或多个 Markdown 文件导入成笔记（`POST /api/pages/import`），返回新建的笔记（顺序和文件相同）。
    /// [groupId] 是导入到哪个项目，nil 是"无项目"；不是自己的项目时服务端回 404。
    func importMarkdown(files: [ImportMarkdownFile], groupId: String?) async throws -> [NotePageSummary]

    /// 网页"仅编辑器"页面的地址（`/note-embed?page=…&lang=…&model=…&reasoning=…&theme=…&reveal=…`）。
    /// [model] / [reasoning] 是 App 里选的模型和推理强度，编辑器里的 AI 助手用它们（网页按服务端的模型列表核对）。
    /// [theme] 是 App 现在显示的外观（light / dark）：网页在第一次绘制前就按它上色（src/lib/theme.ts 的 THEME_INIT_SCRIPT）。
    /// [reveal] 是检索结果命中的块（笔记）或元素（白板）的 id（`NoteSearchResult.blockId`）：网页读好页面后滚动 / 移动到那里
    /// （src/components/note-embed.tsx）。空字符串当作没给。
    func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?, theme: String?, reveal: String?) -> String
}

extension NotesBackend {
    func createNote() async throws -> NotePageSummary {
        try await createNote(parentId: nil, kind: .note, groupId: nil)
    }

    func renameNote(id: String, title: String) async throws -> NoteIconWrite {
        fatalError("unused")
    }

    func getShare(id: String) async throws -> NoteShareState {
        fatalError("unused")
    }

    func updateShare(id: String, patch: NoteSharePatch) async throws -> ShareUpdateResult {
        fatalError("unused")
    }

    func noteEmbedUrl(pageId: String, lang: String?) -> String {
        noteEmbedUrl(pageId: pageId, lang: lang, model: nil, reasoning: nil, theme: nil, reveal: nil)
    }

    func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?) -> String {
        noteEmbedUrl(pageId: pageId, lang: lang, model: model, reasoning: reasoning, theme: nil, reveal: nil)
    }

    func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?, theme: String?) -> String {
        noteEmbedUrl(pageId: pageId, lang: lang, model: model, reasoning: reasoning, theme: theme, reveal: nil)
    }
}

/// 回收站里保留的天数，与 src/types/notes.ts 的 TRASH_RETENTION_DAYS 相同。
let TRASH_RETENTION_DAYS = 30

/// 网页编辑器（/note-embed）发给 App 的消息。约定见 src/lib/native-bridge.ts 和 docs/architecture/android-native.md；两边要一起改。
///
/// 网页调的是 `window.NoteFableNative.postMessage(json)`（Android 的 @JavascriptInterface）。WKWebView 没有这种对象，
/// 界面层要在页面开始加载前注入一段脚本，把 `window.NoteFableNative` 定义成转发给
/// `window.webkit.messageHandlers.<名字>.postMessage(json)` 的对象（还有同步返回的 `appIcon()` / `language()` / `theme()`），
/// 收到的 JSON 文本交给 [parse]。
enum EmbedMessage: Equatable, Sendable {
    /// [kind]：网页读到的页面类型；旧网页不发时是 nil（这时不改 App 这边已知的类型）。
    case ready(id: String, title: String, icon: String?, kind: PageKind? = nil)
    case meta(title: String, icon: String?)
    case saveState(state: String)
    case missing(id: String? = nil)
    case trashed
    /// 笔记里的页面提及被点了：打开那一页（和回答里的笔记链接一样走 openNoteFromLink）。
    case openPage(id: String)
    /// [kept]：没保存成功，但草稿已存在 WebView 里、之后会重试（不是冲突）。这时可以先离开。
    case flushed(requestId: String, ok: Bool, kept: Bool = false)
    /// 笔记里的图片、文件、封面或图标因为文件存储空间不够上传失败（used / limit 是字节）。App 在编辑器上方显示提示。
    /// 只有 bootstrap 里声明了 `canShowStorageLimit()` 的 App 才会收到。
    case storageLimit(tier: String, used: Int, limit: Int)
    /// 笔记编辑器里的 AI 面板或幻灯片生图撞到使用次数上限（429 usage_limit）。App 在编辑器上方显示提示。
    /// 只有 bootstrap 里声明了 `canShowUsageLimit()` 的 App 才会收到。[pageId] 是发生上限的源页面 ID（用于过滤切页后晚到的旧响应）。
    case usageLimit(tier: String, kind: String, pageId: String? = nil)
    /// 白板在用画画的工具（画笔、图形…，不是移动画布的手）。Android 这期间让开屏幕边缘的返回手势；
    /// iOS 在白板页一直关着边缘手势（[PageKind.capturesEdgeSwipes]），收下不用。
    case drawing(active: Bool)
    /// 幻灯片的放映：start（App 横屏、全屏、屏幕常亮）、slide（换了页，index 从 0 开始）、end（恢复）。
    /// 只有 bootstrap 里声明了 `canPresent()` 的 App 才会收到。
    case presentation(state: String, index: Int, count: Int)
    /// 编辑器导出的文件（白板的 PNG / SVG / PDF，幻灯片的 PDF / PNG / PPTX）分块送来（src/lib/export-file.ts）：
    /// fileStart（[size] 是总字节数）→ fileChunk（[data] 是一块的 base64，[index] 从 0 起按顺序）× n → fileEnd；中途放弃是 fileAbort。
    /// 只有 bootstrap 里声明了 `canSaveFile()` 的 App 才会收到；NotesViewModel 用 [ExportFileAssembler] 拼成临时文件。
    case fileStart(id: String, name: String, mime: String, size: Int)
    case fileChunk(id: String, index: Int, data: String)
    case fileEnd(id: String)
    case fileAbort(id: String)

    /// 不认识或格式不对的消息返回 nil（网页先加了新消息类型也不会让 App 出错）。
    static func parse(_ json: String) -> EmbedMessage? {
        guard let fields = JSONValue.parse(json)?.objectValue else { return nil }
        do {
            switch try text(fields["type"]) {
            case "ready":
                guard let page = fields["page"]?.objectValue, let id = try text(page["id"]) else { return nil }
                // 只认字符串（和 Android 一样）；不认识的值按笔记。
                let kind = page["kind"]?.stringValue.map { PageKind.of($0) }
                return .ready(id: id, title: try text(page["title"]) ?? "", icon: try text(page["icon"]), kind: kind)
            case "meta":
                return .meta(title: try text(fields["title"]) ?? "", icon: try text(fields["icon"]))
            case "saveState":
                guard let state = try text(fields["state"]) else { return nil }
                return .saveState(state: state)
            case "missing":
                let id = try text(fields["id"]).flatMap { $0.isEmpty ? nil : $0 }
                return .missing(id: id)
            case "trashed":
                return .trashed
            case "openPage":
                guard let id = try text(fields["id"]), !id.isEmpty else { return nil }
                return .openPage(id: id)
            case "storageLimit":
                guard let tier = try text(fields["tier"]), let used = fields["used"]?.intValue, let limit = fields["limit"]?.intValue else { return nil }
                return .storageLimit(tier: tier, used: used, limit: limit)
            case "usageLimit":
                guard let tier = fields["tier"]?.stringValue, ["guest", "member", "pro"].contains(tier),
                      let kind = fields["kind"]?.stringValue, ["chat", "image"].contains(kind) else { return nil }
                let pageId = fields["pageId"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
                return .usageLimit(tier: tier, kind: kind, pageId: pageId?.isEmpty == false ? pageId : nil)
            case "presentation":
                guard let state = try text(fields["state"]), ["start", "slide", "end"].contains(state) else { return nil }
                return .presentation(state: state, index: fields["index"]?.intValue ?? 0, count: fields["count"]?.intValue ?? 0)
            case "flushed":
                return .flushed(
                    requestId: try text(fields["requestId"]) ?? "",
                    ok: try flag(fields["ok"]),
                    kept: try flag(fields["kept"])
                )
            case "drawing":
                guard let active = fields["active"]?.boolValue else { return nil }
                return .drawing(active: active)
            case "fileStart":
                // 大小要是不小于 0 的整数；类型、文件名的检查在 ExportFileAssembler（不合格时提示保存失败，不是悄悄丢掉）。
                guard let id = try fileId(fields), let name = try text(fields["name"]), let mime = try text(fields["mime"]),
                      let size = fields["size"]?.intValue, size >= 0 else { return nil }
                return .fileStart(id: id, name: name, mime: mime, size: size)
            case "fileChunk":
                guard let id = try fileId(fields), let index = fields["index"]?.intValue, index >= 0,
                      let data = fields["data"]?.stringValue else { return nil }
                return .fileChunk(id: id, index: index, data: data)
            case "fileEnd":
                return try fileId(fields).map { EmbedMessage.fileEnd(id: $0) }
            case "fileAbort":
                return try fileId(fields).map { EmbedMessage.fileAbort(id: $0) }
            default:
                return nil
            }
        } catch {
            return nil
        }
    }

    private struct Malformed: Error {}

    /// 导出文件的 id（fileStart … fileEnd 用它配对）：没有或是空的算格式不对。
    private static func fileId(_ fields: [String: JSONValue]) throws -> String? {
        guard let id = try text(fields["id"]), !id.isEmpty else { return nil }
        return id
    }

    // Kotlin 的 jsonPrimitive.contentOrNull：字符串原样，数字和布尔取字面，null / 没有是 nil，对象和数组算格式不对。
    private static func text(_ value: JSONValue?) throws -> String? {
        switch value {
        case nil, .null?: return nil
        case .string(let text)?: return text
        case .bool(let flag)?: return flag ? "true" : "false"
        case .number(let number)?: return JSONValue.number(number).encodedString()
        case .array?, .object?: throw Malformed()
        }
    }

    // Kotlin 的 jsonPrimitive.booleanOrNull == true。
    private static func flag(_ value: JSONValue?) throws -> Bool {
        switch value {
        case .bool(let flag)?: return flag
        case .string(let text)?: return text == "true"
        case .array?, .object?: throw Malformed()
        default: return false
        }
    }
}
