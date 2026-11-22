import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 整个 App 的依赖装配（Android 的 `NoteFableApp.kt` + `MainActivity.kt` / `NoteFableRoot.kt` 里各 ViewModel 的 Factory）。
/// App 启动时建一个，放进 SwiftUI 的 environment；界面只从这里拿接口、Store 和 ViewModel，不自己建。
///
/// 界面层要接上的几处（Core 不依赖 UIKit / GoogleSignIn）：[requestGoogleIdToken]、[clearGoogleSignIn]、
/// [emojiGlyphSupported]、[editorBridge]（用 [registerEditor]）。App 启动后调一次 [start]。
@MainActor
@Observable
final class AppEnvironment {
    // MARK: - 配置和资源

    let config: AppConfig
    /// 装着打包资源（`system-text.json`、`models.json`、`emoji.json`、`usage-limits.json`、各语言 lproj）的包。
    let resources: Bundle
    let defaults: UserDefaults

    // MARK: - 网络和接口

    /// 身份所在的 Cookie 存储（`<Application Support>/cookies.json`）。
    let cookieJar: PersistentCookieJar
    let transport: HTTPTransport
    let api: NoteFableApi
    let accountApi: AccountApi
    let sessionsApi: SessionsApi
    let projectsApi: ProjectsApi
    let noteIconApi: NoteIconApi
    let searchApi: SearchApi
    let exportApi: ExportApi
    let proposalApi: ProposalApi
    let reportApi: ReportApi

    // MARK: - 语言和文案

    let language: LanguageController
    /// 服务端英文系统文的译文（`system-text.json`）。读不到时是空词典：显示英文原句。
    let systemTextCatalog: SystemText
    /// 每日上限（`usage-limits.json`）；读不到是 nil。
    let usageLimits: UsageLimits?

    // MARK: - App 级的 Store

    /// 设置里选的图标（只存在这台设备上）。
    let appIcon: AppIconStore
    /// 设置里选的外观（跟随系统 / 浅色 / 深色，只存在这台设备上）。
    let appTheme: AppThemeStore
    /// AI 笔记提案的应用 / 放弃状态。
    let proposals: ProposalStore
    /// 回答的"存到笔记"、"整理成笔记"、下载对话。
    let answerExports: AnswerExportStore
    /// 最近使用的表情。
    let recentEmoji: RecentEmojiStore

    // MARK: - ViewModel

    let chat: ChatViewModel
    let account: AccountViewModel
    let notes: NotesViewModel
    let sidebar: SidebarViewModel

    // MARK: - 界面层接上的地方

    /// 让用户选 Google 账号并拿到 ID 令牌（GoogleSignIn SDK）。界面层在启动时赋值。
    /// 安装包没配 `GIDClientID` 时用不到：登录窗口只有邮箱验证码（[googleSignInConfigured] 是 false）。
    var requestGoogleIdToken: AccountViewModel.GoogleIdTokenRequest? {
        get { google.requestIdToken }
        set { google.requestIdToken = newValue }
    }

    /// 退出登录 / 删除账号时清掉 Google SDK 记住的账号（Android 的 clearGoogleCredentialState）。界面层赋值，没有就不做。
    var clearGoogleSignIn: (@MainActor () async -> Void)? {
        get { google.clearDeviceChoice }
        set { google.clearDeviceChoice = newValue }
    }

    /// 本机字体能不能画出这个表情（要用 CoreText，界面层赋值）；画不出来的不进表情面板。默认都算能画。
    @ObservationIgnored var emojiGlyphSupported: @Sendable (String) -> Bool = { _ in true }

    /// 只读检查 App Group 共享目录里有没有待取分享（不删文件）；在笔记工作区时据此决定是否切回聊天。
    @ObservationIgnored var hasPendingShare: @MainActor (_ id: String?) async -> Bool = { _ in false }

    /// 从 App Group 的共享目录取走系统「分享」交来的内容（界面层赋值：要用 App Group 的容器和附件缓存目录）。
    /// 给了 id 就取那一份，没给就按时间先后取走全部没过期的分享；没有可取的返回空数组。
    @ObservationIgnored var consumeSharePayloads: @MainActor (_ id: String?) async -> [(text: String, files: [LocalFile])] = { _ in [] }

    /// 当前打开着的网页编辑器的桥（没有打开笔记时为 nil）。用 [registerEditor] 设置。
    @ObservationIgnored private(set) var editorBridge: NoteEmbedBridge?

    /// 每换一次身份（登录、退出、删除账号）加一。界面用它清掉自己手上属于旧身份的状态（比如开着的「整理成笔记」窗口）。
    private(set) var identityGeneration = 0

    /// 安装包配了 Google 登录（Info.plist 的 `GIDClientID`）。
    var googleSignInConfigured: Bool { config.googleIOSClientId != nil }

