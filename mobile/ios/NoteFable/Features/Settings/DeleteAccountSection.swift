import SwiftUI

/// 设置的"账号"卡片里、"退出登录"下面的"删除账号"（网页 settings-dialog.tsx 的 DeleteAccount；Android ui/DeleteAccountSection.kt）。
/// 外观照网页手机宽度：红色的一行（`SettingsRowButton`，Trash2）；点了在原地换成确认区（底 8% 红、内边距 14×16、14 / 行高 1.5），
/// 右下角"取消"和红字、28% 红描边的"永久删除"（上距 12）。删除中两个按钮都不能点；失败留在确认区显示原因。
/// 状态在 `SettingsDialogModel`（confirmingDelete / deleting / deleteError）。
struct DeleteAccountSection: View {
    let model: SettingsDialogModel

    @Environment(\.openURL) private var openURL
    @Environment(AppEnvironment.self) private var app

    private static let dangerBorder = Color(argb: 0x47B91C1C) // rgba(185, 28, 28, 0.28)
    private static let dangerFill = Color(argb: 0x14B91C1C)   // rgba(185, 28, 28, 0.08)

    init(model: SettingsDialogModel) {
        self.model = model
    }

    var body: some View {
        let state = model.state
        if !state.confirmingDelete {
            SettingsRowButton(L("acct_delete_account"), icon: Lucide.trash2, danger: true) { model.startDelete() }
                .disabled(!model.deleteEnabled)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text(L("acct_delete_account_warning"))
                    .font(.nf(14))
                    .nfLineHeight(21, fontSize: 14)
                    .foregroundStyle(Sm.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                SettingsHelpLine(L("acct_delete_app_store_notice"))
                NotionButton(L("plan_manage_app_store")) {
                    if let url = URL(string: "https://apps.apple.com/account/subscriptions") { openURL(url) }
                }
                .disabled(state.deleting)
                .padding(.top, 8)
                if let error = state.deleteError {
                    SettingsErrorLine(error.text("acct_err_delete_account", app.systemText))
                        .padding(.top, 8)
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    NotionButton(L("cancel")) { model.cancelDelete() }
                        .disabled(state.deleting)
                    NotionButton(L(state.deleting ? "acct_deleting" : "acct_delete_permanently"), kind: .danger) {
                        model.confirmDelete()
                    }
                    .disabled(state.deleting)
                    .overlay {
                        RoundedRectangle(cornerRadius: 4.8)
                            .strokeBorder(Self.dangerBorder, lineWidth: 1)
                            .allowsHitTesting(false)
                    }
                }
                .padding(.top, 12)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Self.dangerFill)
        }
    }
}
