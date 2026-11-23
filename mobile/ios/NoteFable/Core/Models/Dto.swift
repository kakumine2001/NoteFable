import Foundation

// 服务端 JSON 的形状。字段与 src/app/api 保持一致；未知字段一律忽略，网页端加字段不会让 App 崩溃。
//
// 解析规则照 Android 的 NoteFableJson（ignoreUnknownKeys、coerceInputValues、explicitNulls = false）：
// 有默认值的字段缺了或是 null 就用默认值，可空字段缺了或是 null 就是 nil，没有默认值的字段缺了算解析失败。
// 所以每个类型的 init(from:) 都手写（放在 extension 里，逐成员初始化方法还在）；写出去用编译器生成的 encode。

enum NoteFableJson {
    static func decode<T: Decodable>(_ type: T.Type = T.self, from data: Data) throws -> T {
        try JSONDecoder().decode(T.self, from: data)
    }

    static func decodeFromString<T: Decodable>(_ type: T.Type = T.self, _ text: String) throws -> T {
        try decode(T.self, from: Data(text.utf8))
    }

    /// 把已经读成 [JSONValue] 的一部分解析成具体类型。
    static func decodeFromJsonElement<T: Decodable>(_ type: T.Type = T.self, _ element: JSONValue) throws -> T {
        try decode(T.self, from: Data(element.encodedString().utf8))
    }

    static func parseToJsonElement(_ text: String) -> JSONValue? {
        JSONValue.parse(text)
    }

    /// 写成 JSON 文本（nil 的字段不写；键按字典序）。
    static func encodeToString<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// 按名字读字段的小包装，给各个 DTO 的 init(from:) 用。
struct DtoFields {
    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ name: String) { stringValue = name }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    private let container: KeyedDecodingContainer<Key>

    init(_ decoder: Decoder) throws {
        container = try decoder.container(keyedBy: Key.self)
    }

    /// 必须有的字段（Kotlin 里没有默认值的属性）。
    func req<T: Decodable>(_ name: String, _ type: T.Type = T.self) throws -> T {
        try container.decode(T.self, forKey: Key(name))
    }

    /// 可空字段：缺了或是 null 都是 nil。
    func opt<T: Decodable>(_ name: String, _ type: T.Type = T.self) throws -> T? {
        try container.decodeIfPresent(T.self, forKey: Key(name))
    }

    /// 有默认值的字段：缺了或是 null 用 [fallback]。
    func or<T: Decodable>(_ name: String, _ fallback: @autoclosure () -> T) throws -> T {
        try container.decodeIfPresent(T.self, forKey: Key(name)) ?? fallback()
    }

    /// JSON 里有没有这个键（值是 null 也算有）。
    func has(_ name: String) -> Bool {
        container.contains(Key(name))
    }
}

struct SessionSummary: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var icon: String? = nil
    var pinned: Bool = false
    var position: Int = 0
    var projectId: String? = nil
    var updatedAt: String = ""
}

extension SessionSummary: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.req("title"), icon: try f.opt("icon"), pinned: try f.or("pinned", false),
            position: try f.or("position", 0), projectId: try f.opt("projectId"), updatedAt: try f.or("updatedAt", "")
        )
    }
}

struct SessionsResponse: Encodable, Equatable, Sendable {
    var sessions: [SessionSummary] = []
}

extension SessionsResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(sessions: try DtoFields(decoder).or("sessions", []))
    }
}

struct AttachmentDto: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var filename: String = ""
    var mimeType: String = ""
    var size: Int = 0
    var dataUrl: String? = nil
}

extension AttachmentDto: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), filename: try f.or("filename", ""), mimeType: try f.or("mimeType", ""),
            size: try f.or("size", 0), dataUrl: try f.opt("dataUrl")
        )
    }
}

struct GeneratedImageDto: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var dataUrl: String
    var mimeType: String = "image/png"
}

extension GeneratedImageDto: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(id: try f.req("id"), dataUrl: try f.req("dataUrl"), mimeType: try f.or("mimeType", "image/png"))
    }
}

/// 同一位置的其它版本（编辑过的提问、重新生成的回答）里，这条是第几个，以及前后版本的消息 ID（网页 MessageVersions）。
struct MessageVersions: Encodable, Equatable, Sendable {
    var index: Int
    var total: Int
    var prevId: String? = nil
    var nextId: String? = nil
}

