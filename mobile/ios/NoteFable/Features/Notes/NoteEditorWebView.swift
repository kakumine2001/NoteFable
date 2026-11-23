import SwiftUI
import UIKit
import WebKit

// 笔记编辑页里的网页编辑器（Android ui/NoteEditor.kt 的 WebView 部分）：WKWebView 打开 `<baseUrl>/note-embed?page=…&lang=…&model=…&reasoning=…&theme=…`，
// 和原生之间走 JS 桥（Core 的 NoteEmbedBridge / NoteEmbedScripts，约定见 src/lib/native-bridge.ts）。规则见 docs/architecture/android-native.md 的“笔记”：
// - 加载前先清空 WebView 的 Cookie，再把 App 的 Cookie 拷进去：身份和 API 相同，退出登录后网页也不会沿用旧会话。
// - 只有本站的 /note-embed 在 WebView 里打开；本站的聊天链接在 App 里打开；笔记文件由 App 带着 Cookie 下载；其它链接交给系统浏览器。
// - 网页进程被系统杀掉或崩溃时重新加载，没保存的编辑由网页的本地草稿恢复。
// - 图片 / 文件块的“上传”（<input type="file">）WKWebView 自己会弹系统的选择器，不用另接。
// - 外观：把 App 现在显示的外观（light / dark，已经按“跟随系统”算好）经地址的 theme=、`NoteFableNative.theme()` 交给网页，
//   开着的时候变了再用 `notefableEmbed.theme(value)` 推一次。不传 system：网页自己再去问系统的话，结果要看 WKWebView 的
//   prefers-color-scheme 跟不跟窗口的外观覆盖，传算好的值就和 App 的界面一定一致。WebView 自己不画底（透明），
//   网页画出来之前露出的是编辑页的底色，深色下不会先白一下。

/// 网页编辑器。按 `OpenNote.editor` 建一个（外面用 `.id(open.editor)`）：冲突后“另存为新笔记”换到副本时不重新加载。
/// `appIcon` / `language` / `theme` 是设置里现在的图标、界面语言和 App 显示着的外观（light / dark），开着的时候变了就推给网页。
@MainActor
struct NoteEditorWebView: UIViewRepresentable {
    let editor: String
    let app: AppEnvironment
    let router: AppRouter
    let appIcon: String?
    let language: String
    let theme: String

    func makeCoordinator() -> NoteEditorController {
        NoteEditorController(editor: editor, app: app, router: router)
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeWebView(appIcon: appIcon, language: language, theme: theme)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.sync(appIcon: appIcon, language: language, theme: theme)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: NoteEditorController) {
        coordinator.teardown()
    }
}

/// 一个编辑器的 WKWebView 和它的桥。出现时建 WebView、`bridge.attach` 并登记到 `AppEnvironment.registerEditor`
/// （离开笔记前经它保存）；离开界面时 `release` 并注销。
@MainActor
final class NoteEditorController: NSObject, NoteEditorBridge {
    /// `window.webkit.messageHandlers.<名字>`：网页的 `window.NoteFableNative.postMessage` 经它转过来。
    private static let handlerName = "notefableNative"

    /// 所有编辑器共用 App 的默认（落盘的）数据存储：Cookie 每次加载前换成 App 的；网页的本地草稿（localStorage）
    /// 和 Android 的 WebView 一样跨 App 重启保留，离开笔记再回来、网页进程崩溃、App 被系统杀掉后重新打开都还能恢复。
    private static let dataStore = WKWebsiteDataStore.default()
    /// 所有编辑器的换 Cookie 排成一条链，一次只换一个：旧的加载既不会清掉新加载刚放进去的 Cookie，也不会把上一个身份的 Cookie 放回去。
    private static var cookieChain: Task<Void, Never>?

    private let editor: String
    private let app: AppEnvironment
    private let router: AppRouter
    private let bridge: NoteEmbedBridge

    private var webView: WKWebView?
    /// 每开始一次加载（或销毁）加一：等 Cookie 期间又开始了新的加载时，旧的不再继续。
    private var loadRun = 0
    private var pushedIcon: String?
    private var pushedLanguage = ""
    /// 交给网页的外观（light / dark）；重新加载时地址和 `NoteFableNative.theme()` 用它。
    private var pushedTheme = ""
    private var edgePan: UIScreenEdgePanGestureRecognizer?
    /// 正在显示的网页提示框（alert / confirm / prompt）和按“取消”回答它的办法：离开编辑页时关掉，网页不会一直等着。
    private var openDialog: (alert: UIAlertController, cancel: () -> Void)?

