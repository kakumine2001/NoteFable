import Foundation

// 原生和网页编辑器（/note-embed）之间的 JS 桥（Android ui/NoteEditor.kt 的 NoteEmbedBridge）。约定见 src/lib/native-bridge.ts：
// 网页 → 原生：`window.NoteFableNative.postMessage(json)`；原生 → 网页：`window.notefableEmbed.flush(id)` / `openHistory()` /
// `pageUpdated(pageJson)` / `pageSettings(pageJson)` / `appIcon(value)` / `language(code)` / `theme(value)` / `reveal(id)`。
// WKWebView 本身在界面层，经 [NoteEditorBridge] 和这里说话；这里管消息的分发和"保存后再离开"的等待。

/// 界面层的编辑器（WKWebView 的包装）要实现的几个调用，都是对网页执行一段脚本（[NoteEmbedScripts]）。
@MainActor
protocol NoteEditorBridge: AnyObject {
    /// 执行 [NoteEmbedScripts.flush]，返回脚本的结果：true = 编辑器已挂上、保存已开始（结果随 flushed 消息回来）；
    /// false = 网页还没挂上编辑器（没加载完、加载失败）。执行出错也返回 false。
    func flush(requestId: String) async -> Bool
    func openHistory()
    func pageUpdated(_ pageJson: String)
    func pageSettings(_ pageJson: String)
    func appIcon(_ value: String?)
    func language(_ code: String)
    func theme(_ value: String)
    /// 执行 [NoteEmbedScripts.reveal]：在开着的页面里定位到检索命中的块 / 元素，不重新加载。
    func reveal(_ id: String)
    /// 幻灯片的操作（"…"菜单的放映 / 导出、放映中的返回）：交给网页（`window.notefableEmbed.slides`）。
    func slides(_ command: String)
    /// 在常驻 WebView 里就地切到另一篇页面（`window.notefableEmbed.openPage`）；返回 false 表示旧版服务端或尚未挂好，由界面回退到整页加载。
    func openPage(id: String, reveal: String?, model: String?, reasoning: String?) async -> Bool
    /// 离开笔记回到列表 / 聊天时卸载编辑器 DOM，保留轻量缓存（`window.notefableEmbed.close`）。
    func close()
    /// 移进回收站的页面从常驻 WebView 缓存里清掉（`window.notefableEmbed.pageTrashed`）。
    func pageTrashed(_ ids: [String])
    /// 抽屉或回收站里改了页面、聊天（改名、换图标、删除、复原）：让网页重读笔记下方的反向链接（`window.notefableEmbed.refreshBacklinks`）。
    func refreshBacklinks()
    /// AI 生成幻灯片向导开着时的「返回」：关闭向导最上面一层（先选笔记层，其次向导，草稿保留）；没有可关的返回 false。
    func slidesWizardBack() async -> Bool
}

extension NoteEditorBridge {
    func openPage(id: String, reveal: String?, model: String?, reasoning: String?) async -> Bool { false }
    func close() {}
    func pageTrashed(_ ids: [String]) {}
    func refreshBacklinks() {}
    func slidesWizardBack() async -> Bool { false }
}

