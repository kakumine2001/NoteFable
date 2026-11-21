import SwiftUI

/// 预设 AI 角色的矢量绘制和语义状态动画（网页 src/components/character-avatar.tsx，Android ui/Mascot.kt 的 CharacterGraphic）。
/// - `hero`：空白首页的大形象，用带地面阴影的 viewBox（宽 `size`、高 `size × 1.0625`，64 → 64×68），出现时有出场动画；
///   否则是图标 viewBox（`size × size`）。
/// - `animated`：跟着 `state` 动（浮动、眨眼、思考、回答、完成 / 出错的单次动作）；不传就画固定姿态。
/// - 系统打开“减弱动态效果”、场景不在前台（scenePhase 不是 active）或 `state == .hidden` 时静止，画 `CharacterCatalog.pose` 的固定姿态。
/// - completed / error 都只动一次，不循环。
/// 纯装饰（网页 aria-hidden），需要读屏文字时由调用方加。
struct CharacterGraphic: View {
    private let characterId: CharacterId
    private let state: CharacterState
    private let size: CGFloat
    private let hero: Bool
    private let animated: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    /// 出场动画从什么时候算起；还没开始时为 nil（这时不画出来，免得先闪一下）。
    @State private var appearedAt: Date?
    @State private var enterFinished = false
    /// 循环动画连续播放的起点（Android 的 InfiniteTransition 何时建的）。
    @State private var loopStartedAt: Date?
    /// 什么时候切到 typing 的；一出现就是 typing 时为 nil（姿态直接到位）。
    @State private var typingStartedAt: Date?
    /// completed / error 的单次动作的起点；播完或没在播时为 nil。
    @State private var burstStartedAt: Date?

    init(id: CharacterId, state: CharacterState = .idle, size: CGFloat, hero: Bool = false, animated: Bool = false) {
        self.characterId = id
        self.state = state
        self.size = size
        self.hero = hero
        self.animated = animated
    }

    /// 正在播动画（Android 的 live）。
    private var live: Bool {
        animated && !reduceMotion && scenePhase == .active && state != .hidden
    }

    /// 网页 `.nf-char.is-hero[data-animated="true"] .nf-char-enter`。
    private var wantsEntrance: Bool {
        hero && animated && !reduceMotion
    }

    var body: some View {
        let art = MascotArt.art(for: characterId)
        let live = self.live
        let looping = live && CharacterMotionTimeline.loops(state)
        let entering = wantsEntrance && !enterFinished
        // 没有东西在动就停表，不空耗电量。
        let ticking = looping || burstStartedAt != nil || entering

        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: !ticking)) { timeline in
            let current = mascotFrame(at: timeline.date, live: live, looping: looping, entering: entering)
            Canvas { context, canvasSize in
                MascotRenderer.draw(art, frame: current, hero: hero, in: context, size: canvasSize)
            }
        }
        .frame(width: size, height: hero ? size * 1.0625 : size)
        .accessibilityHidden(true)
        .onChange(of: looping, initial: true) { _, isLooping in
            loopStartedAt = isLooping ? Date() : nil
        }
        .onChange(of: state) { _, newState in
            typingStartedAt = newState == .typing ? Date() : nil
        }
        .task(id: wantsEntrance) {
            // 出场只播一次：视图被暂时移出再回来时接着原来的时间算，不重播也不闪。
            guard wantsEntrance, !enterFinished else { return }
            let startedAt = appearedAt ?? Date()
            appearedAt = startedAt
            let remainingMs = CharacterMotionTimeline.enterTotalMs + 40 - Self.milliseconds(from: startedAt, to: Date())
            if remainingMs > 0 {
                try? await Task.sleep(nanoseconds: UInt64(remainingMs) * 1_000_000)
            }
            if !Task.isCancelled { enterFinished = true }
        }
        .task(id: BurstTrigger(state: state, live: live)) {
            burstStartedAt = nil
            guard live, let duration = CharacterMotionTimeline.burstDurationMs(state) else { return }
            burstStartedAt = Date()
            try? await Task.sleep(nanoseconds: UInt64(duration) * 1_000_000)
            if !Task.isCancelled { burstStartedAt = nil }
        }
    }

    private func mascotFrame(at now: Date, live: Bool, looping: Bool, entering: Bool) -> MascotFrame {
        var phases = CharacterMotionPhases.rest
        if live {
            phases = CharacterMotionTimeline.phases(
                state: state,
                motion: CharacterCatalog.spec(characterId).motion,
                loopElapsedMs: looping ? (loopStartedAt.map { Self.milliseconds(from: $0, to: now) } ?? 0) : nil,
                typingElapsedMs: typingStartedAt.map { Self.milliseconds(from: $0, to: now) },
                burstElapsedMs: burstStartedAt.map { Self.milliseconds(from: $0, to: now) }
            )
        }
        let pose = computeCharacterDrawPose(
            characterId: characterId,
            state: state,
            hero: hero,
            reducedMotion: reduceMotion,
            live: live,
            phases: phases
        )
        var enter = 1.0
        if entering {
            enter = appearedAt.map { CharacterMotionTimeline.enterProgress(elapsedMs: Self.milliseconds(from: $0, to: now)) } ?? 0
        }
        return MascotFrame(pose: pose, enter: enter, shadowFactor: live && state == .idle ? phases.floatPhase : 0)
    }

    private static func milliseconds(from start: Date, to end: Date) -> Double {
        end.timeIntervalSince(start) * 1000
    }
}

