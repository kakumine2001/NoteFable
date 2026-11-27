import SwiftUI
import UIKit
import WebKit

// PowerPoint（.pptx）导入（#154 PR 12，Android ui/PptxImportScreen.kt 的移植）。导入弹窗本身是网页（src/components/pptx-import-dialog.tsx），
// 开在笔记编辑器共用的常驻 /note-embed WKWebView 里：画面上有编辑器时盖在它上面（NoteEditorScreen），
// 没有打开页面时则是下面的全屏画面。WKWebView 原生支持 <input type="file"> 调起系统文件选择器（含 .pptx）。

/// 网页 msg("Could not import this PowerPoint file. Try again.")：英文原句，经系统文词典翻译。
private let pptxImportFailedText = "Could not import this PowerPoint file. Try again."

/// 让常驻 WKWebView 里的网页打开 PowerPoint 导入窗口。换了一次打开、或 WebView 重建后重新叫一次；
/// 网页已经显示着（幻灯片工具栏里打开的）时不用叫。打不开时提示一句并 `onFailed`。
@MainActor
struct PptxImportOverlayLauncher: View {
    let pptxImport: PptxImportUi
    let pool: NoteEditorPool
    let onShown: (Int) -> Void
    let onFailed: (Int) -> Void

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let taskKey = "\(pptxImport.request)-\(pool.generation)"
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task(id: taskKey) {
                if pptxImport.shown && pool.controller?.pptxImportVisible == true { return }
                guard let script = NoteEmbedScripts.pptxImportOpen(target: pptxImport.target) else {
                    Toast.show(app.systemText.localize(pptxImportFailedText), long: true)
                    onFailed(pptxImport.request)
                    return
                }
                let opened = await pool.openPptxImport(script: script)
                if Task.isCancelled { return }
                if opened {
                    onShown(pptxImport.request)
                } else {
                    Toast.show(app.systemText.localize(pptxImportFailedText), long: true)
                    onFailed(pptxImport.request)
                }
            }
    }
}

/// 没有开着页面时（笔记列表、空状态和侧栏的「导入 PowerPoint」）的全屏导入画面：挂上常驻 WKWebView，
/// 没加载过就加载空白编辑器（`/note-embed?warm=1`），网页出来之前显示“读取中”。关掉后回到原来的画面，WebView 停靠。
/// 宽窗口（iPad / iPhone Duo 展开态）里网页自动显示居中弹窗，窄窗口全屏，遵循窗口当前尺寸和安全区。
@MainActor
struct PptxImportScreen: View {
    let pptxImport: PptxImportUi
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(NoteEditorPool.self) private var editorPool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let notes = app.notes
        let resolvedTheme = (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue
        let storage = notes.state.pptxImportStorageLimit

        VStack(spacing: 0) {
            if let storage {
                GuestLimitPrompt(storage: storage, attachmentsLost: false) {
                    notes.dismissPptxImportStorageLimit()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            ZStack {
                PptxImportWebView(
                    pool: editorPool,
                    app: app,
                    router: router,
                    appIcon: app.appIcon.icon,
                    language: app.language.uiLocale,
                    theme: resolvedTheme
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if !pptxImport.shown {
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
                                editorPool.discardPptxImportIfUnready()
                                notes.dismissPptxImport(pptxImport.request)
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                PptxImportOverlayLauncher(
                    pptxImport: pptxImport,
                    pool: editorPool,
                    onShown: { notes.onPptxImportShown($0) },
                    onFailed: { request in
                        editorPool.discardPptxImport()
                        notes.dismissPptxImport(request)
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

/// 挂上常驻 WKWebView 来承载全屏 PowerPoint 导入（与 `NoteEditorWebView` 共用 `NoteEditorPool`）。
@MainActor
private struct PptxImportWebView: UIViewRepresentable {
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
        return controller.attachPptxImportView(appIcon: appIcon, language: language, theme: theme)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        pool.controller?.syncPptxImport(appIcon: appIcon, language: language, theme: theme)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        if coordinator.pool.park(ifTokenMatches: coordinator.mountToken) {
            webView.removeFromSuperview()
        }
    }
}
