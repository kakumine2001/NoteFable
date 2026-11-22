import SwiftUI

// 输入栏（Android ChatScreen.kt 的 `Composer`，网页 page.tsx 的 .notion-composer-wrap / .notion-composer，412×915 下的值）。
// 外层：左右 10.4、上 12、下 max(16, 底部安全区)（由 ChatWorkspace 算好传进来）。从上到下：
// 上限提示（未登录）→ 红色提示条 → 引用 → 已添加的笔记 → 已选的附件（每一项下距 12）→ 输入框的白色圆角框 → 一行小字状态（上距 8）。
// 圆角框（.notion-composer）：白底、1px 深描边、圆角 16、内边距 10、行间距 4，阴影 0 1 2 rgba(12,23,48,.04) + 0 8 28 rgba(12,23,48,.07)；
// 聚焦时描边换成 --nf-accent-line，外面再加 3px 的浅蓝光圈（--nf-accent-soft），120ms ease。
// 框里：「生成图片」标记（开着时）→ 输入框（最小高 40、16 / 24）→ 一行控件：行首「＋」（40，图标 18 线宽 1.8），
// 离它 6 是模型按钮（按内容宽度，最多到发送键前 6 处），发送键固定在行尾。

@MainActor
struct ChatComposer: View {
    /// 圆角框下面留多少（键盘弹出时 16；否则 16 减去底部安全区，不小于 0）。
    let bottomPadding: CGFloat
    /// 每加一就聚焦输入框一次（引用回答、点了最近的笔记）。
    let focusRequest: Int
    let onFocusChange: (Bool) -> Void
    let onModelClick: () -> Void
    let onAddClick: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var focused = false

    var body: some View {
        let state = app.chat.state
        // 上传附件时发出的内容已定：文字、引用、笔记、附件都不能再改。
        let uploading = state.upload != nil
        let error = composerErrorText(filesError: state.filesError, notice: state.notice, systemText: app.systemText)
        VStack(alignment: .leading, spacing: 0) {
            limitPrompt(state)
            if let error { ComposerError(text: error) }
            // 网页：引用在最上面，笔记在附件上面。
            if let quote = state.quote {
                ChatComposerQuote(quote: quote, enabled: !uploading) { app.chat.clearQuote() }
            }
            if !state.attachedPages.isEmpty {
                PendingPages(pages: state.attachedPages, enabled: !uploading) { id in app.chat.removeAttachedPage(id) }
            }
            if !state.files.isEmpty {
                PendingFiles(files: state.files, enabled: !uploading) { uri in app.chat.removeFile(uri) }
            }
            inputBox(state, uploading: uploading)
            ComposerStatus(files: state.files, upload: state.upload)
        }
        .padding(.horizontal, 10.4)
        .padding(.top, 12)
        .padding(.bottom, bottomPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 未登录撞到当日上限：网页只在服务端开了登录、且还没登录时显示（GuestLimitPrompt 里的判断）。
    /// 免费用户的升级提示（Android UpgradeLimitPrompt）iOS 还没有购买流程，不显示。
    @ViewBuilder
    private func limitPrompt(_ state: ChatUiState) -> some View {
        let account = app.account.state
        if let kind = state.guestLimit, account.configured, account.user == nil {
            GuestLimitPrompt(kind: kind, attachmentsLost: !state.files.isEmpty || !state.attachedPages.isEmpty)
        }
    }

    private func inputBox(_ state: ChatUiState, uploading: Bool) -> some View {
        let draft = app.chat.draft
        let shape = RoundedRectangle(cornerRadius: 16)
        // 历史还没读到、附件不合格、附件还在上传或拷贝时不能发送。
        let canSend = !state.messagesLoading && !state.messagesFailed && state.filesError == nil
            && state.upload == nil && state.importing == 0
        // 已经按了停止、在等回答结束时不能再点。
        let sendEnabled = state.sending ? !state.stopping : (canSend && !ApiText.isBlank(draft))
        return VStack(alignment: .leading, spacing: 4) {
            if state.imageMode {
                ImageModeChip { app.chat.setImageMode(false) }
            }
            ChatComposerInput(
                text: draft,
                placeholder: L(state.imageMode ? "image_hint" : "message_hint"),
                readOnly: uploading,
                focusRequest: focusRequest,
                onTextChange: { text in app.chat.updateDraft(text) },
                onFocusChange: { value in
                    focused = value
                    onFocusChange(value)
                },
                // 粘贴的图片先拷进缓存再走附件的校验；拷贝期间不能发送（ChatViewModel.importFiles）。
                onPasteImages: { images in
                    app.chat.importFiles { await ChatAttachmentFiles.savePasted(images) }
                }
            )
            HStack(spacing: 0) {
                // 上传附件期间不能再加；外观不变（Android 同样）。
                NFIconButton(
                    Lucide.plus, label: L("attach_add"), iconSize: 18, strokeWidth: 1.8, disabledColor: Sm.muted,
                    action: onAddClick
                )
                .disabled(uploading)
                if let model = state.selectedModel {
                    ChatModelPill(
                        label: model.label,
                        effort: state.selectedReasoning.map { ChatReasoningText.label($0) },
                        action: onModelClick
                    )
                    .padding(.leading, 6)
                }
                Spacer(minLength: 6)
                ChatSendButton(sending: state.sending, enabled: sendEnabled) {
                    if state.sending {
                        app.chat.stop()
                    } else {
                        app.chat.send(app.chat.draft)
                    }
                }
            }
        }
        .padding(10)
        .background {
            // --nf-composer-shadow：0 1px 2px rgba(12,23,48,.04), 0 8px 28px rgba(12,23,48,.07)。
            shape
                .fill(Sm.surface)
                .shadow(color: Sm.composerShadow, radius: 14, x: 0, y: 8)
                .shadow(color: Color(argb: 0x0A0C1730), radius: 1, x: 0, y: 1)
        }
        .overlay {
            shape.strokeBorder(focused ? Sm.accentLine : Sm.borderStrong, lineWidth: 1)
                .allowsHitTesting(false)
        }
        .overlay {
            // box-shadow: 0 0 0 3px var(--nf-accent-soft)：画在边界外面，线的中心在外扩 1.5 的地方。
            RoundedRectangle(cornerRadius: 17.5)
                .stroke(focused ? Sm.accentSoft : Color.clear, lineWidth: 3)
                .padding(-1.5)
                .allowsHitTesting(false)
        }
        .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.12), reduceMotion), value: focused)
    }
}