    /// 官网地址（隐私政策、使用条款的链接）。
    var siteUrl: String { config.siteURL }

    // MARK: - 内部

    private let l10n: L10n
    private let google: GoogleSignInSeam
    @ObservationIgnored private var translator: (locale: String, value: SystemTextTranslator)?
    @ObservationIgnored private var listeners: [Task<Void, Never>] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastLocaleSyncKey: AccountLocaleSyncKey?
    @ObservationIgnored private var imageCache = DataCache()
    @ObservationIgnored private var imageLoads: [String: Task<Data, Error>] = [:]
    /// 换身份时加一：旧身份发出的图片请求回来后不进缓存。
    @ObservationIgnored private var imageGeneration = 0

    /// - Parameters:
    ///   - resources: 打包资源所在的包（测试里给一个临时目录）。
    ///   - defaults: 本机设置（模型选择、草稿、语言、图标、外观、笔记侧栏的折叠状态、最近的表情）。
    ///   - dataDirectory: 放 Cookie 文件的目录；nil 用 Application Support。不存在就建。
    ///   - transport: 网络传输；测试里换成假的。
    ///   - systemLanguages: 系统的语言列表（"自动"时按它选界面语言）。
    init(
        config: AppConfig = AppConfig(),
        resources: Bundle = .main,
        defaults: UserDefaults = .standard,
        dataDirectory: URL? = nil,
        transport: HTTPTransport = URLSessionTransport(),
        systemLanguages: @escaping () -> [String] = { Locale.preferredLanguages },
        l10n: L10n = .shared
    ) {
        self.config = config
        self.resources = resources
        self.defaults = defaults
        self.transport = transport
        self.l10n = l10n

        // ---- 网络（NoteFableApp.cookieJar / api）----
        let directory = dataDirectory ?? Self.defaultDataDirectory()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cookieJar = PersistentCookieJar(fileURL: directory.appendingPathComponent("cookies.json"))
        self.cookieJar = cookieJar
        let api = NoteFableApi(
            baseUrl: config.baseURL,
            cookieStore: cookieJar,
            transport: transport,
            acceptLanguage: { AppLanguage.acceptLanguage(AppLanguage.uiLocale) },
            // LocalFile.uri 在 iOS 上是文件地址（选好的附件先拷进 App 的临时目录）：上传时边读边传。
            openFile: { uri in
                guard let url = URL(string: uri), url.isFileURL else { throw URLError(.fileDoesNotExist) }
                return .file(url)
            }
        )
        self.api = api
        let accountApi = AccountApi(http: api.http)
        let sessionsApi = SessionsApi(http: api.http)
        let projectsApi = ProjectsApi(http: api.http)
        let noteIconApi = NoteIconApi(http: api.http)
        let exportApi = ExportApi(http: api.http)
        let proposalApi = ProposalApi(http: api.http)
        self.accountApi = accountApi
        self.sessionsApi = sessionsApi
        self.projectsApi = projectsApi
        self.noteIconApi = noteIconApi
        self.searchApi = SearchApi(http: api.http)
        self.exportApi = exportApi
        self.proposalApi = proposalApi
        self.reportApi = ReportApi(http: api.http)

        // ---- 语言（MainActivity.resolveAutoConfiguration）----
        // 系统语言都没启用时问服务端按国家推断。这个接口不读也不建账号 / 设备记录，所以直接走传输层：不带 Cookie。
        let inferenceUrl = URL(string: config.baseURL + "/api/i18n?preference=auto&format=locale")
        language = LanguageController(
            store: UserDefaultsLanguagePreferenceStore(defaults: defaults),
            resources: resources,
            systemLanguages: systemLanguages,
            inferLocale: { tags in
                guard let inferenceUrl else { return nil }
                let request = HTTPRequest(url: inferenceUrl, headers: ["Accept-Language": tags.joined(separator: ",")])
                guard let (data, response) = try? await transport.send(request), response.isSuccessful else { return nil }
                return AppLanguage.inferredLocaleCode(from: data)
            },
            l10n: l10n
        )

        // ---- 打包的资源 ----
        systemTextCatalog = Self.resourceData("system-text", "json", in: resources).flatMap { try? SystemText.parse($0) } ?? .empty
        usageLimits = Self.resourceData("usage-limits", "json", in: resources).flatMap { try? UsageLimits.parse($0) }

        // ---- App 级的 Store ----
        appIcon = AppIconDefaults.store(defaults)
        appTheme = AppThemeDefaults.store(defaults)
        proposals = ProposalStore(backend: proposalApi)
        let answerExports = AnswerExportStore(backend: exportApi)
        self.answerExports = answerExports
        recentEmoji = UserDefaultsRecentEmojiStore(defaults: defaults)

        // ---- ViewModel（各自的 Factory）----
        let chat = ChatViewModel(
            backend: api,
            settings: PrefsSettingsStore(defaults: defaults),
            bundledModels: {
                guard let data = Self.resourceData("models", "json", in: resources) else { return nil }
                return try NoteFableJson.decode(ModelsResponse.self, from: data)
            },
            savedState: UserDefaultsChatSavedState(defaults: defaults),
            saveIcon: { sessionId, icon in (try? await sessionsApi.updateSessionIcon(id: sessionId, icon: icon)) ?? false },
            onMessageIdChanged: { sessionId, from, to in answerExports.rename(sessionId: sessionId, from: from, to: to) }
        )
        self.chat = chat
        // GoogleSignIn 在界面层，这时还没接上：给 AccountViewModel 一个转到 [requestGoogleIdToken] 的闭包。
        // 没配客户端 ID 的安装包传 nil，登录窗口就只有邮箱验证码。
        let google = GoogleSignInSeam()
        self.google = google
        let forward: AccountViewModel.GoogleIdTokenRequest = { clientId, nonce in
            guard let request = google.requestIdToken else { throw GoogleSignInUnavailable() }
            return try await request(clientId, nonce)
        }
        account = AccountViewModel(
            backend: api, profile: accountApi, requestGoogleIdToken: config.googleIOSClientId == nil ? nil : forward
        )
        notes = NotesViewModel(backend: api, prefs: UserDefaultsNotesPrefs(defaults: defaults), noteIcons: noteIconApi)
        sidebar = SidebarViewModel(sessions: sessionsApi, projectsApi: projectsApi, chat: chat)
    }