    init(editor: String, app: AppEnvironment, router: AppRouter) {
        self.editor = editor
        self.app = app
        self.router = router
        let notes = app.notes
        // 消息按编辑器转发，不按页面 id：换到副本后由 ViewModel 跟过去。
        self.bridge = NoteEmbedBridge(onMessage: { message in
            notes.onEditorMessage(editor, message)
        })
        super.init()
        // 幻灯片导出的文件：收齐后用系统的“存储到文件”让用户选位置（Android 是 SAF 的 CreateDocument）。
        bridge.onFileReady = { [weak self] ready in self?.saveExport(ready) }
    }

    /// 导出的文件交给系统的“存储到文件”（拷贝过去，临时文件随后删掉）。
    private func saveExport(_ ready: ExportFileAssembler.Ready) {
        guard let presenter = webView?.window?.rootViewController.map(Self.topmost) else {
            try? FileManager.default.removeItem(at: ready.url.deletingLastPathComponent())
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [ready.url], asCopy: true)
        picker.delegate = ExportPickerCleanup.shared
        ExportPickerCleanup.shared.track(picker, folder: ready.url.deletingLastPathComponent())
        presenter.present(picker, animated: true)
    }

    private static func topmost(_ controller: UIViewController) -> UIViewController {
        var top = controller
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    // MARK: - 建立和销毁

    func makeWebView(appIcon: String?, language: String, theme: String) -> WKWebView {
        pushedIcon = appIcon
        pushedLanguage = language
        pushedTheme = theme
        // 网页读好（ready）时桥会再推一次。
        bridge.pushTheme(theme)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = Self.dataStore
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
        let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(onEdgePan(_:)))
        edgePan.edges = app.language.isRightToLeft ? .right : .left
        edgePan.delegate = self
        webView.addGestureRecognizer(edgePan)
        webView.scrollView.panGestureRecognizer.require(toFail: edgePan)
        self.edgePan = edgePan

        self.webView = webView
        bridge.attach(self)
        app.registerEditor(bridge)
        loadPage()
        return webView
    }

    /// 设置里换了图标 / 界面语言 / 外观（或跟随系统时系统切了深浅）：推给网页（就地换，不重新加载笔记）。
    func sync(appIcon: String?, language: String, theme: String) {
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

    /// 离开编辑页：等着网页回答的保存都算失败，注销桥，停掉网页。
    func teardown() {
        loadRun += 1
        if let dialog = openDialog {
            openDialog = nil
            if dialog.alert.presentingViewController != nil { dialog.alert.dismiss(animated: false) }
            dialog.cancel()
        }
        bridge.release(self)
        // 直接从一篇换到另一篇时，新编辑器可能已经登记了：只注销自己的。
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
    }

    // MARK: - 加载

    /// 现在该打开的地址。换到副本后（`OpenNote.id` 变了、`editor` 没变）重新加载用副本的地址。
    /// model / reasoning 是聊天里选的模型和推理强度（模型列表读到之后才有），编辑器里的 AI 助手用它们。
    private func embedURL() -> URL? {
        var pageId = editor
        if let open = app.notes.state.open, open.editor == editor { pageId = open.id }
        let chat = app.chat.state
        let address = app.api.noteEmbedUrl(
            pageId: pageId, lang: app.language.uiLocale, model: chat.selectedModel?.id, reasoning: chat.selectedReasoning,
            theme: pushedTheme.isEmpty ? nil : pushedTheme
        )
        return URL(string: address)
    }

    /// 换 Cookie、装好 `window.NoteFableNative`，再打开网页。
    private func loadPage() {
        guard let webView, let url = embedURL() else { return }
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

        // 排在前面的换 Cookie 做完再轮到这次；轮到时这次已经被新的加载或离开页面取代就什么都不做。
        // App 的 Cookie 在真正换的那一刻读，不用开始加载时的旧值（中间可能登录 / 退出了）。
        let previous = Self.cookieChain
        Self.cookieChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.loadRun == current, self.webView != nil else { return }
            let identity = self.app.identityGeneration
            let cookies = URL(string: self.app.config.baseURL).map { self.app.cookies(for: $0) } ?? []
            await NoteEditorController.replaceCookies(cookies)
            // 换 Cookie 的途中换了身份：这页属于上一个身份（界面要到下一次重绘才收掉它），不带着旧 Cookie 去加载。
            guard self.loadRun == current, self.app.identityGeneration == identity, let webView = self.webView else { return }
            webView.load(URLRequest(url: url))
        }
    }

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

    func openHistory() {
        run(NoteEmbedScripts.openHistory)
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

    func slides(_ command: String) {
        run(NoteEmbedScripts.slides(command))
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
            return
        }
        guard let webView else {
            notes.closeNote()
            return
        }
        if webView.canGoBack {
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
        guard let base = URL(string: app.config.baseURL) else { return false }
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

    /// 网页进程被系统杀掉或崩溃：等着它回答的保存都算失败（Android bridge.release），再重新加载。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        bridge.release(self)
        bridge.attach(self)
        loadPage()
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
