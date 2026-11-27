import Foundation

// 聊天界面的状态（Android `ui/ChatViewModel.kt` 的前半：UiMessage、ChatUiState 和几个小类型）。

enum MessageRole: Equatable, Sendable {
    case user, assistant, system
}

struct UiMessage: Equatable, Sendable {
    var id: String
    var role: MessageRole
    var content: String
    var attachments: [AttachmentDto]
    var images: [GeneratedImageDto]
    /// 提问时添加的笔记（网页 Message.pages），点一下打开那篇笔记。
    var pages: [ChatProjectNote]
    var streaming: Bool
    /// 生成这条回答的模型 ID，用来在回答上方显示"NoteFable · 模型名"。
    var modelId: String?
    /// 请求失败时的原因（服务端或网络给出的文字），界面再套本地化外壳。
    var errorDetail: String?
    var thinkingMs: Int?
    /// 正在生成图片：显示占位卡片而不是转圈。
    var generatingImage: Bool
    /// 图片生成回合（失败后 generatingImage 变回 false、images 为空时仍保留，避免误显示文字聊天模型名或允许按文字改写）。
    var imageTurn: Bool
    /// 服务端在正文末尾追加的"Request failed: …"的位置（activity 里的 failure），界面据此换成译文。
    var failure: FailureInfo?
    /// 当日使用次数已用完（429 usage_limit）。和网页一样：正文换成服务端的英文原句，界面只翻译、
    /// 当普通回答显示，不套"请求失败："也不标红（chat-message.tsx 的 usageLimit 分支）。
    var usageLimit: Bool
    /// 推理、搜索、笔记工具、项目上下文与提案（Chat/Activity.swift）。流里实时合并，历史里从 activity 读出。
    var activity: [ActivityStep]
    /// 服务端保存的提案（历史的 proposals 字段）；流里新出的提案在 `activity` 里。
    var proposals: [Proposal]
    /// 开始等待回答的时刻（毫秒时间戳），进度条的"已等 N 秒"用。
    var startedAt: Int?
    /// 列表项的标识（SwiftUI 的 `ForEach(id: \.key)`）。默认等于 `id`；发送后对账把 `local-N` 换成服务端 ID 时沿用原来的 key，
    /// 这一回合的界面状态（回答"…"菜单的保存、下载、保存位置选择）就不会因为换 ID 被丢掉（网页的临时 ID 留到切换对话为止）。
    var key: String
    /// 这条消息还有别的版本（编辑过的提问、重新生成的回答）时的位置和前后版本；只有一个版本时为空。
    var versions: MessageVersions?

    init(
        _ id: String,
        _ role: MessageRole,
        _ content: String,
        attachments: [AttachmentDto] = [],
        images: [GeneratedImageDto] = [],
        pages: [ChatProjectNote] = [],
        streaming: Bool = false,
        modelId: String? = nil,
        errorDetail: String? = nil,
        thinkingMs: Int? = nil,
        generatingImage: Bool = false,
        imageTurn: Bool? = nil,
        failure: FailureInfo? = nil,
        usageLimit: Bool = false,
        activity: [ActivityStep] = [],
        proposals: [Proposal] = [],
        startedAt: Int? = nil,
        key: String? = nil,
        versions: MessageVersions? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.attachments = attachments
        self.images = images
        self.pages = pages
        self.streaming = streaming
        self.modelId = modelId
        self.errorDetail = errorDetail
        self.thinkingMs = thinkingMs
        self.generatingImage = generatingImage
        self.imageTurn = imageTurn ?? (generatingImage || !images.isEmpty)
        self.failure = failure
        self.usageLimit = usageLimit
        self.activity = activity
        self.proposals = proposals
        self.startedAt = startedAt
        self.key = key ?? id
        self.versions = versions
    }

    /// 图片生成回合（生成中、已完成或生成失败）：回答顶部不标文字聊天模型名，提问不开放按文字改写。
    var isImageAnswer: Bool { imageTurn || generatingImage || !images.isEmpty }
}

/// 发送前上传附件的进度（网页输入栏下方的那一行）。Android 端叫 UploadProgress；这边 NoteFableApi.swift 里已有同名的私有类型。
enum ChatUploadProgress: Equatable, Sendable {
    case preparing
    case uploading(index: Int, total: Int, name: String, percent: Int)
}