extension MessageVersions: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(index: try f.req("index"), total: try f.req("total"), prevId: try f.opt("prevId"), nextId: try f.opt("nextId"))
    }
}

struct MessageDto: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var role: String
    var content: String = ""
    var model: String? = nil
    var reasoningEffort: String? = nil
    var thinkingMs: Int? = nil
    var createdAt: String = ""
    var attachments: [AttachmentDto] = []
    var generatedImages: [GeneratedImageDto] = []
    // activity / proposals 保留原始 JSON，由 Activity 的 parseStored / parseStoredProposals 逐项校验后再用（坏的丢掉）。
    var activity: JSONValue? = nil
    var proposals: JSONValue? = nil
    /// 用户给这条提问添加的笔记（网页 Message.pages）。标题和图标每次读历史都从笔记取；回收站里的不返回。
    var pages: [ChatProjectNote] = []
    /// 有别的版本时才有；只有一个版本时为空。
    var versions: MessageVersions? = nil
}

extension MessageDto: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), role: try f.req("role"), content: try f.or("content", ""), model: try f.opt("model"),
            reasoningEffort: try f.opt("reasoningEffort"), thinkingMs: try f.opt("thinkingMs"),
            createdAt: try f.or("createdAt", ""), attachments: try f.or("attachments", []),
            generatedImages: try f.or("generatedImages", []), activity: try f.opt("activity"),
            proposals: try f.opt("proposals"), pages: try f.or("pages", []), versions: try f.opt("versions")
        )
    }
}

struct MessagesResponse: Encodable, Equatable, Sendable {
    var messages: [MessageDto] = []
}

extension MessagesResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(messages: try DtoFields(decoder).or("messages", []))
    }
}

struct ModelInfo: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var label: String
    var provider: String = ""
    var supportsImageInput: Bool = false
    var supportsWebSearch: Bool = false
    var reasoningEfforts: [String] = []
    var defaultReasoning: String = "medium"
}

extension ModelInfo: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), label: try f.req("label"), provider: try f.or("provider", ""),
            supportsImageInput: try f.or("supportsImageInput", false), supportsWebSearch: try f.or("supportsWebSearch", false),
            reasoningEfforts: try f.or("reasoningEfforts", []), defaultReasoning: try f.or("defaultReasoning", "medium")
        )
    }
}

struct ModelsResponse: Encodable, Equatable, Sendable {
    var defaultModel: String
    var models: [ModelInfo] = []
}

extension ModelsResponse: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(defaultModel: try f.req("defaultModel"), models: try f.or("models", []))
    }
}

// 错误响应。429 的使用上限还带 code / tier / kind（src/lib/usage-limits.ts）。
struct ApiError: Encodable, Equatable, Sendable {
    var error: String? = nil
    var code: String? = nil
    var tier: String? = nil
    var kind: String? = nil
}

extension ApiError: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(error: try f.opt("error"), code: try f.opt("code"), tier: try f.opt("tier"), kind: try f.opt("kind"))
    }
}

// POST /api/uploads：每个文件一张上传凭证（ticket）和存放路径；mode 是 "blob"（线上）或 "local"（本机开发）。
struct UploadSlot: Encodable, Equatable, Sendable {
    var path: String
    var ticket: String
}

extension UploadSlot: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(path: try f.req("path"), ticket: try f.req("ticket"))
    }
}

struct UploadPlan: Encodable, Equatable, Sendable {
    var uploads: [UploadSlot] = []
    var mode: String = "blob"
}

extension UploadPlan: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(uploads: try f.or("uploads", []), mode: try f.or("mode", "blob"))
    }
}

struct ClientTokenResponse: Encodable, Equatable, Sendable {
    var clientToken: String
}

extension ClientTokenResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(clientToken: try DtoFields(decoder).req("clientToken"))
    }
}

// POST /api/images 的结果：只在图片完成后返回一次。
struct GeneratedImagePayload: Encodable, Equatable, Sendable {
    var dataUrl: String = ""
    var mimeType: String = "image/png"
}

extension GeneratedImagePayload: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(dataUrl: try f.or("dataUrl", ""), mimeType: try f.or("mimeType", "image/png"))
    }
}

struct ImageResult: Encodable, Equatable, Sendable {
    var sessionId: String? = nil
    var image: GeneratedImagePayload? = nil
    var error: String? = nil
}

extension ImageResult: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(sessionId: try f.opt("sessionId"), image: try f.opt("image"), error: try f.opt("error"))
    }
}

