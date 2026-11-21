import SwiftUI

// 登录窗口和设置（Android NoteFableRoot.kt 里的 SignInDialog、AccountUi.kt 的 ProfileRow 里的 SettingsDialog）。
// 两个都挂在根上：别处只改 `router.signInOpen` / `router.settingsOpen`（`router.openSignIn()` / `router.openSettings()`）。

extension View {
    /// 在根视图上装一次（放在 `.nfOverlayHost()` 里面）：
    /// - 登录窗口：`router.signInOpen` 为 true、服务端开了登录、还没登录时显示；登录成功（账号里有了用户）自动关掉。
    /// - 设置：`router.settingsOpen` 为 true 且已登录时显示（全屏，灰底）；退出登录、删除账号后自动关掉。
    func accountOverlays() -> some View {
        modifier(AccountOverlaysModifier())
    }
}

private struct AccountOverlaysModifier: ViewModifier {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    func body(content: Content) -> some View {
        let router = self.router
        let account = app.account.state
        let signedIn = account.user != nil
        let signInShown = router.signInOpen && account.configured && !signedIn
        let settingsShown = router.settingsOpen && signedIn
        return content
            .nfPanel(
                isPresented: Binding(get: { signInShown }, set: { if !$0 { router.signInOpen = false } }),
                style: SignInDialogHost.layerStyle
            ) {
                SignInDialogHost()
            }
            .nfPanel(
                isPresented: Binding(get: { settingsShown }, set: { if !$0 { router.settingsOpen = false } }),
                style: .settings
            ) {
                SettingsScreenHost()
            }
            .onChange(of: signedIn) { _, nowSignedIn in
                // 登录成功就关掉登录窗口；退出 / 删除账号后设置没有东西可显示了。
                if nowSignedIn {
                    router.signInOpen = false
                } else {
                    router.settingsOpen = false
                }
            }
    }
}