/// 对网页执行的脚本。和 Android 端逐字相同，网页那边没有对应函数时什么都不做。
enum NoteEmbedScripts {
    /// JS 字符串字面量（org.json 的 JSONObject.quote）：引号、反斜杠、控制字符转义，`</` 写成 `<\/`。
    static func quote(_ text: String) -> String {
        var out = "\""
        var previous: Unicode.Scalar?
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "/": out += previous == "<" ? "\\/" : "/"
            case "\u{08}": out += "\\b"
            case "\t": out += "\\t"
            case "\n": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\r": out += "\\r"
            default:
                // 控制字符和 U+2028 / U+2029（旧的 JS 引擎里它们会断开字符串字面量）写成 \uXXXX。
                if scalar.value < 0x20 || (0x80..<0xA0).contains(scalar.value) || (0x2000..<0x2100).contains(scalar.value) {
                    let hex = String(scalar.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
            previous = scalar
        }
        return out + "\""
    }

    /// 让网页立刻保存；编辑器挂上了返回 true。
    static func flush(_ requestId: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.flush==='function'){e.flush(\(quote(requestId)));return true}return false})()"
    }

    static let openHistory = "(function(){var e=window.notefableEmbed;if(e&&typeof e.openHistory==='function')e.openHistory()})()"

    /// 页面 JSON 作为字符串字面量传过去，网页里再 JSON.parse。
    static func pageUpdated(_ pageJson: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageUpdated==='function')e.pageUpdated(\(quote(pageJson)))})()"
    }

    static func pageSettings(_ pageJson: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageSettings==='function')e.pageSettings(\(quote(pageJson)))})()"
    }

    /// 图标作为字符串字面量传过去；默认标志传 null。
    static func appIcon(_ icon: String?) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.appIcon==='function')e.appIcon(\(icon.map(quote) ?? "null"))})()"
    }

    /// 就地换字典，不重新加载笔记、草稿和 AI 的流。
    static func language(_ code: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.language==='function')e.language(\(quote(code)))})()"
    }

    /// 换外观（light / dark）：网页就地换 data-theme，不重新加载笔记（src/lib/native-bridge.ts 的 theme）。
    static func theme(_ value: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.theme==='function')e.theme(\(quote(value)))})()"
    }

    /// 在开着的页面里滚到检索命中的块（笔记）、移到命中的元素（白板），和地址的 `reveal=` 一样（src/lib/native-bridge.ts 的 reveal）。
    /// 已经开着的页面又从检索结果打开时用，不重新加载。id 不是 `[A-Za-z0-9_-]{1,120}` 的样子时网页什么也不做。
    static func reveal(_ id: String) -> String {
        "window.notefableEmbed&&window.notefableEmbed.reveal&&window.notefableEmbed.reveal(\(quote(id)))"
    }

    /// 让网页重读反向链接（旧版网页没有这个函数时什么都不做）。
    static let refreshBacklinks = "(function(){var e=window.notefableEmbed;if(e&&typeof e.refreshBacklinks==='function')e.refreshBacklinks()})()"

    /// 幻灯片的操作（JSON：{ action: "present" | "end" | "export", format? }）。
    static func slides(_ command: String) -> String {
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.slides==='function')e.slides(\(quote(command)))})()"
    }

    /// 网页只认 `[A-Za-z0-9_-]{1,120}` 的页面 / 块 / 元素 id（src/lib/native-bridge.ts 的 REVEAL_TARGET）。
    private static func isValidTargetId(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 120 else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 0x30 && scalar.value <= 0x39)
                || (scalar.value >= 0x41 && scalar.value <= 0x5A)
                || (scalar.value >= 0x61 && scalar.value <= 0x7A)
                || scalar == "_" || scalar == "-"
        }
    }

    /// 离开笔记但保留热缓存：卸载编辑器 DOM，返回 true 表示网页已处理。
    static let close =
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.close==='function')return e.close()===true;return false})()"

    /// 在常驻 WebView 里就地切页（window.notefableEmbed.openPage）；id 不合法返回 nil。
    static func openPage(id: String, reveal: String? = nil, model: String? = nil, reasoning: String? = nil) -> String? {
        guard isValidTargetId(id) else { return nil }
        var fields = ["\"id\":\(quote(id))"]
        if let reveal, isValidTargetId(reveal) {
            fields.append("\"reveal\":\(quote(reveal))")
        }
        if let model = model?.trimmingCharacters(in: .whitespacesAndNewlines), !model.isEmpty {
            fields.append("\"model\":\(quote(model))")
        }
        if let reasoning = reasoning?.trimmingCharacters(in: .whitespacesAndNewlines), !reasoning.isEmpty {
            fields.append("\"reasoning\":\(quote(reasoning))")
        }
        return "(function(){var e=window.notefableEmbed;if(e&&typeof e.openPage==='function')return e.openPage({\(fields.joined(separator: ","))})===true;return false})()"
    }

    /// 把移进回收站的页面 id 通知常驻 WebView 清理缓存（window.notefableEmbed.pageTrashed）。
    static func pageTrashed(_ ids: [String]) -> String? {
        let valid = ids.filter(isValidTargetId)
        guard !valid.isEmpty else { return nil }
        return "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageTrashed==='function')return e.pageTrashed([\(valid.map(quote).joined(separator: ","))])===true;return false})()"
    }

    /// 打开 AI 生成幻灯片向导的脚本（`window.notefableEmbed.slidesWizard`）。结果是 `"open"`（出来了）、`"loading"`（网页还没挂好，
    /// 过一会儿再问）、`"unsupported"`（旧服务端没有向导）或 `"rejected"`。[source] 里有网页不认的 id 时返回 nil。
    static func slidesWizardOpen(source: SlidesWizardSource, model: String? = nil, reasoning: String? = nil) -> String? {
        var sourceFields: [String] = []
        switch source {
        case .new(let groupId, let parentId):
            sourceFields.append("\"type\":\"new\"")
            if let groupId {
                guard isValidTargetId(groupId) else { return nil }
                sourceFields.append("\"groupId\":\(quote(groupId))")
            }
            if let parentId {
                guard isValidTargetId(parentId) else { return nil }
                sourceFields.append("\"parentId\":\(quote(parentId))")
            }
        case .note(let pageId):
            guard isValidTargetId(pageId) else { return nil }
            sourceFields.append("\"type\":\"note\"")
            sourceFields.append("\"pageId\":\(quote(pageId))")
        case .chat(let sessionId):
            guard isValidTargetId(sessionId) else { return nil }
            sourceFields.append("\"type\":\"chat\"")
            sourceFields.append("\"sessionId\":\(quote(sessionId))")
        }
        var requestFields = [
            "\"action\":\"open\"",
            "\"source\":{\(sourceFields.joined(separator: ","))}",
        ]
        if let model = model?.trimmingCharacters(in: .whitespacesAndNewlines), !model.isEmpty {
            requestFields.append("\"model\":\(quote(model))")
        }
        if let reasoning = reasoning?.trimmingCharacters(in: .whitespacesAndNewlines), !reasoning.isEmpty {
            requestFields.append("\"reasoning\":\(quote(reasoning))")
        }
        return "(function(){var e=window.notefableEmbed;if(!e)return 'loading';if(typeof e.slidesWizard!=='function')return 'unsupported';"
            + "return e.slidesWizard({\(requestFields.joined(separator: ","))})===true?'open':'rejected'})()"
    }

    /// [slidesWizardOpen] 的执行结果（WKWebView 直接返回字符串）：true 打开了，false 打不开，nil 还要再问。
    static func slidesWizardAnswer(_ result: String?) -> Bool? {
        switch result {
        case "open": return true
        case "unsupported", "rejected": return false
        default: return nil
        }
    }

    /// 向导开着时的「返回」：关闭最上面一层（先选笔记层，其次向导，草稿保留）；没有可关的返回 false。
    static let slidesWizardBack =
        "(function(){var e=window.notefableEmbed;if(e&&typeof e.slidesWizard==='function')return e.slidesWizard({\"action\":\"back\"})===true;return false})()"

    /// 返回手势先交给网页：有打开的 <dialog>（版本历史等）就发 cancel 事件关最上面一层（等同网页里按 Esc），返回 true。
    static let closeTopDialog =
        "(function(){var d=document.querySelectorAll('dialog[open]');if(!d.length)return false;" +
        "d[d.length-1].dispatchEvent(new Event('cancel',{cancelable:true}));return true})()"

    /// 页面开始加载前注入（WKUserScript，document start，只进主框架）：WKWebView 没有 Android 的 @JavascriptInterface，
    /// 这里把 `window.NoteFableNative` 定义成转发给 `window.webkit.messageHandlers.<handler>` 的对象。
    /// `appIcon()` / `language()` / `theme()` 要同步返回，所以值写死在脚本里：每次加载前用当时的值重新生成这段脚本；
    /// 开着的时候换了图标 / 语言 / 外观走 [appIcon] / [language] / [theme] 推过去。默认标志是空字符串。
    /// [theme] 是 App 现在显示的外观（light / dark）；nil 时不定义 `theme()`，网页按地址里的 theme= 或自己存的值。
    /// `canOpenPage()` 告诉网页这个 App 会处理 `openPage`（旧版没有，网页照旧用新窗口打开链接）；
    /// `canShowStorageLimit()` 告诉网页这个 App 会显示"存储空间不够"（`storageLimit`；旧版没有，网页在编辑器里只说明原因）；
    /// `canShowUsageLimit()` 告诉网页这个 App 会处理使用次数上限（`usageLimit`；旧版没有，网页在 WebView 里只说明原因）；
    /// `canSaveFile()` 告诉网页这个 App 会收导出的文件（`fileStart` … `fileEnd`；旧版没有，网页提示先更新 App）；
    /// `canOpenChat()` 告诉网页这个 App 会处理 `openChat`（笔记下方反向链接里的聊天；旧版没有，网页不列聊天）；
    /// `canShowSlidesWizard()` 告诉网页这个 App 会处理 AI 生成幻灯片的向导（`slidesWizard`；旧版没有，AI 面板不显示「生成幻灯片」）。
    static func bootstrap(handler: String, appIcon: String?, language: String, theme: String? = nil) -> String {
        "(function(){var icon=\(quote(appIcon ?? "")),lang=\(quote(language));window.NoteFableNative={" +
            "postMessage:function(json){window.webkit.messageHandlers[\(quote(handler))].postMessage(String(json))}," +
            "appIcon:function(){return icon},language:function(){return lang},canOpenPage:function(){return true}," +
            "canShowStorageLimit:function(){return true},canShowUsageLimit:function(){return true},canPresent:function(){return true},canSaveFile:function(){return true}," +
            "canOpenChat:function(){return true},canShowSlidesWizard:function(){return true}" +
            (theme.map { ",theme:function(){return \(quote($0))}" } ?? "") +
            "}})()"
    }
}

