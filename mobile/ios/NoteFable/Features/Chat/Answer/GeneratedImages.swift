import Photos
import SwiftUI
import UIKit

// 回答里生成的图片和"生成中"的占位卡片（网页 chat-message.tsx 的 .generated-image-*，Android `AssistantTurn.kt` 的 GeneratedImage、
// `AttachUi.kt` 的 GeneratingImagePreview）。

// MARK: - 生成的图片

/// .generated-image-grid：最宽 576、间距 12、下距 13.6。
struct GeneratedImageGrid: View {
    let images: [GeneratedImageDto]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(images) { image in
                GeneratedImageView(image: image)
            }
        }
        .frame(maxWidth: 576, alignment: .leading)
        .padding(.bottom, 13.6)
    }
}

/// .generated-image-shell + .generated-image-download：圆角 4.8、1px #e2e8f0、#f8fafc 底；
/// 右下角的下载键 44 圆形、#0f172a .72 底、白色 Download 20，离右下角各 14.4，阴影 0 12 30 .28。
@MainActor
private struct GeneratedImageView: View {
    let image: GeneratedImageDto

    @Environment(AppEnvironment.self) private var app
    /// 读到的图片和读它时的身份。地址变了（data: 换成存好后的 `/api/attachments/…/image`）还是同一张图（按 id 排），
    /// 新地址读完前接着显示；换了身份就不再显示。
    @State private var loaded: (image: UIImage, generation: Int)? = nil

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 4.8)
        picture
            .frame(maxWidth: .infinity)
            .background(Color(argb: 0xFFF8FAFC))
            .clipShape(shape)
            .overlay { shape.strokeBorder(Color(argb: 0xFFE2E8F0), lineWidth: 1) }
            .overlay(alignment: .bottomTrailing) {
                Button {
                    GeneratedImageSaver.save(image, app: app)
                } label: {
                    LucideIcon(Lucide.download, size: 20, color: .white)
                        .frame(width: 44, height: 44)
                        .background(Color(argb: 0xB80F172A), in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 22, scale: 0.97))
                .shadow(color: Color(argb: 0x470F172A), radius: 15, x: 0, y: 12)
                .padding(.trailing, 14.4)
                .padding(.bottom, 14.4)
                .accessibilityLabel(L("image_download"))
            }
            .task(id: RemoteImageRequest(path: image.dataUrl, generation: app.identityGeneration)) {
                let result = await RemoteImageLoader.image(image.dataUrl, app: app)
                if Task.isCancelled { return }
                // 新地址读不到时留着同一张图的旧结果（同一身份下）。
                if let result { loaded = (result, app.identityGeneration) }
            }
    }

    /// 占满宽度、高度按图片的宽高比；读到之前先占一个正方形。
    @ViewBuilder
    private var picture: some View {
        let current = loaded.flatMap { $0.generation == app.identityGeneration ? $0.image : nil }
        if let shown = RemoteImageLoader.cachedImage(image.dataUrl, app: app) ?? current {
            Image(uiImage: shown)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .accessibilityLabel(L("generated_image"))
        } else {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
        }
    }
}

// MARK: - 存进相册

/// 生成图片的"下载"：存进系统相册（Android 是 Pictures 目录）。只申请"添加照片"的权限，不读相册。
/// 文件名和网页的下载名同一个规则：`notefable-<id>.<扩展名>`，扩展名按图片的类型（jpg / webp / gif，默认 png），
/// id 里不安全的字符换成 `_`。保存在 App 级的任务里跑：这一回合滚出屏幕、对账换了消息 ID 也不中断。
enum GeneratedImageSaver {
    static func fileName(id: String, mimeType: String) -> String {
        var safe = ""
        for scalar in id.unicodeScalars {
            if ChatText.isASCIIAlphanumeric(scalar) || scalar == "." || scalar == "_" || scalar == "-" {
                safe.unicodeScalars.append(scalar)
            } else {
                safe.append("_")
            }
        }
        while safe.hasPrefix(".") { safe.removeFirst() }
        while safe.hasSuffix(".") { safe.removeLast() }
        if safe.isEmpty { safe = "image" }
        return "notefable-\(safe).\(fileExtension(mimeType))"
    }

    static func fileExtension(_ mimeType: String) -> String {
        let type = mimeType.lowercased().prefix { $0 != ";" }.trimmingCharacters(in: .whitespaces)
        switch type {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/webp": return "webp"
        case "image/gif": return "gif"
        default: return "png"
        }
    }

    /// 按文件头认图片的类型；认不出来返回 nil（用服务端给的类型）。
    static func sniffMimeType(_ data: Data) -> String? {
        let head = [UInt8](data.prefix(12))
        if head.count >= 3, head[0] == 0xFF, head[1] == 0xD8, head[2] == 0xFF { return "image/jpeg" }
        if head.count >= 4, head[0] == 0x89, head[1] == 0x50, head[2] == 0x4E, head[3] == 0x47 { return "image/png" }
        if head.count >= 4, head[0] == 0x47, head[1] == 0x49, head[2] == 0x46, head[3] == 0x38 { return "image/gif" }
        if head.count >= 12, head[0] == 0x52, head[1] == 0x49, head[2] == 0x46, head[3] == 0x46,
           head[8] == 0x57, head[9] == 0x45, head[10] == 0x42, head[11] == 0x50 { return "image/webp" }
        return nil
    }

