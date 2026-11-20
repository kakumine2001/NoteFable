import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// ChatViewModel 用到的纯函数和小类型：失败原因、对账时沿用列表 key，以及 Android 界面文件里不依赖界面的那部分
// （AttachUi.kt、AttachPagesDialog.kt、ChatRecentNotes.kt、TurnActions.kt、ChatScreen.kt 的提示文字）。

/// 网页字典里的 "Check your connection and try again."（界面用 `L("check_connection")` 显示译文）。
let CONNECTION_FAILED = "Check your connection and try again."

/// 网页 msg("You can attach up to 5 pages to a message.")，译文在系统文词典里（服务端也用这句）。
let TOO_MANY_PAGES = "You can attach up to 5 pages to a message."

/// 这边自己判定的失败（图片接口返回了错误文字、没有图片等）：`message` 原样显示在"请求失败："后面。
struct ChatTurnError: LocalizedError, Equatable, Sendable {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

/// 连不上服务器的几种情况（断网、域名解析失败、连接被拒或超时、TLS 握手失败）。
private let connectionFailureCodes: Set<URLError.Code> = [
    .notConnectedToInternet, .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost, .networkConnectionLost, .timedOut,
    .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
    .serverCertificateNotYetValid, .internationalRoamingOff, .dataNotAllowed,
]

/// 回答失败时显示在"Request failed: …"后面的原因。连不上服务器时系统给的是带主机地址的技术信息，
/// 换成网页字典里的 `CONNECTION_FAILED`，界面按语言显示译文；服务端返回的错误（ApiException）和其它错误保持原句，和网页一样。
/// 没有文字的错误用类型名（Kotlin 端的 `javaClass.simpleName`）。
func chatFailureDetail(_ error: Error) -> String {
    if let api = error as? ApiException { return api.message }
    if let url = error as? URLError {
        return connectionFailureCodes.contains(url.code) ? CONNECTION_FAILED : url.localizedDescription
    }
    if let localized = error as? LocalizedError, let text = localized.errorDescription { return text }
    if error is CocoaError { return error.localizedDescription }
    return String(describing: type(of: error))
}

/// 对账：先按服务端 ID 沿用旧列表里已有的 key（之前的回合对账过、key 还是 `local-N` 的消息，不能退回服务端 ID 而重建，
/// 否则它进行中的下载等界面状态会被丢掉）。再处理刚发送的这一回合：服务端列表末尾就是它，从两边末尾往前，
/// 旧列表里还是本地 ID 且角色相同的消息，把它的 key 交给服务端的那条（见 `UiMessage.key`）。
func carryLocalKeys(_ old: [UiMessage], _ loaded: [UiMessage]) -> [UiMessage] {
    var keysById: [String: String] = [:]
    for message in old where !message.id.hasPrefix("local-") && message.key != message.id {
        keysById[message.id] = message.key
    }
    var result = loaded.map { message -> UiMessage in
        guard let key = keysById[message.id] else { return message }
        var kept = message
        kept.key = key
        return kept
    }
    var i = old.count - 1
    var j = result.count - 1
    while i >= 0, j >= 0, old[i].id.hasPrefix("local-"), old[i].role == result[j].role {
        result[j].key = old[i].key
        i -= 1
        j -= 1
    }
    return result
}

/// 这次对账里从本地 ID 换成服务端 ID 的消息：(旧 ID, 新 ID)。
func replacedLocalIds(_ old: [UiMessage], _ merged: [UiMessage]) -> [(from: String, to: String)] {
    var oldByKey: [String: UiMessage] = [:]
    for message in old where message.id.hasPrefix("local-") { oldByKey[message.key] = message }
    return merged.compactMap { message in
        guard let previous = oldByKey[message.key], previous.id != message.id else { return nil }
        return (previous.id, message.id)
    }
}

// MARK: - 添加笔记（AttachPagesDialog.kt、ChatRecentNotes.kt）

/// 勾选 / 取消：已选的去掉；没满就加到最后；满了不变（网页 toggle，Android ProjectSettings.kt 的 toggleProjectNote）。
func toggleAttachedNote(_ selected: [ChatProjectNote], _ note: ChatProjectNote, max: Int) -> [ChatProjectNote] {
    if selected.contains(where: { $0.id == note.id }) { return selected.filter { $0.id != note.id } }
    if selected.count >= max { return selected }
    return selected + [note]
}

/// 打开窗口时读到的笔记列表之后，之前选的笔记换成现在的标题；已经进了回收站的去掉（发出去也会被服务端剔除）。
/// 和网页 AttachPageDialog 的 setSelected(current.flatMap(byId.get)) 一样。
func refreshAttachedPages(_ selected: [ChatProjectNote], _ live: [ChatProjectNote]) -> [ChatProjectNote] {
    var byId: [String: ChatProjectNote] = [:]
    for note in live { byId[note.id] = note }
    return selected.compactMap { byId[$0.id] }
}

/// 空白页「最近编辑」那一行显示的笔记：按更新时间从新到旧的前 4 篇（时间相同的保持原来的顺序）。
func recentChatNotes(_ pages: [NotePageSummary]) -> [NotePageSummary] {
    pages.enumerated()
        .sorted { $0.element.updatedAt != $1.element.updatedAt ? $0.element.updatedAt > $1.element.updatedAt : $0.offset < $1.offset }
        .prefix(4)
        .map(\.element)
}

/// 「最近编辑」里的一篇能不能点：上传中不能；已添加的可以取消；没满才能再加。
func canToggleRecentNote(_ pageId: String, selected: [ChatProjectNote], enabled: Bool) -> Bool {
    enabled && (selected.contains { $0.id == pageId } || selected.count < MAX_MESSAGE_NOTES)
}

// MARK: - 附件（AttachUi.kt）

/// 文件选择器和相机一起给结果时用哪些：选了文件就用选的；没选而相机拍了（文件里有内容）就用相机那张。
func pickedAttachmentSources<T>(_ picked: [T], cameraTarget: T?, cameraHasContent: (T) -> Bool) -> [T] {
    if !picked.isEmpty { return picked }
    if let cameraTarget, cameraHasContent(cameraTarget) { return [cameraTarget] }
    return []
}

/// 粘贴进输入栏时收的图片类型。
let PASTE_IMAGE_TYPES: Set<String> = ["image/png", "image/jpeg", "image/webp"]

/// 生成的图片刚完成时服务器给的是 data: 地址：取出里面的字节交给图片视图；普通地址返回 nil（按地址加载）。
func dataUrlBytes(_ dataUrl: String) -> Data? {
    guard dataUrl.hasPrefix("data:"), let marker = dataUrl.range(of: "base64,") else { return nil }
    return Data(base64Encoded: String(dataUrl[marker.upperBound...]), options: .ignoreUnknownCharacters)
}

/// 附件不能用的原因，按当前语言（和网页字典逐条对应）。
func attachErrorText(_ error: AttachError) -> String {
    switch error {
    case .tooMany(let max, let extra): return L("err_too_many", max, extra)
    case .empty(let name): return L("err_empty", name)
    case .nameTooLong: return L("err_name_long")
    case .unsupported(let name): return L("err_unsupported", name)
    case .modelCannotReadImages: return L("err_model_images")
    case .fileTooLarge(let name, let limitBytes): return L("err_file_large", name, formatUploadSize(limitBytes))
    case .totalTooLarge(let limitBytes): return L("err_total_large", formatUploadSize(limitBytes))
    case .slotsFull(let max): return L("err_slots_full", max)
    case .roomForFewer(let remaining, let max, let count):
        return remaining == 1 ? L("err_one_more", max, count) : L("err_some_more", remaining, max, count)
    case .notAdded(let cause): return L("err_not_added", attachErrorText(cause))
    }
}

/// 输入栏上方那一行提示的文字（ChatScreen.kt）：附件本身不能发送时先说附件的原因。
func composerErrorText(filesError: AttachError?, notice: ComposerNotice?, systemText: SystemTextTranslator) -> String? {
    if let filesError { return attachErrorText(filesError) }
    guard let notice else { return nil }
    switch notice {
    case .rejected(let error): return attachErrorText(error)
    case .uploadFailed: return L("upload_failed")
    case .loadFailed, .linkFailed: return L("messages_load_failed")
    case .iconFailed: return L("em_chat_icon_failed")
    case .pagesInImageMode: return L("err_pages_image_mode")
    case .tooManyPages: return systemText.localize(TOO_MANY_PAGES)
    // 编辑、重新生成、切换版本、分支没成功：服务端或字典里的原句，按语言显示。
    case .failed(let detail): return detail == CONNECTION_FAILED ? L("check_connection") : systemText.localize(detail)
    }
}

// MARK: - 一条消息上的操作（TurnActions.kt）

/// 编辑、重新生成、切换版本、分支。由根界面接到 ChatViewModel；`busy` 时这个聊天在发送或生成，不能操作。
struct TurnActions {
    let regenerate: @MainActor (_ messageId: String) -> Void
    let edit: @MainActor (_ messageId: String, _ text: String) -> Void
    let showVersion: @MainActor (_ messageId: String) -> Void
    let branch: @MainActor (_ messageId: String) -> Void
    /// 关掉因为被拒绝而重新打开的编辑框（取消）。
    let dismissEditDraft: @MainActor () -> Void
    let busy: Bool
}

/// 版本切换「‹ 2/3 ›」中间的数字。
func versionLabel(_ versions: MessageVersions) -> String {
    "\(versions.index)/\(versions.total)"
}