/// 一个编辑器（[OpenNote.editor]）的桥：收网页发来的消息，让网页保存并等结果。界面在编辑器打开时建一个，
/// WebView 建好后 [attach]，销毁（离开编辑页、网页进程崩溃）时 [release]。
@MainActor
final class NoteEmbedBridge {
    /// 整个保存（包括执行脚本本身）超过这么久没结果就算失败。
    nonisolated static let FLUSH_TIMEOUT: Duration = .seconds(15)

    private(set) weak var editor: NoteEditorBridge?
    /// App 现在显示的外观（light / dark），由界面用 [pushTheme] 给；还没给过是 nil。
    private(set) var theme: String?
    private var pending: [String: NoteDeferred<FlushResult>] = [:]

    private let currentLanguage: @MainActor () -> String
    private let sleep: @Sendable (Duration) async throws -> Void
    private let makeRequestId: @MainActor () -> String
    private let onMessage: @MainActor (EmbedMessage) -> Void

    /// [onMessage] 收 flushed 以外的消息（交给 `NotesViewModel.onEditorMessage(open.editor, …)`）。
    /// [sleep] 只用来给保存计时，测试里换成不真等的。
    init(
        currentLanguage: @escaping @MainActor () -> String = { AppLanguage.uiLocale },
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        makeRequestId: @escaping @MainActor () -> String = { UUID().uuidString },
        onMessage: @escaping @MainActor (EmbedMessage) -> Void
    ) {
        self.currentLanguage = currentLanguage
        self.sleep = sleep
        self.makeRequestId = makeRequestId
        self.onMessage = onMessage
    }

