import Observation
import SwiftUI
import UIKit
import WebKit

// 笔记编辑页里的网页编辑器（Android ui/NoteEditor.kt 的 WebView 部分）：WKWebView 打开 `<baseUrl>/note-embed?page=…&lang=…&model=…&reasoning=…&theme=…`
// （从检索结果打开时第一次加载还带 `&reveal=<命中的块 / 元素>`；已经开着的页面改用 `notefableEmbed.reveal(id)` 就地定位），
// 白板、幻灯片也是同一个页面。
// 和原生之间走 JS 桥（Core 的 NoteEmbedBridge / NoteEmbedScripts，约定见 src/lib/native-bridge.ts）。规则见 docs/architecture/ios-native.md：
// - 整个工作区复用单个常驻 WKWebView（[NoteEditorPool]）：首次打开笔记时按需创建，切页优先走 `notefableEmbed.openPage` 就地切换
//   （保留网页壳和最多 8 篇缓存），旧版服务端或尚未挂好时自动回退到 Cookie 同步 + 整页加载；离开笔记时调 `close()` 卸载编辑器 DOM。
// - 换身份、退到后台（停留在列表 / 聊天时）、收到内存警告（停留在列表 / 聊天时）、空闲超过 120 秒、渲染进程崩溃（停留在后台时）
//   或根视图销毁时彻底释放 WKWebView。
// - 加载前先清空 WebView 的 Cookie，再把 App 的 Cookie 拷进去：身份和 API 相同，退出登录后网页也不会沿用旧会话。
// - 只有本站的 /note-embed 在 WebView 里打开；本站的聊天链接在 App 里打开；笔记文件由 App 带着 Cookie 下载；其它链接交给系统浏览器。
// - 图片 / 文件块的“上传”（<input type="file">）WKWebView 自己会弹系统的选择器，不用另接。
// - 外观：把 App 现在显示的外观（light / dark，已经按“跟随系统”算好）经地址的 theme=、`NoteFableNative.theme()` 交给网页，
//   开着的时候变了再用 `notefableEmbed.theme(value)` 推一次。WebView 自己不画底（透明），深色下不会先白一下。

/// 整个笔记工作区共用的常驻 WKWebView 池（Android 的 `NoteEmbedHost`）：
/// 首次打开笔记时按需创建，离开笔记时卸载编辑器 DOM 并保留轻量缓存，按身份变化 / 后台 / 内存警告 / 120 秒空闲超时释放。
@MainActor
@Observable
final class NoteEditorPool {
    private static let idleTimeout: Duration = .seconds(120)
    /// 关掉向导时还有 AI 生成在后台跑：多留一会儿，完成时 `pagesChanged` 能刷新列表。
    private static let busyIdleTimeout: Duration = .seconds(360)

    /// 每次新建或崩溃重建 WKWebView 加一，让等待打开向导的 `.task` 重新触发。
    private(set) var generation = 0

    @ObservationIgnored private(set) var controller: NoteEditorController?
    @ObservationIgnored private var idleTask: Task<Void, Never>?
    @ObservationIgnored private var mountToken = 0
    @ObservationIgnored private weak var boundApp: AppEnvironment?

    init() {}

    /// 绑定到 AppEnvironment，确保停在列表或聊天里时也能收到聊天提案更新和回收站清理事件。
    func bind(app: AppEnvironment) {
        if boundApp === app { return }
        boundApp = app
        app.warmPageUpdated = { [weak self] pageJson in
            self?.pageUpdated(pageJson)
        }
        app.notes.notifyPagesTrashed = { [weak self] ids in
            self?.pageTrashed(ids)
        }
        app.notes.notifyPageUpdated = { [weak self] pageId, pageJson in
            self?.pageUpdated(pageJson, pageId: pageId)
        }
        app.notes.notifyPageSettings = { [weak self] page in
            self?.pageSettings(NoteFableJson.encodeToString(page))
        }
    }

    func obtainController(app: AppEnvironment, router: AppRouter) -> (controller: NoteEditorController, token: Int) {
        bind(app: app)
        idleTask?.cancel()
        idleTask = nil
        mountToken += 1
        let active: NoteEditorController
        if let existing = controller {
            existing.updateRouter(router)
            active = existing
        } else {
            let created = NoteEditorController(
                app: app,
                router: router,
                onTerminatedWhileParked: { [weak self] in self?.destroy() },
                onProcessRestarted: { [weak self] in self?.generation += 1 },
                onWizardBusyChanged: { [weak self] in self?.rescheduleIdleIfParked() }
            )
            controller = created
            active = created
        }
        return (active, mountToken)
    }

    /// 离开编辑页或全屏向导但保留热缓存：卸载编辑器 DOM，开始 120 秒（向导还在生成时 360 秒）空闲倒计时，到期未重开则销毁。
    /// 已经有更新的编辑页挂上了同一个 WebView（token 不对）时什么都不做，返回 false。
    @discardableResult
    func park(ifTokenMatches token: Int) -> Bool {
        guard token == mountToken else { return false }
        idleTask?.cancel()
        idleTask = nil
        guard let controller else { return true }
        controller.park()
        if controller.isLoaded {
            scheduleIdle()
        } else {
            destroy()
        }
        return true
    }

    /// 全屏向导打不开（页面没加载成、旧服务端）：丢掉这个 WebView，下次重新加载。
    func discardWizard() {
        if controller?.isWizardActive == true { destroy() }
    }

    /// 网页还没出现向导就被用户关闭：如果这个 WebView 从未成功打开过页面或向导（比如离线加载失败），直接丢掉避免停靠坏页面。
    func discardWizardIfUnready() {
        if let controller, controller.isWizardActive, !controller.hasEverResponded { destroy() }
    }

    /// 全屏 PowerPoint 导入打不开（页面没加载成、旧服务端）：丢掉这个 WebView，下次重新加载。
    func discardPptxImport() {
        if controller?.isPptxImportActive == true { destroy() }
    }

    /// 网页还没出现 PowerPoint 导入就被用户关闭：如果从未成功响应过，直接丢掉避免停靠坏页面。
    func discardPptxImportIfUnready() {
        if let controller, controller.isPptxImportActive, !controller.hasEverResponded { destroy() }
    }

    /// 用 `NoteEmbedScripts.slidesWizardOpen` 打开向导：冷启动时 `.task` 可能先于 `makeUIView` 执行，
    /// 在池上一起等 `controller` 与 `webView` 就绪（每 250ms 轮询，最多 20 秒），避免 `controller == nil` 时提前退出一直停在加载中。
    func openSlidesWizard(script: String) async -> Bool {
        let deadline = ContinuousClock.now + NoteEditorController.wizardOpenTimeout
        while !Task.isCancelled && ContinuousClock.now < deadline {
            if let controller, let answer = await controller.tryOpenSlidesWizard(script: script) {
                return answer
            }
            do {
                try await Task.sleep(for: NoteEditorController.wizardPollInterval)
            } catch {
                return false
            }
        }
        return false
    }

