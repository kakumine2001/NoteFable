import Foundation
import Observation

/// 应用 / 放弃 / 撤销 AI 的页面提案（`POST /api/proposals/:id/apply|discard|undo`）。拆成协议便于单元测试。
/// 三个都只生效一次：重发不会重复应用、重复撤销（服务端按提案的状态判断）。
protocol ProposalBackend {
    /// 应用提案，返回响应里的页面（`page`）。服务端拒绝时抛 [ProposalException]。
    func apply(proposalId: String) async throws -> AppliedPage

    func discard(proposalId: String) async throws

    /// 撤销已应用的提案：编辑提案恢复成应用前的内容，新建提案把建的页面移进回收站。服务端拒绝时抛 [ProposalException]。
    func undo(proposalId: String) async throws -> UndoneProposal
}

/// 应用提案后服务端返回的页面：[id] 是 `page.id`，[json] 是整个 `page` 对象的 JSON（转给打开着的网页编辑器）。
struct AppliedPage: Equatable, Sendable {
    var id: String?
    var json: String?
}

/// 撤销后服务端返回的结果：编辑提案是恢复后的页面（`page`，和应用时一样交给打开着的编辑器），
/// 新建提案是移进回收站的页面（`ids`：建的那篇和它的子页面；已经撤销过时是空的）。
struct UndoneProposal: Equatable, Sendable {
    var page: AppliedPage? = nil
    var trashedIds: [String] = []
}

/// 服务端拒绝了操作。[serverMessage] 是响应里的 `error`（英文原句），没有时界面用"无法应用修改建议。"等本地文案。
struct ProposalException: Error, Equatable, Sendable {
    var serverMessage: String?

    init(serverMessage: String?) {
        self.serverMessage = serverMessage
    }
}

final class ProposalApi: ProposalBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func apply(proposalId: String) async throws -> AppliedPage {
        let body = try await post(proposalId, "apply")
        return Self.page(JSONValue.parse(body)?["page"]) ?? AppliedPage(id: nil, json: nil)
    }

    func discard(proposalId: String) async throws {
        _ = try await post(proposalId, "discard")
    }

    func undo(proposalId: String) async throws -> UndoneProposal {
        let body = JSONValue.parse(try await post(proposalId, "undo"))
        return UndoneProposal(
            page: Self.page(body?["page"]),
            trashedIds: (body?["ids"]?.arrayValue ?? []).compactMap(\.stringValue)
        )
    }

    private static func page(_ value: JSONValue?) -> AppliedPage? {
        guard let page = value, case .object = page else { return nil }
        return AppliedPage(id: page["id"]?.stringValue, json: page.encodedString())
    }

    private func post(_ proposalId: String, _ action: String) async throws -> Data {
        var request = try http.request("POST", "/api/proposals/\(ApiUrl.encode(proposalId))/\(action)")
        request.setHeader("Accept", "application/json")
        let (data, response) = try await http.execute(request)
        guard response.isSuccessful else {
            let sentence = (try? NoteFableJson.decode(ApiError.self, from: data))?.error
            throw ProposalException(serverMessage: sentence.flatMap { ApiText.isBlank($0) ? nil : $0 })
        }
        return data
    }
}

/// [ProposalStore] 需要知道的提案的那几项。提案本身（Activity 里的 Proposal：编辑已有页面 / 新建页面）不在这一层定义，
/// 让它遵守这个协议即可。
protocol ProposalTarget {
    var id: String { get }

    /// 服务端保存的状态（`pending` / `applied` / `discarded` / `undone`）；只有保存过的提案才有。
    var status: String? { get }

    /// 编辑提案要改的那个页面的 ID；新建提案是 nil（以此区分两种提案）。
    var editedPageId: String? { get }

    /// 新建提案应用后服务端建好的页面（保存过的提案才有）。
    var appliedPageId: String? { get }

    /// 服务端说这个已应用的提案能撤销（`undoable`）。
    var undoable: Bool { get }
}

