import Foundation

// 7 个预设 AI 角色的模型类型、语义状态机和姿态计算（网页 src/lib/characters.ts，Android data/Characters.kt）。
// 角色数据本身（CharacterId、图层路径、眼睛、动作参数、viewBox）在 CharactersData.generated.swift，
// 由 scripts/gen-ios-characters.ts 从 src/lib/characters.ts 生成，不手改。
// 坐标都是 240×240 画布上的 SVG 用户单位；颜色是 0xAARRGGBB（配 `Color(argb:)`）。

extension CharacterId: Identifiable {
    /// 网页 / 存储里的 id（"quill"、"foldie"…）。
    var id: String { rawValue }

    static func fromId(_ value: String?) -> CharacterId? {
        value.flatMap { CharacterId(rawValue: $0) }
    }
}

enum CharacterState: String, CaseIterable, Sendable {
    case idle
    case typing
    case thinking
    case responding
    case completed
    case error
    case hidden
}

enum CharacterOutcome: String, Sendable {
    case completed
    case error

    /// 回合结束后短暂反馈停留多久（网页 characterOutcomeDurationMs）。
    var durationMs: Int { self == .completed ? 650 : 950 }
}

enum CharacterStrokeCap: String, Sendable {
    case butt
    case round
    case square
}

enum CharacterStrokeJoin: String, Sendable {
    case miter
    case round
    case bevel
}

struct CharacterPath: Equatable, Sendable {
    let d: String
    let fillArgb: UInt32?
    let strokeArgb: UInt32?
    let strokeWidth: Double
    let strokeCap: CharacterStrokeCap
    let strokeJoin: CharacterStrokeJoin
    let evenOdd: Bool
}

enum CharacterEye: Equatable, Sendable {
    case capsule(Capsule)
    case polygon(Polygon)

    struct Capsule: Equatable, Sendable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let rx: Double
        let rotation: Double
        let cx: Double
        let cy: Double
        let fillArgb: UInt32
    }

    struct Polygon: Equatable, Sendable {
        let d: String
        let cx: Double
        let cy: Double
        let fillArgb: UInt32
    }

    var cx: Double {
        switch self {
        case .capsule(let eye): return eye.cx
        case .polygon(let eye): return eye.cx
        }
    }

    var cy: Double {
        switch self {
        case .capsule(let eye): return eye.cy
        case .polygon(let eye): return eye.cy
        }
    }

    var fillArgb: UInt32 {
        switch self {
        case .capsule(let eye): return eye.fillArgb
        case .polygon(let eye): return eye.fillArgb
        }
    }
}

struct CharacterMotionSpec: Equatable, Sendable {
    let floatAmplitude: Double
    let floatDurationMs: Int
    let idleAccentDeg: Double
    let idleBodyTiltDeg: Double
    let typingTiltDeg: Double
    let typingAccentDeg: Double
    let typingGazeY: Double
    let thinkingTiltDeg: Double
    let thinkingAccentDeg: Double
    let thinkingGazeX: Double
    let respondingTiltDeg: Double
    let respondingAccentDeg: Double
    let completedNodY: Double
    let completedAccentDeg: Double
    let errorDropY: Double
    let errorTiltDeg: Double
    let errorAccentDeg: Double
}

struct CharacterArtSpec: Equatable, Sendable {
    let id: CharacterId
    let accentPivotX: Double
    let accentPivotY: Double
    let eyeCenterX: Double
    let eyeCenterY: Double
    let shadowRx: Double
    let backAccentPaths: [CharacterPath]
    let bodyPaths: [CharacterPath]
    let frontAccentPaths: [CharacterPath]
    let eyes: [CharacterEye]
    let motion: CharacterMotionSpec
}

struct CharacterStatePose: Hashable, Sendable {
    let bodyOffsetY: Double
    let bodyTiltDeg: Double
    let bodyScale: Double
    let accentDeg: Double
    let gazeX: Double
    let gazeY: Double
    let eyeScaleY: Double

