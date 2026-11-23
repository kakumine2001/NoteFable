import Foundation

// 回答前的过程（推理摘要、联网搜索、笔记工具、项目上下文）与 AI 对页面（笔记、白板、幻灯片）的提案。
// 移植自网页 src/lib/chat-activity.ts（Android data/Activity.kt）：applyActivityEvent 的合并规则、parseStoredActivity 的校验、
// splitThought、hostOf，单元测试（ActivityTests）与 src/lib/chat-activity.test.ts、Android 的 ActivityTest 逐条对应。三边一起改。

/// 联网搜索的一步做了什么。
enum WebAction: Equatable, Sendable {
    case search(queries: [String], sources: [String])
    case openPage(url: String)
    case findInPage(url: String, pattern: String)
}

/// 回答用到的项目参考笔记（只有出处，没有正文）。
struct ContextNote: Equatable, Sendable {
    let id: String
    let title: String
    var truncated: Bool = false
}

struct ContextInfo: Equatable, Sendable {
    let projectName: String
    let hasInstructions: Bool
    let notes: [ContextNote]
}

/// 提案里一处改动的操作（网页 src/lib/page-ai/types.ts 的 ProposalOp）。笔记只用前三种，白板、幻灯片还用后四种。
enum ProposalOp: String, CaseIterable, Sendable {
    case replace
    case insertAfter = "insert_after"
    case delete
    case add
    case update
    case move
    case reorder

    /// 不认识的操作（以后的服务端加的）按 update 显示。
    static func of(_ value: String) -> ProposalOp {
        ProposalOp(rawValue: value) ?? .update
    }
}

/// 改动的对象（types.ts 的 ProposalTarget）：笔记用块编号（[ProposalChange.block]），没有它；
/// 幻灯片是第几张（从 1 起），白板是元素（只有一个时 [name] 是它的文字，几个时只有个数）。
enum ProposalChangeTarget: Equatable, Sendable {
    case slide(number: Int)
    case elements(count: Int, name: String? = nil)
}

/// 提案里的一处改动（types.ts 的 ProposalChange，服务端各页面类型的适配器做好的形状，卡片照着显示，不分类型）。
struct ProposalChange: Equatable, Sendable {
    let op: ProposalOp
    /// 笔记 read_note 里看到的块编号；0 表示插在开头。别的类型总是 0。
    let block: Int
    var target: ProposalChangeTarget? = nil
    /// 改前、改后的文字（笔记是 Markdown，别的类型是读得出的文字）。插入、添加没有改前，删除没有改后。
    var before: String? = nil
    var after: String? = nil
    /// 改前、改后的缩略图（白板、幻灯片）：本站的相对地址 `/api/proposals/:id/image?change=n&side=…`，要带 App 的 Cookie 读。
    var beforeImage: String? = nil
    var afterImage: String? = nil
    var dropsFormatting: Bool = false
    var dropsMedia: Bool = false
}

/// AI 对页面的提案：编辑已有页面或新建页面（笔记、白板、幻灯片同一个形状）。`status` 只有服务端保存过的提案才有。
enum Proposal: Equatable, Identifiable, Sendable {
    case edit(Edit)
    case create(Create)

    struct Edit: Equatable, Sendable {
        let id: String
        let pageId: String
        let pageTitle: String
        let baseVersion: Int
        var titleBefore: String? = nil
        var titleAfter: String? = nil
        var changes: [ProposalChange] = []
        /// `pending` / `applied` / `discarded` / `undone`。
        var status: String? = nil
        var appliedPageId: String? = nil
        /// 要改的页面的类型（旧服务端不给：笔记）。
        var pageKind: PageKind = .note
        /// 页面 AI 面板开着"自动应用"：没经确认就应用了。
        var autoApplied: Bool = false
        /// 服务端说能撤销（已应用、记着应用时的版本）。真能不能撤销，按下时服务端再查。
        var undoable: Bool = false
    }

    struct Create: Equatable, Sendable {
        let id: String
        let title: String
        var icon: String? = nil
        /// 要显示的正文（笔记是 Markdown，别的类型是读得出的文字）。
        let content: String
        var status: String? = nil
        var appliedPageId: String? = nil
        /// 建成子页面时的父页面。[parentTitle] 有值（可以是空字符串）才显示"在“…”里"。
        var parentId: String? = nil
        var parentTitle: String? = nil
        /// 正文以外要给人看的改动（白板、幻灯片的缩略图等）。
        var changes: [ProposalChange] = []
        /// 要建的页面的类型（旧服务端不给：笔记）。
        var pageKind: PageKind = .note
        var autoApplied: Bool = false
        var undoable: Bool = false
    }