    /// 全屏检索的 ViewModel：每次打开检索建一个（Android 的 SearchViewModel.Factory）。
    func makeSearchViewModel() -> SearchViewModel {
        SearchViewModel(backend: searchApi)
    }

    // MARK: - 系统文、模型、表情

    /// 当前界面语言的系统文翻译器。在 SwiftUI 的 body 里读会登记对语言的依赖，换语言后重绘时拿到新的。
    var systemText: SystemTextTranslator {
        let locale = l10n.locale
        if let translator, translator.locale == locale { return translator.value }
        let value = systemTextCatalog.translator(locale)
        translator = (locale, value)
        return value
    }

    /// 表情目录（`emoji.json`，2 MB 多）：在后台线程解析，每种语言只解析一次。关键词按当前界面语言。
    func loadEmojiCatalog() async throws -> EmojiCatalog {
        let locale = language.uiLocale
        let supported = emojiGlyphSupported
        let url = Self.resourceURL("emoji", "json", in: resources)
        return try await Task.detached(priority: .userInitiated) {
            try EmojiCatalog.load(
                locale: locale,
                read: {
                    guard let url else { throw URLError(.fileDoesNotExist) }
                    return try Data(contentsOf: url)
                },
                supported: supported
            )
        }.value
    }

    // MARK: - 换身份（NoteFableRoot.kt 的 onIdentityChanged）

    /// 登录、退出、删除账号之前调用：趁网页编辑器还带着旧身份的 Cookie，把打开的笔记存掉。
    func beforeIdentityChange() async {
        await notes.flushBeforeIdentityChange()
    }

    /// 登录、退出、删除账号成功之后调用：聊天、笔记、侧栏按新身份重新加载。
    func onIdentityChanged() {
        chat.onIdentityChanged()
        notes.onIdentityChanged()
        sidebar.onIdentityChanged()
        // 旧身份整理好的笔记打不开了（网页登录 / 退出会重新加载页面）。
        answerExports.clearPageJobs()
        // 图片按归属校验：旧身份读到的不留给新身份，还在路上的回来也不存。
        imageGeneration += 1
        imageCache.removeAll()
        imageLoads.removeAll()
        identityGeneration += 1
    }

    /// 登录窗口里"使用 Google 继续"（NoteFableRoot.kt 的 signIn）。草稿在 ChatViewModel 里，换身份后仍在。
    func signInWithGoogle() async {
        await beforeIdentityChange()
        account.signIn(onSignedIn: { [weak self] in self?.onIdentityChanged() })
    }

    /// 退出登录（NoteFableRoot.kt 侧栏底部的 onSignOut）：退出后按系统语言显示（网页 forgetLocaleChoice）。
    func signOut() async {
        await beforeIdentityChange()
        let google = self.google
        account.signOut(
            clearDeviceChoice: { await google.clearDeviceChoice?() },
            onSignedOut: { [weak self] in self?.onSignedOut() }
        )
    }