    func attach(_ editor: NoteEditorBridge) {
        self.editor = editor
    }

    /// WebView 被销毁（离开编辑页、网页进程崩溃）：等着它回答的保存都算失败，不再等。
    func release(_ editor: NoteEditorBridge) {
        guard self.editor === editor else { return }
        self.editor = nil
        for answer in pending.values { answer.complete(FlushResult(false)) }
    }

    /// 网页发来的 JSON（`window.NoteFableNative.postMessage`）。不认识的消息忽略。
    func postMessage(_ json: String) {
        guard let message = EmbedMessage.parse(json) else { return }
        if case .flushed(let requestId, let ok, let kept) = message {
            pending.removeValue(forKey: requestId)?.complete(FlushResult(ok, draftKept: kept))
            return
        }
        // 页面读好时再对一次语言：网页读初始 HTML 期间 App 的语言可能换过。
        if case .ready = message {
            pushLanguage(currentLanguage())
            // 外观同理：加载期间在设置里换过、或系统刚好切了深色。
            if let theme { editor?.theme(theme) }
        }
        onMessage(message)
    }

    /// 让网页立刻保存。ok 表示没有未保存的内容。
    /// 编辑器还没挂上（页面没加载完、加载失败）时没有可保存的编辑，直接算成功；
    /// 整个过程 15 秒没结果、或者 WebView 中途被销毁，都算失败。
    func flush() async -> FlushResult {
        guard let view = editor else { return FlushResult(true) }
        let id = makeRequestId()
        let answer = NoteDeferred<FlushResult>()
        pending[id] = answer
        let timer = Task { [sleep] in
            do {
                try await sleep(Self.FLUSH_TIMEOUT)
            } catch {
                return
            }
            answer.complete(FlushResult(false))
        }
        let script = Task {
            // 没挂上：WebView 还在就是没有可保存的编辑；已经换掉 / 销毁了算失败。
            if !(await view.flush(requestId: id)) { answer.complete(FlushResult(editor === view)) }
        }
        defer {
            timer.cancel()
            script.cancel()
            pending[id] = nil
        }
        return await answer.wait()
    }