/// [AccountUser.locale] 不知道（服务端没返回这个字段）。
let LOCALE_UNKNOWN = "?"

// GET /api/account（src/app/api/account/route.ts）。configured=false 表示服务端没开 Google 登录，不显示登录入口。
struct AccountUser: Encodable, Equatable, Sendable {
    var name: String? = nil
    var googleName: String? = nil
    var email: String? = nil
    var image: String? = nil
    var displayName: String? = nil
    var icon: String? = nil
    var avatarUrl: String? = nil
    /// 设置里选的界面语言（en / zh / zh-Hant / ja…）。JSON 里是 null＝自动检测（按环境语言显示）；
    /// 没有这个字段＝服务端没读到用户行、不知道（[LOCALE_UNKNOWN]），这时不用本机的选择覆盖账号（网页 AccountUser.locale）。
    var locale: String? = LOCALE_UNKNOWN
}

extension AccountUser: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            name: try f.opt("name"), googleName: try f.opt("googleName"), email: try f.opt("email"), image: try f.opt("image"),
            displayName: try f.opt("displayName"), icon: try f.opt("icon"), avatarUrl: try f.opt("avatarUrl"),
            locale: f.has("locale") ? try f.opt("locale") : LOCALE_UNKNOWN
        )
    }
}

struct AccountResponse: Encodable, Equatable, Sendable {
    var configured: Bool = false
    var user: AccountUser? = nil
    var googleClientId: String? = nil
    /// 服务端开了哪些登录方式（登录窗口只列这些）。旧服务端不返回：按网页的规则，Google 缺省算开、邮箱缺省算关。
    var google: Bool? = nil
    var email: Bool? = nil
}

extension AccountResponse: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            configured: try f.or("configured", false), user: try f.opt("user"), googleClientId: try f.opt("googleClientId"),
            google: try f.opt("google"), email: try f.opt("email")
        )
    }
}

struct ProfileResponse: Encodable, Equatable, Sendable {
    var user: AccountUser? = nil
}

extension ProfileResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(user: try DtoFields(decoder).opt("user"))
    }
}

struct NonceResponse: Encodable, Equatable, Sendable {
    var nonce: String
}

extension NonceResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(nonce: try DtoFields(decoder).req("nonce"))
    }
}

struct CsrfResponse: Encodable, Equatable, Sendable {
    var csrfToken: String
}

extension CsrfResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(csrfToken: try DtoFields(decoder).req("csrfToken"))
    }
}

// ---- 聊天项目（侧栏的 Projects，src/app/api/chat-projects；类型见 src/types/chat.ts） ----

/// 侧栏列表、新建和保存的返回值。noteCount 只数没进回收站的参考笔记。
struct ChatProjectSummary: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var noteCount: Int = 0
    var hasInstructions: Bool = false
}

extension ChatProjectSummary: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), name: try f.req("name"), noteCount: try f.or("noteCount", 0),
            hasInstructions: try f.or("hasInstructions", false)
        )
    }
}

struct ChatProjectsResponse: Encodable, Equatable, Sendable {
    var projects: [ChatProjectSummary] = []
}

extension ChatProjectsResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(projects: try DtoFields(decoder).or("projects", []))
    }
}

struct ChatProjectResponse: Encodable, Equatable, Sendable {
    var project: ChatProjectSummary
}

extension ChatProjectResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(project: try DtoFields(decoder).req("project"))
    }
}

/// 设置窗口用的详情：notes 按选的顺序，不含回收站里的笔记。发言添加的笔记（[MessageDto.pages]）和输入栏上方待发送的也用它。
/// [kind] 是页面类型（旧服务端不返回，按笔记）。
struct ChatProjectNote: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var kind: PageKind = .note
}

extension ChatProjectNote: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"), kind: try f.or("kind", .note))
    }
}

extension ChatProjectNote {
    /// 笔记列表里的一篇（添加到消息、选作项目的参考笔记时）：ID、标题、图标和类型。
    init(page: NotePageSummary) {
        self.init(id: page.id, title: page.title, icon: page.icon, kind: page.kind)
    }
}

struct ChatProjectDetail: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var instructions: String? = nil
    var notes: [ChatProjectNote] = []
}

extension ChatProjectDetail: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), name: try f.req("name"), instructions: try f.opt("instructions"), notes: try f.or("notes", [])
        )
    }
}

struct ChatProjectDetailResponse: Encodable, Equatable, Sendable {
    var project: ChatProjectDetail
}

