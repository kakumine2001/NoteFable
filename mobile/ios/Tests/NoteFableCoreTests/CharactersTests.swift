import XCTest
@testable import NoteFableCore

/// Android CharactersTest 的移植，加上动画时间线（Mascot.kt 的 InfiniteTransition / Animatable）的数值检查。
/// Android 那条经 ChatUiState 的用例在这里直接喂同样的回合信号给 deriveTurnCharacterState。
final class CharactersTests: XCTestCase {
    func testAllSevenCharactersAreRegisteredWithQuillAsTheDefaultAndContrastFixed() {
        XCTAssertEqual(CharacterId.allCases.map(\.id), ["quill", "foldie", "piko", "velo", "sora", "loop", "orbit"])
        XCTAssertEqual(CharacterId.default, .quill)
        XCTAssertEqual(CharacterId.allCases.filter(\.isDefault), [.quill])
        XCTAssertEqual(CharacterId.fromId("piko"), .piko)
        XCTAssertNil(CharacterId.fromId("unknown"))
        XCTAssertNil(CharacterId.fromId(nil))
        XCTAssertEqual(CharacterId.quill.displayName, "Quill")
        XCTAssertEqual(Set(CharacterCatalog.specs.keys), Set(CharacterId.allCases))

        let quill = CharacterCatalog.spec(.quill)
        let bodyFill = quill.bodyPaths.first?.fillArgb
        // 对比度修正：Quill 的身体是暖色羊皮纸（不是奶油色 0xFFF7F6F2 或白色），轮廓线 >= 8。
        XCTAssertNotNil(bodyFill)
        XCTAssertNotEqual(bodyFill, 0xFFF7_F6F2)
        XCTAssertNotEqual(bodyFill, 0xFFFF_FFFF)
        let contour = quill.bodyPaths.first { $0.strokeArgb == 0xFF0F_172A }
        XCTAssertNotNil(contour)
        XCTAssertGreaterThanOrEqual(contour?.strokeWidth ?? 0, 8)
        XCTAssertEqual(contour?.strokeJoin, .round)

        for id in CharacterId.allCases {
            let spec = CharacterCatalog.spec(id)
            XCTAssertEqual(spec.id, id)
            XCTAssertFalse(spec.bodyPaths.isEmpty)
            XCTAssertGreaterThanOrEqual(spec.eyes.count, 2)
            XCTAssertGreaterThanOrEqual(spec.motion.floatDurationMs, 3000)
            for layer in spec.backAccentPaths + spec.bodyPaths + spec.frontAccentPaths {
                XCTAssertTrue(layer.d.hasPrefix("M"))
                XCTAssertTrue(layer.fillArgb != nil || layer.strokeArgb != nil)
            }
            for state in CharacterState.allCases {
                let pose = CharacterCatalog.pose(id, state)
                XCTAssertTrue(pose.bodyScale.isFinite)
                XCTAssertTrue(pose.eyeScaleY.isFinite)
            }
            XCTAssertGreaterThan(CharacterCatalog.pose(id, .typing).gazeY, 0)
            XCTAssertGreaterThan(CharacterCatalog.pose(id, .thinking).gazeX, 0)
            XCTAssertGreaterThan(CharacterCatalog.pose(id, .error).bodyOffsetY, 0)
        }

        // 网页的两个 viewBox：图标 "16 14 208 212"，大形象 "12 10 216 229.5"（64:68）。
        XCTAssertEqual(CharacterCatalog.iconViewBox, CharacterViewBox(x: 16, y: 14, width: 208, height: 212))
        XCTAssertEqual(CharacterCatalog.heroViewBox, CharacterViewBox(x: 12, y: 10, width: 216, height: 229.5))
        // Velo 的眼睛是多边形，其余是胶囊。
        if case .polygon(let eye) = CharacterCatalog.spec(.velo).eyes[0] {
            XCTAssertEqual(eye.cx, 100.5)
        } else {
            XCTFail("Velo's eyes are polygons")
        }
        if case .capsule(let eye) = CharacterCatalog.spec(.sora).eyes[0] {
            XCTAssertEqual(eye.rotation, -5)
            XCTAssertEqual(eye.fillArgb, 0xFF0F_172A)
        } else {
            XCTFail("Sora's eyes are capsules")
        }
    }

