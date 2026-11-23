import SwiftUI

// 报告 AI 的内容（网页 answer-actions.tsx 的 ReportDialog，Android `ReportDialog.kt`；应用商店对 AI 生成内容的要求）：
// 回答（回答的"…"菜单、只有图片的回答的旗子）、提案卡片（标题行的旗子）、AI 写过的页面（页面的"…"菜单）。
// .notes-dialog 外观；标题 16 / 600，说明 14 灰、上距 8；理由框是多行的 .notes-dialog-input（上距 12、最小高 96、1px 深描边、
// 圆角 6、16 字），选填、最多 1000 字；按钮行上距 20：取消 + 黑底"发送报告"。发送成功后在同一个框里显示"已发送，谢谢"和"完成"。
// 标题和说明：回答是"报告这条回答"，提案和页面是"报告 AI 内容"。状态和发送在 `ReportModel`（Core）里。

extension View {
    /// 报告 [target] 的对话框。发送中点遮罩不关。
    func reportDialog(_ target: ReportTarget, isPresented: Binding<Bool>) -> some View {
        modifier(ReportDialogModifier(target: target, isPresented: isPresented))
    }
}

private struct ReportDialogModifier: ViewModifier {
    let target: ReportTarget
    @Binding var isPresented: Bool

    @Environment(AppEnvironment.self) private var app
    /// 正在发送：期间点遮罩不关。
    @State private var busy = false

    func body(content: Content) -> some View {
        let presented = $isPresented
        content.nfDialog(isPresented: $isPresented, dismissDisabled: busy) {
            ReportDialogContent(target: target, backend: app.reportApi, busy: $busy) {
                presented.wrappedValue = false
            }
        }
    }
}

private struct ReportDialogContent: View {
    @State private var model: ReportModel
    @Binding private var busy: Bool

    @Environment(AppEnvironment.self) private var app
    @FocusState private var focused: Bool

    @MainActor
    init(target: ReportTarget, backend: ReportBackend, busy: Binding<Bool>, onClose: @escaping @MainActor () -> Void) {
        _model = State(initialValue: ReportModel(target: target, backend: backend, onClose: onClose))
        _busy = busy
    }

    var body: some View {
        let state = model.state
        VStack(alignment: .leading, spacing: 0) {
            NFDialogTitle(L(model.titleKey))
            if state.sent {
                NFDialogDescription(L("report_sent"))
                NFDialogButtons {
                    NotionButton(L("done"), kind: .primary) { model.close() }
                }
            } else {
                NFDialogDescription(L(model.helpKey))
                reasonField
                    .disabled(state.busy)
                if let error = state.error {
                    NFDialogError(error.text("report_failed", app.systemText))
                }
                NFDialogButtons {
                    NotionButton(L("cancel")) { model.close() }
                        .disabled(state.busy)
                    NotionButton(L(model.sendLabelKey), kind: .primary) { model.send() }
                        .disabled(state.busy)
                }
            }
        }
        .onChange(of: state.busy, initial: true) { _, value in
            busy = value
        }
    }

    /// 多行的理由框：聚焦时 2px 蓝框（盖住描边），出现后自动聚焦。
    @MainActor
    private var reasonField: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        let reason = Binding<String>(
            get: { model.state.reason },
            set: { model.setReason($0) }
        )
        let placeholder = L("report_reason_placeholder")
        return TextField("", text: reason, prompt: Text(placeholder).foregroundStyle(Sm.faint), axis: .vertical)
            .textFieldStyle(.plain)
            .font(.nf(16))
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .lineLimit(3...10)
            .focused($focused)
            // 网页的内边距 8.8×11.2 在 1px 描边里面，这里描边画在框内，所以各加 1。
            .padding(.horizontal, 12.2)
            .padding(.vertical, 9.8)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
            .overlay { shape.stroke(focused ? Sm.blue : .clear, lineWidth: 2) }
            .contentShape(shape)
            .onTapGesture { focused = true }
            .padding(.top, 12)
            .accessibilityLabel(placeholder)
            .task {
                // 等对话框进场、输入框进了窗口再聚焦，太早设会被忽略。
                try? await Task.sleep(nanoseconds: 80_000_000)
                focused = true
            }
    }
}