    var id: String {
        switch self {
        case .edit(let edit): return edit.id
        case .create(let create): return create.id
        }
    }

    var status: String? {
        switch self {
        case .edit(let edit): return edit.status
        case .create(let create): return create.status
        }
    }

    var appliedPageId: String? {
        switch self {
        case .edit(let edit): return edit.appliedPageId
        case .create(let create): return create.appliedPageId
        }
    }

    var pageKind: PageKind {
        switch self {
        case .edit(let edit): return edit.pageKind
        case .create(let create): return create.pageKind
        }
    }

    var autoApplied: Bool {
        switch self {
        case .edit(let edit): return edit.autoApplied
        case .create(let create): return create.autoApplied
        }
    }

    var undoable: Bool {
        switch self {
        case .edit(let edit): return edit.undoable
        case .create(let create): return create.undoable
        }
    }

    /// 卡片上的改动列表（新建提案是正文以外的那些）。
    var changes: [ProposalChange] {
        switch self {
        case .edit(let edit): return edit.changes
        case .create(let create): return create.changes
        }
    }
}

/// 进度面板里的一步（网页的 ActivityStep）。提案和失败位置不进步骤列表，回答下方另外显示。
/// 失败位置（`failure`）就是 Android 的 `FailureInfo(offset, detail)`：服务端在回答末尾追加的失败文从正文的哪里开始、原因是什么。
enum ActivityStep: Equatable, Identifiable, Sendable {
    case thought(id: String, text: String)
    case context(id: String, info: ContextInfo)
    case web(id: String, done: Bool, action: WebAction? = nil)
    case tool(id: String, done: Bool, name: String, label: String? = nil)
    case failure(id: String, offset: Int, detail: String)
    case proposal(Proposal)

    var id: String {
        switch self {
        case .thought(let id, _), .context(let id, _), .web(let id, _, _), .tool(let id, _, _, _), .failure(let id, _, _): return id
        case .proposal(let proposal): return proposal.id
        }
    }
}

/// `/api/chat` 流里 `{activity: …}` 的事件（网页的 ActivityEvent，服务端已整理成统一形状）。
enum ActivityEvent: Equatable, Sendable {
    case thought(id: String, delta: String)
    case context(id: String, info: ContextInfo)
    case web(id: String, done: Bool, action: WebAction? = nil)
    case tool(id: String, done: Bool, name: String, label: String? = nil)
    case failure(id: String, offset: Int, detail: String)
    case proposal(Proposal)

    var id: String {
        switch self {
        case .thought(let id, _), .context(let id, _), .web(let id, _, _), .tool(let id, _, _, _), .failure(let id, _, _): return id
        case .proposal(let proposal): return proposal.id
        }
    }
}

enum Activity {
    private static let maxText = 300
    private static let maxContextNotes = 10
    private static let maxContextId = 100

    /// 一次回答只有一个项目上下文步骤，重发时替换同一步。
    static let contextStepId = "project-context"

    /// 按 id 把一个事件合并进已有步骤（网页的 applyActivityEvent）。
    static func apply(_ steps: [ActivityStep], _ event: ActivityEvent) -> [ActivityStep] {
        let index = steps.firstIndex { $0.id == event.id }
        func put(_ step: ActivityStep) -> [ActivityStep] {
            var next = steps
            if let index { next[index] = step } else { next.append(step) }
            return next
        }
        switch event {
        case .thought(let id, let delta):
            guard let index else { return steps + [.thought(id: id, text: delta)] }
            // 同一个 id 已经是别的种类：不动。
            guard case .thought(let currentId, let text) = steps[index] else { return steps }
            return put(.thought(id: currentId, text: text + delta))
        case .context(let id, let info): return put(.context(id: id, info: info))
        case .proposal(let proposal): return put(.proposal(proposal))
        case .failure(let id, let offset, let detail): return put(.failure(id: id, offset: offset, detail: detail))
        case .tool(let id, let done, let name, let label): return put(.tool(id: id, done: done, name: name, label: label))
        case .web(let id, let done, let action): return put(.web(id: id, done: done, action: action))
        }
    }

    static func apply(_ steps: [ActivityStep], _ events: [ActivityEvent]) -> [ActivityStep] {
        events.reduce(steps) { apply($0, $1) }
    }

