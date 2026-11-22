import ImageIO
import SwiftUI
import UIKit

// 头像裁剪（网页 src/components/avatar-cropper.tsx + globals.css 的 .avatar-*，手机宽度 ≤639 的值；Android ui/AvatarCropper.kt）：
// - 整体（.avatar-cropper）：内容居中、间距 10、内边距 14。
// - 预览圆（.avatar-crop-view）：直径 200，--notion-active 底，外侧 1px --notion-border-strong 细环；拖动换位置。
// - 缩放（.avatar-zoom）：整行，"Zoom" 12 灰字 + 间距 10 + 滑块（1–3，蓝色 accent）。
// - 提示（.avatar-crop-hint）12 灰字；错误（.profile-error）12 #b91c1c、上距 10。
// - 按钮行（.avatar-crop-actions）：靠行尾、间距 8；按钮高 42、左右 14、圆角 6、15 字；"保存"是 --nf-ink 底白字；禁用时 .55。
// 保存时把圆里看到的部分画成 512×512 的正方形上传。位置和大小的计算在 Core 的 `cropLayout`。

// MARK: - 读图、画图

/// 读照片的结果（网页 createImageBitmap 的成功 / 太小 / 读不了）。
enum AvatarImageSource: @unchecked Sendable {
    case ready(CGImage)
    case problem(AvatarSourceProblem)
}

/// 跨线程带一个值（位图、渲染参数只读不改）。
private struct AvatarSendableBox<Value>: @unchecked Sendable {
    let value: Value
}

enum AvatarImageDecoder {
    /// 读照片并按 EXIF 摆正（网页 imageOrientation: "from-image"）。GIF 只取第一帧，和网页相同。
    /// 默认是头像的规则；设置里的"图标"用同一条路，只是不限最小边、缩得更小。在后台线程调用。
    static func decode(
        _ data: Data,
        minSide: Int = AVATAR_MIN_SIDE,
        sampleSize: (_ width: Int, _ height: Int) -> Int = { avatarSampleSize($0, $1) }
    ) -> AvatarImageSource {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return .problem(.unreadable) }
        let pixelWidth = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
        let pixelHeight = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        // EXIF 5…8 是转了 90° 的：摆正之后宽高对调。
        let rotated = orientation >= 5 && orientation <= 8
        let width = rotated ? pixelHeight : pixelWidth
        let height = rotated ? pixelWidth : pixelHeight
        if let problem = checkAvatarSource(width: width, height: height, minSide: minSide) {
            return .problem(problem)
        }
        // 不把 10 MB 的原图整个解出来：按 2 的幂缩小到够用的大小，同时摆正。
        let sample = max(1, sampleSize(width, height))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, max(width, height) / sample),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return .problem(.unreadable)
        }
        return .ready(image)
    }

    /// 网页 save()：把圆里看到的部分画到 512×512 上，按 `AVATAR_MIME_TYPE` / `AVATAR_QUALITY` 编码。
    static func renderAvatar(_ image: CGImage, layout: CropLayout) -> Data? {
        let side = CGFloat(AVATAR_OUTPUT)
        let png = AVATAR_MIME_TYPE == "image/png"
        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        format.opaque = !png
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        let rendered = renderer.image { context in
            if !png {
                // JPEG 没有透明：透明的地方垫白。
                UIColor.white.setFill()
                context.fill(CGRect(x: 0, y: 0, width: side, height: side))
            }
            context.cgContext.interpolationQuality = .high
            UIImage(cgImage: image).draw(in: avatarOutputRect(layout))
        }
        return png ? rendered.pngData() : rendered.jpegData(compressionQuality: CGFloat(AVATAR_QUALITY))
    }

    /// 设置里的"图标"：居中裁成正方形、缩到 96×96、存成 PNG 的 data URL（网页 imageFileToIcon）。读不出来返回 nil。
    static func renderAppIcon(_ data: Data) -> AppIconValue? {
        let decoded = decode(data, minSide: 1, sampleSize: { appIconSampleSize(width: $0, height: $1) })
        guard case .ready(let image) = decoded else { return nil }
        let crop = appIconCrop(width: image.width, height: image.height)
        guard crop.side > 0,
              let square = image.cropping(to: CGRect(x: crop.left, y: crop.top, width: crop.side, height: crop.side))
        else { return nil }
        let side = CGFloat(appIconImageSize)
        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = 1
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        let rendered = renderer.image { context in
            context.cgContext.interpolationQuality = .high
            UIImage(cgImage: square).draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }
        guard let png = rendered.pngData() else { return nil }
        return appIconDataUrl(png)
    }

    /// 在后台线程读照片。
    static func decodeInBackground(_ data: Data) async -> AvatarImageSource {
        await Task.detached(priority: .userInitiated) { AvatarImageDecoder.decode(data) }.value
    }

    /// 在后台线程画成要上传的图片。
    static func renderAvatarInBackground(_ image: CGImage, layout: CropLayout) async -> Data? {
        let box = AvatarSendableBox(value: image)
        return await Task.detached(priority: .userInitiated) { AvatarImageDecoder.renderAvatar(box.value, layout: layout) }.value
    }

    /// 在后台线程做成"图标"的存储值。
    static func renderAppIconInBackground(_ data: Data) async -> AppIconValue? {
        await Task.detached(priority: .userInitiated) { AvatarImageDecoder.renderAppIcon(data) }.value
    }
}

// MARK: - 裁剪界面

/// 网页 AvatarCropper：拖动换位置、滑块缩放、保存成正方形。`data` 是选好的原图；`error` 是上传失败的提示（已翻译），
/// 读照片的问题在这里自己显示。换一张照片时由调用处换 `.id`，状态重新开始。
struct AvatarCropper: View {
    let data: Data
    let saving: Bool
    let error: String?
    let onCancel: () -> Void
    let onSave: (Data) -> Void

