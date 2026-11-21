import Foundation
import SwiftUI
import UIKit

/// 全应用统一的 AI 角色 / 图标（网页 src/components/app-icon.tsx、character-avatar.tsx 的 ResolvedCharacterAvatar，Android AppIcon）：
/// 没自定义时是默认角色 Quill；选了别的预设角色就画那个角色（可以带状态动画）；上传了图片就显示圆角 22% 的静态缩略图，
/// 读不出来的图片退回默认 Quill。`icon` 是 `AppIconStore.icon` 的存储值，设置里的预览直接传要预览的值。
/// 用到的尺寸：侧栏头部 20、设置预览 24、回答标签 32；空白首页用 `hero`（64 → 64×68，见 `Mascot`）。
/// 纯装饰，需要读屏文字时由调用方加。
struct AppIconView: View {
    private let icon: AppIconValue?
    private let state: CharacterState
    private let size: CGFloat
    private let hero: Bool
    private let animated: Bool

    init(icon: AppIconValue?, state: CharacterState = .idle, size: CGFloat, hero: Bool = false, animated: Bool = false) {
        self.icon = icon
        self.state = state
        self.size = size
        self.hero = hero
        self.animated = animated
    }

    var body: some View {
        switch resolveAppIcon(icon) {
        case .image(let dataUrl):
            if let image = AppIconImageCache.shared.image(for: dataUrl) {
                uploaded(image)
            } else {
                CharacterGraphic(id: .default, state: state, size: size, hero: hero, animated: animated)
            }
        case .character(let characterId):
            CharacterGraphic(id: characterId, state: state, size: size, hero: hero, animated: animated)
        }
    }

    /// 上传的图片：网页 `.app-icon-image`；大形象是 `.nf-mascot-custom`（放在 64×68 的格子中间，带投影）。
    @ViewBuilder
    private func uploaded(_ image: UIImage) -> some View {
        let picture = Image(uiImage: image)
            .resizable()
            .interpolation(.medium)
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .circular))
        if hero {
            picture
                // box-shadow: 0 6px 18px rgba(12, 23, 48, 0.12)
                .shadow(color: Color(argb: 0x1F0C1730), radius: 9, x: 0, y: 6)
                .frame(width: size, height: size * 1.0625)
                .accessibilityHidden(true)
        } else {
            picture
                .accessibilityHidden(true)
        }
    }
}

/// 空白聊天首页的主视觉角色（网页 src/components/mascot.tsx，Android Mascot）：64×68，跟着真实的聊天状态动。
/// 不传 `state` 时按 `lookDown`：true -> typing，false -> idle。
struct Mascot: View {
    private let icon: AppIconValue?
    private let lookDown: Bool
    private let state: CharacterState?

    init(icon: AppIconValue?, lookDown: Bool = false, state: CharacterState? = nil) {
        self.icon = icon
        self.lookDown = lookDown
        self.state = state
    }

    var body: some View {
        AppIconView(icon: icon, state: state ?? (lookDown ? .typing : .idle), size: 64, hero: true, animated: true)
    }
}

/// 最近一次解码的上传图片：同一张图在侧栏、回答标签、设置里反复用，不必每次重新解码（Android rememberAppIconImage）。
private final class AppIconImageCache: @unchecked Sendable {
    static let shared = AppIconImageCache()

    private let lock = NSLock()
    private var key: String?
    private var image: UIImage?

    /// 解不出来（不是 base64、不是图片）时为 nil。
    func image(for dataUrl: String) -> UIImage? {
        lock.lock()
        defer { lock.unlock() }
        if key != dataUrl {
            image = appIconImageBytes(dataUrl).flatMap { UIImage(data: $0) }
            key = dataUrl
        }
        return image
    }
}