    /// 角色的路径都要能被共用的 SVG 解析器（界面层画图用的那个）完整读出来，而且落在 240×240 的画布里。
    func testEveryLayerAndPolygonEyeIsValidSvgPathDataInsideTheArtboard() {
        for id in CharacterId.allCases {
            let spec = CharacterCatalog.spec(id)
            var paths = (spec.backAccentPaths + spec.bodyPaths + spec.frontAccentPaths).map(\.d)
            for eye in spec.eyes {
                if case .polygon(let polygon) = eye { paths.append(polygon.d) }
            }
            for d in paths {
                XCTAssertTrue(SVGPathData.isValid(d), "\(id): \(d)")
                let commands = SVGPathData.parse(d)
                XCTAssertGreaterThanOrEqual(commands.count, 2, "\(id): \(d)")
                guard case .move = commands.first else {
                    XCTFail("\(id): path must start with a move: \(d)")
                    continue
                }
                for command in commands {
                    let point: (x: Double, y: Double)?
                    switch command {
                    case .move(let x, let y), .line(let x, let y): point = (x, y)
                    case .cubic(_, _, _, _, let x, let y): point = (x, y)
                    case .close: point = nil
                    }
                    if let point {
                        XCTAssertTrue((0...240).contains(point.x) && (0...240).contains(point.y), "\(id): \(d)")
                    }
                }
            }
        }
    }

    func testStateMachineEnforcesPriorityHiddenErrorRespondingThinkingCompletedTypingIdle() {
        XCTAssertEqual(resolveCharacterState(), .idle)
        XCTAssertEqual(resolveCharacterState(isTyping: true), .typing)
        XCTAssertEqual(resolveCharacterState(isCompleted: true, isTyping: true), .completed)
        XCTAssertEqual(resolveCharacterState(isThinking: true, isCompleted: true, isTyping: true), .thinking)
        XCTAssertEqual(resolveCharacterState(isResponding: true, isThinking: true, isTyping: true), .responding)
        XCTAssertEqual(
            resolveCharacterState(hasError: true, isResponding: true, isThinking: true, isCompleted: true, isTyping: true),
            .error
        )
        XCTAssertEqual(
            resolveCharacterState(hidden: true, hasError: true, isResponding: true, isThinking: true, isTyping: true),
            .hidden
        )
    }

