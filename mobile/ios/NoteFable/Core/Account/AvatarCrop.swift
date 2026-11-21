import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

// 头像裁剪里不画界面的计算（Android ui/AvatarCropper.kt；网页 avatar-cropper.tsx）。读图、画图在界面层。

/// 预览圆的直径（pt = CSS px）。
let AVATAR_VIEW: Double = 200

/// 保存的正方形边长（网页 AVATAR_OUTPUT）。
let AVATAR_OUTPUT = 512

/// 短边比这小的照片不收（网页 AVATAR_MIN_SIDE）。
let AVATAR_MIN_SIDE = 200

/// 缩放滑块的范围是 1…3。
let AVATAR_MAX_ZOOM: Double = 3

/// 上传的图片类型。网页和 Android 存 WebP（质量 .9）；iOS 的系统库不能写 WebP，所以存 JPEG（质量 .9），
/// 服务端按内容判断类型，两种都收。
let AVATAR_MIME_TYPE = "image/jpeg"
let AVATAR_QUALITY: Double = 0.9

/// 照片在预览圆里的位置和大小（单位与 view 相同），以及夹过之后的偏移。
struct CropLayout: Equatable, Sendable {
    var dx: Double
    var dy: Double
    var w: Double
    var h: Double
    var offsetX: Double
    var offsetY: Double
}

/// 网页 layoutFor：照片按短边铺满圆（× zoom），偏移夹在不露出空白的范围里。
func cropLayout(
    imageWidth: Double, imageHeight: Double, zoom: Double, offsetX: Double, offsetY: Double, view: Double = AVATAR_VIEW
) -> CropLayout {
    let scale = max(view / imageWidth, view / imageHeight) * zoom
    let w = imageWidth * scale
    let h = imageHeight * scale
    // 浮点误差会让刚好铺满的一边算出 -0.00001：夹到 0，否则范围倒过来。
    let limitX = max(0, (w - view) / 2)
    let limitY = max(0, (h - view) / 2)
    let x = min(max(offsetX, -limitX), limitX)
    let y = min(max(offsetY, -limitY), limitY)
    return CropLayout(dx: (view - w) / 2 + x, dy: (view - h) / 2 + y, w: w, h: h, offsetX: x, offsetY: y)
}

/// 保存时（网页 save()：把圆里看到的部分画到 512×512 上）整张照片在 512×512 画布上的位置：预览里的位置 × 512 / view。
func avatarOutputRect(_ layout: CropLayout, view: Double = AVATAR_VIEW) -> CGRect {
    let ratio = Double(AVATAR_OUTPUT) / view
    // 先算成 Double 再建 CGRect：四个乘法直接写在参数里，Apple 平台的类型检查会超时（Double / CGFloat 两种重载）。
    let x: Double = layout.dx * ratio
    let y: Double = layout.dy * ratio
    let width: Double = layout.w * ratio
    let height: Double = layout.h * ratio
    return CGRect(x: x, y: y, width: width, height: height)
}

/// 解码后最多这么多像素（ARGB 约 80 MB）：再大的位图画不动，还容易把内存用光。
let AVATAR_MAX_DECODED_PIXELS: Int64 = 20_000_000

/// 解码时的缩小倍数（2 的幂）：放大到最大（3 倍）时圆里看到的部分仍有 512 像素，所以短边保留到 512 × 3 以上就够了，
/// 不必把 10 MB 的原图整个读进内存。很长的截图 / 全景图短边不大但像素很多，再按总像素数继续缩小。
func avatarSampleSize(_ width: Int, _ height: Int) -> Int {
    let needed = AVATAR_OUTPUT * Int(AVATAR_MAX_ZOOM)
    var sample = 1
    while min(width, height) / (sample * 2) >= needed { sample *= 2 }
    while (Int64(width) / Int64(sample)) * (Int64(height) / Int64(sample)) > AVATAR_MAX_DECODED_PIXELS { sample *= 2 }
    return sample
}

/// 读照片的结果里不能用的两种（网页 createImageBitmap 的 太小 / 读不了）；能用时界面层自己拿着位图。
enum AvatarSourceProblem: Equatable, Sendable {
    /// acct_photo_too_small
    case tooSmall
    /// acct_photo_unreadable
    case unreadable
}

/// 摆正之后的尺寸够不够（短边至少 [minSide]）。尺寸读不出来（0）算读不了。
func checkAvatarSource(width: Int, height: Int, minSide: Int = AVATAR_MIN_SIDE) -> AvatarSourceProblem? {
    if width <= 0 || height <= 0 { return .unreadable }
    return min(width, height) < minSide ? .tooSmall : nil
}