    /// 用 `NoteEmbedScripts.pptxImportOpen` 打开 PowerPoint 导入窗口（同 `openSlidesWizard`）。
    func openPptxImport(script: String) async -> Bool {
        let deadline = ContinuousClock.now + NoteEditorController.wizardOpenTimeout
        while !Task.isCancelled && ContinuousClock.now < deadline {
            if let controller, let answer = await controller.tryOpenPptxImport(script: script) {
                return answer
            }
            do {
                try await Task.sleep(for: NoteEditorController.wizardPollInterval)
            } catch {
                return false
            }
        }
        return false
    }

    /// 用 `NoteEmbedScripts.quizOpen` 在开着的编辑器上打开复习和测验窗口。
    func openQuiz(script: String) async -> Bool {
        let deadline = ContinuousClock.now + NoteEditorController.wizardOpenTimeout
        while !Task.isCancelled && ContinuousClock.now < deadline {
            if let controller, let answer = await controller.tryOpenQuiz(script: script) {
                return answer
            }
            do {
                try await Task.sleep(for: NoteEditorController.wizardPollInterval)
            } catch {
                return false
            }
        }
        return false
    }

    private func rescheduleIdleIfParked() {
        guard let controller, controller.isParked, controller.isLoaded else { return }
        scheduleIdle()
    }

    private func scheduleIdle() {
        idleTask?.cancel()
        let timeout = (controller?.slidesWizardBusy == true) ? Self.busyIdleTimeout : Self.idleTimeout
        idleTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: timeout)
            } catch {
                return
            }
            guard let self, self.controller?.isParked == true else { return }
            // 逐页配图等长时间后台任务仍在进行时续期，避免中途销毁 WebView 导致已扣费的图片丢失。
            if self.controller?.slidesWizardBusy == true {
                self.scheduleIdle()
            } else {
                self.destroy()
            }
        }
    }

    /// 退到后台或收到内存警告时，如果当前没有打开笔记或向导（只留着热缓存），立刻释放 WKWebView。
    func destroyIfParked() {
        if controller?.isParked == true, controller?.slidesWizardBusy != true { destroy() }
    }

    /// 彻底销毁常驻 WKWebView（换身份、空闲超时、内存压力、后台释放、根视图销毁）。
    func destroy() {
        idleTask?.cancel()
        idleTask = nil
        mountToken += 1
        generation += 1
        controller?.teardown()
        controller = nil
    }

    /// 知道页面 id 时，这次加载以来没在这个 WebView 里打开过的页面不推（不在网页的缓存里；白板、幻灯片的整页数据很大）。
    func pageUpdated(_ pageJson: String, pageId: String? = nil) {
        guard let controller, controller.isLoaded else { return }
        if let pageId, !controller.hasOpened(pageId) { return }
        controller.pageUpdated(pageJson)
    }

    func pageTrashed(_ ids: [String]) {
        if let controller, controller.isLoaded { controller.pageTrashed(ids) }
    }

    func pageSettings(_ pageJson: String) {
        if let controller, controller.isLoaded { controller.pageSettings(pageJson) }
    }
}

/// 网页编辑器。复用 [NoteEditorPool] 里的单个 WKWebView：直接切页时走 `notefableEmbed.openPage` 不再重建视图；
/// 冲突后“另存为新笔记”只改 `open.id` 不改 `open.editor`，也不会重新切页。
@MainActor
struct NoteEditorWebView: UIViewRepresentable {
    let open: OpenNote
    let pool: NoteEditorPool
    let app: AppEnvironment
    let router: AppRouter
    let appIcon: String?
    let language: String
    let theme: String
    let edgeBack: Bool

    final class Coordinator {
        let pool: NoteEditorPool
        var mountToken = 0

        init(pool: NoteEditorPool) {
            self.pool = pool
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(pool: pool)
    }

    func makeUIView(context: Context) -> WKWebView {
        let (controller, token) = pool.obtainController(app: app, router: router)
        context.coordinator.mountToken = token
        return controller.attachView(open: open, appIcon: appIcon, language: language, theme: theme, edgeBack: edgeBack)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        pool.controller?.sync(open: open, appIcon: appIcon, language: language, theme: theme, edgeBack: edgeBack)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // 新的编辑页已经先挂上了同一个 WebView 时不摘：摘了新画面就是空白的。
        if coordinator.pool.park(ifTokenMatches: coordinator.mountToken) { webView.removeFromSuperview() }
    }
}

/// 常驻编辑器的 WKWebView 和它的桥。首次打开笔记时建 WebView、`bridge.attach`；切页时复用并登记到 `AppEnvironment.registerEditor`；
/// 离开编辑页时 `park()` 卸载编辑器 DOM 并注销活跃桥；释放池时 `teardown()` 彻底销毁。
@MainActor
final class NoteEditorController: NSObject, NoteEditorBridge {
    /// `window.webkit.messageHandlers.<名字>`：网页的 `window.NoteFableNative.postMessage` 经它转过来。
    private static let handlerName = "notefableNative"
    /// 全屏向导借用常驻 WebView 时的占位编辑器标识（没有打开任何页面）。
    static let slidesWizardEditorId = "__slides_wizard__"
    /// 全屏 PowerPoint 导入借用常驻 WebView 时的占位编辑器标识（没有打开任何页面）。
    static let pptxImportEditorId = "__pptx_import__"
    static let wizardOpenTimeout: Duration = .seconds(20)
    static let wizardPollInterval: Duration = .milliseconds(250)

    /// 所有编辑器共用 App 的默认（落盘的）数据存储：Cookie 每次加载前换成 App 的；网页的本地草稿（localStorage）
    /// 和 Android 的 WebView 一样跨 App 重启保留，离开笔记再回来、网页进程崩溃、App 被系统杀掉后重新打开都还能恢复。
    private static let dataStore = WKWebsiteDataStore.default()
    /// 所有编辑器的换 Cookie 排成一条链，一次只换一个：旧的加载既不会清掉新加载刚放进去的 Cookie，也不会把上一个身份的 Cookie 放回去。
    private static var cookieChain: Task<Void, Never>?

    private let app: AppEnvironment
    private var router: AppRouter
    private let onTerminatedWhileParked: @MainActor () -> Void
    private let onProcessRestarted: @MainActor () -> Void
    private let onWizardBusyChanged: @MainActor () -> Void
    private var bridge: NoteEmbedBridge!

