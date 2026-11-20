import Foundation
import Observation

/// 应用 / 放弃 AI 的笔记提案（`POST /api/proposals/:id/apply|discard`）。拆成协议便于单元测试。
protocol ProposalBackend {
    /// 应用提案，返回响应里的笔记（`page`）。服务端拒绝时抛 [ProposalException]。
    func apply(proposalId: String) async throws -> AppliedPage

    func discard(proposalId: String) async throws
}

/// 应用提案后服务端返回的笔记：[id] 是 `page.id`，[json] 是整个 `page` 对象的 JSON（转给打开着的网页编辑器）。
struct AppliedPage: Equatable, Sendable {
    var id: String?
    var json: String?
}

/// 服务端拒绝了操作。[serverMessage] 是响应里的 `error`（英文原句），没有时界面用"无法应用修改建议。"。
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
        guard let page = JSONValue.parse(body)?["page"], case .object = page else { return AppliedPage(id: nil, json: nil) }
        return AppliedPage(id: page["id"]?.stringValue, json: page.encodedString())
    }

    func discard(proposalId: String) async throws {
        _ = try await post(proposalId, "discard")
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

/// [ProposalStore] 需要知道的提案的那几项。提案本身（Activity 里的 Proposal：编辑已有笔记 / 新建笔记）不在这一层定义，
/// 让它遵守这个协议即可。
protocol ProposalTarget {
    var id: String { get }

    /// 服务端保存的状态（`applied` / `discarded`）；只有保存过的提案才有。
    var status: String? { get }

    /// 编辑提案要改的那篇笔记的 ID；新建提案是 nil（以此区分两种提案）。
    var editedPageId: String? { get }

    /// 新建提案应用后服务端建好的笔记（保存过的提案才有）。
    var appliedPageId: String? { get }
}

/// 一张提案卡片的操作状态。[error] 为 nil 表示没有错误。
struct ProposalState: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case idle, applying, discarding, applied, discarded
    }

    var status: Status = .idle
    var error: ProposalError? = nil
    /// 应用后的笔记 ID（"打开笔记"的目标）。
    var pageId: String? = nil

    var settled: Bool { status == .applied || status == .discarded }
    var busy: Bool { status == .applying || status == .discarding }
}

/// 操作失败：[serverMessage] 是服务端原句（界面用系统文词典翻译），nil 时用 [action] 对应的本地文案。
struct ProposalError: Equatable, Sendable {
    enum Action: Equatable, Sendable {
        case apply, discard
    }

    var action: Action
    var serverMessage: String?
}

/// 应用提案后改动或新建的笔记。[page] 是服务端返回的新版本（`page` 的 JSON）：改动的笔记正开在编辑器里时，
/// 交给网页的 `window.notefableEmbed.pageUpdated`，和网页 notefable:page-updated 一样换成新版本（有未保存的编辑则提示冲突）。
struct ProposalChangeEvent: Equatable, Sendable {
    var pageId: String?
    var created: Bool
    var page: String? = nil
}

/// 提案卡片的状态按提案 ID 存在卡片外（网页 page-edit-proposal.tsx 的 states Map）。
/// 回答结束后重新读历史时卡片会重建，但状态还在，不会退回"未应用"。服务端保存的确定状态（已应用 / 已放弃）优先。
/// 应用 / 放弃在 Store 自己开的任务里跑，离开对话也不会被取消。
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

    /// 应用成功后发出：笔记列表要刷新，打开着的笔记要重读。先开始听，再触发；之前发过的不补。
    func changes() -> AsyncStream<ProposalChangeEvent> {
        changeEvents.stream()
    }

    /// 卡片显示用的状态：服务端已确定的结果优先，否则用本机的操作状态（网页的 useProposalState）。
    func stateOf(_ proposal: some ProposalTarget) -> ProposalState {
        let initial = Self.initialState(proposal)
        return initial.settled ? initial : states[proposal.id] ?? initial
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
                // 编辑提案打开被改的那篇；新建提案打开服务端刚建的那篇。
                let pageId = editedPageId ?? applied.id
                states[id] = ProposalState(status: .applied, pageId: pageId)
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

    nonisolated static func initialState(_ proposal: some ProposalTarget) -> ProposalState {
        let status: ProposalState.Status
        switch proposal.status {
        case "applied": status = .applied
        case "discarded": status = .discarded
        default: status = .idle
        }
        return ProposalState(status: status, pageId: proposal.editedPageId ?? proposal.appliedPageId)
    }
}