    init(
        _ bodyOffsetY: Double, _ bodyTiltDeg: Double, _ bodyScale: Double, _ accentDeg: Double,
        _ gazeX: Double, _ gazeY: Double, _ eyeScaleY: Double
    ) {
        self.bodyOffsetY = bodyOffsetY
        self.bodyTiltDeg = bodyTiltDeg
        self.bodyScale = bodyScale
        self.accentDeg = accentDeg
        self.gazeX = gazeX
        self.gazeY = gazeY
        self.eyeScaleY = eyeScaleY
    }
}

/// SVG 的 viewBox（网页 CHARACTER_ICON_VIEWBOX / CHARACTER_HERO_VIEWBOX）。
struct CharacterViewBox: Equatable, Sendable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

/// 角色数据的入口。`specs`、`iconViewBox`、`heroViewBox` 在生成的文件里。
enum CharacterCatalog {
    static func spec(_ id: CharacterId) -> CharacterArtSpec {
        // 生成的表覆盖全部 case（CharactersTests 检查）。
        specs[id]!
    }

    /// 每个（角色，状态）固定的代表姿态（网页 getCharacterStatePose）：系统关掉动画或不在前台时就画这个，各状态仍然分得清。
    static func pose(_ id: CharacterId, _ state: CharacterState) -> CharacterStatePose {
        let m = spec(id).motion
        switch state {
        case .idle, .hidden:
            return CharacterStatePose(0, 0, 1, 0, 0, 0, 1)
        case .typing:
            return CharacterStatePose(1.5, m.typingTiltDeg, 1, m.typingAccentDeg, 0, m.typingGazeY, 1)
        case .thinking:
            return CharacterStatePose(-2, m.thinkingTiltDeg, 1, m.thinkingAccentDeg, m.thinkingGazeX, -2.5, 1)
        case .responding:
            return CharacterStatePose(-1, m.respondingTiltDeg, 1.015, m.respondingAccentDeg, 0, 1.5, 1)
        case .completed:
            return CharacterStatePose(m.completedNodY * 0.4, 1.2, 1.02, m.completedAccentDeg, 0, 0, 0.72)
        case .error:
            return CharacterStatePose(m.errorDropY, m.errorTiltDeg, 0.985, m.errorAccentDeg, 0, 3.5, 0.82)
        }
    }
}

/// 语义状态的优先级：hidden > error > responding > thinking > completed > typing > idle。
func resolveCharacterState(
    hidden: Bool = false,
    hasError: Bool = false,
    isResponding: Bool = false,
    isThinking: Bool = false,
    isCompleted: Bool = false,
    isTyping: Bool = false
) -> CharacterState {
    if hidden { return .hidden }
    if hasError { return .error }
    if isResponding { return .responding }
    if isThinking { return .thinking }
    if isCompleted { return .completed }
    if isTyping { return .typing }
    return .idle
}

/// 把界面上真实的回合信号换成角色状态；按了停止就立刻离开 thinking / responding。
func deriveTurnCharacterState(
    isBusy: Bool,
    isStopping: Bool = false,
    hasOutput: Bool = false,
    outcome: CharacterOutcome? = nil,
    isTyping: Bool = false,
    hidden: Bool = false
) -> CharacterState {
    let active = isBusy && !isStopping
    return resolveCharacterState(
        hidden: hidden,
        hasError: outcome == .error,
        isResponding: active && hasOutput,
        isThinking: active && !hasOutput,
        isCompleted: !active && outcome == .completed,
        isTyping: isTyping
    )
}

// MARK: - 动画

/// 某一时刻各段动画的相位（Android Mascot.kt 里 InfiniteTransition / Animatable 的当前值）。
struct CharacterMotionPhases: Equatable, Sendable {
    /// 浮动：0（原位）…1（最高点）。
    var floatPhase: Double = 0
    /// 眨眼：眼睛的纵向缩放，1 = 睁开。
    var blinkScale: Double = 1
    /// 待机时饰件偶尔抖一下：idleAccentDeg 的倍数。
    var idleAccentWave: Double = 0
    /// 进入 typing 姿态的进度 0…1。
    var typingProgress: Double = 0
    /// 思考时左右摆：-1…1。
    var thinkPhase: Double = 0
    /// 回答时起伏：0…1。
    var respondPhase: Double = 0
    /// completed / error 的单次动作：0 → 1 → 0。
    var burstBell: Double = 0