    private var webView: WKWebView?
    /// 当前活跃的编辑器标识（`OpenNote.editor` 或 [slidesWizardEditorId]）；停留在列表 / 聊天里只保留热缓存时为 nil。
    private(set) var activeEditor: String?
    /// 当前活跃笔记的页面 id（用于渲染进程崩溃后重载）。
    private var currentPageId: String?
    /// 正在切往的目标页面 id：在该页的 ready 到达前，丢弃旧页残留的晚到消息，避免串到新页上。
    private var awaitingPageId: String?
    /// 是否已经为当前身份加载过 `/note-embed`（加载过后切页优先走 `openPage`）。
    private(set) var isLoaded = false
    /// 网页里的 AI 幻灯片向导现在是否可见。
    private(set) var slidesWizardVisible = false
    /// 关掉向导时还有 AI 生成在后台跑。
    private(set) var slidesWizardBusy = false
    /// 网页里的 PowerPoint 导入窗口现在是否可见。
    private(set) var pptxImportVisible = false
    /// 网页里的复习和测验窗口现在是否可见。
    private(set) var quizVisible = false
    /// 这次加载的网页是否真的回应过（ready / slidesWizard open / openSlidesWizard 成功）：离线或加载失败停在错误页时为 false。
    private(set) var hasEverResponded = false
    var isParked: Bool { activeEditor == nil }
    var isWizardActive: Bool { activeEditor == Self.slidesWizardEditorId }
    var isPptxImportActive: Bool { activeEditor == Self.pptxImportEditorId }

    /// 每开始一次加载（或销毁）加一：等 Cookie 期间又开始了新的加载时，旧的不再继续。
    private var loadRun = 0
    /// 每次切换或停靠加一：过滤掉异步 `openPage` 返回前的旧回调。
    private var showEpoch = 0
    private var openTask: Task<Void, Never>?
    /// 网页进程崩溃时打开着的编辑器：之后这一篇再经 `show` 打开时不跳到检索命中的位置。只用一次，离开编辑页时清掉。
    private var crashedEditor: String?
    /// 这次加载以来在这个 WebView 里打开过的页面：只有它们可能在网页的缓存里。
    private var openedPageIds: Set<String> = []
    /// 现在这一篇之前的历史项数（旧版服务端回退整页加载时，上一篇留在 backForwardList 里）。边缘返回只在比它多时才 goBack，
    /// 不会在这一篇里退回到上一篇。
    private var historyFloor = 0
    private var pushedIcon: String?
    private var pushedLanguage = ""
    /// 交给网页的外观（light / dark）；重新加载时地址和 `NoteFableNative.theme()` 用它。
    private var pushedTheme = ""
    private var edgePan: UIScreenEdgePanGestureRecognizer?
    /// 正在显示的网页提示框（alert / confirm / prompt）和按“取消”回答它的办法：切页或离开编辑页时关掉，网页不会一直等着。
    private var openDialog: (alert: UIAlertController, cancel: () -> Void)?
    #if DEBUG
    /// CI 应用商店截图：FixtureLaunch 在现在这个网页里跑就绪探测（[screenshotProbe]）。
    private(set) static weak var screenshotController: NoteEditorController?
    #endif

    init(
        app: AppEnvironment,
        router: AppRouter,
        onTerminatedWhileParked: @escaping @MainActor () -> Void,
        onProcessRestarted: @escaping @MainActor () -> Void,
        onWizardBusyChanged: @escaping @MainActor () -> Void
    ) {
        self.app = app
        self.router = router
        self.onTerminatedWhileParked = onTerminatedWhileParked
        self.onProcessRestarted = onProcessRestarted
        self.onWizardBusyChanged = onWizardBusyChanged
        super.init()
        // 消息按当前活跃编辑器转发，不按页面 id：换到副本后由 ViewModel 跟过去。
        self.bridge = NoteEmbedBridge(onMessage: { [weak self] message in
            guard let self else { return }
            if case .pagesChanged = message {
                // 笔记 AI 面板的后台画成图、AI 生成幻灯片可能在离开编辑页（常驻 WKWebView 停靠中）或切页途中完成：只要 WKWebView 还在就刷新列表。
                if self.webView != nil {
                    self.app.notes.refresh()
                }
                return
            }
            if case .slidesJobs(let pageIds) = message {
                // 离开编辑页（停靠中）时生成还在跑、做完了也要收到。
                if self.webView != nil { self.app.notes.onSlidesJobs(pageIds) }
                return
            }
            if case .slidesWizard(let open, let busy) = message {
                guard self.webView != nil else { return }
                self.hasEverResponded = true
                self.slidesWizardVisible = open
                self.slidesWizardBusy = open ? false : busy
                self.onWizardBusyChanged()
                if open {
                    let editorForOpen = (self.activeEditor == Self.slidesWizardEditorId || self.activeEditor == Self.pptxImportEditorId) ? nil : self.activeEditor
                    self.app.notes.onSlidesWizardOpened(editor: editorForOpen)
                } else {
                    self.app.notes.onSlidesWizardClosed()
                }
                return
            }
            if case .pptxImport(let open) = message {
                guard self.webView != nil else { return }
                self.hasEverResponded = true
                self.pptxImportVisible = open
                if open {
                    let editorForOpen = (self.activeEditor == Self.pptxImportEditorId || self.activeEditor == Self.slidesWizardEditorId) ? nil : self.activeEditor
                    self.app.notes.onPptxImportOpened(editor: editorForOpen)
                } else {
                    self.app.notes.onPptxImportClosed()
                }
                return
            }
            guard let editor = self.activeEditor else {
                // 首次 HTML 还没加载完用户就离开了笔记：立刻让网页卸载编辑器 DOM，不留孤立实例。
                if case .ready = message { self.bridge.close() }
                return
            }
            if editor == Self.slidesWizardEditorId {
                switch message {
                case .openPage(let id):
                    self.slidesWizardVisible = false
                    self.app.notes.dismissSlidesWizard()
                    self.router.openNote(id)
                case .usageLimit(let tier, let kind, _):
                    self.app.notes.onWizardUsageLimit(tier: tier, kind: kind)
                case .storageLimit(let tier, let used, let limit):
                    self.app.notes.onWizardStorageLimit(tier: tier, used: used, limit: limit)
                default:
                    break
                }
                return
            }
            if editor == Self.pptxImportEditorId {
                switch message {
                case .openPage(let id):
                    self.pptxImportVisible = false
                    self.app.notes.dismissPptxImport()
                    self.router.openNote(id)
                case .storageLimit(let tier, let used, let limit):
                    self.app.notes.onPptxImportStorageLimit(tier: tier, used: used, limit: limit)
                default:
                    break
                }
                return
            }
            if let expected = self.awaitingPageId {
                switch message {
                case .ready(let id, _, _, _, _):
                    if id != expected { return }
                    self.hasEverResponded = true
                    self.awaitingPageId = nil
                    self.currentPageId = id
                    self.openedPageIds.insert(id)
                case .missing(let id):
                    if let id, id != expected { return }
                    self.awaitingPageId = nil
                default:
                    return
                }
            } else {
                switch message {
                case .ready(let id, _, _, _, _):
                    // 冲突后“另存为新笔记”：开着的换成了副本，它也在网页的缓存里。
                    self.currentPageId = id
                    self.openedPageIds.insert(id)
                    self.quizVisible = false
                case .quiz(let open):
                    if open { self.hasEverResponded = true }
                    self.quizVisible = open
                case .missing(let id):
                    if let id, let current = self.currentPageId, id != current { return }
                case .usageLimit(_, _, let pageId):
                    if let pageId, let current = self.currentPageId, pageId != current { return }
                default:
                    break
                }
            }
            if case .openChat(let id, let messageId) = message {
                // 笔记下方反向链接里的聊天：和搜索结果一样，先保存笔记、切到聊天，再打开（有发言就滚到那里）。
                self.router.openChat(id, messageId: messageId)
                return
            }
            self.app.notes.onEditorMessage(editor, message)
        })
    }