extension ChatProjectDetailResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(project: try DtoFields(decoder).req("project"))
    }
}

/// 与 src/types/chat.ts 相同的上限。
let MAX_PROJECT_INSTRUCTIONS = 4000
let MAX_PROJECT_NOTES = 5

/// 一条消息最多能添加的笔记数（网页 MAX_MESSAGE_NOTES，服务端同一个值）。
let MAX_MESSAGE_NOTES = 5

/// 用户的自定义指令（适用于所有聊天）的上限，与网页 MAX_CUSTOM_INSTRUCTIONS 相同。
let MAX_CUSTOM_INSTRUCTIONS = MAX_PROJECT_INSTRUCTIONS

/// `GET /api/billing` 里一种用量（chat / image）：本期用了多少、上限、按天还是按月（day / month）、何时重新计算。
/// daily：除了月上限还有每日上限的种类（图片）今天的用量。
struct PlanUsage: Encodable, Equatable, Sendable {
    var used: Int = 0
    var limit: Int = 0
    var period: String = "day"
    var resetsAt: String? = nil
    var daily: PlanDailyUsage? = nil
}

extension PlanUsage: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            used: try f.or("used", 0), limit: try f.or("limit", 0), period: try f.or("period", "day"),
            resetsAt: try f.opt("resetsAt"), daily: try f.opt("daily")
        )
    }
}

struct PlanDailyUsage: Encodable, Equatable, Sendable {
    var used: Int = 0
    var limit: Int = 0
    var resetsAt: String? = nil
}

extension PlanDailyUsage: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(used: try f.or("used", 0), limit: try f.or("limit", 0), resetsAt: try f.opt("resetsAt"))
    }
}

/// `GET /api/billing` 的订阅状态（网页 src/lib/billing-client.ts 的 PlanInfo.subscription）。
struct PlanSubscription: Encodable, Equatable, Sendable {
    var status: String = ""
    var periodEnd: String? = nil
    var cancelAt: String? = nil
}

extension PlanSubscription: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(status: try f.or("status", ""), periodEnd: try f.opt("periodEnd"), cancelAt: try f.opt("cancelAt"))
    }
}

/// `GET /api/billing`：当前方案（free / pro）、订阅和本期用量。
/// googlePlay / productId / accountId 是 Android 的 Play 购买用的，这边只读不用；
/// provider：现在的订阅在哪里买的（stripe = 网页、google = Play）；manageUrl：Play 订阅的管理页（Play 买的才有）。
/// priceJpy：Pro 的月额（日元，显示用）；trialDays：这个用户还能用的免费试用天数（第一次订阅才有，否则 0）。
struct PlanInfo: Encodable, Equatable, Sendable {
    var plan: String = "free"
    var subscription: PlanSubscription? = nil
    var usage: [String: PlanUsage] = [:]
    var googlePlay: Bool = false
    var productId: String? = nil
    var accountId: String? = nil
    var provider: String? = nil
    var manageUrl: String? = nil
    var priceJpy: Int = 0
    var trialDays: Int = 0
}

extension PlanInfo: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            plan: try f.or("plan", "free"), subscription: try f.opt("subscription"), usage: try f.or("usage", [:]),
            googlePlay: try f.or("googlePlay", false), productId: try f.opt("productId"), accountId: try f.opt("accountId"),
            provider: try f.opt("provider"), manageUrl: try f.opt("manageUrl"), priceJpy: try f.or("priceJpy", 0),
            trialDays: try f.or("trialDays", 0)
        )
    }
}

/// `GET / PUT /api/custom-instructions` 的回复；nil 表示没有设置。
struct CustomInstructionsResponse: Encodable, Equatable, Sendable {
    var instructions: String? = nil
}

extension CustomInstructionsResponse: Decodable {
    init(from decoder: Decoder) throws {
        self.init(instructions: try DtoFields(decoder).opt("instructions"))
    }
}

/// `GET / PUT /api/app-icon` 的回复（设置里的"图标"，见 AppIconSync.swift）。updatedAt 为 nil 表示账号上还没保存过；
/// account 是这个账号的不透明的键（本机记住图标属于哪个账号）。
struct AppIconResponse: Encodable, Equatable, Sendable {
    var icon: String? = nil
    var updatedAt: String? = nil
    var account: String? = nil
}

extension AppIconResponse: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(icon: try f.opt("icon"), updatedAt: try f.opt("updatedAt"), account: try f.opt("account"))
    }
}
