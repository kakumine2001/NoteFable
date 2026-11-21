import Foundation
import SwiftUI

/// 一层已经换成 `Path` 的图形（Android Mascot.kt 的 ParsedLayer）。坐标是角色画布（240×240）上的单位。
struct MascotLayer {
    let path: Path
    let fill: Color?
    let fillStyle: FillStyle
    let stroke: Color?
    let strokeStyle: StrokeStyle?

    init(_ spec: CharacterPath) {
        path = SVGPath.path(spec.d)
        fill = spec.fillArgb.map { Color(argb: $0) }
        fillStyle = FillStyle(eoFill: spec.evenOdd)
        if let strokeArgb = spec.strokeArgb, spec.strokeWidth > 0 {
            let cap: CGLineCap
            switch spec.strokeCap {
            case .butt: cap = .butt
            case .round: cap = .round
            case .square: cap = .square
            }
            let join: CGLineJoin
            switch spec.strokeJoin {
            case .miter: join = .miter
            case .round: join = .round
            case .bevel: join = .bevel
            }
            stroke = Color(argb: strokeArgb)
            // SVG 的 stroke-miterlimit 默认是 4（Compose 的 Stroke 也是）。
            strokeStyle = StrokeStyle(lineWidth: CGFloat(spec.strokeWidth), lineCap: cap, lineJoin: join, miterLimit: 4)
        } else {
            stroke = nil
            strokeStyle = nil
        }
    }
}

/// 一只眼睛。胶囊眼自带的倾斜已经算进 `path`，画的时候只需要绕 `center` 做眨眼的纵向缩放。
struct MascotEye {
    let path: Path
    let center: CGPoint
    let fill: Color

    init(_ spec: CharacterEye) {
        center = CGPoint(x: spec.cx, y: spec.cy)
        fill = Color(argb: spec.fillArgb)
        switch spec {
        case .capsule(let eye):
            let rect = CGRect(x: eye.x, y: eye.y, width: eye.width, height: eye.height)
            // SVG 的 rx 是正圆角，不要 SwiftUI 默认的连续曲率圆角。
            let capsule = Path(roundedRect: rect, cornerRadius: CGFloat(eye.rx), style: .circular)
            if eye.rotation == 0 {
                path = capsule
            } else {
                // SVG 的 rotate(角度 cx cy)：绕眼睛中心顺时针转。
                let turn = CGAffineTransform(translationX: CGFloat(eye.cx), y: CGFloat(eye.cy))
                    .rotated(by: CGFloat(eye.rotation * Double.pi / 180))
                    .translatedBy(x: CGFloat(-eye.cx), y: CGFloat(-eye.cy))
                path = capsule.applying(turn)
            }
        case .polygon(let eye):
            path = SVGPath.path(eye.d)
        }
    }
}

/// 一个角色的全部图层，由下往上：后饰件 → 身体 → 前饰件 → 眼睛（Android ParsedCharacter）。
struct MascotArt {
    let spec: CharacterArtSpec
    let backAccents: [MascotLayer]
    let body: [MascotLayer]
    let frontAccents: [MascotLayer]
    let eyes: [MascotEye]
    let accentPivot: CGPoint

    init(_ spec: CharacterArtSpec) {
        self.spec = spec
        backAccents = spec.backAccentPaths.map { MascotLayer($0) }
        body = spec.bodyPaths.map { MascotLayer($0) }
        frontAccents = spec.frontAccentPaths.map { MascotLayer($0) }
        eyes = spec.eyes.map { MascotEye($0) }
        accentPivot = CGPoint(x: spec.accentPivotX, y: spec.accentPivotY)
    }

    /// 路径只解析一次：同一个角色在侧栏、回答标签、空白首页反复出现。
    static func art(for id: CharacterId) -> MascotArt {
        MascotArtCache.shared.art(for: id)
    }
}

private final class MascotArtCache: @unchecked Sendable {
    static let shared = MascotArtCache()

    private let lock = NSLock()
    private var items: [CharacterId: MascotArt] = [:]

    func art(for id: CharacterId) -> MascotArt {
        lock.lock()
        defer { lock.unlock() }
        if let cached = items[id] { return cached }
        let art = MascotArt(CharacterCatalog.spec(id))
        items[id] = art
        return art
    }
}