    /// 设置里的"删除账号"：成功（返回 nil）后和退出一样换成新的匿名身份。打开的笔记属于被删的账号，不再保存。
    func deleteAccount() async -> Error? {
        let google = self.google
        let failure = await account.deleteAccount(clearDeviceChoice: { await google.clearDeviceChoice?() })
        if failure == nil { onSignedOut() }
        return failure
    }

    private func onSignedOut() {
        language.forgetChoice()
        onIdentityChanged()
    }

    // MARK: - 编辑器

    /// 编辑器打开 / 关掉时由界面调用（传 nil 是关掉了）：离开笔记前经它保存，提案改了打开着的笔记时也经它通知网页。
    func registerEditor(_ bridge: NoteEmbedBridge?) {
        editorBridge = bridge
        notes.registerEditor(bridge)
    }

    // MARK: - App 级的事件（NoteFableRoot.kt 里不画界面的 LaunchedEffect）

    /// App 启动后调一次（多调无妨）：
    /// - 回答"存到笔记" / 「整理成笔记」建好了笔记 → 刷新笔记列表（网页 notefable:page-created）；
    /// - 应用了提案 → 刷新笔记列表；改动的笔记正开在编辑器里时把新版本交给网页编辑器（不然下次保存会 409）；
    /// - 界面语言跟着账号上的语言走（AccountLocaleSync，整个 App 只这一处，界面不用再做）。
    func start() {
        if started { return }
        started = true
        // 先开始听再起任务：start() 之后马上发出的事件也收得到。
        let created = answerExports.created()
        let changes = proposals.changes()
        listeners = [
            Task { [weak self] in
                for await _ in created { self?.notes.refresh() }
            },
            Task { [weak self] in
                for await change in changes { self?.onProposalChange(change) }
            },
        ]
        syncLanguageWithAccount()
    }

    /// 停掉 [start] 开的监听（测试收尾用；App 里不用调）。
    func stop() {
        started = false
        listeners.forEach { $0.cancel() }
        listeners = []
        lastLocaleSyncKey = nil
    }

    private func onProposalChange(_ change: ProposalChangeEvent) {
        notes.refresh()
        if !change.created, let page = change.page, let pageId = change.pageId, notes.state.open?.id == pageId {
            editorBridge?.pageUpdated(page)
        }
    }

    /// 账号状态里和语言有关的几项变了就同步一次，然后接着等下一次变化。
    private func syncLanguageWithAccount() {
        guard started else { return }
        let key = withObservationTracking {
            account.state.localeSyncKey
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.syncLanguageWithAccount() }
        }
        if key != lastLocaleSyncKey {
            lastLocaleSyncKey = key
            language.syncWithAccount(account.state)
        }
    }

    // MARK: - 界面用的小工具

    /// 相对路径补成完整地址（附件、头像的 `/api/…`）；已经是完整地址的原样返回。
    func absoluteUrl(_ path: String) -> String {
        api.absoluteUrl(path)
    }

    /// 带着 App 的 Cookie 读一张图片（附件、生成的图片、头像：服务端只把它们给主人）。
    /// 读过的留在内存里；同一个地址同时只发一个请求。
    func fetchData(_ pathOrUrl: String) async throws -> Data {
        let key = api.absoluteUrl(pathOrUrl)
        if let cached = imageCache.get(key) { return cached }
        if let running = imageLoads[key] { return try await running.value }
        let generation = imageGeneration
        let api = self.api
        // 不随发起它的视图取消：别的视图可能也在等同一张，读完进缓存下次直接用。
        let task = Task { [weak self] () throws -> Data in
            let result: Result<Data, Error>
            do {
                result = .success(try await api.fetchData(key).data)
            } catch {
                result = .failure(error)
            }
            if let self, self.imageGeneration == generation {
                self.imageLoads[key] = nil
                if case .success(let data) = result { self.imageCache.put(key, data) }
            }
            return try result.get()
        }
        imageLoads[key] = task
        return try await task.value
    }

    /// 这个地址的 Cookie：打开笔记编辑器前拷进 WKWebView 的 Cookie 存储，网页和 API 就是同一个身份。
    func cookies(for url: URL) -> [HTTPCookie] {
        cookieJar.cookies(for: url)
    }

    // MARK: - 资源

    nonisolated static func defaultDataDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
    }

    /// 包里的一个资源文件；没有是 nil。
    nonisolated static func resourceURL(_ name: String, _ ext: String, in bundle: Bundle) -> URL? {
        if let url = bundle.url(forResource: name, withExtension: ext) { return url }
        // 测试里的包只是一个普通目录。
        let url = (bundle.resourceURL ?? bundle.bundleURL).appendingPathComponent("\(name).\(ext)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    nonisolated static func resourceData(_ name: String, _ ext: String, in bundle: Bundle) -> Data? {
        resourceURL(name, ext, in: bundle).flatMap { try? Data(contentsOf: $0) }
    }
}
