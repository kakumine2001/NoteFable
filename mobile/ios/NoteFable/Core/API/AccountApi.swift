import Foundation

/// 个人资料的一次编辑（网页 user-profile.ts 的 ProfileEdit，与 `PATCH /api/account` 同形）。
/// 只发 set 为 true 的项；值为 nil 表示恢复为 Google 的名字 / 照片。
struct ProfileEdit: Equatable, Sendable {
    var setDisplayName: Bool = false
    var displayName: String? = nil
    var setIcon: Bool = false
    var icon: String? = nil
    /// 只有 setLocale 才写 locale；值为 nil 表示明确恢复成"自动"。
    var setLocale: Bool = false
    var locale: String? = nil

    static func name(_ value: String?) -> ProfileEdit {
        ProfileEdit(setDisplayName: true, displayName: value)
    }

    static func icon(_ value: String?) -> ProfileEdit {
        ProfileEdit(setIcon: true, icon: value)
    }

    static func locale(_ value: String?) -> ProfileEdit {
        ProfileEdit(setLocale: true, locale: value)
    }

    static let resetToGoogle = ProfileEdit(setDisplayName: true, displayName: nil, setIcon: true, icon: nil)
}

/// 不等服务端回复就显示的编辑结果（网页 applyProfileEdit）：选表情或恢复时，上传的照片也一起去掉，和服务端规则相同。
func applyProfileEdit(_ user: AccountUser, _ edit: ProfileEdit) -> AccountUser {
    var next = user
    next.displayName = edit.setDisplayName ? edit.displayName : user.displayName
    next.icon = edit.setIcon ? edit.icon : user.icon
    next.avatarUrl = edit.setIcon ? nil : user.avatarUrl
    next.locale = edit.setLocale ? edit.locale : user.locale
    next.name = next.displayName ?? user.googleName
    return next
}

/// 已经是这个状态就不发（网页 profileEditChanges，例如回车后又失焦的重复保存）。
func profileEditChanges(_ user: AccountUser, _ edit: ProfileEdit) -> Bool {
    applyProfileEdit(user, edit) != user
}

extension ApiException {
    /// 服务端给了原因时的那句英文原句；只有 "HTTP <状态码>"（没有错误 JSON）时返回 nil。
    func serverMessage() -> String? {
        ApiText.isBlank(message) || message == "HTTP \(status)" ? nil : message
    }
}

/// 个人资料的保存与头像上传（网页 account-store.ts 的 sendPatch / sendPhoto）。拆成协议便于单元测试。
protocol AccountProfileBackend {
    /// `PATCH /api/account`，返回服务端确认后的资料。
    func updateProfile(_ edit: ProfileEdit) async throws -> AccountUser

    /// `POST /api/account/avatar`（multipart，唯一的字段 `file`），返回换好照片后的资料。
    func uploadAvatar(bytes: Data, mimeType: String) async throws -> AccountUser

    /// `GET /api/custom-instructions`：登录用户的自定义指令，没有设置时为 nil。
    func customInstructions() async throws -> String?

    /// `PUT /api/custom-instructions`：整体替换（空字符串是清空），返回服务端保存后的文字。
    func saveCustomInstructions(_ instructions: String) async throws -> String?

    /// `GET /api/billing`：当前方案和本期用量（设置里的"方案"）。
    func plan() async throws -> PlanInfo
}

extension AccountProfileBackend {
    func plan() async throws -> PlanInfo {
        throw UnsupportedOperationError()
    }
}

struct ApplePurchasePreparation: Decodable {
    var token: UUID?
    var reservation: String?
    var pending: Bool?
}

enum ApplePurchaseStatus: String, Decodable {
    case subscribed, inactive, conflict
}

final class AccountApi: AccountProfileBackend, AppIconBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func updateProfile(_ edit: ProfileEdit) async throws -> AccountUser {
        var fields: [String: JSONValue] = [:]
        if edit.setDisplayName { fields["displayName"] = ApiJson.string(edit.displayName) }
        if edit.setIcon { fields["icon"] = ApiJson.string(edit.icon) }
        if edit.setLocale { fields["locale"] = ApiJson.string(edit.locale) }
        let response = try await http.send(
            try http.request("PATCH", "/api/account", json: .object(fields)), as: ProfileResponse.self
        )
        // 网页：没有 user 也算失败（"Could not save."）。
        guard let user = response.user else { throw ApiException(status: 200, message: "HTTP 200") }
        return user
    }

    func uploadAvatar(bytes: Data, mimeType: String) async throws -> AccountUser {
        // 和网页 FormData.append("file", blob, "avatar") 一样：文件名 avatar，类型是切出来的图片的类型（服务端按内容判断）。
        var form = MultipartBody()
        form.addFormDataPart("file", filename: "avatar", contentType: mimeType, data: bytes)
        var request = try http.request("POST", "/api/account/avatar", timeout: .upload)
        request.body = .data(form.encoded())
        request.setHeader("Content-Type", form.contentType)
        let response = try await http.send(request, as: ProfileResponse.self)
        guard let user = response.user else { throw ApiException(status: 201, message: "HTTP 201") }
        return user
    }

    func plan() async throws -> PlanInfo {
        try await http.getJson("/api/billing")
    }

    func prepareApplePurchase() async throws -> ApplePurchasePreparation {
        let body: JSONValue = ["prepare": .bool(true)]
        return try await http.send(try http.request("POST", "/api/billing/apple", json: body))
    }

    func releaseApplePurchase(_ reservation: String) async throws {
        let body: JSONValue = ["release": .string(reservation)]
        let _: ApiError = try await http.send(try http.request("POST", "/api/billing/apple", json: body))
    }

    func confirmApplePurchase(_ transaction: String) async throws -> ApplePurchaseStatus {
        let body: JSONValue = ["transaction": .string(transaction)]
        struct Response: Decodable { let status: ApplePurchaseStatus }
        let response: Response = try await http.send(try http.request("POST", "/api/billing/apple", json: body))
        return response.status
    }

    func accountAppIcon() async throws -> AppIconResponse {
        try await http.getJson("/api/app-icon", as: AppIconResponse.self)
    }

    func saveAccountAppIcon(_ icon: String?) async throws -> AppIconResponse {
        let body: JSONValue = ["icon": ApiJson.string(icon)]
        return try await http.send(try http.request("PUT", "/api/app-icon", json: body), as: AppIconResponse.self)
    }

    func customInstructions() async throws -> String? {
        try await http.getJson("/api/custom-instructions", as: CustomInstructionsResponse.self).instructions
    }

    func saveCustomInstructions(_ instructions: String) async throws -> String? {
        let body: JSONValue = ["instructions": .string(instructions)]
        return try await http.send(
            try http.request("PUT", "/api/custom-instructions", json: body), as: CustomInstructionsResponse.self
        ).instructions
    }
}