/// 状态或 live 一变就重新决定要不要播单次动作。
private struct BurstTrigger: Equatable {
    let state: CharacterState
    let live: Bool
}

/// 一帧要画的全部参数。
struct MascotFrame {
    let pose: CharacterStatePose
    /// 出场进度：0 = 透明、缩小、在下方；1 = 到位（中途略超过 1）。
    let enter: Double
    /// 浮到最高点时地面阴影最窄最淡：0…1。
    let shadowFactor: Double
}

/// 把一帧画进 `Canvas`（Android Mascot.kt 里 Canvas 的那段）。变换的嵌套顺序和网页的 SVG 分组相同：
/// 出场 → 身体（位移、缩放、倾斜，支点在脚下）→ 饰件绕各自的支点转 → 眼睛跟着视线平移、各自眨眼。
enum MascotRenderer {
    /// 身体缩放 / 倾斜的支点（网页 .nf-char-actor 的 transform-origin）。
    private static let bodyPivot = CGPoint(x: 120, y: 195)
    /// 出场缩放的支点（.nf-char-enter）。
    private static let enterPivot = CGPoint(x: 120, y: 206)

    static func draw(_ art: MascotArt, frame: MascotFrame, hero: Bool, in context: GraphicsContext, size: CGSize) {
        let box = hero ? CharacterCatalog.heroViewBox : CharacterCatalog.iconViewBox
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 0, height > 0 else { return }
        let pose = frame.pose

        // viewBox 等比放进画布并居中（SVG 默认的 preserveAspectRatio）。
        let fit = min(width / box.width, height / box.height)
        var canvas = context
        canvas.translateBy(x: CGFloat((width - box.width * fit) / 2), y: CGFloat((height - box.height * fit) / 2))
        canvas.scaleBy(x: CGFloat(fit), y: CGFloat(fit))
        canvas.translateBy(x: CGFloat(-box.x), y: CGFloat(-box.y))

        let alpha = min(1, max(0, frame.enter))

        if hero {
            // 地面阴影：椭圆中心 (120, 226)、纵向半径 7.5；浮起来时变窄变淡。
            let rx = art.spec.shadowRx * (1 - 0.16 * frame.shadowFactor)
            let shadow = Path(ellipseIn: CGRect(x: 120 - rx, y: 218.5, width: rx * 2, height: 15))
            canvas.fill(shadow, with: .color(Sm.ink.opacity((0.1 - 0.04 * frame.shadowFactor) * alpha)))
        }

        let enterScale = hero ? 0.62 + 0.38 * frame.enter : 1
        let enterOffsetY = hero ? 34 * (1 - frame.enter) : 0

        var figure = canvas
        figure.opacity = alpha
        figure.translateBy(x: 0, y: CGFloat(enterOffsetY + pose.bodyOffsetY))
        figure.scale(by: enterScale, around: enterPivot)
        figure.scale(by: pose.bodyScale, around: bodyPivot)
        figure.rotate(degrees: pose.bodyTiltDeg, around: bodyPivot)

        var accent = figure
        accent.rotate(degrees: pose.accentDeg, around: art.accentPivot)

        drawLayers(art.backAccents, in: accent)
        drawLayers(art.body, in: figure)
        drawLayers(art.frontAccents, in: accent)

        var gaze = figure
        gaze.translateBy(x: CGFloat(pose.gazeX), y: CGFloat(pose.gazeY))
        for eye in art.eyes {
            var blink = gaze
            blink.scale(x: 1, y: pose.eyeScaleY, around: eye.center)
            blink.fill(eye.path, with: .color(eye.fill))
        }
    }

    private static func drawLayers(_ layers: [MascotLayer], in context: GraphicsContext) {
        for layer in layers {
            if let fill = layer.fill {
                context.fill(layer.path, with: .color(fill), style: layer.fillStyle)
            }
            if let stroke = layer.stroke, let style = layer.strokeStyle {
                context.stroke(layer.path, with: .color(stroke), style: style)
            }
        }
    }
}

private extension GraphicsContext {
    mutating func scale(x: Double, y: Double, around pivot: CGPoint) {
        guard x != 1 || y != 1 else { return }
        translateBy(x: pivot.x, y: pivot.y)
        scaleBy(x: CGFloat(x), y: CGFloat(y))
        translateBy(x: -pivot.x, y: -pivot.y)
    }

    mutating func scale(by factor: Double, around pivot: CGPoint) {
        scale(x: factor, y: factor, around: pivot)
    }

    /// 顺时针为正（坐标系 y 朝下，和 SVG 的 rotate 一样）。
    mutating func rotate(degrees: Double, around pivot: CGPoint) {
        guard degrees != 0 else { return }
        translateBy(x: pivot.x, y: pivot.y)
        rotate(by: Angle.degrees(degrees))
        translateBy(x: -pivot.x, y: -pivot.y)
    }
}