    static let rest = CharacterMotionPhases()
}

/// 当前这一帧要画的姿态（Android computeCharacterDrawPose）：
/// - 系统降低动画，或者不在播动画（[live] 为 false）时，用 `CharacterCatalog.pose` 的固定姿态；
/// - hidden 一律归零。
func computeCharacterDrawPose(
    characterId: CharacterId,
    state: CharacterState,
    hero: Bool,
    reducedMotion: Bool,
    live: Bool,
    phases: CharacterMotionPhases = .rest
) -> CharacterStatePose {
    if state == .hidden {
        return CharacterCatalog.pose(characterId, .hidden)
    }
    if reducedMotion || !live {
        return CharacterCatalog.pose(characterId, state)
    }
    let m = CharacterCatalog.spec(characterId).motion
    // 小图标的位移按比例缩小（网页 floatScale、--cf-nod-completed / --cf-drop-error 的 0.65）。
    let floatScale = hero ? 1.0 : 0.42
    let burstScale = hero ? 1.0 : 0.65
    let p = phases
    switch state {
    case .idle:
        return CharacterStatePose(
            -m.floatAmplitude * floatScale * p.floatPhase,
            m.idleBodyTiltDeg * p.floatPhase,
            1,
            m.idleAccentDeg * p.idleAccentWave,
            0,
            0,
            p.blinkScale
        )
    case .typing:
        return CharacterStatePose(
            1.5 * p.typingProgress,
            m.typingTiltDeg * p.typingProgress,
            1,
            m.typingAccentDeg * p.typingProgress,
            0,
            m.typingGazeY * p.typingProgress,
            p.blinkScale
        )
    case .thinking:
        return CharacterStatePose(
            -4 + 2 * p.thinkPhase,
            m.thinkingTiltDeg * p.thinkPhase,
            1,
            m.thinkingAccentDeg * (0.25 + 0.75 * abs(p.thinkPhase)),
            m.thinkingGazeX * p.thinkPhase,
            -2.8,
            1
        )
    case .responding:
        return CharacterStatePose(
            -3.5 * p.respondPhase,
            m.respondingTiltDeg * p.respondPhase,
            1 + 0.015 * p.respondPhase,
            m.respondingAccentDeg * p.respondPhase,
            0,
            1.5 * p.respondPhase,
            p.blinkScale
        )
    case .completed:
        return CharacterStatePose(
            m.completedNodY * burstScale * p.burstBell,
            0,
            1 + 0.02 * p.burstBell,
            m.completedAccentDeg * p.burstBell,
            0,
            0,
            1 - 0.65 * p.burstBell
        )
    case .error:
        return CharacterStatePose(
            m.errorDropY * burstScale * p.burstBell,
            m.errorTiltDeg * p.burstBell,
            1 - 0.015 * p.burstBell,
            m.errorAccentDeg * p.burstBell,
            0,
            5 * p.burstBell,
            1 - 0.18 * p.burstBell
        )
    case .hidden:
        return CharacterCatalog.pose(characterId, .hidden)
    }
}

/// CSS 的 cubic-bezier(x1, y1, x2, y2)（Compose 的 CubicBezierEasing）。
struct CharacterEasing: Equatable, Sendable {
    let x1: Double
    let y1: Double
    let x2: Double
    let y2: Double

    static let linear = CharacterEasing(x1: 0, y1: 0, x2: 1, y2: 1)
    /// CSS ease-in-out。
    static let easeInOut = CharacterEasing(x1: 0.42, y1: 0, x2: 0.58, y2: 1)
    /// CSS ease-out。
    static let easeOut = CharacterEasing(x1: 0, y1: 0, x2: 0.58, y2: 1)
    /// 出场的回弹（.nf-char-enter）。
    static let enter = CharacterEasing(x1: 0.34, y1: 1.56, x2: 0.64, y2: 1)

