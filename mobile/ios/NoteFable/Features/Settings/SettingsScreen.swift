import SwiftUI

// 设置（网页 SettingsDialog 的手机宽度，Android ui/SettingsDialog.kt；从侧栏的账号行打开，登录后才有）。全屏：灰底（--notion-sidebar），
// 顶栏高 56、左右 10.4：返回键 40（ArrowLeft 20）+ 间距 4 +"设置"17/650 墨色；下面左右 16、上 8、下 32 的滚动区，
// 各栏是白色卡片（圆角 12、1px 细线），栏间距 24，栏标题 13/550 灰：
// 个人资料（没有栏标题）、方案、通用（语言、图标）、个性化（自定义指令）、账号（退出登录、删除账号）。
// 资料、语言和图标改了就存。只有自定义指令要按"保存"：改了以后下方浮出"未保存的更改"条（放弃 / 保存），
// 保存或放弃之前不关（顶栏的返回只让那条晃一下）。保存后留在设置里，标题右边显示"已保存"。
// 关闭：保存中、删除中、选照片 / 上传照片时不关。不管怎么关，输入中的名字都先存掉。规则都在 Core 的 `SettingsDialogModel`。

/// 设置面板的内容：每次打开建一份新的状态（上一次的错误、没存的指令不带进来）。由 `accountOverlays()` 放进 `.nfPanel(style: .settings)`。
struct SettingsScreenHost: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var model: SettingsDialogModel?
    @State private var plan: PlanSettingsModel?

    init() {}

    var body: some View {
        ZStack {
            if let model, let plan, let user = app.account.state.user {
                SettingsScreen(model: model, plan: plan, user: user)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if model == nil { model = makeModel() }
            if plan == nil {
                let account = app.account
                plan = PlanSettingsModel(load: { await account.loadPlan() })
            }
        }
    }

    private func makeModel() -> SettingsDialogModel {
        let app = self.app
        let router = self.router
        return SettingsDialogModel(
            account: app.account,
            // 退出后按新的匿名身份重新加载（AppEnvironment.signOut 里通知）。
            onSignOut: { Task { @MainActor in await app.signOut() } },
            deleteAccount: { await app.deleteAccount() },
            onClose: { router.settingsOpen = false }
        )
    }
}

struct SettingsScreen: View {
    let model: SettingsDialogModel
    let plan: PlanSettingsModel
    let user: AccountUser

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let account = app.account.state
        let state = model.state
        let dirty = model.dirty
        VStack(spacing: 0) {
            topBar
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 24) {
                    profileSection(account)
                    planSection
                    generalSection
                    personalizationSection(state)
                    accountSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                // 条出来时多留出条的高度，最后一栏不被挡住（.settings-body.has-unsaved）。
                .padding(.bottom, dirty ? 96 : 32)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .overlay(alignment: .bottom) {
            ZStack {
                if dirty {
                    SettingsUnsavedBar(
                        attention: state.attention, busy: state.busy,
                        onDiscard: { model.discard() }, onSave: { model.save() }
                    )
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.nfRise(offsetY: 16))
                }
            }
            .padding(16)
            .animation(reduceMotion ? nil : NFMotion.emphasized(0.2), value: dirty)
        }
        // 账号的资料变了（保存成功、失败回滚）：没在编辑时名字输入框跟着走。
        .onChange(of: user) { _, _ in model.userChanged() }
    }

    // MARK: 顶栏

    private var topBar: some View {
        HStack(spacing: 4) {
            // 顶栏的返回（网页 closeAll）：有没保存的指令时只让"未保存的更改"条晃一下。
            NFIconButton(Lucide.arrowLeft, label: L("back"), color: Sm.text) { model.closeAll() }
            Text(L("acct_settings"))
                .font(.nf(17, weight: 650))
                .foregroundStyle(Sm.ink)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10.4)
        .frame(height: 56)
    }

    // MARK: 各栏

    private func profileSection(_ account: AccountUiState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 名字、头像、语言保存失败的提示：放在最上面（网页 .settings-save-error，下距 12）。
            if let error = account.profileError {
                SettingsErrorLine(profileErrorText(error, app.systemText))
                    .padding(.bottom, 12)
            }
            SettingsCard(padded: true) {
                ProfileSettings(model: model, user: user)
            }
        }
    }

    private var planSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsGroupLabel(L("plan_title"))
            SettingsCard(padded: true) {
                PlanSettingsCard(model: plan)
            }
        }
    }

    private var generalSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsGroupLabel(L("settings_general"))
            SettingsCard {
                LanguageSettingsRowView(user: user)
                SettingsRowDivider()
                AppIconSettings(model: model)
            }
        }
    }

    private func personalizationSection(_ state: SettingsDialogState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsGroupLabel(L("settings_personalization"))
            SettingsCard(padded: true) {
                CustomInstructionsSection(model: model)
                if let error = state.error {
                    SettingsErrorLine(error.text("acct_err_save_custom_instructions", app.systemText))
                        .padding(.top, 12)
                }
            }
        }
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsGroupLabel(L("account"))
            SettingsCard {
                SettingsRowButton(L("sign_out"), icon: Lucide.logOut) { model.signOut() }
                    .disabled(!model.signOutEnabled)
                SettingsRowDivider()
                DeleteAccountSection(model: model)
            }
        }
    }
}