/// 输入栏上方的提示。
enum ComposerNotice: Equatable, Sendable {
    /// 新选的文件整批没有加进去。
    case rejected(AttachError)
    case uploadFailed
    /// 打开已有缓存的聊天时读历史失败（网页 "Failed to load conversation."）：缓存照常显示。
    case loadFailed
    /// 聊天图标没保存成功（网页 "Failed to change the chat icon."，显示在输入栏上方）。
    case iconFailed
    /// 链接（?chat=）里的 ID 不对：网页在输入栏上方显示 "Failed to load conversation."。
    case linkFailed
    /// 生成图片时不能带笔记（网页 sendMessage 的同名检查）：不悄悄丢掉，让用户自己移除。
    case pagesInImageMode
    /// 放回被拒的提问后笔记超过上限（网页同样不悄悄删减）。
    case tooManyPages
    /// 编辑、重新生成、切换版本或分支没成功（网页 setSendError(detail)）：`detail` 是服务端或字典里的英文原句，界面翻译。
    case failed(detail: String)
}

/// 打开聊天后要滚到并闪一下的消息（检索结果、?chat=&message= 链接）。`token` 区分同一条消息的多次请求。
struct MessageReveal: Equatable, Sendable {
    let sessionId: String
    let messageId: String
    let token: Int
}

/// 被拒绝的改写：哪条提问、写了什么。
struct RejectedEdit: Equatable, Sendable {
    let messageId: String
    let text: String
}

struct ChatUiState: Equatable, Sendable {
    var sessions: [SessionSummary] = []
    var sessionsLoading = true
    var sessionsFailed = false
    /// 空表示还没读到（或服务端没有 /api/models）；这时请求不带模型，由服务端用默认值。
    var models: [ModelInfo] = []
    var defaultModelId: String? = nil
    var chosenModelId: String? = nil
    var chosenReasoning: String? = nil
    var activeSessionId: String? = nil
    var messages: [UiMessage] = []
    var messagesLoading = false
    var messagesFailed = false
    /// 当前看着的聊天正在发送（上传附件或等待 / 接收回答）；别的聊天在后台生成时不影响这里。
    var sending = false
    /// 已经按了停止，正在等服务端把已生成的部分存好、结束回答：停止键这时不能再点（网页的 stopping）。
    var stopping = false
    /// 发出去但被拒绝的改写（上限、断网等）：那条提问的编辑框带着这段文字重新打开，写的字不丢（网页 rejectedEdit）。
    var rejectedEdit: RejectedEdit? = nil
    /// 选好、还没发送的附件。
    var files: [LocalFile] = []
    /// 下一条消息要添加的笔记（ID、标题、图标）。正文由服务端每次发送时重新读取（网页 attachedPages）。
    var attachedPages: [ChatProjectNote] = []
    /// 从回答里选中、点「问 NoteFable」引用的文字。发送时作为引用块放在正文前面（ChatQuote，网页 quote）。
    var quote: String? = nil
    /// 「生成图片」模式：下一条消息交给图片接口。
    var imageMode = false
    var upload: ChatUploadProgress? = nil
    var notice: ComposerNotice? = nil
    /// 每成功发出一条消息加一；输入栏据此清空草稿（上传失败时不清，文字还在）。
    var sentCount = 0
    /// 当前（还没保存的）新聊天里先选的图标（网页 draftIcon）：会话建好后再保存到它上面。
    var draftIcon: String? = nil
    /// 等消息读完后要定位的消息。
    var reveal: MessageReveal? = nil
    /// 未登录用户撞到当日上限（429 usage_limit、tier = guest）时是 "chat" 或 "image"：
    /// 输入栏上方显示登录提示（网页 GuestLimitPrompt）。关掉、登录或退出后清空。
    var guestLimit: String? = nil
    /// 免费用户撞到上限（tier = member）时是 "chat" 或 "image"：输入栏上方显示 Pro 的升级提示（网页 UpgradePrompt）。
    var upgradeLimit: String? = nil
    /// 文件存储空间不够、附件或图片生成被拒绝（413 storage_limit）：输入栏上方说明原因和用量，
    /// 未登录时给登录入口（网页 StorageLimitPrompt）。关掉、登录或退出后清空。
    var storageLimit: StorageLimitInfo? = nil
    /// 还在拷贝、校验的附件（粘贴的图片、刚选的文件）有几批；没处理完前不能发送，否则它们会漏掉、跑到下一条里。
    var importing = 0
    /// 正在发送（上传附件或生成回答）的聊天的会话 ID，包括后台的（切换聊天不会停掉它们）。`sending` 只说当前聊天。
    /// 还没拿到会话 ID 的新聊天不在里面。侧栏据此不让删生成中的聊天。
    var generatingSessionIds: Set<String> = []
    /// 当前聊天的角色完成 / 出错短暂状态反馈（网页 characterOutcome）。
    var characterOutcome: CharacterOutcome? = nil
    /// 消息列表的视图身份：iOS 27 起界面层按它换新的列表（`ChatListRepair`），更早的系统不用。
    /// 每换一次对话（`ChatViewModel.show`）换一个值；新聊天拿到会话 ID、再点开着的聊天不算换。
    var conversationId = 0