    /// 开始保存并用提示条说明进度和结果（开始时是网页已有的"正在下载…"）。
    @MainActor
    static func save(_ image: GeneratedImageDto, app: AppEnvironment) {
        Toast.show(L("downloading"))
        Task { @MainActor in
            do {
                // 刚生成的是 data: 地址（直接解码），历史里的是 `/api/attachments/<id>/image`（带 App 的 Cookie 读）。
                let data: Data
                if let bytes = dataUrlBytes(image.dataUrl) {
                    data = bytes
                } else {
                    data = try await app.fetchData(image.dataUrl)
                }
                let name = fileName(id: image.id, mimeType: sniffMimeType(data) ?? image.mimeType)
                try await addToPhotos(data, fileName: name)
                Toast.show(L("save_saved"))
            } catch GeneratedImageSaveError.photosDenied {
                Toast.show(L("photos_access_denied"), long: true)
            } catch {
                Toast.show(L("request_failed", app.systemText.localize(chatFailureDetail(error))), long: true)
            }
        }
    }

    private static func addToPhotos(_ data: Data, fileName: String) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw GeneratedImageSaveError.photosDenied }
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            let options = PHAssetResourceCreationOptions()
            options.originalFilename = fileName
            // 原样写入字节（不重新编码），类型和文件名都保留。
            request.addResource(with: .photo, data: data, options: options)
        }
    }
}

enum GeneratedImageSaveError: Error {
    /// 用户没有允许往相册里添加照片。
    case photosDenied
}

// MARK: - 生成中

/// 图片生成中的占位卡片（.generated-image-placeholder）：最宽 448、1px 描边、圆角 5.6；
/// 上面一行是图标 + 两行说明 + 三个跳动的点，下面是 16:9 的浅灰画布，底部有一条扫过去的蓝色进度线。
/// "减弱动态效果"时点和进度线不动。
struct GeneratingImagePreview: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 5.6)
        VStack(alignment: .leading, spacing: 0) {
            header
            canvas
        }
        .frame(maxWidth: 448, alignment: .leading)
        .background(Color.white)
        .clipShape(shape)
        .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
    }

    private var header: some View {
        HStack(spacing: 10.4) {
            LucideIcon(Lucide.imagePlus, size: 18, strokeWidth: 1.7, color: Sm.muted)
                .frame(width: 30.4, height: 30.4)
                .background(Sm.sidebar, in: RoundedRectangle(cornerRadius: 4.8))
            VStack(alignment: .leading, spacing: 2) {
                Text(L("generating_image"))
                    .font(.nf(14, weight: 500))
                    .nfLineHeight(20, fontSize: 14)
                    .foregroundStyle(Sm.text)
                Text(L("generating_image_wait"))
                    .font(.nf(12))
                    .nfLineHeight(16, fontSize: 12)
                    .foregroundStyle(Sm.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            dots
                .padding(.trailing, 2.4)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10.4)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) { NFDivider() }
    }

    /// 三个点：1.2 秒一轮，30% 处最亮并上移 2，其余时间 .35；依次错开 150 毫秒。
    @ViewBuilder
    private var dots: some View {
        if reduceMotion {
            dotRow { _ in 0 }
        } else {
            TimelineView(.animation) { context in
                let time = context.date.timeIntervalSinceReferenceDate
                dotRow { index in Self.dotPhase(time - Double(index) * 0.15) }
            }
        }
    }

    private func dotRow(phase: (Int) -> Double) -> some View {
        HStack(spacing: 3.2) {
            ForEach(0..<3, id: \.self) { index in
                let value = phase(index)
                Circle()
                    .fill(Sm.faint)
                    .frame(width: 3.84, height: 3.84)
                    .opacity(0.35 + 0.65 * value)
                    .offset(y: -2 * value)
            }
        }
        .accessibilityHidden(true)
    }

    private static func dotPhase(_ time: Double) -> Double {
        var t = time.truncatingRemainder(dividingBy: 1.2)
        if t < 0 { t += 1.2 }
        if t < 0.36 { return t / 0.36 }
        if t < 0.72 { return 1 - (t - 0.36) / 0.36 }
        return 0
    }

    private var canvas: some View {
        Sm.sidebar
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay { LucideIcon(Lucide.imagePlus, size: 28, strokeWidth: 1.5, color: Sm.faint) }
            .overlay {
                if !reduceMotion {
                    TimelineView(.animation) { context in
                        // 1.8 秒一轮：前 55% 的时间从左扫到右，剩下的时间停在右边外面。
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8)
                        GeneratingImageSweep(progress: min(1, t / 0.99))
                    }
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }
}

/// 画布上掠过的高光和底部的进度线（宽 42%、高 2，从左侧外面滑到右侧外面）。和网页一样不随界面方向镜像。
private struct GeneratingImageSweep: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            let bar = width * 0.42
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    stops: [
                        .init(color: Color.white.opacity(0), location: 0.28),
                        .init(color: Color.white.opacity(0.7), location: 0.48),
                        .init(color: Color.white.opacity(0), location: 0.68),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: width, height: height)
                .offset(x: -width + progress * 2 * width)
                Rectangle()
                    .fill(Sm.blue)
                    .frame(width: bar, height: 2)
                    .offset(x: -1.05 * bar + progress * 3.45 * bar, y: height - 2)
            }
            .frame(width: width, height: height, alignment: .topLeading)
        }
        .environment(\.layoutDirection, .leftToRight)
    }
}