    /// 进度 `fraction`（0…1）对应的值；y 可以超过 1（回弹）。
    func value(at fraction: Double) -> Double {
        let x = min(1, max(0, fraction))
        if x == 0 || x == 1 { return x }
        // x(t) 在 0…1 上单调，二分求 t。
        var low = 0.0
        var high = 1.0
        var t = x
        for _ in 0..<40 {
            let estimate = Self.bezier(t, x1, x2)
            if abs(estimate - x) < 1e-7 { break }
            if estimate < x { low = t } else { high = t }
            t = (low + high) / 2
        }
        return Self.bezier(t, y1, y2)
    }

    private static func bezier(_ t: Double, _ p1: Double, _ p2: Double) -> Double {
        let u = 1 - t
        return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t
    }
}

/// 把“过了多少毫秒”换成各段动画的相位。时长、延迟和关键帧取自网页 globals.css 的 `nf-char-*`
/// （Android Mascot.kt 的 InfiniteTransition / Animatable 是同一组数字）。和时钟无关，方便测试。
enum CharacterMotionTimeline {
    struct Keyframe: Equatable, Sendable {
        let at: Double
        let value: Double
    }

    // 出场：560ms、延迟 80ms、回弹。
    static let enterDelayMs = 80.0
    static let enterDurationMs = 560.0
    // 进入 typing 姿态的过渡。
    static let typingDurationMs = 160.0
    // 循环动画的周期和起始延迟。
    static let floatDelayMs = 500.0
    static let blinkPeriodMs = 5600.0
    static let blinkDelayMs = 1500.0
    static let idleAccentPeriodMs = 6400.0
    static let idleAccentDelayMs = 1800.0
    static let thinkPeriodMs = 2600.0
    static let respondPeriodMs = 1900.0

    static let floatKeyframes = [Keyframe(at: 0, value: 0), Keyframe(at: 0.5, value: 1), Keyframe(at: 1, value: 0)]
    /// nf-char-blink：一次单眨，过半周期后连眨两下。
    static let blinkKeyframes = [
        Keyframe(at: 0, value: 1), Keyframe(at: 0.018, value: 0.12), Keyframe(at: 0.036, value: 1),
        Keyframe(at: 0.52, value: 1), Keyframe(at: 0.538, value: 0.12), Keyframe(at: 0.556, value: 1),
        Keyframe(at: 0.574, value: 0.12), Keyframe(at: 0.592, value: 1), Keyframe(at: 1, value: 1),
    ]
    /// nf-char-accent-idle：周期开头抖一下，其余时间不动。
    static let idleAccentKeyframes = [
        Keyframe(at: 0, value: 0), Keyframe(at: 0.03, value: 1), Keyframe(at: 0.06, value: -0.3),
        Keyframe(at: 0.08, value: 0.45), Keyframe(at: 0.1, value: 0), Keyframe(at: 1, value: 0),
    ]
    static let thinkKeyframes = [Keyframe(at: 0, value: -1), Keyframe(at: 0.5, value: 1), Keyframe(at: 1, value: -1)]
    static let respondKeyframes = [Keyframe(at: 0, value: 0), Keyframe(at: 0.5, value: 1), Keyframe(at: 1, value: 0)]