    /// 读到的照片；nil 是还在读。
    @State private var source: AvatarImageSource?
    @State private var zoom: Double = 1
    @State private var offsetX: Double = 0
    @State private var offsetY: Double = 0
    /// 拖动开始时的偏移：之后每次用"原偏移 + 总位移"重新夹（拖出边界再拖回来时与网页一致）。
    @State private var dragOrigin: CGSize?
    @State private var exporting = false
    /// 正在画要上传的图片。裁剪界面没了（取消、关掉编辑区）就作废，画完也不上传（Android 的 scope 随界面取消）。
    @State private var export: Task<Void, Never>?

    init(data: Data, saving: Bool, error: String?, onCancel: @escaping () -> Void, onSave: @escaping (Data) -> Void) {
        self.data = data
        self.saving = saving
        self.error = error
        self.onCancel = onCancel
        self.onSave = onSave
    }

    private var image: CGImage? {
        if case .ready(let image) = source { return image }
        return nil
    }

    private var loadError: String? {
        guard case .problem(let problem) = source else { return nil }
        switch problem {
        case .tooSmall: return L("acct_photo_too_small", AVATAR_MIN_SIDE)
        case .unreadable: return L("acct_photo_unreadable")
        }
    }

    private func layout(for image: CGImage, zoom: Double, offsetX: Double, offsetY: Double) -> CropLayout {
        cropLayout(
            imageWidth: Double(image.width), imageHeight: Double(image.height),
            zoom: zoom, offsetX: offsetX, offsetY: offsetY
        )
    }

    var body: some View {
        let image = self.image
        let current = image.map { layout(for: $0, zoom: zoom, offsetX: offsetX, offsetY: offsetY) }
        VStack(spacing: 10) {
            preview(image, current)
            HStack(spacing: 10) {
                Text(L("acct_zoom"))
                    .font(.nf(12))
                    .foregroundStyle(Sm.muted)
                Slider(
                    value: Binding(get: { zoom }, set: { setZoom($0) }),
                    in: 1...AVATAR_MAX_ZOOM
                )
                .tint(Sm.blue)
                .disabled(image == nil)
                .accessibilityLabel(L("acct_zoom"))
            }
            Text(L("acct_crop_hint"))
                .font(.nf(12))
                .foregroundStyle(Sm.muted)
            if let message = loadError ?? error {
                Text(message)
                    .font(.nf(12))
                    .foregroundStyle(Sm.danger)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                AvatarCropButton(label: L("cancel"), primary: false, action: onCancel)
                    .disabled(saving)
                AvatarCropButton(label: L(saving ? "save_saving" : "save"), primary: true) {
                    save(image, current)
                }
                .disabled(image == nil || saving || exporting)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(14)
        .task {
            let decoded = await AvatarImageDecoder.decodeInBackground(data)
            if !Task.isCancelled { source = decoded }
        }
        .onDisappear {
            export?.cancel()
            export = nil
        }
    }

    /// 预览圆：直径 200，外侧 1px 的细环（box-shadow 0 0 0 1px），所以外框是 202。照片不随界面方向翻转。
    private func preview(_ image: CGImage?, _ current: CropLayout?) -> some View {
        ZStack(alignment: .topLeading) {
            Sm.active
            if let image, let current {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: current.w, height: current.h)
                    .offset(x: current.dx, y: current.dy)
            }
        }
        .frame(width: AVATAR_VIEW, height: AVATAR_VIEW, alignment: .topLeading)
        .clipShape(Circle())
        .contentShape(Circle())
        .gesture(drag(image))
        .padding(1)
        .overlay { Circle().strokeBorder(Sm.borderStrong, lineWidth: 1) }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement()
        .accessibilityLabel(L("acct_crop_preview"))
    }

    private func drag(_ image: CGImage?) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                guard let image else { return }
                let origin = dragOrigin ?? CGSize(width: offsetX, height: offsetY)
                if dragOrigin == nil { dragOrigin = origin }
                let next = layout(
                    for: image, zoom: zoom,
                    offsetX: Double(origin.width + value.translation.width),
                    offsetY: Double(origin.height + value.translation.height)
                )
                offsetX = next.offsetX
                offsetY = next.offsetY
            }
            .onEnded { _ in dragOrigin = nil }
    }

    /// 缩小时照片可能露出空白：偏移跟着重新夹一次。
    private func setZoom(_ value: Double) {
        zoom = value
        guard let image else { return }
        let next = layout(for: image, zoom: value, offsetX: offsetX, offsetY: offsetY)
        offsetX = next.offsetX
        offsetY = next.offsetY
    }

    private func save(_ image: CGImage?, _ current: CropLayout?) {
        guard let image, let current, !exporting else { return }
        exporting = true
        let onSave = self.onSave
        export = Task { @MainActor in
            let bytes = await AvatarImageDecoder.renderAvatarInBackground(image, layout: current)
            if Task.isCancelled { return }
            exporting = false
            export = nil
            if let bytes { onSave(bytes) }
        }
    }
}

private struct AvatarCropButton: View {
    let label: String
    let primary: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.nf(15))
                .foregroundStyle(primary ? Sm.onInk : Sm.text)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: 42)
        }
        .buttonStyle(.pressable(
            background: primary ? Sm.ink : .clear,
            pressedBackground: primary ? Sm.inkHover : Sm.hover,
            cornerRadius: 6, scale: 0.97, disabledOpacity: 0.55
        ))
    }
}
