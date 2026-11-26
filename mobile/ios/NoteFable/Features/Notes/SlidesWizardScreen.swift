import SwiftUI
import UIKit
import WebKit

// AI 生成幻灯片（#150，Android ui/SlidesWizardScreen.kt 的移植）。向导本身是网页（src/components/slides-wizard.tsx），
// 开在笔记编辑器共用的常驻 /note-embed WKWebView 里：画面上有编辑器时盖在它上面（NoteEditorScreen），
// 聊天、笔记列表上则是下面的全屏画面。约定见 docs/architecture/ios-native.md 和 notes-flow.md。

/// 网页 msg("Could not generate slides. Try again.")：英文原句，经系统文词典翻译。
private let slidesWizardFailedText = "Could not generate slides. Try again."

/// 让常驻 WKWebView 里的网页打开向导。换了一次打开、或 WebView 重建（渲染进程崩溃）后重新叫一次；
/// 网页已经显示着（笔记 AI 面板里打开的）时不用叫。打不开（旧服务端、页面加载不了）时提示一句并 `onFailed`。
@MainActor
struct SlidesWizardOverlayLauncher: View {
    let wizard: SlidesWizardUi
    let pool: NoteEditorPool
    let model: String?
    let reasoning: String?
    let onShown: (Int) -> Void
    let onFailed: (Int) -> Void

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let taskKey = "\(wizard.request)-\(pool.generation)"
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task(id: taskKey) {
                guard let controller = pool.controller else { return }
                if wizard.shown && controller.slidesWizardVisible { return }
                guard let script = NoteEmbedScripts.slidesWizardOpen(source: wizard.source, model: model, reasoning: reasoning) else {
                    Toast.show(app.systemText.localize(slidesWizardFailedText), long: true)
                    onFailed(wizard.request)
                    return
                }
                let opened = await controller.openSlidesWizard(script: script)
                if Task.isCancelled { return }
                if opened {
                    onShown(wizard.request)
                } else {
                    Toast.show(app.systemText.localize(slidesWizardFailedText), long: true)
                    onFailed(wizard.request)
                }
            }
    }
}

/// 没有开着页面时（聊天的「＋」、笔记列表和侧栏的「用 AI 生成」）的全屏向导：挂上常驻 WKWebView，
/// 没加载过就加载空白编辑器（`/note-embed?warm=1`），网页出来之前显示“读取中”。关掉后回到原来的画面，WebView 停靠。
/// 宽窗口（iPad / iPhone Duo 展开态）里网页自动显示居中弹窗，窄窗口全屏，遵循窗口当前尺寸和安全区。
@MainActor
struct SlidesWizardScreen: View {
    let wizard: SlidesWizardUi
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(NoteEditorPool.self) private var editorPool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let notes = app.notes
        let chat = app.chat.state
        let resolvedTheme = (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue
        let usage = notes.state.wizardUsageLimit
        let showUsagePrompt: Bool = {
            guard let usage else { return false }
            if usage.tier == "guest" { return app.account.state.configured && app.account.state.user == nil }
            if usage.tier == "member" { return app.account.state.user != nil }
            return false
        }()

        VStack(spacing: 0) {
            if showUsagePrompt, let usage {
                GuestLimitPrompt(usage: usage, attachmentsLost: false) {
                    notes.dismissWizardUsageLimit()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            ZStack {
                SlidesWizardWebView(
                    pool: editorPool,
                    app: app,
                    router: router,
                    appIcon: app.appIcon.icon,
                    language: app.language.uiLocale,
                    theme: resolvedTheme
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if !wizard.shown {
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
                                notes.dismissSlidesWizard(wizard.request)
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                SlidesWizardOverlayLauncher(
                    wizard: wizard,
                    pool: editorPool,
                    model: chat.selectedModel?.id,
                    reasoning: chat.selectedReasoning,
                    onShown: { notes.onSlidesWizardShown($0) },
                    onFailed: { request in
                        editorPool.discardWizard()
                        notes.dismissSlidesWizard(request)
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

/// 挂上常驻 WKWebView 来承载全屏向导（与 `NoteEditorWebView` 共用 `NoteEditorPool`）。
@MainActor
private struct SlidesWizardWebView: UIViewRepresentable {
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
        return controller.attachWizardView(appIcon: appIcon, language: language, theme: theme)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        pool.controller?.syncWizard(appIcon: appIcon, language: language, theme: theme)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        if coordinator.pool.park(ifTokenMatches: coordinator.mountToken) {
            webView.removeFromSuperview()
        }
    }
}