    func updateRouter(_ router: AppRouter) {
        self.router = router
    }

    // MARK: - 建立、切页、停靠和销毁

    func attachView(open: OpenNote, appIcon: String?, language: String, theme: String, edgeBack: Bool) -> WKWebView {
        let webView = ensureWebView(edgeBack: edgeBack)
        webView.removeFromSuperview()
        show(open: open, appIcon: appIcon, language: language, theme: theme, edgeBack: edgeBack)
        return webView
    }

    /// 全屏向导挂上常驻 WKWebView（没有打开任何页面时）。
    func attachWizardView(appIcon: String?, language: String, theme: String) -> WKWebView {
        let webView = ensureWebView(edgeBack: true)
        webView.removeFromSuperview()
        showWizard(appIcon: appIcon, language: language, theme: theme)
        return webView
    }

    /// 全屏 PowerPoint 导入挂上常驻 WKWebView（没有打开任何页面时）。
    func attachPptxImportView(appIcon: String?, language: String, theme: String) -> WKWebView {
        let webView = ensureWebView(edgeBack: true)
        webView.removeFromSuperview()
        showPptxImport(appIcon: appIcon, language: language, theme: theme)
        return webView
    }

    private func ensureWebView(edgeBack: Bool) -> WKWebView {
        if let existing = webView { return existing }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = ScreenshotHooks.isActive ? .nonPersistent() : Self.dataStore
        configuration.allowsInlineMediaPlayback = true
        // WKUserContentController 会强引用消息处理者，中间隔一个弱引用，免得和 WebView 互相拉住。
        configuration.userContentController.add(NoteScriptMessageProxy(self), name: Self.handlerName)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // 自己不画底：网页画出来之前露出编辑页的底色（--notion-bg，跟着外观变），深色下不会先白一下。
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // 滚到头回弹时露出来的地方也用页面底色。
        webView.underPageBackgroundColor = SmUI.background
        // 长按链接不弹预览：预览里会加载任意网页。
        webView.allowsLinkPreview = false
        #if DEBUG
        // 只有 debug 包能用 Safari 调试 WebView。
        webView.isInspectable = true
        #endif

        // 从行首的屏幕边缘往里滑 = Android 的返回键（手势导航的边缘返回）：先交给网页关面板，再保存并回列表。
        // 在别的画面这个手势是拉出抽屉；编辑页里它是返回（见下面的 UIGestureRecognizerDelegate），抽屉用顶栏的菜单键开。
        // 白板页关着（停用的手势不收触摸，网页的手势也不用等它失败）：单指画、拖从边缘开始也留在画布上，离开用顶栏的“<”。
        let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(onEdgePan(_:)))
        edgePan.edges = app.language.isRightToLeft ? .right : .left
        edgePan.delegate = self
        edgePan.isEnabled = edgeBack
        webView.addGestureRecognizer(edgePan)
        webView.scrollView.panGestureRecognizer.require(toFail: edgePan)
        self.edgePan = edgePan

        self.webView = webView
        bridge.attach(self)
        #if DEBUG
        if ScreenshotHooks.isActive { Self.screenshotController = self }
        #endif
        return webView
    }

    func syncWizard(appIcon: String?, language: String, theme: String) {
        if activeEditor != Self.slidesWizardEditorId {
            showWizard(appIcon: appIcon, language: language, theme: theme)
            return
        }
        if theme != pushedTheme {
            pushedTheme = theme
            bridge.pushTheme(theme)
        }
        if appIcon != pushedIcon {
            pushedIcon = appIcon
            bridge.pushAppIcon(appIcon)
        }
        if language != pushedLanguage {
            pushedLanguage = language
            bridge.pushLanguage(language)
            edgePan?.edges = app.language.isRightToLeft ? .right : .left
        }
    }

    private func showWizard(appIcon: String?, language: String, theme: String) {
        openTask?.cancel()
        openTask = nil
        showEpoch += 1
        dismissOpenDialog()

        crashedEditor = nil
        activeEditor = Self.slidesWizardEditorId
        currentPageId = nil
        awaitingPageId = nil
        pushedIcon = appIcon
        pushedLanguage = language
        pushedTheme = theme
        edgePan?.isEnabled = true
        edgePan?.edges = app.language.isRightToLeft ? .right : .left
        bridge.pushTheme(theme)
        if app.editorBridge === bridge { app.registerEditor(nil) }

        if isLoaded, webView != nil {
            bridge.pushLanguage(language)
            bridge.pushAppIcon(appIcon)
        } else {
            loadWizard()
        }
    }

