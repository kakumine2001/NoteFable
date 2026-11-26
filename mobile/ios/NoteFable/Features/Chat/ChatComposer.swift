import SwiftUI

// 分体式 Liquid Glass 输入栏：左侧独立“＋”玻璃圆按钮，右侧 26pt 连续圆角 Liquid Glass 输入卡（模型胶囊与发送键在卡内底部）。

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
    @Environment(\.nfChromePath) private var chromePath
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
        .padding(.horizontal, 12)
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
        let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)
        let focusAnimation = NFMotion.unlessReduced(NFMotion.cssEase(0.12), reduceMotion)
        // Keep GlassEffectContainer merge spacing (< HStack gap 8) so the '+' glass circle and input card stay visually split.
        return NFGlassContainer(spacing: 4) {
            HStack(alignment: .bottom, spacing: NFChromeMetrics.gap) {
                NFGlassIconButton(
                    Lucide.plus,
                    label: L("attach_add"),
                    size: NFChromeMetrics.control,
                    iconSize: 20,
                    strokeWidth: 2,
                    disabledColor: Sm.muted,
                    action: onAddClick
                )
                .disabled(uploading)

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
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .clipShape(shape)
                .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.borderStrong)
                .nfChromeShadow(Sm.composerShadow, radius: 14, y: 8)
                .nfChromeShadow(Color(argb: 0x0A0C1730), radius: 1, y: 1)
                .overlay {
                    if chromePath == .solid {
                        shape.strokeBorder(focused ? Sm.accentLine : .clear, lineWidth: 1)
                            .animation(focusAnimation, value: focused)
                            .allowsHitTesting(false)
                    }
                }
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
                if let model = state.selectedModel {
                    ChatModelPill(
                        label: model.label,
                        effort: state.selectedReasoning.map { ChatReasoningText.label($0) },
                        action: onModelClick
                    )
                }
                Spacer(minLength: 6)
                ChatSendButton(sending: state.sending, enabled: sendEnabled) {
                    Haptics.light()
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

/// 模型按钮：高 34、全圆角胶囊、左右 12、间距 6；玻璃卡上用系统生动的柔和透明底。
private struct ChatModelPill: View {
    let label: String
    let effort: String?
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let ink = chromePath == .native ? chromePath.primaryInk : Sm.text
        let subInk = chromePath == .native ? chromePath.secondaryInk : Sm.muted
        let bg: Color = {
            switch chromePath {
            case .native: return Color.primary.opacity(0.065)
            case .material: return Sm.hover
            case .solid: return Sm.modelPill
            }
        }()
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label)
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let effort {
                    Text(effort)
                        .font(.nf(14, weight: 500))
                        .foregroundStyle(subInk)
                        .lineLimit(1)
                        .fixedSize()
                }
                LucideIcon(Lucide.chevronDown, size: 15, color: subInk)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
        }
        .buttonStyle(.pressable(
            background: bg,
            pressedBackground: chromePath == .solid ? Sm.modelPillPressed : Sm.active,
            cornerRadius: 17,
            scale: 0.97
        ))
    }
}

/// 发送键：36 的圆；可发送时墨色底白箭头，不可发送时柔和灰底。生成中换成停止键。
private struct ChatSendButton: View {
    let sending: Bool
    let enabled: Bool
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let foreground = enabled ? Sm.onInk : Sm.faint
        let disabledFill = chromePath == .native ? Color.primary.opacity(0.07) : Sm.hover
        Button(action: action) {
            Group {
                if sending {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(foreground)
                        .frame(width: 11, height: 11)
                } else {
                    LucideIcon(Lucide.arrowUp, size: 22, strokeWidth: 2.1, color: foreground)
                }
            }
            .frame(width: 36, height: 36)
        }
        .buttonStyle(.pressable(
            background: enabled ? Sm.ink : disabledFill, pressedBackground: Sm.inkHover, cornerRadius: 18, scale: 0.97
        ))
        .disabled(!enabled)
        .accessibilityLabel(L(sending ? "stop" : "send"))
    }
}
