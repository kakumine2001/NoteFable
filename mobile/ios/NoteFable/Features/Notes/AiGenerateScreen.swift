import SwiftUI
import UIKit
import WebKit

// 工作区统一「用 AI 生成」（笔记 / 白板 / 幻灯片，#254；Android ui/AiGenerateScreen.kt 的移植）。
// 面板本身是网页（src/components/ai-generate-panel.tsx），运行在笔记编辑器共用的常驻 /note-embed WKWebView 里：
// 画面上有编辑器时盖在它上面（NoteEditorScreen），没有开着页面时则是下面的全屏画面。
// 宽窗口（iPad / iPhone Duo 展开态）里网页自动显示居中弹窗，窄窗口全屏，遵循窗口当前尺寸和安全区。

private let aiGenerateFailedText = "Could not generate the note. Try again."

@MainActor
struct AiGenerateOverlayLauncher: View {
    let aiGenerate: AiGenerateUi
    let pool: NoteEditorPool
    let model: String?
    let reasoning: String?
    let onShown: (Int) -> Void
    let onFailed: (Int) -> Void

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let taskKey = "\(aiGenerate.request)-\(pool.generation)"
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task(id: taskKey) {
                if aiGenerate.shown && pool.controller?.aiGenerateVisible == true { return }
                guard let script = NoteEmbedScripts.aiGenerateOpen(target: aiGenerate.target, model: model, reasoning: reasoning) else {
                    Toast.show(app.systemText.localize(aiGenerateFailedText), long: true)
                    onFailed(aiGenerate.request)
                    return
                }
                let opened = await pool.openAiGenerate(script: script)
                if Task.isCancelled { return }
                if opened {
                    onShown(aiGenerate.request)
                } else {
                    Toast.show(app.systemText.localize(aiGenerateFailedText), long: true)
                    onFailed(aiGenerate.request)
                }
            }
    }
}

@MainActor
struct AiGenerateScreen: View {
    let aiGenerate: AiGenerateUi
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(NoteEditorPool.self) private var editorPool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let notes = app.notes
        let chat = app.chat.state
        let resolvedTheme = (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue
        let usage = notes.state.aiGenerateUsageLimit
        let storage = notes.state.aiGenerateStorageLimit
        let showUsagePrompt: Bool = {
            guard let usage else { return false }
            if usage.tier == "guest" { return app.account.state.configured && app.account.state.user == nil }
            if usage.tier == "member" { return app.account.state.user != nil }
            return false
        }()

        VStack(spacing: 0) {
            if let storage {
                GuestLimitPrompt(storage: storage, attachmentsLost: false) {
                    notes.dismissAiGenerateStorageLimit()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            } else if showUsagePrompt, let usage {
                GuestLimitPrompt(usage: usage, attachmentsLost: false) {
                    notes.dismissAiGenerateUsageLimit()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            ZStack {
                AiGenerateWebView(
                    pool: editorPool,
                    app: app,
                    router: router,
                    appIcon: app.appIcon.icon,
                    language: app.language.uiLocale,
                    theme: resolvedTheme
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if !aiGenerate.shown {
                    ZStack {
                        Sm.background.ignoresSafeArea()
                        HStack(spacing: 8) {
                            Spinner(size: 16, color: Sm.muted)
                            Text(L("sb_loading"))
                                .font(.nf(14))
                                .nfLineHeight(20, fontSize: 14)
                                .foregroundStyle(Sm.muted)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    .overlay(alignment: .topTrailing) {
                        NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                            NFGlassIconButton(Lucide.x, label: L("close"), size: 40, iconSize: 18) {
                                editorPool.discardAiGenerateIfUnready()
                                notes.dismissAiGenerate(aiGenerate.request)
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                AiGenerateOverlayLauncher(
                    aiGenerate: aiGenerate,
                    pool: editorPool,
                    model: chat.selectedModel?.id,
                    reasoning: chat.selectedReasoning,
                    onShown: { notes.onAiGenerateShown($0) },
                    onFailed: { request in
                        editorPool.discardAiGenerate()
                        notes.dismissAiGenerate(request)
                    }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Sm.background.ignoresSafeArea())
        .onAppear {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }
}

@MainActor
private struct AiGenerateWebView: UIViewRepresentable {
    let pool: NoteEditorPool
    let app: AppEnvironment
    let router: AppRouter
    let appIcon: String?
    let language: String
    let theme: String

    final class Coordinator {
        let pool: NoteEditorPool
        var mountToken = 0

        init(pool: NoteEditorPool) {
            self.pool = pool
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(pool: pool)
    }

    func makeUIView(context: Context) -> WKWebView {
        let (controller, token) = pool.obtainController(app: app, router: router)
        context.coordinator.mountToken = token
        return controller.attachAiGenerateView(appIcon: appIcon, language: language, theme: theme)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        pool.controller?.syncAiGenerate(appIcon: appIcon, language: language, theme: theme)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        if coordinator.pool.park(ifTokenMatches: coordinator.mountToken) {
            webView.removeFromSuperview()
        }
    }
}