    /// 尝试执行一次 `NoteEmbedScripts.slidesWizardOpen`：网页未就绪或 `webView == nil` 返回 `nil` 供外层继续轮询；
    /// 网页明确接受或拒绝返回 `true` / `false`。
    func tryOpenSlidesWizard(script: String) async -> Bool? {
        guard let webView else { return nil }
        let raw: String? = await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                done.resume(returning: result as? String)
            }
        }
        guard let answer = NoteEmbedScripts.slidesWizardAnswer(raw) else { return nil }
        if answer {
            slidesWizardVisible = true
            hasEverResponded = true
        }
        return answer
    }

    func syncPptxImport(appIcon: String?, language: String, theme: String) {
        if activeEditor != Self.pptxImportEditorId {
            showPptxImport(appIcon: appIcon, language: language, theme: theme)
            return
        }
        if theme != pushedTheme {
            pushedTheme = theme
            bridge.pushTheme(theme)
        }
        if appIcon != pushedIcon {
            pushedIcon = appIcon
            bridge.pushAppIcon(appIcon)
        }
        if language != pushedLanguage {
            pushedLanguage = language
            bridge.pushLanguage(language)
            edgePan?.edges = app.language.isRightToLeft ? .right : .left
        }
    }

    private func showPptxImport(appIcon: String?, language: String, theme: String) {
        openTask?.cancel()
        openTask = nil
        showEpoch += 1
        dismissOpenDialog()
        quizVisible = false

        crashedEditor = nil
        activeEditor = Self.pptxImportEditorId
        currentPageId = nil
        awaitingPageId = nil
        pushedIcon = appIcon
        pushedLanguage = language
        pushedTheme = theme
        edgePan?.isEnabled = true
        edgePan?.edges = app.language.isRightToLeft ? .right : .left
        bridge.pushTheme(theme)
        if app.editorBridge === bridge { app.registerEditor(nil) }

        if isLoaded, webView != nil {
            bridge.pushLanguage(language)
            bridge.pushAppIcon(appIcon)
        } else {
            loadPptxImport()
        }
    }

    func tryOpenPptxImport(script: String) async -> Bool? {
        guard let webView else { return nil }
        let raw: String? = await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                done.resume(returning: result as? String)
            }
        }
        guard let answer = NoteEmbedScripts.slidesWizardAnswer(raw) else { return nil }
        if answer {
            pptxImportVisible = true
            hasEverResponded = true
        }
        return answer
    }

    func tryOpenQuiz(script: String) async -> Bool? {
        guard let webView else { return nil }
        let raw: String? = await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                done.resume(returning: result as? String)
            }
        }
        guard let answer = NoteEmbedScripts.quizAnswer(raw) else { return nil }
        if answer {
            quizVisible = true
            hasEverResponded = true
        }
        return answer
    }

    /// 设置里换了图标 / 界面语言 / 外观（或跟随系统时系统切了深浅）：推给网页（就地换，不重新加载笔记）。
    /// 页面类型变了（网页的 ready 改正了检索结果带来的类型）：边缘返回跟着开关。
    /// 直接从一篇笔记切到另一篇时（`open.editor` 变化）：就地切换页面，不重建 WKWebView。
    func sync(open: OpenNote, appIcon: String?, language: String, theme: String, edgeBack: Bool) {
        if open.editor != activeEditor {
            show(open: open, appIcon: appIcon, language: language, theme: theme, edgeBack: edgeBack)
            return
        }
        currentPageId = open.id
        openedPageIds.insert(open.id)
        if let edgePan, edgePan.isEnabled != edgeBack { edgePan.isEnabled = edgeBack }
        if theme != pushedTheme {
            pushedTheme = theme
            bridge.pushTheme(theme)
        }
        if appIcon != pushedIcon {
            pushedIcon = appIcon
            bridge.pushAppIcon(appIcon)
        }
        if language != pushedLanguage {
            pushedLanguage = language
            bridge.pushLanguage(language)
            // 换成 / 换掉阿拉伯语时，返回手势也换到新的行首那一边。
            edgePan?.edges = app.language.isRightToLeft ? .right : .left
        }
    }

    /// 在常驻 WKWebView 里打开或切到 `open`：已加载过同一身份的 `/note-embed` 时优先走 `openPage`，失败再回退整页加载。
    private func show(open: OpenNote, appIcon: String?, language: String, theme: String, edgeBack: Bool) {
        openTask?.cancel()
        openTask = nil
        showEpoch += 1
        let epoch = showEpoch
        dismissOpenDialog()

        // 崩溃后重载的那一次不再跳到检索命中的位置；只用一次，之后再从检索结果打开同一篇照常跳过去。
        let crashed = crashedEditor == open.editor
        crashedEditor = nil
        quizVisible = false
        let useReveal = crashed ? nil : open.reveal

        activeEditor = open.editor
        currentPageId = open.id
        openedPageIds.insert(open.id)
        awaitingPageId = open.id
        pushedIcon = appIcon
        pushedLanguage = language
        pushedTheme = theme
        edgePan?.isEnabled = edgeBack
        edgePan?.edges = app.language.isRightToLeft ? .right : .left
        bridge.pushTheme(theme)
        app.registerEditor(bridge)

        if isLoaded, webView != nil {
            bridge.pushLanguage(language)
            bridge.pushAppIcon(appIcon)
            let chat = app.chat.state
            let model = chat.selectedModel?.id
            let reasoning = chat.selectedReasoning
            openTask = Task { @MainActor [weak self] in
                // 还没轮到执行就已经离开、换了另一篇或网页进程没了：不再发 openPage（否则会在 close 之后把编辑器重新挂上）。
                guard let self, !Task.isCancelled, self.showEpoch == epoch, self.activeEditor == open.editor else { return }
                let handled = await self.bridge.openPage(id: open.id, reveal: useReveal, model: model, reasoning: reasoning)
                guard !Task.isCancelled, self.showEpoch == epoch, self.activeEditor == open.editor else { return }
                if !handled {
                    // 旧版服务端不支持 openPage：整页加载。同站时用 location.replace 换掉当前历史项（不多压一项），
                    // 更早的历史项（上一篇）仍在 backForwardList 里，边缘返回由 historyFloor 挡住。
                    self.loadPage(pageId: open.id, reveal: useReveal, replaceHistory: true)
                }
            }
        } else {
            loadPage(pageId: open.id, reveal: useReveal)
        }
    }

    /// 离开编辑页但保留热缓存：卸载网页编辑器 DOM、注销当前活跃桥，不销毁 WKWebView。
    func park() {
        openTask?.cancel()
        openTask = nil
        showEpoch += 1
        loadRun += 1
        dismissOpenDialog()
        quizVisible = false
        activeEditor = nil
        currentPageId = nil
        awaitingPageId = nil
        crashedEditor = nil
        if app.editorBridge === bridge { app.registerEditor(nil) }
        if isLoaded, webView != nil {
            bridge.close()
        }
    }

    /// 彻底释放 WKWebView：等着网页回答的保存都算失败，注销桥，停掉网页。
    func teardown() {
        openTask?.cancel()
        openTask = nil
        showEpoch += 1
        loadRun += 1
        isLoaded = false
        slidesWizardVisible = false
        slidesWizardBusy = false
        pptxImportVisible = false
        quizVisible = false
        app.notes.onSlidesJobs([])
        hasEverResponded = false
        activeEditor = nil
        currentPageId = nil
        awaitingPageId = nil
        openedPageIds = []
        dismissOpenDialog()
        bridge.release(self)
        if app.editorBridge === bridge { app.registerEditor(nil) }
        guard let webView else { return }
        self.webView = nil
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        if let edgePan {
            webView.removeGestureRecognizer(edgePan)
            self.edgePan = nil
        }
        let content = webView.configuration.userContentController
        content.removeScriptMessageHandler(forName: Self.handlerName)
        content.removeAllUserScripts()
        webView.removeFromSuperview()
    }

    private func dismissOpenDialog() {
        if let dialog = openDialog {
            openDialog = nil
            if dialog.alert.presentingViewController != nil { dialog.alert.dismiss(animated: false) }
            dialog.cancel()
        }
    }

    // MARK: - 加载

    /// 现在该打开的地址。model / reasoning 是聊天里选的模型和推理强度，编辑器里的 AI 助手用它们。
    /// 从检索结果打开的，第一次加载带上命中的块 / 元素（`reveal=`），网页读好后定位过去。
    private func embedURL(pageId: String, reveal: String?) -> URL? {
        let chat = app.chat.state
        let address = app.api.noteEmbedUrl(
            pageId: pageId, lang: app.language.uiLocale, model: chat.selectedModel?.id, reasoning: chat.selectedReasoning,
            theme: pushedTheme.isEmpty ? nil : pushedTheme, reveal: reveal
        )
        return URL(string: address)
    }

    private func wizardURL() -> URL? {
        let chat = app.chat.state
        let address = app.api.slidesWizardUrl(
            lang: app.language.uiLocale, model: chat.selectedModel?.id, reasoning: chat.selectedReasoning,
            theme: pushedTheme.isEmpty ? nil : pushedTheme
        )
        return URL(string: address)
    }

    private func loadWizard() {
        guard let webView, let url = wizardURL() else { return }
        loadRun += 1
        let current = loadRun

        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(
            source: NoteEmbedScripts.bootstrap(
                handler: Self.handlerName, appIcon: app.appIcon.icon, language: app.language.uiLocale,
                theme: pushedTheme.isEmpty ? nil : pushedTheme
            ),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let previous = Self.cookieChain
        Self.cookieChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.loadRun == current, self.activeEditor == Self.slidesWizardEditorId, self.webView != nil else { return }
            let identity = self.app.identityGeneration
            let cookies = URL(string: self.app.config.baseURL).map { self.app.cookies(for: $0) } ?? []
            await NoteEditorController.replaceCookies(cookies)
            guard self.loadRun == current, self.app.identityGeneration == identity, self.activeEditor == Self.slidesWizardEditorId, let webView = self.webView else { return }
            self.isLoaded = true
            self.historyFloor = webView.backForwardList.currentItem == nil ? 0 : webView.backForwardList.backList.count + 1
            webView.load(URLRequest(url: url))
        }
    }

    private func loadPptxImport() {
        guard let webView, let url = wizardURL() else { return }
        loadRun += 1
        let current = loadRun

        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(
            source: NoteEmbedScripts.bootstrap(
                handler: Self.handlerName, appIcon: app.appIcon.icon, language: app.language.uiLocale,
                theme: pushedTheme.isEmpty ? nil : pushedTheme
            ),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let previous = Self.cookieChain
        Self.cookieChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.loadRun == current, self.activeEditor == Self.pptxImportEditorId, self.webView != nil else { return }
            let identity = self.app.identityGeneration
            let cookies = URL(string: self.app.config.baseURL).map { self.app.cookies(for: $0) } ?? []
            await NoteEditorController.replaceCookies(cookies)
            guard self.loadRun == current, self.app.identityGeneration == identity, self.activeEditor == Self.pptxImportEditorId, let webView = self.webView else { return }
            self.isLoaded = true
            self.historyFloor = webView.backForwardList.currentItem == nil ? 0 : webView.backForwardList.backList.count + 1
            webView.load(URLRequest(url: url))
        }
    }

    /// 换 Cookie、装好 `window.NoteFableNative`，再打开网页。
    /// `replaceHistory` 为 true（旧版服务端回退整页加载）且当前已在同站页时，用 `location.replace` 替换当前历史项（不多压一项）。
    /// 之前的历史项仍在 backForwardList 里，所以记下 `historyFloor`，边缘返回不会退到上一篇。
    private func loadPage(pageId: String, reveal: String?, replaceHistory: Bool = false) {
        guard let webView, let url = embedURL(pageId: pageId, reveal: reveal) else { return }
        loadRun += 1
        let current = loadRun

        // `NoteFableNative.appIcon()` / `language()` / `theme()` 要同步返回，值写在脚本里：每次加载前用当时的值重新生成。
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(
            source: NoteEmbedScripts.bootstrap(
                handler: Self.handlerName, appIcon: app.appIcon.icon, language: app.language.uiLocale,
                theme: pushedTheme.isEmpty ? nil : pushedTheme
            ),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        #if DEBUG
        if ScreenshotHooks.isActive {
            self.isLoaded = true
            self.historyFloor = 0
            // 应用商店截图：打开本机网页服务上的真实编辑器；平时的截图用下面的离线替身页。
            if let server = ScreenshotHooks.editorServer {
                loadFromEditorServer(url, server: server, run: current)
                return
            }
            let html = FixtureEditorPage.html(
                pageId: pageId,
                theme: self.pushedTheme.isEmpty ? "light" : self.pushedTheme,
                language: self.app.language.uiLocale
            )
            webView.loadHTMLString(html, baseURL: url)
            return
        }
        #endif

        // 排在前面的换 Cookie 做完再轮到这次；轮到时这次已经被新的加载或离开页面取代就什么都不做。
        // App 的 Cookie 在真正换的那一刻读，不用开始加载时的旧值（中间可能登录 / 退出了）。
        let previous = Self.cookieChain
        Self.cookieChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.loadRun == current, self.activeEditor != nil, self.webView != nil else { return }
            let identity = self.app.identityGeneration
            let cookies = URL(string: self.app.config.baseURL).map { self.app.cookies(for: $0) } ?? []
            await NoteEditorController.replaceCookies(cookies)
            // 换 Cookie 的途中换了身份或已离开笔记：不再带着旧 Cookie 去加载。
            guard self.loadRun == current, self.app.identityGeneration == identity, self.activeEditor != nil, let webView = self.webView else { return }
            self.isLoaded = true
            if replaceHistory, let currentUrl = webView.url, self.isSameSite(currentUrl) {
                // replace 换掉的是现在这一项，前面的历史项（上一篇）还在：记下来，返回不退到那里。
                self.historyFloor = webView.backForwardList.backList.count
                webView.evaluateJavaScript("window.location.replace(\(NoteEmbedScripts.quote(url.absoluteString)))") { [weak self, weak webView] _, error in
                    guard error != nil, let self, self.loadRun == current, let webView else { return }
                    self.historyFloor = webView.backForwardList.currentItem == nil ? 0 : webView.backForwardList.backList.count + 1
                    webView.load(URLRequest(url: url))
                }
            } else {
                self.historyFloor = webView.backForwardList.currentItem == nil ? 0 : webView.backForwardList.backList.count + 1
                webView.load(URLRequest(url: url))
            }
        }
    }

    #if DEBUG
    /// 同一个编辑器地址换到本机跑着的网页服务（ci-store-server.sh），带上能看到种子页面的匿名设备 Cookie。
    /// 截图的 WebView 用 nonPersistent 数据存储，所以 Cookie 直接写进它自己的存储（replaceCookies 写的是默认存储）。
    private func loadFromEditorServer(_ url: URL, server: URL, run: Int) {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.scheme = server.scheme
        parts?.host = server.host
        parts?.port = server.port
        guard let webView, let target = parts?.url else { return }
        let store = webView.configuration.websiteDataStore.httpCookieStore
        let cookie = ScreenshotHooks.editorCookie.flatMap { value in
            HTTPCookie(properties: [.name: "notefable_device", .value: value, .domain: server.host ?? "localhost", .path: "/"])
        }
        Task { @MainActor [weak self] in
            if let cookie {
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    store.setCookie(cookie) {
                        done.resume()
                    }
                }
            }
            guard let self, self.loadRun == run, self.activeEditor != nil, let webView = self.webView else { return }
            webView.load(URLRequest(url: target))
        }
    }

    /// 在现在的网页里执行 [script]，结果是 true 才返回 true。
    func screenshotProbe(_ script: String) async -> Bool {
        guard let webView else { return false }
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }
    #endif

    /// WebView 的 Cookie 换成 App 的（匿名设备 Cookie、登录会话）：先清掉旧的，避免退出登录后网页还用旧身份。
    private static func replaceCookies(_ cookies: [HTTPCookie]) async {
        let store = dataStore
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            store.removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: Date.distantPast) {
                done.resume()
            }
        }
        let cookieStore = store.httpCookieStore
        for cookie in cookies {
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                cookieStore.setCookie(cookie) {
                    done.resume()
                }
            }
        }
    }

    // MARK: - NoteEditorBridge（对网页执行脚本）

    func flush(requestId: String) async -> Bool {
        guard let webView else { return false }
        let script = NoteEmbedScripts.flush(requestId)
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }

    func openPage(id: String, reveal: String?, model: String?, reasoning: String?) async -> Bool {
        guard let webView, let script = NoteEmbedScripts.openPage(id: id, reveal: reveal, model: model, reasoning: reasoning) else {
            return false
        }
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(script) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }

    func close() {
        run(NoteEmbedScripts.close)
    }

    func pageTrashed(_ ids: [String]) {
        guard let script = NoteEmbedScripts.pageTrashed(ids) else { return }
        run(script)
    }

    func openHistory() {
        run(NoteEmbedScripts.openHistory)
    }

    /// 这次加载以来在这个 WebView 里打开过这一篇（可能在网页的缓存里）。
    func hasOpened(_ pageId: String) -> Bool {
        openedPageIds.contains(pageId)
    }

    func pageUpdated(_ pageJson: String) {
        run(NoteEmbedScripts.pageUpdated(pageJson))
    }

    func pageSettings(_ pageJson: String) {
        run(NoteEmbedScripts.pageSettings(pageJson))
    }

    func appIcon(_ value: String?) {
        run(NoteEmbedScripts.appIcon(value))
    }

    func language(_ code: String) {
        run(NoteEmbedScripts.language(code))
    }

    func theme(_ value: String) {
        run(NoteEmbedScripts.theme(value))
    }

    func reveal(_ id: String) {
        run(NoteEmbedScripts.reveal(id))
    }

    func slides(_ command: String) {
        run(NoteEmbedScripts.slides(command))
    }

    func refreshBacklinks() {
        run(NoteEmbedScripts.refreshBacklinks)
    }

    func slidesWizardBack() async -> Bool {
        guard let webView else { return false }
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(NoteEmbedScripts.slidesWizardBack) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }

    func pptxImportBack() async -> Bool {
        guard let webView else { return false }
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(NoteEmbedScripts.pptxImportBack) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }

    func quizBack() async -> Bool {
        guard let webView else { return false }
        return await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            webView.evaluateJavaScript(NoteEmbedScripts.quizBack) { result, _ in
                answer.resume(returning: (result as? Bool) == true)
            }
        }
    }

    private func run(_ script: String) {
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - 返回

    /// Android 的返回键：WebView 能后退就后退（网页里打开的面板会往历史里推一条记录）；有打开的 <dialog>（版本历史等）
    /// 就关最上面一层；都没有才保存并回列表，和顶栏的“<”走同一条路（`NotesViewModel.closeNote`）。
    func goBack() {
        if router.drawerOpen { return }
        let notes = app.notes
        // 放映中：先结束放映（网页收到后发 presentation end，App 恢复竖屏和顶栏），不离开幻灯片。
        if notes.state.presenting {
            slides(#"{"action":"end"}"#)
            // 网页没有回应（加载失败等）时也结束放映，不把人困在横屏全屏里。
            Task { @MainActor [weak notes] in
                try? await Task.sleep(for: .milliseconds(1500))
                if notes?.state.presenting == true { notes?.presentationEnded() }
            }
            return
        }
        // AI 幻灯片向导开着：优先关向导最上面一层（草稿保留），不离开笔记、也不走 WebView 的后退。
        if let wizard = notes.state.slidesWizard {
            if wizard.shown {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if !(await self.slidesWizardBack()) {
                        self.app.notes.dismissSlidesWizard(wizard.request)
                    }
                }
            } else if activeEditor == Self.slidesWizardEditorId {
                notes.dismissSlidesWizard(wizard.request)
            }
            return
        }
        // PowerPoint 导入窗口开着：优先关导入窗口（导入中时中止并清理），不离开笔记、也不走 WebView 的后退。
        if let pptx = notes.state.pptxImport {
            if pptx.shown {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if !(await self.pptxImportBack()) {
                        self.app.notes.dismissPptxImport(pptx.request)
                    }
                }
            } else if activeEditor == Self.pptxImportEditorId {
                notes.dismissPptxImport(pptx.request)
            }
            return
        }
        // 复习和测验开着：先关举报弹窗再关测验窗口，不离开笔记。
        if let quiz = notes.state.reviewQuiz, quiz.shown {
            Task { @MainActor [weak self] in
                guard let self else { return }
                if !(await self.quizBack()) {
                    self.app.notes.dismissReviewQuiz(quiz.request)
                }
            }
            return
        }
        guard let webView else {
            notes.closeNote()
            return
        }
        if webView.canGoBack, webView.backForwardList.backList.count > historyFloor {
            webView.goBack()
            return
        }
        webView.evaluateJavaScript(NoteEmbedScripts.closeTopDialog) { result, _ in
            if (result as? Bool) != true { notes.closeNote() }
        }
    }

    @objc private func onEdgePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        guard recognizer.state == .ended, let view = recognizer.view else { return }
        let forward: CGFloat = recognizer.edges == .right ? -1 : 1
        let distance = recognizer.translation(in: view).x * forward
        let speed = recognizer.velocity(in: view).x * forward
        guard distance > 48 || speed > 500 else { return }
        // 晚一拍再看：同一次滑动如果打开了抽屉，就不再离开笔记。
        Task { @MainActor [weak self] in
            self?.goBack()
        }
    }

    // MARK: - 链接

    private func isSameSite(_ url: URL) -> Bool {
        Self.sameOrigin(url, URL(string: app.config.baseURL))
    }

    private static func sameOrigin(_ url: URL, _ base: URL?) -> Bool {
        guard let base else { return false }
        return url.scheme?.lowercased() == base.scheme?.lowercased()
            && url.host?.lowercased() == base.host?.lowercased()
            && url.port == base.port
    }

    /// 主框架要去 `url`：留在 WebView 里（true），还是已经交给别处处理（false）。
    private func staysInWebView(_ url: URL) -> Bool {
        let target = url.absoluteString
        let baseUrl = app.config.baseURL
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "about" { return true }
        if ScreenshotHooks.isActive {
            // 应用商店截图时编辑器来自本机的网页服务。
            return (scheme == "http" || scheme == "https")
                && (isSameSite(url) || Self.sameOrigin(url, ScreenshotHooks.editorServer))
                && url.path.contains("/note-embed")
        }
        guard scheme == "http" || scheme == "https" else {
            // mailto:、tel: 之类交给系统；blob:、data:、javascript: 系统打不开，也不让它换掉编辑器。
            if !["blob", "data", "javascript", "file"].contains(scheme) { openExternally(url) }
            return false
        }
        // 本站的笔记文件由 App 带着 Cookie 下载（系统浏览器没有 App 的 Cookie，只会拿到 404）。
        if NoteFileLinks.isNoteFile(target, baseUrl: baseUrl) {
            NoteFileDownloader.download(target, app: app, anchor: webView)
            return false
        }
        if isSameSite(url), url.path.contains("/note-embed") { return true }
        // 本站的聊天链接（保存的回答里写的 /c/…?message=…）：在 App 里打开，不交给浏览器。
        if let link = ChatLink.parse(target, baseUrl: baseUrl) {
            router.openLink(link)
            return false
        }
        openExternally(url)
        return false
    }

    /// 交给系统（浏览器、邮件、电话…）。单独一个同步函数：在 async 的代理方法里直接调 `open` 会选到它的 async 版本。
    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    /// 弹出网页的提示框。弹不出来（没有窗口、最上面的画面正在关 / 正在弹出）时马上按 `cancel` 回答；
    /// 弹出来了就记下来，离开编辑页时由 `teardown` 关掉并按 `cancel` 回答。
    private func show(_ alert: UIAlertController, cancel: @escaping () -> Void) {
        guard let presenter = NoteFileDownloader.topViewController(webView),
              presenter.viewIfLoaded?.window != nil,
              !presenter.isBeingDismissed, !presenter.isBeingPresented,
              self.webView != nil
        else {
            cancel()
            return
        }
        openDialog = (alert, cancel)
        presenter.present(alert, animated: true)
    }
}

