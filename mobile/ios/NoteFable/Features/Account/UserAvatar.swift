import SwiftUI
import UIKit

/// 头像（网页 UserAvatar，Android AccountUi.kt 的 UserAvatar）：自己上传的照片 > 表情 > Google 照片 > 名字首字母；
/// 圆形，底色 --notion-active。照片读不出来时和网页 onError 一样退到下一个候选。
/// 上传的照片在本站（`/api/account/avatar/…`），要带 Cookie 读，所以走 `RemoteImageLoader`。
///
/// ```swift
/// UserAvatar(user: user, size: 22)    // 侧栏账号行
/// UserAvatar(user: user, size: 56)    // 设置里的个人资料
/// ```
struct UserAvatar: View {
    private let user: AccountUser
    private let size: CGFloat

    @Environment(AppEnvironment.self) private var app
    /// 读到的图片，按地址存。
    @State private var images: [String: UIImage] = [:]
    /// 读不出来的地址。
    @State private var broken: Set<String> = []

    init(user: AccountUser, size: CGFloat) {
        self.user = user
        self.size = size
    }

    private enum Source: Equatable {
        case photo(String)
        case emoji(String)
        case initial(String)
    }

    private var source: Source {
        if let photo = user.avatarUrl, !photo.isEmpty, !broken.contains(photo) { return .photo(photo) }
        if let icon = user.icon, !icon.isEmpty { return .emoji(icon) }
        if let image = user.image, !image.isEmpty, !broken.contains(image) { return .photo(image) }
        let trimmed = (user.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return .initial(trimmed.first.map { String($0).uppercased() } ?? "?")
    }

    /// 现在要读的图片地址；不是照片时没有。
    private var photoURL: String? {
        if case .photo(let url) = source { return url }
        return nil
    }

    var body: some View {
        content
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityHidden(true)
            .task(id: photoURL) {
                guard let url = photoURL, images[url] == nil else { return }
                if let image = await RemoteImageLoader.image(url, app: app) {
                    images[url] = image
                } else if !Task.isCancelled {
                    broken.insert(url)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch source {
        case .photo(let url):
            if let image = images[url] {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.medium)
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .background(Sm.active)
            } else {
                // 还在读：先是底色。
                Sm.active
            }
        case .emoji(let emoji):
            Text(emoji)
                .font(.system(size: size * 0.62))
                .lineLimit(1)
                .fixedSize()
                .frame(width: size, height: size)
                .background(Color(argb: 0x0F37352F))
        case .initial(let letter):
            Text(letter)
                .font(.nf(size * 0.55, weight: 600))
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
                .fixedSize()
                .frame(width: size, height: size)
                .background(Sm.active)
        }
    }
}
