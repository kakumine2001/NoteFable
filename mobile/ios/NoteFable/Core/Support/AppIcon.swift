import Foundation
import Observation

// 设置里的 AI 角色 / 自定义图标（网页 src/lib/app-icon.ts，Android data/AppIcon.kt）：
// 空聊天首页的大形象、AI 回答顶部的标识、侧栏图标、笔记 AI 按钮、设置预览全部跟随当前选择。
// 保存在当前设备上；登录时还会和账号同步（AppIconSync.swift，网页 app-icon-sync.ts），访客只存在这台设备上。
// nil（未设置）表示默认角色 Quill；其他预设角色存为 "character:<id>"；上传的图片保留 "data:image/..."。
// 旧版本的表情符号或未知值自动回到默认角色（nil -> Quill）。

/// 存下来的图标值：`character:<id>` 或图片的 data URL。和网页 localStorage 的 `notefable:app-icon`、Android 的 `app_icon` 相同。
typealias AppIconValue = String

/// 保存的图片的边长（px）。
let appIconImageSize = 96
let characterIconPrefix = "character:"

enum ResolvedAppIcon: Equatable, Sendable {
    case character(CharacterId)
    case image(dataUrl: String)
}

/// 网页 isImageIcon。
func isImageIcon(_ icon: String) -> Bool {
    icon.hasPrefix("data:image/")
}

func parseCharacterIcon(_ value: String) -> CharacterId? {
    let rawId = value.hasPrefix(characterIconPrefix) ? String(value.dropFirst(characterIconPrefix.count)) : value
    return CharacterId.fromId(rawId)
}

func toCharacterIcon(_ characterId: CharacterId) -> AppIconValue? {
    characterId == .default ? nil : characterIconPrefix + characterId.id
}

/// 读取存储时的兼容归一化（网页 normalizeAppIcon）：
/// - nil / 空串 / "quill" / "character:quill" -> nil（默认角色 Quill）
/// - 有效的预设角色 -> "character:<id>"
/// - 上传图片的 data URL -> 原样保留
/// - 旧版表情、损坏或未知的字符串 -> nil（回到默认角色 Quill）
func normalizeAppIcon(_ value: String?) -> AppIconValue? {
    guard let value, !value.isEmpty else { return nil }
    if isImageIcon(value) { return value }
    return parseCharacterIcon(value).flatMap(toCharacterIcon)
}

/// 和 Android 同名：对存储里读到的值做安全归一化。
func validAppIcon(_ value: String?) -> AppIconValue? {
    normalizeAppIcon(value)
}

func resolveAppIcon(_ icon: String?) -> ResolvedAppIcon {
    let normalized = normalizeAppIcon(icon)
    if let normalized, isImageIcon(normalized) {
        return .image(dataUrl: normalized)
    }
    return .character(normalized.flatMap(parseCharacterIcon) ?? .default)
}

/// 解码后最多这么多像素（和头像相同的上限）。
private let appIconMaxDecodedPixels = 20_000_000

/// 解码选中的图片时的缩小倍数（2 的幂）：短边留到成品的 2 倍以上；很长的图再按总像素数缩小。
func appIconSampleSize(width: Int, height: Int) -> Int {
    var sample = 1
    while min(width, height) / (sample * 2) >= appIconImageSize * 2 { sample *= 2 }
    while (width / sample) * (height / sample) > appIconMaxDecodedPixels { sample *= 2 }
    return sample
}

/// 居中裁出的正方形（网页 imageFileToIcon）。
struct AppIconCrop: Equatable, Sendable {
    let left: Int
    let top: Int
    let side: Int
}

func appIconCrop(width: Int, height: Int) -> AppIconCrop {
    let side = min(width, height)
    return AppIconCrop(left: (width - side) / 2, top: (height - side) / 2, side: side)
}

/// PNG 字节 → 存下来的值（网页 canvas.toDataURL("image/png")）。
func appIconDataUrl(_ png: Data) -> AppIconValue {
    "data:image/png;base64," + png.base64EncodedString()
}

/// 存着的图片的字节；不是 base64 的 data URL、解不出来时为 nil。
func appIconImageBytes(_ icon: String) -> Data? {
    guard isImageIcon(icon), let comma = icon.firstIndex(of: ",") else { return nil }
    guard icon[..<comma].hasSuffix(";base64") else { return nil }
    var payload = String(icon[icon.index(after: comma)...])
    // 和 Android 的 Base64 解码一样允许省略末尾的 "="；Foundation 要求补齐。
    if !payload.hasSuffix("=") {
        switch payload.utf8.count % 4 {
        case 2: payload += "=="
        case 3: payload += "="
        default: break
        }
    }
    return Data(base64Encoded: payload)
}

/// 现在的图标设置。`read` / `write` 是这台设备上的存储（App 里是 UserDefaults）；
/// 存不进去或传入非法值时 `save` 返回 false、显示的图标不变（网页 saveAppIcon）。
@MainActor
@Observable
final class AppIconStore {
    /// 归一化后的存储值；nil = 默认角色 Quill。
    private(set) var icon: AppIconValue?

    @ObservationIgnored private let write: (AppIconValue?) throws -> Bool

    init(read: () throws -> String?, write: @escaping (AppIconValue?) throws -> Bool) {
        self.icon = normalizeAppIcon(try? read())
        self.write = write
    }

    @discardableResult
    func save(_ icon: String?) -> Bool {
        let next: AppIconValue?
        if let icon, !icon.isEmpty {
            if isImageIcon(icon) {
                next = icon
            } else {
                guard let characterId = parseCharacterIcon(icon) else { return false }
                next = toCharacterIcon(characterId)
            }
        } else {
            next = nil
        }
        guard (try? write(next)) == true else { return false }
        self.icon = next
        return true
    }
}