    func testTurnSignalsMapToCharacterStatesAndExitThinkingImmediatelyOnStop() {
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false), .idle)
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false, isTyping: true), .typing)

        // 等第一个字 -> thinking（盖过 typing）。
        XCTAssertEqual(deriveTurnCharacterState(isBusy: true, hasOutput: false, isTyping: true), .thinking)
        // 正在输出 -> responding。
        XCTAssertEqual(deriveTurnCharacterState(isBusy: true, hasOutput: true), .responding)

        // 按了停止 -> 立刻离开 thinking / responding。
        XCTAssertEqual(deriveTurnCharacterState(isBusy: true, isStopping: true, hasOutput: false), .idle)
        XCTAssertEqual(deriveTurnCharacterState(isBusy: true, isStopping: true, hasOutput: true, isTyping: true), .typing)

        // 正常结束 -> completed，之后回到 idle。
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false, hasOutput: true, outcome: .completed), .completed)
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false, hasOutput: true, outcome: nil), .idle)

        // 出错盖过 typing（例如 429 把草稿还回输入框）；hidden 盖过一切。
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false, outcome: .error, isTyping: true), .error)
        XCTAssertEqual(deriveTurnCharacterState(isBusy: false, outcome: .error, isTyping: true, hidden: true), .hidden)

        XCTAssertEqual(CharacterOutcome.completed.durationMs, 650)
        XCTAssertEqual(CharacterOutcome.error.durationMs, 950)
    }

    func testReducedMotionPreservesDistinctStaticPosesAcrossAllSevenCharacters() {
        let visibleStates: [CharacterState] = [.idle, .typing, .thinking, .responding, .completed, .error]
        let phases = CharacterMotionPhases(floatPhase: 0.8, thinkPhase: -0.6, respondPhase: 0.7, burstBell: 1)
        for id in CharacterId.allCases {
            for hero in [false, true] {
                let poses = visibleStates.map { state -> CharacterStatePose in
                    let drawPose = computeCharacterDrawPose(
                        characterId: id, state: state, hero: hero, reducedMotion: true, live: false, phases: phases
                    )
                    XCTAssertEqual(drawPose, CharacterCatalog.pose(id, state))
                    // 降低动画优先于 live。
                    XCTAssertEqual(
                        computeCharacterDrawPose(
                            characterId: id, state: state, hero: hero, reducedMotion: true, live: true, phases: phases
                        ),
                        drawPose
                    )
                    return drawPose
                }
                XCTAssertEqual(Set(poses).count, visibleStates.count, "\(id) hero=\(hero)")
                XCTAssertEqual(
                    computeCharacterDrawPose(characterId: id, state: .hidden, hero: hero, reducedMotion: true, live: false),
                    CharacterStatePose(0, 0, 1, 0, 0, 0, 1)
                )
                XCTAssertEqual(
                    computeCharacterDrawPose(characterId: id, state: .hidden, hero: hero, reducedMotion: false, live: true, phases: phases),
                    CharacterStatePose(0, 0, 1, 0, 0, 0, 1)
                )
            }
        }
    }

    func testLivePosesFollowThePhasesWithSmallerTravelForIcons() {
        let m = CharacterCatalog.spec(.quill).motion
        let top = CharacterMotionPhases(floatPhase: 1, blinkScale: 0.12, idleAccentWave: 1)

        let hero = computeCharacterDrawPose(characterId: .quill, state: .idle, hero: true, reducedMotion: false, live: true, phases: top)
        XCTAssertEqual(hero, CharacterStatePose(-m.floatAmplitude, m.idleBodyTiltDeg, 1, m.idleAccentDeg, 0, 0, 0.12))
        let icon = computeCharacterDrawPose(characterId: .quill, state: .idle, hero: false, reducedMotion: false, live: true, phases: top)
        XCTAssertEqual(icon.bodyOffsetY, -m.floatAmplitude * 0.42, accuracy: 1e-9)

        // 静止相位下的 idle 就是原位。
        XCTAssertEqual(
            computeCharacterDrawPose(characterId: .quill, state: .idle, hero: true, reducedMotion: false, live: true),
            CharacterStatePose(0, 0, 1, 0, 0, 0, 1)
        )

        let typing = computeCharacterDrawPose(
            characterId: .quill, state: .typing, hero: true, reducedMotion: false, live: true,
            phases: CharacterMotionPhases(typingProgress: 1)
        )
        XCTAssertEqual(typing, CharacterCatalog.pose(.quill, .typing))

        let thinking = computeCharacterDrawPose(
            characterId: .quill, state: .thinking, hero: true, reducedMotion: false, live: true,
            phases: CharacterMotionPhases(thinkPhase: 1)
        )
        XCTAssertEqual(thinking.bodyOffsetY, -2)
        XCTAssertEqual(thinking.bodyTiltDeg, m.thinkingTiltDeg)
        XCTAssertEqual(thinking.accentDeg, m.thinkingAccentDeg)
        XCTAssertEqual(thinking.gazeX, m.thinkingGazeX)

        let nodHero = computeCharacterDrawPose(
            characterId: .quill, state: .completed, hero: true, reducedMotion: false, live: true,
            phases: CharacterMotionPhases(burstBell: 1)
        )
        XCTAssertEqual(nodHero.bodyOffsetY, m.completedNodY)
        XCTAssertEqual(nodHero.eyeScaleY, 0.35, accuracy: 1e-9)
        let dropIcon = computeCharacterDrawPose(
            characterId: .quill, state: .error, hero: false, reducedMotion: false, live: true,
            phases: CharacterMotionPhases(burstBell: 1)
        )
        XCTAssertEqual(dropIcon.bodyOffsetY, m.errorDropY * 0.65, accuracy: 1e-9)
        XCTAssertEqual(dropIcon.gazeY, 5)
    }

    func testEasingMatchesCssCubicBezier() {
        XCTAssertEqual(CharacterEasing.linear.value(at: 0.3), 0.3, accuracy: 1e-6)
        XCTAssertEqual(CharacterEasing.easeInOut.value(at: 0), 0)
        XCTAssertEqual(CharacterEasing.easeInOut.value(at: 1), 1)
        XCTAssertEqual(CharacterEasing.easeInOut.value(at: 0.5), 0.5, accuracy: 1e-6)
        XCTAssertEqual(CharacterEasing.easeInOut.value(at: 0.25), 0.129, accuracy: 0.002)
        // ease-in-out 是对称的：正放和倒放同一条曲线。
        XCTAssertEqual(
            CharacterEasing.easeInOut.value(at: 0.2) + CharacterEasing.easeInOut.value(at: 0.8), 1, accuracy: 1e-6
        )
        XCTAssertGreaterThan(CharacterEasing.easeOut.value(at: 0.5), 0.5)
        // 出场曲线会冲过 1 再落回来。
        let peak = stride(from: 0.0, through: 1.0, by: 0.01).map { CharacterEasing.enter.value(at: $0) }.max() ?? 0
        XCTAssertGreaterThan(peak, 1.05)
        XCTAssertLessThan(peak, 1.2)
        XCTAssertEqual(CharacterEasing.enter.value(at: -1), 0)
        XCTAssertEqual(CharacterEasing.enter.value(at: 2), 1)
    }

    func testEntranceWaitsEightyMillisecondsThenTakesFiveHundredSixty() {
        XCTAssertEqual(CharacterMotionTimeline.enterProgress(elapsedMs: 0), 0)
        XCTAssertEqual(CharacterMotionTimeline.enterProgress(elapsedMs: 80), 0)
        XCTAssertGreaterThan(CharacterMotionTimeline.enterProgress(elapsedMs: 200), 0)
        XCTAssertGreaterThan(CharacterMotionTimeline.enterProgress(elapsedMs: 500), 1)
        XCTAssertEqual(CharacterMotionTimeline.enterProgress(elapsedMs: 640), 1)
        XCTAssertEqual(CharacterMotionTimeline.enterProgress(elapsedMs: 5000), 1)
        XCTAssertEqual(CharacterMotionTimeline.enterTotalMs, 640)
    }

    func testLoopsUseTheWebKeyframeTimings() {
        let quill = CharacterCatalog.spec(.quill).motion // 浮动周期 4300ms
        func phases(_ ms: Double, _ state: CharacterState = .idle) -> CharacterMotionPhases {
            CharacterMotionTimeline.phases(state: state, motion: quill, loopElapsedMs: ms)
        }

        // 浮动：等 500ms，再用半个周期升到最高点、半个周期落回。
        XCTAssertEqual(phases(0).floatPhase, 0)
        XCTAssertEqual(phases(500).floatPhase, 0)
        XCTAssertEqual(phases(500 + 2150).floatPhase, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(500 + 1075).floatPhase, 0.5, accuracy: 1e-6)
        XCTAssertEqual(phases(500 + 4300 + 2150).floatPhase, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(500 + 4300 * 3).floatPhase, 0, accuracy: 1e-6)

        // 眨眼：等 1500ms；周期 5600ms 里 1.8% 处闭一次，53.8% 和 57.4% 处连闭两次。
        XCTAssertEqual(phases(1000).blinkScale, 1)
        XCTAssertEqual(phases(1500 + 5600 * 0.018).blinkScale, 0.12, accuracy: 1e-6)
        XCTAssertEqual(phases(1500 + 5600 * 0.036).blinkScale, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(1500 + 2000).blinkScale, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(1500 + 5600 * 0.538).blinkScale, 0.12, accuracy: 1e-6)
        XCTAssertEqual(phases(1500 + 5600 * 0.574).blinkScale, 0.12, accuracy: 1e-6)
        XCTAssertEqual(phases(1500 + 5600 * 1.018).blinkScale, 0.12, accuracy: 1e-6)

        // 饰件：等 1800ms；周期 6400ms 的前 10% 抖一下（1 → -0.3 → 0.45 → 0）。
        XCTAssertEqual(phases(1800).idleAccentWave, 0)
        XCTAssertEqual(phases(1800 + 192).idleAccentWave, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(1800 + 384).idleAccentWave, -0.3, accuracy: 1e-6)
        XCTAssertEqual(phases(1800 + 512).idleAccentWave, 0.45, accuracy: 1e-6)
        XCTAssertEqual(phases(1800 + 3000).idleAccentWave, 0, accuracy: 1e-6)

        // 思考：-1 → 1 → -1，一个来回 2.6s；回答：0 → 1 → 0，一个来回 1.9s。都不延迟。
        XCTAssertEqual(phases(0).thinkPhase, -1)
        XCTAssertEqual(phases(650).thinkPhase, 0, accuracy: 1e-6)
        XCTAssertEqual(phases(1300).thinkPhase, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(2600 + 1300).thinkPhase, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(0).respondPhase, 0)
        XCTAssertEqual(phases(950).respondPhase, 1, accuracy: 1e-6)
        XCTAssertEqual(phases(1900 + 475).respondPhase, 0.5, accuracy: 1e-6)

        // 没在循环时全部归位。
        XCTAssertEqual(CharacterMotionTimeline.phases(state: .idle, motion: quill, loopElapsedMs: nil), .rest)
        for state in CharacterState.allCases {
            XCTAssertEqual(CharacterMotionTimeline.loops(state), [.idle, .typing, .thinking, .responding].contains(state))
        }
    }

    func testTypingEasesInAndOneShotsRiseThenSettleBackToRest() {
        let motion = CharacterCatalog.spec(.piko).motion

        // typing：160ms 过渡；一出现就是 typing 时直接到位。
        XCTAssertEqual(CharacterMotionTimeline.phases(state: .typing, motion: motion, loopElapsedMs: 0).typingProgress, 1)
        XCTAssertEqual(
            CharacterMotionTimeline.phases(state: .typing, motion: motion, loopElapsedMs: 0, typingElapsedMs: 0).typingProgress, 0
        )
        let halfway = CharacterMotionTimeline.phases(state: .typing, motion: motion, loopElapsedMs: 0, typingElapsedMs: 80).typingProgress
        XCTAssertGreaterThan(halfway, 0.5)
        XCTAssertLessThan(halfway, 1)
        XCTAssertEqual(
            CharacterMotionTimeline.phases(state: .typing, motion: motion, loopElapsedMs: 0, typingElapsedMs: 160).typingProgress, 1
        )
        XCTAssertEqual(
            CharacterMotionTimeline.phases(state: .idle, motion: motion, loopElapsedMs: 0, typingElapsedMs: 160).typingProgress, 0
        )

        // completed 540ms、error 600ms：升到顶再落回 0，只播一次。
        XCTAssertEqual(CharacterMotionTimeline.burstDurationMs(.completed), 540)
        XCTAssertEqual(CharacterMotionTimeline.burstDurationMs(.error), 600)
        XCTAssertNil(CharacterMotionTimeline.burstDurationMs(.idle))
        for state in [CharacterState.completed, .error] {
            let duration = CharacterMotionTimeline.burstDurationMs(state) ?? 0
            XCTAssertEqual(CharacterMotionTimeline.burstBell(state: state, elapsedMs: 0), 0)
            let samples = stride(from: 0.0, through: duration, by: 1).map {
                CharacterMotionTimeline.burstBell(state: state, elapsedMs: $0)
            }
            XCTAssertEqual(samples.max() ?? 0, 1, accuracy: 0.05)
            XCTAssertTrue(samples.allSatisfy { $0 >= 0 && $0 <= 1 })
            XCTAssertEqual(CharacterMotionTimeline.burstBell(state: state, elapsedMs: duration), 0)
            XCTAssertEqual(CharacterMotionTimeline.burstBell(state: state, elapsedMs: duration + 1000), 0)
            XCTAssertEqual(
                CharacterMotionTimeline.phases(state: state, motion: motion, loopElapsedMs: nil, burstElapsedMs: nil).burstBell, 0
            )
        }
        XCTAssertEqual(CharacterMotionTimeline.burstBell(state: .idle, elapsedMs: 100), 0)
    }
}