    /// 读一个流事件。形状不对的返回 nil（宁可忽略也不让回答中断）。
    static func parseEvent(_ json: JSONValue) -> ActivityEvent? {
        let id = string(json, "id")
        switch string(json, "type") {
        case "thought":
            guard let id, let delta = string(json, "delta"), !delta.isEmpty else { return nil }
            return .thought(id: id, delta: delta)
        case "context":
            guard let id, let info = parseContextInfo(json) else { return nil }
            return .context(id: id, info: info)
        case "web":
            guard let id else { return nil }
            return .web(id: id, done: string(json, "status") == "done", action: parseWebAction(json["action"]))
        case "tool":
            guard let id, string(json, "name") != nil else { return nil }
            let label = text(json["label"])
            return .tool(id: id, done: string(json, "status") == "done", name: text(json["name"]), label: label.isEmpty ? nil : label)
        case "failure":
            guard let id, let failure = parseFailure(json) else { return nil }
            return .failure(id: id, offset: failure.offset, detail: failure.detail)
        case "proposal":
            return parseEditProposal(json).map { .proposal(.edit($0)) }
        case "create_proposal":
            return parseCreateProposal(json).map { .proposal(.create($0)) }
        default:
            return nil
        }
    }

    /// 历史里保存的过程（网页的 parseStoredActivity）。服务端已解析成数组；这里再校验一遍，坏的丢掉。
    static func parseStored(_ element: JSONValue?) -> [ActivityStep] {
        guard let array = element?.arrayValue else { return [] }
        var steps: [ActivityStep] = []
        for step in array {
            guard step.objectValue != nil, let id = string(step, "id") else { continue }
            switch string(step, "kind") {
            case "thought":
                if let text = string(step, "text") { steps.append(.thought(id: id, text: text)) }
            case "web":
                // 保存的回答里不留"正在搜索"：还原不出 action 的搜索丢掉。
                if let action = parseStoredWebAction(step["action"]) { steps.append(.web(id: id, done: true, action: action)) }
            case "context":
                if let info = parseContextInfo(step) { steps.append(.context(id: id, info: info)) }
            case "tool":
                if let name = string(step, "name") {
                    let label = text(step["label"])
                    steps.append(.tool(id: id, done: true, name: name, label: label.isEmpty ? nil : label))
                }
            case "failure":
                if let failure = parseFailure(step) { steps.append(.failure(id: id, offset: failure.offset, detail: failure.detail)) }
            default:
                break
            }
        }
        return steps
    }

    /// 同上，读 JSON 字符串（与网页 parseStoredActivity 的入参一致，便于对照测试）。
    static func parseStored(raw: String?) -> [ActivityStep] {
        guard let raw, !raw.isEmpty else { return [] }
        return parseStored(JSONValue.parse(raw))
    }

    /// 历史里保存的提案（`proposals` 字段，`kind` 是 `proposal` / `create_proposal`）。
    static func parseStoredProposals(_ element: JSONValue?) -> [Proposal] {
        (element?.arrayValue ?? []).compactMap { json -> Proposal? in
            switch string(json, "kind") {
            case "proposal": return parseEditProposal(json).map { .edit($0) }
            case "create_proposal": return parseCreateProposal(json).map { .create($0) }
            default: return nil
            }
        }
    }