/// 网页提示框的回答只给一次：按钮和 `teardown` 都可能来回答，后到的不再动续体。都在主线程上调用。
private final class DialogAnswer<Value> {
    private var continuation: CheckedContinuation<Value, Never>?

    init(_ continuation: CheckedContinuation<Value, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: Value) {
        continuation?.resume(returning: value)
        continuation = nil
    }
}

/// `WKUserContentController` 强引用它，它弱引用真正的处理者。
@MainActor
private final class NoteScriptMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var target: NoteEditorController?

    init(_ target: NoteEditorController) {
        self.target = target
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.receive(message)
    }
}

extension NoteEditorController {
    /// 网页发来的 JSON（`window.NoteFableNative.postMessage`）。只收主框架的。
    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.name == Self.handlerName, message.frameInfo.isMainFrame, let json = message.body as? String else { return }
        bridge.postMessage(json)
    }
}

// MARK: - UIGestureRecognizerDelegate

extension NoteEditorController: UIGestureRecognizerDelegate {
    /// 只有边缘返回手势用这个代理。别的手势（抽屉的横滑、网页自己的滚动和点按）等它失败了再开始：
    /// 触摸不是从屏幕边缘开始时它马上失败，所以平时没有影响；从边缘滑进来时只触发返回，不会同时把抽屉拉出来。
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

// MARK: - WKNavigationDelegate

extension NoteEditorController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        // 页面里的子框架（嵌入的视频等）照常加载。
        if let frame = navigationAction.targetFrame, !frame.isMainFrame { return .allow }
        guard let url = navigationAction.request.url else { return .cancel }
        return staysInWebView(url) ? .allow : .cancel
    }

    /// 网页按下载处理的响应（Content-Disposition: attachment，或 WebView 显示不了的类型）：本站的笔记文件由 App 下载，其它交给系统。
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        guard navigationResponse.isForMainFrame, let url = navigationResponse.response.url else { return .allow }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let attachment = disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment")
        guard attachment || !navigationResponse.canShowMIMEType else { return .allow }
        if NoteFileLinks.isNoteFile(url.absoluteString, baseUrl: app.config.baseURL) {
            NoteFileDownloader.download(url.absoluteString, app: app, anchor: webView)
        } else if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            openExternally(url)
        }
        return .cancel
    }

    /// 网页进程被系统杀掉或崩溃：正在看笔记时作废未完成的保存和导出并重载；停在后台热缓存里时直接销毁。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let editor = activeEditor else {
            onTerminatedWhileParked()
            return
        }
        slidesWizardVisible = false
        slidesWizardBusy = false
        pptxImportVisible = false
        quizVisible = false
        // 新的网页进程里没有在做的幻灯片（加载后也会发空的）。
        app.notes.onSlidesJobs([])
        if editor == Self.slidesWizardEditorId {
            isLoaded = false
            showEpoch += 1
            openTask?.cancel()
            openTask = nil
            bridge.release(self)
            bridge.attach(self)
            openedPageIds = []
            loadWizard()
            onProcessRestarted()
            return
        }
        if editor == Self.pptxImportEditorId {
            isLoaded = false
            showEpoch += 1
            openTask?.cancel()
            openTask = nil
            bridge.release(self)
            bridge.attach(self)
            openedPageIds = []
            loadPptxImport()
            onProcessRestarted()
            return
        }
        // 拼了一半的导出文件不会再来了（新网页不知道它）：作废，不留下打开着的临时文件。
        app.notes.cancelExportTransfer(editor: editor)
        // 放映中的网页没了：先结束放映，重新加载失败也不会困在横屏全屏里。
        app.notes.presentationEnded()
        crashedEditor = editor
        isLoaded = false
        showEpoch += 1
        openTask?.cancel()
        openTask = nil
        bridge.release(self)
        bridge.attach(self)
        let pageId = (app.notes.state.open?.editor == editor ? app.notes.state.open?.id : nil) ?? currentPageId ?? editor
        awaitingPageId = pageId
        // 新的网页进程从头加载：之前缓存的页面都没了，只剩这一篇。
        openedPageIds = [pageId]
        loadPage(pageId: pageId, reveal: nil)
        onProcessRestarted()
    }
}