/// 一张提案卡片的操作状态。[error] 为 nil 表示没有错误。
struct ProposalState: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case idle, applying, discarding, applied, discarded, undoing, undone
    }

    var status: Status = .idle
    var error: ProposalError? = nil
    /// 应用后的页面 ID（"打开"的目标）。
    var pageId: String? = nil
    /// 显示"撤销"：服务端说能撤销，或者刚在这台设备上应用过（网页 State.undoable）。
    var undoable: Bool = false

    /// 已处理（应用 / 放弃 / 撤销，撤销中也算，同网页）：卡片默认最小化、变淡。
    var settled: Bool { status == .applied || status == .undoing || status == .discarded || status == .undone }
    var busy: Bool { status == .applying || status == .discarding || status == .undoing }
    /// 还没决定：显示"应用 / 放弃"。
    var pending: Bool { status == .idle || status == .applying || status == .discarding }
    /// 显示"撤销"（撤销中是转圈）。
    var showsUndo: Bool { status == .undoing || (status == .applied && undoable) }

    /// "打开"链接的目标：已应用的提案，和撤销中 / 撤销过的编辑提案（页面还在，内容恢复了）；
    /// 撤销中 / 撤销过的新建提案的页面要进 / 已在回收站里，不给。
    func openPageId(isEdit: Bool) -> String? {
        status == .applied || ((status == .undoing || status == .undone) && isEdit) ? pageId : nil
    }
}

/// 操作失败：[serverMessage] 是服务端原句（界面用系统文词典翻译），nil 时用 [action] 对应的本地文案。
struct ProposalError: Equatable, Sendable {
    enum Action: Equatable, Sendable {
        case apply, discard, undo
    }

    var action: Action
    var serverMessage: String?

    /// 没有服务端原句时的文案键。
    var fallbackKey: String {
        switch action {
        case .apply: return "proposal_apply_failed"
        case .discard: return "proposal_discard_failed"
        case .undo: return "proposal_undo_failed"
        }
    }
}

/// 应用 / 撤销提案后改动、新建或移走的页面。[page] 是服务端返回的新版本（`page` 的 JSON）：改动的页面正开在编辑器里时，
/// 交给网页的 `window.notefableEmbed.pageUpdated`，和网页 notefable:page-updated 一样换成新版本（有未保存的编辑则提示冲突）。
/// [trashedIds] 是撤销新建提案时移进回收站的页面（网页 notefable:pages-trashed）：从笔记列表里拿掉，开着的关掉。
struct ProposalChangeEvent: Equatable, Sendable {
    var pageId: String?
    /// 应用新建提案：建了新页面。
    var created: Bool
    var page: String? = nil
    var trashedIds: [String] = []
}

/// 提案卡片的状态按提案 ID 存在卡片外（网页 page-proposal.tsx 的 states Map）。
/// 回答结束后重新读历史时卡片会重建，但状态还在，不会退回"未应用"。服务端保存的确定状态优先（见 [stateOf]）。
/// 应用 / 放弃 / 撤销在 Store 自己开的任务里跑，离开对话也不会被取消。
@MainActor
@Observable
final class ProposalStore {
    /// 本机的操作状态，按提案 ID。卡片显示用 [stateOf]。
    private(set) var states: [String: ProposalState] = [:]

    private let backend: ProposalBackend
    private let changeEvents = StoreEvents<ProposalChangeEvent>()

    init(backend: ProposalBackend) {
        self.backend = backend
    }

    /// 应用 / 撤销成功后发出：笔记列表要刷新，打开着的页面要换成新版本或关掉。先开始听，再触发；之前发过的不补。
    func changes() -> AsyncStream<ProposalChangeEvent> {
        changeEvents.stream()
    }

