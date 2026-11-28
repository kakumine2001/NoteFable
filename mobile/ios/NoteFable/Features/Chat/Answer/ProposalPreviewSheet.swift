import SwiftUI
import UIKit
import WebKit

/// 画布提案（白板 / 幻灯片）的改前・改后可视化预览弹层（`/note-embed?proposal=<id>&lang=…&theme=…`）。
/// 以系统 `.sheet` 呈现，在 iPhone、iPad（竖屏 / 横屏 / 多任务缩放）与 iPhone Duo（双屏 / 折展 / Split View）下均按当前窗口尺寸自适应；
/// 使用独立的 `WKWebView` 与共享 `WKWebsiteDataStore.default()` Cookie，不干扰常驻笔记编辑器池。
@MainActor
struct ProposalPreviewSheet: View {
    let proposal: Proposal

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.colorScheme) private var colorScheme
    @State private var loaded = false

    private var resolvedTheme: String {
        (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue
    }

    private var previewUrl: URL? {
        let raw = app.api.proposalPreviewUrl(
            proposalId: proposal.id,
            lang: app.language.uiLocale,
            theme: resolvedTheme
        )
        return URL(string: raw)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                LucideIcon(pageKindIcon(proposal.pageKind), size: 16, strokeWidth: 2, color: Sm.text)
                Text(ProposalCopy.title(proposal))
                    .font(.nf(15, weight: 600))
                    .nfLineHeight(20, fontSize: 15)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                    NFGlassIconButton(Lucide.x, label: L("close"), size: 36, iconSize: 16) {
                        router.closeProposalPreview()
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Sm.background)
            .overlay(alignment: .bottom) { NFDivider() }

            ZStack {
                if let url = previewUrl {
                    ProposalPreviewWebView(
                        url: url,
                        cookies: app.cookies(for: url),
                        loaded: $loaded
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                if !loaded {
                    ZStack {
                        Sm.background
                        HStack(spacing: 8) {
                            Spinner(size: 16, color: Sm.muted)
                            Text(L("sb_loading"))
                                .font(.nf(14))
                                .nfLineHeight(20, fontSize: 14)
                                .foregroundStyle(Sm.muted)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Sm.background.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

@MainActor
private struct ProposalPreviewWebView: UIViewRepresentable {
    let url: URL
    let cookies: [HTTPCookie]
    @Binding var loaded: Bool

    final class Coordinator: NSObject, WKNavigationDelegate {
        let allowedHost: String?
        var currentUrl: URL?
        var onFinished: () -> Void

        init(allowedHost: String?, onFinished: @escaping () -> Void) {
            self.allowedHost = allowedHost
            self.onFinished = onFinished
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let target = navigationAction.request.url else { return .cancel }
            if target.scheme == "about" { return .allow }
            guard let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return .cancel }
            if let allowedHost, target.host != allowedHost { return .cancel }
            let path = target.path
            guard path == "/note-embed" || path.hasSuffix("/note-embed") else { return .cancel }
            return .allow
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onFinished()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onFinished()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onFinished()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedHost: url.host) {
            loaded = true
        }
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        context.coordinator.currentUrl = url
        loadWithCookies(into: webView, url: url, cookies: cookies)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onFinished = { loaded = true }
        if context.coordinator.currentUrl != url {
            context.coordinator.currentUrl = url
            loaded = false
            loadWithCookies(into: webView, url: url, cookies: cookies)
        }
    }

    private func loadWithCookies(into webView: WKWebView, url: URL, cookies: [HTTPCookie]) {
        Task { @MainActor in
            let store = webView.configuration.websiteDataStore
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                store.removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: Date.distantPast) {
                    done.resume()
                }
            }
            let cookieStore = store.httpCookieStore
            for cookie in cookies {
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    cookieStore.setCookie(cookie) {
                        done.resume()
                    }
                }
            }
            webView.load(URLRequest(url: url))
        }
    }
}