// MARK: - 自定义指令

/// 自定义指令：标题 15/500 + 右边的计数 12 灰（读到后才有；刚保存完换成绿色的"✓ 已保存"12/500）、说明 13 灰、
/// 读取中 / 失败 + 重试、输入框。
private struct CustomInstructionsSection: View {
    let model: SettingsDialogModel

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = model.state
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(L("acct_custom_instructions"))
                .font(.nf(15, weight: 500))
                .nfLineHeight(22.5, fontSize: 15)
                .foregroundStyle(Sm.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.saved {
                HStack(spacing: 4) {
                    LucideIcon(Lucide.check, size: 13, color: settingsSavedGreen)
                    Text(L("save_saved"))
                        .font(.nf(12, weight: 500))
                        .foregroundStyle(settingsSavedGreen)
                }
                .accessibilityElement(children: .combine)
            } else if let count = model.instructionsCount {
                Text(count)
                    .font(.nf(12))
                    .foregroundStyle(Sm.muted)
                    .monospacedDigit()
            }
        }
        SettingsHelpLine(L("acct_custom_instructions_help"))
        if let loadError = state.loadError {
            SettingsErrorLine(loadError.text("acct_err_load_custom_instructions", app.systemText))
                .padding(.top, 12)
            NotionButton(L("try_again")) { model.retryLoad() }
                .padding(.top, 8)
        } else if state.initial == nil {
            SettingsLoadingLine()
        } else {
            SettingsInstructionsField(
                text: Binding(get: { model.state.instructions }, set: { model.setInstructions($0) }),
                label: L("acct_custom_instructions"),
                placeholder: L("acct_custom_instructions_placeholder")
            )
            .disabled(state.busy)
        }
    }
}

/// textarea.settings-textarea（手机）：上距 12、最小高 176、1px 深描边、圆角 10、内边距 10×12、16 / 行高 1.55；
/// 聚焦时蓝边 + 外侧 3px 的 rgba(35,131,226,.16) 光圈。
private struct SettingsInstructionsField: View {
    @Binding var text: String
    let label: String
    let placeholder: String

    @FocusState private var focused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        // 行高 24.8：比字体自然行高多出来的部分当行距。
        let spacing: CGFloat = 24.8 - 16 * 1.193
        TextEditor(text: $text)
            .font(.nf(16))
            .lineSpacing(spacing)
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .scrollContentBackground(.hidden)
            .focused($focused)
            // TextEditor 自带上下 8、左右 5 的留白，补到 10×12。
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .frame(minHeight: 176, maxHeight: 360)
            .background(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(.nf(16))
                        .lineSpacing(spacing)
                        .foregroundStyle(Sm.faint)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(focused ? Sm.blue : Sm.borderStrong, lineWidth: 1) }
            .background {
                // 光圈画在描边外侧 3px。
                RoundedRectangle(cornerRadius: 13)
                    .fill(focused ? Sm.focusRing : Color.clear)
                    .padding(-3)
            }
            .padding(.top, 12)
            .accessibilityLabel(label)
    }
}
