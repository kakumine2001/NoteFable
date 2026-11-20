import Foundation

// 笔记列表、项目（分组）、回收站的服务端 JSON，字段与 src/types/notes.ts 和 src/app/api/pages 一致。
// 笔记正文不在这里：编辑器是网页的 /note-embed，App 只管列表和导航。

struct NotePageSummary: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
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
}

extension NotePageSummary: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"), version: try f.or("version", 0),
            groupId: try f.opt("groupId"), position: try f.or("position", 0), createdAt: try f.or("createdAt", ""),
            updatedAt: try f.or("updatedAt", ""), parentId: try f.opt("parentId"), favoritedAt: try f.opt("favoritedAt"),
            fullWidth: try f.or("fullWidth", false), smallText: try f.or("smallText", false),
            font: try f.or("font", "default"), locked: try f.or("locked", false)
        )
    }
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
}

extension NotesList: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(pages: try f.or("pages", []), groups: try f.or("groups", []))
    }
}

/// deletedAt 是移进回收站的时刻，purgeAt 是不能再恢复、会被永久删除的时刻（ISO 字符串）。
struct NoteTrashItem: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var deletedAt: String
    var purgeAt: String
}

extension NoteTrashItem: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"),
            deletedAt: try f.req("deletedAt"), purgeAt: try f.req("purgeAt")
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

    /// 和网页的"New note"一样，建一篇空白的 Untitled 笔记。[parentId] 指定时建在那一篇里面（子页面）。
    func createNote(parentId: String?) async throws -> NotePageSummary

    /// 移到回收站（服务端只记 deletedAt，30 天内可恢复），子页面一起移进去。返回所有被移进去的 id（含这一篇）。
    func trashNote(id: String) async throws -> [String]

    /// 移进项目（nil 是移出），同时脱离父页面；返回一起移动的 id（含子页面）。
    func moveNote(id: String, groupId: String?) async throws -> [String]

    /// 移到另一页面之下（nil 回到最上层）；返回被移动的页面（含子页面）的新状态。
    func moveToPage(id: String, parentId: String?) async throws -> [NotePageSummary]

    func setFavorite(id: String, favorite: Bool) async throws -> NotePageSummary
    func updateSettings(id: String, settings: NotePageSettings) async throws -> NotePageSummary

    /// 复制这一篇和子页面（网页"Duplicate"）。
    func duplicate(id: String) async throws -> DuplicateResult

    /// 拖动排序：把 [id] 放到 [targetId] 的前 / 后（网页 ReorderRequest）。目标在别的项目里时也一起移过去。
    func reorderNote(id: String, targetId: String, after: Bool) async throws -> [NoteOrderUpdate]
    func createGroup(name: String) async throws -> NoteGroupSummary
    func renameGroup(id: String, name: String) async throws -> NoteGroupSummary
    func deleteGroup(id: String) async throws

    func trash() async throws -> [NoteTrashItem]
    /// 复原；一起移进回收站的子页面也回来。返回所有复原的页面（第一篇是这一篇）。
    func restoreNote(id: String) async throws -> [NotePageSummary]
    /// 永久删除；回收站里它的子页面也一起删。返回删掉的 id（另一时刻移进去、单独列着的子页面也在里面）。
    func deleteForever(id: String) async throws -> [String]

    /// 清空回收站；[before] 是确认时看到的最新一条的 deletedAt，确认后别处新扔的不会被删。
    func emptyTrash(before: String) async throws

    /// 网页"仅编辑器"页面的地址（`/note-embed?page=…&lang=…&model=…&reasoning=…`）。
    /// [model] / [reasoning] 是 App 里选的模型和推理强度，编辑器里的 AI 助手用它们（网页按服务端的模型列表核对）。
    func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?) -> String
}

extension NotesBackend {
    func createNote() async throws -> NotePageSummary {
        try await createNote(parentId: nil)
    }

    func noteEmbedUrl(pageId: String, lang: String?) -> String {
        noteEmbedUrl(pageId: pageId, lang: lang, model: nil, reasoning: nil)
    }
}

/// 回收站里保留的天数，与 src/types/notes.ts 的 TRASH_RETENTION_DAYS 相同。
let TRASH_RETENTION_DAYS = 30

/// 网页编辑器（/note-embed）发给 App 的消息。约定见 src/lib/native-bridge.ts 和 docs/architecture/android-native.md；两边要一起改。
///
/// 网页调的是 `window.NoteFableNative.postMessage(json)`（Android 的 @JavascriptInterface）。WKWebView 没有这种对象，
/// 界面层要在页面开始加载前注入一段脚本，把 `window.NoteFableNative` 定义成转发给
/// `window.webkit.messageHandlers.<名字>.postMessage(json)` 的对象（还有同步返回的 `appIcon()` / `language()`），
/// 收到的 JSON 文本交给 [parse]。
enum EmbedMessage: Equatable, Sendable {
    case ready(id: String, title: String, icon: String?)
    case meta(title: String, icon: String?)
    case saveState(state: String)
    case missing
    case trashed
    /// [kept]：没保存成功，但草稿已存在 WebView 里、之后会重试（不是冲突）。这时可以先离开。
    case flushed(requestId: String, ok: Bool, kept: Bool = false)

    /// 不认识或格式不对的消息返回 nil（网页先加了新消息类型也不会让 App 出错）。
    static func parse(_ json: String) -> EmbedMessage? {
        guard let fields = JSONValue.parse(json)?.objectValue else { return nil }
        do {
            switch try text(fields["type"]) {
            case "ready":
                guard let page = fields["page"]?.objectValue, let id = try text(page["id"]) else { return nil }
                return .ready(id: id, title: try text(page["title"]) ?? "", icon: try text(page["icon"]))
            case "meta":
                return .meta(title: try text(fields["title"]) ?? "", icon: try text(fields["icon"]))
            case "saveState":
                guard let state = try text(fields["state"]) else { return nil }
                return .saveState(state: state)
            case "missing":
                return .missing
            case "trashed":
                return .trashed
            case "flushed":
                return .flushed(
                    requestId: try text(fields["requestId"]) ?? "",
                    ok: try flag(fields["ok"]),
                    kept: try flag(fields["kept"])
                )
            default:
                return nil
            }
        } catch {
            return nil
        }
    }

    private struct Malformed: Error {}

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