    /// 卡片显示用的状态（网页的 useProposalState）：服务端说已放弃 / 已撤销的以服务端为准；
    /// 服务端说已应用的，只有本机正在撤销、撤销完了（或撤销失败带着原因）时用本机的；还没处理的用本机的操作状态。
    /// 别的设备先处理了的，重读历史后显示那边的结果。
    func stateOf(_ proposal: some ProposalTarget) -> ProposalState {
        let initial = Self.initialState(proposal)
        let local = states[proposal.id]
        switch initial.status {
        case .discarded, .undone:
            return initial
        case .applied:
            guard let local, local.status == .applied || local.status == .undoing || local.status == .undone else { return initial }
            return local
        case .idle, .applying, .discarding, .undoing:
            return local ?? initial
        }
    }

    /// 应用提案。已经在处理或已确定时什么也不做，返回 nil；否则返回进行中的任务（测试用它等结果）。
    @discardableResult
    func apply(_ proposal: some ProposalTarget) -> Task<Void, Never>? {
        guard stateOf(proposal).status == .idle else { return nil }
        let id = proposal.id
        let editedPageId = proposal.editedPageId
        states[id] = ProposalState(status: .applying)
        return Task {
            do {
                let applied = try await backend.apply(proposalId: id)
                // 编辑提案打开被改的那个页面；新建提案打开服务端刚建的那个。刚应用的都能撤销。
                let pageId = editedPageId ?? applied.id
                states[id] = ProposalState(status: .applied, pageId: pageId, undoable: true)
                changeEvents.emit(ProposalChangeEvent(pageId: pageId, created: editedPageId == nil, page: applied.json))
            } catch is CancellationError {
                states[id] = ProposalState()
            } catch {
                let message = (error as? ProposalException)?.serverMessage
                states[id] = ProposalState(error: ProposalError(action: .apply, serverMessage: message))
            }
        }
    }

    @discardableResult
    func discard(_ proposal: some ProposalTarget) -> Task<Void, Never>? {
        guard stateOf(proposal).status == .idle else { return nil }
        let id = proposal.id
        states[id] = ProposalState(status: .discarding)
        return Task {
            do {
                try await backend.discard(proposalId: id)
                states[id] = ProposalState(status: .discarded)
            } catch is CancellationError {
                states[id] = ProposalState()
            } catch {
                let message = (error as? ProposalException)?.serverMessage
                states[id] = ProposalState(error: ProposalError(action: .discard, serverMessage: message))
            }
        }
    }

    /// 撤销已应用的提案（网页 undo）：编辑提案恢复成应用前的内容（现在的内容留在页面历史里），新建提案的页面移进回收站。
    /// 不是已应用时什么也不做，返回 nil。失败回到已应用并带着原因，可以再按。
    @discardableResult
    func undo(_ proposal: some ProposalTarget) -> Task<Void, Never>? {
        var applied = stateOf(proposal)
        guard applied.status == .applied else { return nil }
        applied.error = nil
        let id = proposal.id
        let editedPageId = proposal.editedPageId
        var undoing = applied
        undoing.status = .undoing
        states[id] = undoing
        return Task {
            do {
                let undone = try await backend.undo(proposalId: id)
                var done = applied
                done.status = .undone
                done.undoable = false
                states[id] = done
                if let editedPageId {
                    // 和应用后一样：刷新列表，开着的那个页面换成恢复后的版本。
                    changeEvents.emit(ProposalChangeEvent(pageId: editedPageId, created: false, page: undone.page?.json))
                } else {
                    changeEvents.emit(ProposalChangeEvent(pageId: applied.pageId, created: false, trashedIds: undone.trashedIds))
                }
            } catch is CancellationError {
                states[id] = applied
            } catch {
                var failed = applied
                failed.error = ProposalError(action: .undo, serverMessage: (error as? ProposalException)?.serverMessage)
                states[id] = failed
            }
        }
    }

    nonisolated static func initialState(_ proposal: some ProposalTarget) -> ProposalState {
        let status: ProposalState.Status
        switch proposal.status {
        case "applied": status = .applied
        case "discarded": status = .discarded
        case "undone": status = .undone
        default: status = .idle
        }
        return ProposalState(status: status, pageId: proposal.editedPageId ?? proposal.appliedPageId, undoable: proposal.undoable)
    }
}
