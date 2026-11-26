import SwiftUI

// 悬浮输入栏。上限提示在玻璃卡外；卡内依次是错误、引用、笔记、附件、生成图片标记、输入框、控件和状态。
// 卡片圆角 30、内边距 10。输入框和控件沿用网页在 412×915 下的尺寸；「＋」和模型按钮用普通按压样式。

@MainActor
struct ChatComposer: View {
    /// 卡片下方的留白，由 ChatWorkspace 按键盘和安全区决定。
    let bottomPadding: CGFloat
    /// 每加一就聚焦输入框一次（引用回答、点了最近的笔记）。
    let focusRequest: Int
    let onFocusChange: (Bool) -> Void
    let onModelClick: () -> Void
    let onAddClick: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var focused = false
    @State private var columnMaxWidth: CGFloat = 760

    var body: some View {
        let state = app.chat.state
        // 上传附件时发出的内容已定：文字、引用、笔记、附件都不能再改。
        let uploading = state.upload != nil
        VStack(alignment: .leading, spacing: 0) {
            limitPrompt(state)
            composerCard(state, uploading: uploading)
        }
        .frame(maxWidth: columnMaxWidth)
        .padding(.horizontal, 10.4)
        .padding(.top, 8)
        .padding(.bottom, bottomPadding)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { proxy in
            // 网页表单的 .notion-page-column：47.5rem，宽到 1440 时改用 clamp(50rem, 48vw, 55rem)。
            let width = proxy.size.width
            return width >= 1440 ? min(880, max(800, width * 0.48)) : 760
        } action: { maxWidth in
            columnMaxWidth = maxWidth
        }
    }

    private func composerCard(_ state: ChatUiState, uploading: Bool) -> some View {
        let error = composerErrorText(filesError: state.filesError, notice: state.notice, systemText: app.systemText)
        let shape = RoundedRectangle(cornerRadius: 30, style: .continuous)
        let focusAnimation = NFMotion.unlessReduced(NFMotion.cssEase(0.12), reduceMotion)
        return NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
            VStack(alignment: .leading, spacing: 0) {
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
                inputControls(state, uploading: uploading)
                ComposerStatus(files: state.files, upload: state.upload)
            }
            .padding(10)
            .clipShape(shape)
            .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.borderStrong)
            .nfChromeShadow(Sm.composerShadow, radius: 14, y: 8)
            .nfChromeShadow(Color(argb: 0x0A0C1730), radius: 1, y: 1)
            .overlay {
                shape.strokeBorder(focused ? Sm.accentLine : .clear, lineWidth: 1)
                    .animation(focusAnimation, value: focused)
                    .allowsHitTesting(false)
            }
            .overlay {
                // 3pt 光圈画在卡片外侧，线的中心向外移 1.5pt。
                RoundedRectangle(cornerRadius: 31.5, style: .continuous)
                    .stroke(focused ? Sm.accentSoft : Color.clear, lineWidth: 3)
                    .padding(-1.5)
                    .animation(focusAnimation, value: focused)
                    .allowsHitTesting(false)
            }
        }
    }

    /// 存储空间不够（网页 StorageLimitPrompt）优先：总要说明原因；未登录时给登录入口。
    /// 未登录撞到当日上限：网页只在服务端开了登录、且还没登录时显示（GuestLimitPrompt 里的判断）。
    /// 免费用户撞到用量上限时，跳到设置里的 App Store 方案。
    @ViewBuilder
    private func limitPrompt(_ state: ChatUiState) -> some View {
        let account = app.account.state
        if let storage = state.storageLimit {
            GuestLimitPrompt(storage: storage, attachmentsLost: !state.files.isEmpty)
        } else if let kind = state.guestLimit, account.configured, account.user == nil {
            GuestLimitPrompt(kind: kind, attachmentsLost: !state.files.isEmpty || !state.attachedPages.isEmpty)
        } else if let kind = state.upgradeLimit, account.appStoreBilling, account.user != nil {
            GuestLimitPrompt(usage: UsageLimitInfo(tier: "member", kind: kind), attachmentsLost: false) {
                app.chat.dismissUpgradeLimit()
            }
        }
    }

    private func inputControls(_ state: ChatUiState, uploading: Bool) -> some View {
        let draft = app.chat.draft
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
    }
}

/// 模型按钮（.codex-model-trigger，手机）：高 40、全圆角、左右 13.6、间距 6.4；玻璃卡上用半透明底。
/// 模型名 15 / 500（放不下省略）、推理强度 15 / 500 灰、ChevronDown 16。点开模型与推理强度的抽屉。
private struct ChatModelPill: View {
    let label: String
    let effort: String?
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

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
            background: chromePath == .solid ? Sm.modelPill : Sm.hover,
            pressedBackground: chromePath == .solid ? Sm.modelPillPressed : Sm.active,
            cornerRadius: 20,
            scale: 0.97
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
