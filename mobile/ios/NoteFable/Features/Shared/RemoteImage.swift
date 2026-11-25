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
        let generation = app.identityGeneration
        let key = cacheKey(path, generation: generation)
        if let cached = cache.object(forKey: key) { return cached }
        let data: Data
        if path.hasPrefix("data:") {
            guard let bytes = dataUrlBytes(path) else { return nil }
            data = bytes
        } else {
            switch source(path, baseURL: app.config.baseURL) {
            case .app:
                guard let bytes = try? await app.fetchData(path) else { return nil }
                data = bytes
            case .external(let url):
                guard let bytes = await fetchExternal(url) else { return nil }
                data = bytes
            case .unsupported:
                return nil
            }
        }
        let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let image = UIImage(data: data) else { return nil }
            // 先在后台把位图解出来，第一次画的时候主线程不用再解码。
            return image.preparingForDisplay() ?? image
        }.value
        // 读的途中换了身份：这是上一个身份的图片，不交给调用方（视图的 .task 要到下一次重绘才取消，可能还没来得及）。
        guard let decoded, app.identityGeneration == generation else { return nil }
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

    private enum Source {
        /// 本站（相对路径或同源的完整地址）：带 App 的 Cookie 读。
        case app
        /// 别的站点的 http(s) 图片（回答里 Markdown 的外链插图、Google 头像）。
        case external(URL)
        /// 其它协议：不读。
        case unsupported
    }

    private static func source(_ path: String, baseURL: String) -> Source {
        // 本站的相对路径只认 `/api/…` 这种以一个 / 开头的：App 的客户端是把它直接接在站点地址后面，
        // 别的写法（`@host/…`、`.host/…`、`:8443/…`、`//host/…`）接上去会变成另一个主机或端口。
        if path.hasPrefix("/") { return path.hasPrefix("//") ? .unsupported : .app }
        // 完整地址只认小写的 http(s):// 开头（App 的客户端按这个判断是不是完整地址）。
        guard path.hasPrefix("http://") || path.hasPrefix("https://"), let url = URL(string: path),
              let scheme = url.scheme?.lowercased(), url.host?.isEmpty == false else { return .unsupported }
        func port(_ url: URL, _ scheme: String) -> Int { url.port ?? (scheme == "https" ? 443 : 80) }
        if let base = URL(string: baseURL), let baseScheme = base.scheme?.lowercased(), baseScheme == scheme,
           base.host?.lowercased() == url.host?.lowercased(), port(base, baseScheme) == port(url, scheme) {
            return .app
        }
        return .external(url)
    }

    /// 别的站点的图片不走 App 的 HTTP 客户端：那边会把任何站点回的 Set-Cookie 存进 App 的 Cookie 罐，
    /// 跳转回本站时还会带上登录 Cookie。这里用一个不读写 Cookie、不留缓存的临时会话（网页里浏览器也不会给外站带本站的 Cookie）。
    private static let externalSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        return URLSession(configuration: configuration)
    }()

    private static func fetchExternal(_ url: URL) async -> Data? {
        if ScreenshotHooks.isActive { return nil }
        guard let result = try? await externalSession.data(from: url),
              let http = result.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return result.0
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
            loaded = image.map { LoadedImage(path: path, generation: app.identityGeneration, image: $0) }
        }
    }

    /// 换了地址或身份后旧图不再显示；缓存里有的直接用。
    private var currentImage: UIImage? {
        if let image = loaded?.current(path, app: app) { return image }
        return RemoteImageLoader.cachedImage(path, app: app)
    }
}

/// 视图里记着的已读到的图片，连同读它时的地址和身份：地址或身份变了就不再拿出来用
/// （`.task(id:)` 重新读完之前，不能把上一个地址 / 上一个身份的图片留在屏幕上）。
struct LoadedImage {
    let path: String
    let generation: Int
    let image: UIImage

    @MainActor
    func current(_ path: String, app: AppEnvironment) -> UIImage? {
        path == self.path && generation == app.identityGeneration ? image : nil
    }
}

/// `.task(id:)` 的标识：地址或身份变了就重新读。
struct RemoteImageRequest: Equatable {
    let path: String
    let generation: Int
}