    func openHistory() {
        editor?.openHistory()
    }

    func slides(_ command: String) {
        editor?.slides(command)
    }

    /// 抽屉、回收站里的改动：让开着的笔记重读反向链接。
    func refreshBacklinks() {
        editor?.refreshBacklinks()
    }

    /// 别处（聊天里的提案）改了这篇笔记：把服务端返回的新版本交给网页，走网页 notefable:page-updated 的同一条路
    /// （没有未保存的编辑就换成新版本，有就提示冲突），否则编辑器还拿着旧版本，下次保存会 409。
    func pageUpdated(_ pageJson: String) {
        editor?.pageUpdated(pageJson)
    }

    /// 原生"…"菜单改了字体、小字号、全宽、锁定或收藏：把服务端返回的一览项交给网页（window.notefableEmbed.pageSettings）。
    func pageSettings(_ pageJson: String) {
        editor?.pageSettings(pageJson)
    }

    func pageSettings(_ page: NotePageSummary) {
        pageSettings(NoteFableJson.encodeToString(page))
    }

    /// 编辑器开着时在设置里换了图标：交给网页（`window.notefableEmbed.appIcon`），AI 按钮马上跟着变。
    func pushAppIcon(_ icon: String?) {
        editor?.appIcon(icon)
    }

    /// 换界面语言：就地换字典，不重新加载笔记。
    func pushLanguage(_ code: String) {
        editor?.language(code)
    }

    /// 检索结果在开着的这一页里：就地定位到命中的块 / 元素（网页还没挂上编辑器时什么也不做）。
    func reveal(_ id: String) {
        editor?.reveal(id)
    }

    /// App 显示的外观变了（设置里换了，或跟随系统时系统切了深浅）：记下来并推给网页，就地换色。
    /// 传的是已经算好的 light / dark，不传 system：网页编辑器和 App 的界面总是同一个外观。
    func pushTheme(_ value: String) {
        theme = value
        editor?.theme(value)
    }

    /// 在常驻 WebView 里就地切到另一篇笔记（返回 false 表示旧版服务端或尚未挂好，由界面回退整页加载）。
    func openPage(id: String, reveal: String? = nil, model: String? = nil, reasoning: String? = nil) async -> Bool {
        await editor?.openPage(id: id, reveal: reveal, model: model, reasoning: reasoning) ?? false
    }

    /// 离开笔记但保留热缓存：卸载编辑器 DOM。
    func close() {
        editor?.close()
    }

    /// 页面移进回收站：从热缓存里清掉。
    func pageTrashed(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        editor?.pageTrashed(ids)
    }

    /// 向导开着时的「返回」：关最上面一层（草稿保留）；没有可关的返回 false。
    func slidesWizardBack() async -> Bool {
        await editor?.slidesWizardBack() ?? false
    }
}

extension NotesViewModel {
    /// 编辑器打开 / 关掉时由界面调用（Android NoteEditorScreen 的 registerFlush）：离开笔记前经这个桥保存，
    /// 显示设置、收藏的改动和开着的这一页里的检索定位也经它交给网页。传 nil 是编辑器关掉了。
    func registerEditor(_ bridge: NoteEmbedBridge?) {
        guard let bridge else {
            flushEditor = nil
            pushPageSettings = nil
            revealInEditor = nil
            sendSlidesCommand = nil
            refreshBacklinks = nil
            presentationEnded()
            return
        }
        flushEditor = { await bridge.flush() }
        pushPageSettings = { bridge.pageSettings($0) }
        revealInEditor = { bridge.reveal($0) }
        sendSlidesCommand = { bridge.slides($0) }
        refreshBacklinks = { bridge.refreshBacklinks() }
    }
}