// MARK: - WKUIDelegate

extension NoteEditorController: WKUIDelegate {
    /// 不开新窗口（Android setSupportMultipleWindows(false)）：`window.open` / target=_blank 的地址按同一套规则处理。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url, staysInWebView(url) {
            webView.load(navigationAction.request)
        }
        return nil
    }

    // 网页的 alert / confirm / prompt（冲突时“放弃草稿并读取最新版本？”用的是 window.confirm）：用系统的提示框。
    // 弹不出来（没有窗口）或离开编辑页时按“取消”回答。

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let answer = DialogAnswer(done)
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: L("done"), style: .default) { _ in answer.resume(()) })
            show(alert) { answer.resume(()) }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let answer = DialogAnswer(continuation)
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: L("cancel"), style: .cancel) { _ in answer.resume(false) })
            alert.addAction(UIAlertAction(title: L("done"), style: .default) { _ in answer.resume(true) })
            show(alert) { answer.resume(false) }
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo
    ) async -> String? {
        await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
            let answer = DialogAnswer(continuation)
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { field in field.text = defaultText }
            alert.addAction(UIAlertAction(title: L("cancel"), style: .cancel) { _ in answer.resume(nil) })
            alert.addAction(UIAlertAction(title: L("done"), style: .default) { [weak alert] _ in
                answer.resume(alert?.textFields?.first?.text ?? "")
            })
            show(alert) { answer.resume(nil) }
        }
    }
}