    private static let thoughtTitle = ChatRegex(#"^\s*\*\*(.+?)\*\*\s*"#)

    /// OpenAI 的推理摘要是"**标题**\n\n正文"，拆成标题和正文（网页的 splitThought）。
    static func splitThought(_ text: String) -> (title: String, body: String) {
        guard let match = thoughtTitle.firstMatch(in: text) else { return ("", ChatText.trim(text)) }
        let units = Array(text.utf16)
        let title = match.range(at: 1)
        let end = match.range.location + match.range.length
        return (
            ChatText.trim(String(decoding: units[title.location..<(title.location + title.length)], as: UTF16.self)),
            ChatText.trim(String(decoding: units[end...], as: UTF16.self))
        )
    }

    /// 地址的主机名，去掉开头的 www.（网页的 hostOf）。
    static func hostOf(_ url: String) -> String {
        guard let host = HttpUrl.parse(url)?.host else { return url }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// 失败步骤 / 事件（`{type|kind: "failure", offset, detail}`）里的位置和原因；Android 的 `FailureInfo.from`。
    static func parseFailure(_ json: JSONValue?) -> (offset: Int, detail: String)? {
        guard let json, json.objectValue != nil else { return nil }
        guard (string(json, "type") ?? string(json, "kind")) == "failure" else { return nil }
        guard let offset = json["offset"]?.intValue, offset >= 0, let detail = string(json, "detail") else { return nil }
        return (offset, detail)
    }

    // ---- 内部 ----

    private static func string(_ json: JSONValue, _ key: String) -> String? {
        json[key]?.stringValue
    }

    private static func text(_ value: JSONValue?) -> String {
        guard let value = value?.stringValue else { return "" }
        return ChatText.take(ChatText.trim(value), utf16: maxText)
    }

    // 界面要把它做成链接，只收 http(s)。
    private static func safeUrl(_ value: JSONValue?) -> String {
        guard let raw = value?.stringValue, let url = HttpUrl.parse(raw) else { return "" }
        return url.absoluteString
    }

    private static func parseContextInfo(_ data: JSONValue) -> ContextInfo? {
        let projectName = text(data["projectName"])
        if projectName.isEmpty { return nil }
        var notes: [ContextNote] = []
        for note in data["notes"]?.arrayValue ?? [] {
            guard note.objectValue != nil else { continue }
            let id = ChatText.trim(string(note, "id") ?? "")
            guard !id.isEmpty, id.utf16.count <= maxContextId, note["title"]?.stringValue != nil,
                  !notes.contains(where: { $0.id == id }) else { continue }
            let title = text(note["title"])
            notes.append(ContextNote(id: id, title: title.isEmpty ? "Untitled" : title, truncated: note["truncated"]?.boolValue == true))
            if notes.count >= maxContextNotes { break }
        }
        let hasInstructions = data["hasInstructions"]?.boolValue == true
        return hasInstructions || !notes.isEmpty ? ContextInfo(projectName: projectName, hasInstructions: hasInstructions, notes: notes) : nil
    }

    // 流里的 action 是服务端整理过的形状，与保存的一样。
    private static func parseWebAction(_ value: JSONValue?) -> WebAction? {
        parseStoredWebAction(value)
    }

    private static func parseStoredWebAction(_ value: JSONValue?) -> WebAction? {
        guard let action = value, action.objectValue != nil else { return nil }
        switch string(action, "kind") {
        case "search":
            return .search(
                queries: (action["queries"]?.arrayValue ?? []).compactMap(\.stringValue),
                sources: (action["sources"]?.arrayValue ?? []).map { safeUrl($0) }.filter { !$0.isEmpty }
            )
        case "open_page":
            let url = safeUrl(action["url"])
            return url.isEmpty ? nil : .openPage(url: url)
        case "find_in_page":
            let url = safeUrl(action["url"])
            return url.isEmpty ? nil : .findInPage(url: url, pattern: text(action["pattern"]))
        default:
            return nil
        }
    }

    // `proposed.blocks` 现在总是空数组（应用只用服务端存着的内容），但仍然要求它是数组：旧版 App 靠它认提案，服务端一直会给。
    private static func hasProposed(_ json: JSONValue) -> Bool {
        guard let proposed = json["proposed"], proposed.objectValue != nil else { return false }
        return proposed["title"]?.stringValue != nil && proposed["blocks"]?.arrayValue != nil
    }

    // 与网页 parseActivityEvent 的校验一致：承认卡片需要的字段都在才收。后来加的字段（页面类型、自动应用、能否撤销、缩略图）
    // 都是可选的：旧服务端不给时按笔记、没自动应用、不能撤销。
    static func parseEditProposal(_ json: JSONValue) -> Proposal.Edit? {
        guard let id = string(json, "id"), let pageId = string(json, "pageId"), let pageTitle = string(json, "pageTitle"),
              let baseVersion = json["baseVersion"]?.intValue, let changes = json["changes"]?.arrayValue, hasProposed(json)
        else { return nil }
        let title = json["title"]
        return Proposal.Edit(
            id: id,
            pageId: pageId,
            pageTitle: pageTitle,
            baseVersion: baseVersion,
            titleBefore: title?["before"]?.stringValue,
            titleAfter: title?["after"]?.stringValue,
            changes: parseChanges(changes),
            status: string(json, "status"),
            appliedPageId: string(json, "appliedPageId"),
            pageKind: PageKind.of(string(json, "pageKind")),
            autoApplied: json["autoApplied"]?.boolValue == true,
            undoable: json["undoable"]?.boolValue == true
        )
    }

    static func parseCreateProposal(_ json: JSONValue) -> Proposal.Create? {
        guard let id = string(json, "id"), let title = string(json, "title"), let content = string(json, "content"), hasProposed(json)
        else { return nil }
        return Proposal.Create(
            id: id,
            title: title,
            icon: string(json, "icon"),
            content: content,
            status: string(json, "status"),
            appliedPageId: string(json, "appliedPageId"),
            parentId: string(json, "parentId"),
            parentTitle: string(json, "parentTitle"),
            changes: parseChanges(json["changes"]?.arrayValue ?? []),
            pageKind: PageKind.of(string(json, "pageKind")),
            autoApplied: json["autoApplied"]?.boolValue == true,
            undoable: json["undoable"]?.boolValue == true
        )
    }

    /// 改动列表：不是对象或没有 op 的项丢掉，其它字段缺了或类型不对就当没有。
    private static func parseChanges(_ array: [JSONValue]) -> [ProposalChange] {
        array.compactMap { change -> ProposalChange? in
            guard change.objectValue != nil, let op = string(change, "op") else { return nil }
            return ProposalChange(
                op: ProposalOp.of(op),
                block: change["block"]?.intValue ?? 0,
                target: parseChangeTarget(change["target"]),
                before: string(change, "before"),
                after: string(change, "after"),
                beforeImage: proposalImagePath(change["beforeImage"]),
                afterImage: proposalImagePath(change["afterImage"]),
                dropsFormatting: change["dropsFormatting"]?.boolValue == true,
                dropsMedia: change["dropsMedia"]?.boolValue == true
            )
        }
    }

    private static func parseChangeTarget(_ value: JSONValue?) -> ProposalChangeTarget? {
        guard let value, value.objectValue != nil else { return nil }
        switch string(value, "type") {
        case "slide":
            return value["number"]?.intValue.map { .slide(number: $0) }
        case "elements":
            guard let count = value["count"]?.intValue else { return nil }
            // 空的名字和没有一样：显示个数（网页 target.name ? … : …）。
            let name = string(value, "name").flatMap { $0.isEmpty ? nil : $0 }
            return .elements(count: count, name: name)
        default:
            return nil
        }
    }

    /// 缩略图要带着 App 的 Cookie 读，所以只收本站的相对地址（以一个 / 开头）；别的写法当没有。
    private static func proposalImagePath(_ value: JSONValue?) -> String? {
        guard let path = value?.stringValue, path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
        return path
    }
}

/// 完成后标题行的统计（网页 chat-activity.tsx 的 summarize）。界面再把数字套进各自的文案。
struct ActivitySummary: Equatable, Sendable {
    let searches: Int
    let sources: Int
    let noteLookups: Int
    let projectNotes: Int
    let projectInstructions: Bool

    static func of(_ steps: [ActivityStep]) -> ActivitySummary {
        var searches = 0
        var notes = 0
        var projectNotes = 0
        var projectInstructions = false
        var pages = Set<String>()
        for step in steps {
            switch step {
            case .tool:
                notes += 1
            case .context(_, let info):
                projectNotes = info.notes.count
                projectInstructions = info.hasInstructions
            case .web(_, _, let action):
                switch action {
                case .search(let queries, let sources):
                    searches += max(1, queries.count)
                    pages.formUnion(sources)
                case .openPage(let url), .findInPage(let url, _):
                    pages.insert(url)
                case nil:
                    break
                }
            case .thought, .failure, .proposal:
                break
            }
        }
        return ActivitySummary(
            searches: searches, sources: pages.count, noteLookups: notes, projectNotes: projectNotes,
            projectInstructions: projectInstructions
        )
    }
}

extension Array where Element == ActivityStep {
    /// 进度列表里显示的步骤：去掉提案和失败位置（网页的 ProgressStep）。
    func progressSteps() -> [ActivityStep] {
        filter {
            switch $0 {
            case .proposal, .failure: return false
            default: return true
            }
        }
    }
}

/// 回答下方的提案卡片：保存过的优先，流里还没出现在保存列表里的补在后面（网页 chat-message.tsx）。
func mergeProposals(_ stored: [Proposal], _ steps: [ActivityStep]) -> [Proposal] {
    let live = steps.compactMap { step -> Proposal? in
        if case .proposal(let proposal) = step { return proposal }
        return nil
    }
    return stored + live.filter { candidate in !stored.contains(where: { $0.id == candidate.id }) }
}