    /// 出场进度：0（看不见、缩小、在下方）→ 1；中途会略超过 1。
    static func enterProgress(elapsedMs: Double) -> Double {
        let t = (elapsedMs - enterDelayMs) / enterDurationMs
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }
        return CharacterEasing.enter.value(at: t)
    }

    /// 出场动画总共占多久（之后可以停表）。
    static let enterTotalMs = enterDelayMs + enterDurationMs

    /// completed / error 的单次动作有多长；其它状态没有。
    static func burstDurationMs(_ state: CharacterState) -> Double? {
        switch state {
        case .completed: return 540
        case .error: return 600
        default: return nil
        }
    }

    /// 单次动作的钟形进度：前 40% 升到 1，后 60% 落回 0；播完归 0。
    static func burstBell(state: CharacterState, elapsedMs: Double) -> Double {
        guard let duration = burstDurationMs(state), elapsedMs > 0, elapsedMs < duration else { return 0 }
        let burst = CharacterEasing.easeOut.value(at: elapsedMs / duration)
        return burst <= 0.4 ? burst / 0.4 : (1 - burst) / 0.6
    }

    static func typingProgress(elapsedMs: Double) -> Double {
        if elapsedMs <= 0 { return 0 }
        if elapsedMs >= typingDurationMs { return 1 }
        return CharacterEasing.easeOut.value(at: elapsedMs / typingDurationMs)
    }

    /// 无限循环的关键帧动画在 `elapsedMs` 时的值：先等 `delayMs`（停在第一帧），之后每 `periodMs` 重复，段内用 `easing`。
    static func loopValue(
        elapsedMs: Double,
        delayMs: Double = 0,
        periodMs: Double,
        keyframes: [Keyframe],
        easing: CharacterEasing = .easeInOut
    ) -> Double {
        guard let first = keyframes.first else { return 0 }
        let t = elapsedMs - delayMs
        guard t > 0, periodMs > 0 else { return first.value }
        let fraction = t.truncatingRemainder(dividingBy: periodMs) / periodMs
        var previous = first
        for frame in keyframes.dropFirst() {
            if fraction <= frame.at {
                let span = frame.at - previous.at
                guard span > 0 else { return frame.value }
                let local = easing.value(at: (fraction - previous.at) / span)
                return previous.value + (frame.value - previous.value) * local
            }
            previous = frame
        }
        return previous.value
    }

    /// 浮动一个来回的时长（Android：半程至少 900ms）。
    static func floatPeriodMs(_ motion: CharacterMotionSpec) -> Double {
        max(1800, Double(motion.floatDurationMs))
    }

    /// 一帧的全部相位。
    /// - loopElapsedMs：循环动画（idle / typing / thinking / responding）已经连续播了多久；nil = 没在播。
    /// - typingElapsedMs：进入 typing 多久了；nil = 一出现就是 typing（直接到位）。
    /// - burstElapsedMs：进入 completed / error 多久了；nil = 单次动作已经播完或没开始。
    static func phases(
        state: CharacterState,
        motion: CharacterMotionSpec,
        loopElapsedMs: Double?,
        typingElapsedMs: Double? = nil,
        burstElapsedMs: Double? = nil
    ) -> CharacterMotionPhases {
        var phases = CharacterMotionPhases.rest
        if let elapsed = loopElapsedMs {
            phases.floatPhase = loopValue(
                elapsedMs: elapsed, delayMs: floatDelayMs, periodMs: floatPeriodMs(motion), keyframes: floatKeyframes
            )
            phases.blinkScale = loopValue(
                elapsedMs: elapsed, delayMs: blinkDelayMs, periodMs: blinkPeriodMs, keyframes: blinkKeyframes
            )
            phases.idleAccentWave = loopValue(
                elapsedMs: elapsed, delayMs: idleAccentDelayMs, periodMs: idleAccentPeriodMs, keyframes: idleAccentKeyframes
            )
            phases.thinkPhase = loopValue(elapsedMs: elapsed, periodMs: thinkPeriodMs, keyframes: thinkKeyframes)
            phases.respondPhase = loopValue(elapsedMs: elapsed, periodMs: respondPeriodMs, keyframes: respondKeyframes)
        }
        if state == .typing {
            phases.typingProgress = typingElapsedMs.map { typingProgress(elapsedMs: $0) } ?? 1
        }
        if let elapsed = burstElapsedMs {
            phases.burstBell = burstBell(state: state, elapsedMs: elapsed)
        }
        return phases
    }

    /// 这些状态下循环动画一直在播（Android needsLoop）。
    static func loops(_ state: CharacterState) -> Bool {
        switch state {
        case .idle, .typing, .thinking, .responding: return true
        case .completed, .error, .hidden: return false
        }
    }
}
