import SwiftUI
import UIKit

// 本站的图片（附件、生成的图片、头像、回答里的插图）：服务端只把它们给主人，所以要带着 App 的 Cookie 读
// （`AppEnvironment.fetchData`，Android 让 Coil 复用同一个 OkHttp 客户端）。刚生成的图片是 data: 地址，直接解码。

/// 读图片并解码。解码放在后台线程（大图解码要几十毫秒），解好的留在内存里，同一张图再出现时不闪。
enum RemoteImageLoader {
    /// 解好的图片。按身份分开存：换身份后旧身份的图片不再命中（`AppEnvironment.identityGeneration`）。
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 96
        // 按解码后的像素字节数算，约 96 MB。
        cache.totalCostLimit = 96 * 1024 * 1024
        return cache
    }()

    /// `path` 是 `/api/…` 的相对路径、完整的 http(s) 地址，或 `data:` 地址。读不到、解不出来返回 nil。
    @MainActor
    static func image(_ path: String, app: AppEnvironment) async -> UIImage? {
        let key = cacheKey(path, generation: app.identityGeneration)
        if let cached = cache.object(forKey: key) { return cached }
        let data: Data
        if path.hasPrefix("data:") {
            guard let bytes = dataUrlBytes(path) else { return nil }
            data = bytes
        } else {
            guard let bytes = try? await app.fetchData(path) else { return nil }
            data = bytes
        }
        let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let image = UIImage(data: data) else { return nil }
            // 先在后台把位图解出来，第一次画的时候主线程不用再解码。
            return image.preparingForDisplay() ?? image
        }.value
        guard let decoded else { return nil }
        cache.setObject(decoded, forKey: key, cost: cost(of: decoded))
        return decoded
    }

    /// 已经解好的图片（没有就是 nil，不发请求）。视图第一次画的时候用它，滚回来的图片不闪一下占位色。
    @MainActor
    static func cachedImage(_ path: String, app: AppEnvironment) -> UIImage? {
        cache.object(forKey: cacheKey(path, generation: app.identityGeneration))
    }

    private static func cacheKey(_ path: String, generation: Int) -> NSString {
        // data: 地址可能有几 MB，不拿整串当键。
        if path.hasPrefix("data:") { return "data:\(path.utf8.count):\(path.hashValue)" as NSString }
        return "\(generation)|\(path)" as NSString
    }

    private static func cost(of image: UIImage) -> Int {
        let pixels = image.size.width * image.scale * image.size.height * image.scale
        return max(1, Int(pixels) * 4)
    }
}

/// 一张本站的图片。读到之前（和读不到时）是 `Sm.hover` 的占位色。
/// - `.fill`（默认）：占满外面给的框、多出来的裁掉（缩略图、头像）。尺寸和圆角由调用方定：
///   `RemoteImage(path: url).frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))`
/// - `.fit`：读到后按图片自己的宽高比显示在给的宽度里；读到之前占满给的框。
/// 纯装饰，读屏文字由调用方加（`accessibilityLabel`）。
struct RemoteImage: View {
    private let path: String
    private let contentMode: ContentMode

    @Environment(AppEnvironment.self) private var app
    @State private var loaded: LoadedImage? = nil

    init(path: String, contentMode: ContentMode = .fill) {
        self.path = path
        self.contentMode = contentMode
    }

    var body: some View {
        let image = currentImage
        Group {
            if contentMode == .fit, let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Sm.hover
                    .overlay {
                        if let image {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        }
                    }
                    .clipped()
            }
        }
        .accessibilityHidden(true)
        .task(id: RemoteImageRequest(path: path, generation: app.identityGeneration)) {
            let image = await RemoteImageLoader.image(path, app: app)
            if Task.isCancelled { return }
            loaded = image.map { LoadedImage(path: path, image: $0) }
        }
    }

    /// 换了地址后旧图不再显示；缓存里有的直接用。
    private var currentImage: UIImage? {
        if let loaded, loaded.path == path { return loaded.image }
        return RemoteImageLoader.cachedImage(path, app: app)
    }
}

private struct LoadedImage {
    let path: String
    let image: UIImage
}

/// `.task(id:)` 的标识：地址或身份变了就重新读。
private struct RemoteImageRequest: Equatable {
    let path: String
    let generation: Int
}