    private var hasActiveTurnOutput: Bool {
        guard let last = messages.last, last.role == .assistant else { return false }
        return !last.content.isEmpty || !last.images.isEmpty || !last.proposals.isEmpty || last.activity.contains { step in
            if case .proposal = step { return true }
            return false
        }
    }

    func heroCharacterState(isTyping: Bool = false, hidden: Bool = false) -> CharacterState {
        deriveTurnCharacterState(
            isBusy: sending || upload != nil,
            isStopping: stopping,
            hasOutput: hasActiveTurnOutput,
            outcome: characterOutcome,
            isTyping: isTyping,
            hidden: hidden
        )
    }

    func activeReplyCharacterState(hidden: Bool = false) -> CharacterState {
        deriveTurnCharacterState(
            isBusy: sending && upload == nil,
            isStopping: stopping,
            hasOutput: hasActiveTurnOutput,
            outcome: characterOutcome,
            hidden: hidden
        )
    }

    /// 图片交给图片接口时不受聊天模型限制。
    var supportsImages: Bool { imageMode || selectedModel?.supportsImageInput != false }

    /// 当前这组附件不能发送的原因（例如换成了不能读图的模型）。
    var filesError: AttachError? { attachmentError(files, supportsImages: supportsImages) }

    var selectedModel: ModelInfo? {
        models.first { $0.id == chosenModelId } ?? models.first { $0.id == defaultModelId } ?? models.first
    }

    var selectedReasoning: String? {
        guard let model = selectedModel else { return nil }
        if let chosen = chosenReasoning, model.reasoningEfforts.contains(chosen) { return chosen }
        return model.defaultReasoning
    }

    var activeTitle: String? { sessions.first { $0.id == activeSessionId }?.title }

    /// 当前聊天的图标；还没保存的新聊天是草稿图标。
    var activeIcon: String? {
        activeSessionId == nil ? draftIcon : sessions.first { $0.id == activeSessionId }?.icon
    }
}

/// 模型和推理强度的选择要在重开 App 后保留。
protocol SettingsStore: AnyObject {
    var modelId: String? { get set }
    var reasoning: String? { get set }
}

/// 存在 UserDefaults 里（Android 的 PrefsSettingsStore 用 SharedPreferences "settings"）。
final class PrefsSettingsStore: SettingsStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var modelId: String? {
        get { defaults.string(forKey: "settings.modelId") }
        set { defaults.set(newValue, forKey: "settings.modelId") }
    }

    var reasoning: String? {
        get { defaults.string(forKey: "settings.reasoning") }
        set { defaults.set(newValue, forKey: "settings.reasoning") }
    }
}

/// 草稿和引用的存放处（Android 的 SavedStateHandle）：App 在后台被系统杀掉后回来仍在。
/// App 层换成能跨进程保留的实现（例如 SceneStorage / UserDefaults），默认只在内存里。
protocol ChatSavedState: AnyObject {
    var draft: String? { get set }
    var quote: String? { get set }
}

final class MemoryChatSavedState: ChatSavedState {
    var draft: String?
    var quote: String?

    init(draft: String? = nil, quote: String? = nil) {
        self.draft = draft
        self.quote = quote
    }
}

/// 文件存储空间不够、新的上传被拒绝（413 storage_limit）时的档位和用量（字节）。
struct StorageLimitInfo: Equatable, Sendable {
    var tier: String
    var used: Int
    var limit: Int
}