/// 模型按钮（.codex-model-trigger，手机）：高 40、全圆角、底色 #f1f1ef（按下 #e8e8e5）、左右 13.6、间距 6.4；
/// 模型名 15 / 500（放不下省略）、推理强度 15 / 500 灰、ChevronDown 16。点开模型与推理强度的抽屉。
private struct ChatModelPill: View {
    let label: String
    let effort: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6.4) {
                Text(label)
                    .font(.nf(15, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let effort {
                    Text(effort)
                        .font(.nf(15, weight: 500))
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                        .fixedSize()
                }
                LucideIcon(Lucide.chevronDown, size: 16, color: Sm.text)
            }
            .padding(.horizontal, 13.6)
            .frame(height: 40)
        }
        .buttonStyle(.pressable(
            background: Sm.modelPill, pressedBackground: Sm.modelPillPressed, cornerRadius: 20, scale: 0.97
        ))
    }
}

/// 发送键（.notion-send，手机）：40 的圆；可发送时墨色底白箭头（ArrowUp 24、线宽 2.1），不可发送时 .08 灰底、.36 灰箭头。
/// 生成中换成停止键：白色实心方块（网页 lucide Square 16、填充：边长 12、圆角 1.3）。
private struct ChatSendButton: View {
    let sending: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        let foreground = enabled ? Sm.onInk : Sm.faint
        Button(action: action) {
            Group {
                if sending {
                    RoundedRectangle(cornerRadius: 1.3)
                        .fill(foreground)
                        .frame(width: 12, height: 12)
                } else {
                    LucideIcon(Lucide.arrowUp, size: 24, strokeWidth: 2.1, color: foreground)
                }
            }
            .frame(width: 40, height: 40)
        }
        .buttonStyle(.pressable(
            background: enabled ? Sm.ink : Sm.hover, pressedBackground: Sm.inkHover, cornerRadius: 20, scale: 0.97
        ))
        .disabled(!enabled)
        .accessibilityLabel(L(sending ? "stop" : "send"))
    }
}
