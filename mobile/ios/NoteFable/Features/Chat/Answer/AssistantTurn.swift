import SwiftUI

// 回答一回合（网页 chat-message.tsx 的助手部分，Android `AssistantTurn.kt`），从上到下：
// 标签 → 过程面板（等待中或有步骤时）→ 生成的图片 / 生成中占位 → 正文 → 提案卡片 → 失败文 → 操作行。
// 数值来自网页 412x915 的实测（docs/architecture/android-native.md 的对照表）。
//
// 这里的 body 不读 `app.chat.state`：生成途中 state 每来一段字都变，读了它所有回答都要跟着重算。
// 要用聊天状态的小部件（标签行的模型名和角色状态、版本切换、"…"菜单）各自去读。

struct AssistantTurn: View {
    private let message: UiMessage
    private let sessionId: String?
    private let isLatest: Bool

    @Environment(AppEnvironment.self) private var app

    init(message: UiMessage, sessionId: String?, isLatest: Bool) {
        self.message = message
        self.sessionId = sessionId
        self.isLatest = isLatest
    }

    var body: some View {
        let systemText = app.systemText
        // 网页 shouldShowThinking：还在等、没有正文也没有图片。
        let thinking = message.streaming && message.content.isEmpty && message.images.isEmpty
        let progress = message.activity.progressSteps()
        let proposals = mergeProposals(message.proposals, message.activity)
        VStack(alignment: .leading, spacing: 0) {
            AssistantLabelRow(modelId: message.modelId, imageAnswer: message.isImageAnswer, isLatest: isLatest)
            if thinking || !progress.isEmpty {
                // 等待中是已等的秒数，完成后是正文出现前用的秒数（最少 1 秒）。
                ChatActivity(steps: progress, thinking: thinking, startedAt: message.startedAt, thinkingMs: message.thinkingMs)
            }
            if !message.images.isEmpty {
                GeneratedImageGrid(images: message.images)
            }
            if message.generatingImage && message.images.isEmpty {
                GeneratingImagePreview()
            }
            if !message.content.isEmpty {
                // 写完的回答可以选中文字（生成途中是普通 Text，最省）；本文完整的回答选中后菜单里多一个「问 NoteFable」。
                AnswerMarkdown(displayedContent(systemText))
                    .environment(\.answerSelectable, !message.streaming)
                    .environment(\.answerQuote, quoteAction)
            }
            if !proposals.isEmpty {
                ProposalCards(proposals: proposals)
            }
            if let detail = message.errorDetail {
                Text(L("request_failed", detail == CONNECTION_FAILED ? L("check_connection") : systemText.localize(detail)))
                    .font(.nf(15))
                    .foregroundStyle(Sm.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)
            }
            actionRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 使用上限的句子只翻译（网页 t(message.content)），其它回答只替换服务端追加在末尾的"Request failed: …"。
    private func displayedContent(_ systemText: SystemTextTranslator) -> String {
        if message.usageLimit { return systemText.t(message.content) }
        return systemText.localizeFailure(message.content, message.failure ?? failureInfo)
    }

    /// activity 里记着的失败位置（流里来的回答还没有 `message.failure`）。
    private var failureInfo: FailureInfo? {
        for step in message.activity {
            if case .failure(_, let offset, let detail) = step { return FailureInfo(offset: offset, detail: detail) }
        }
        return nil
    }

    /// 「问 NoteFable」：和操作行同样的条件（网页 data-quotable）。上传附件期间菜单里不出这一项（每次弹出菜单时问）。
    private var quoteAction: AnswerQuoteAction? {
        let quotable = !message.streaming && message.errorDetail == nil && !message.usageLimit &&
            !message.generatingImage && !ChatText.isBlank(message.content)
        guard quotable else { return nil }
        let chat = app.chat
        return AnswerQuoteAction(
            title: L("ask_notefable"),
            isAvailable: { chat.state.upload == nil },
            perform: { text in chat.setQuote(text) }
        )
    }

    /// 只给本文完整、没有失败的回答显示操作行（网页 shouldShowAnswerActions：生成中、只有图片、失败时都不显示）。
    @ViewBuilder
    private var actionRow: some View {
        let failed = message.errorDetail != nil || message.usageLimit
        if !message.streaming && !failed && !message.generatingImage && !ChatText.isBlank(message.content) {
            AnswerActions(message: message, sessionId: sessionId)
        } else if !message.streaming, let versions = message.versions, message.images.isEmpty {
            // 没有操作行的回答（没有正文）也要能切换版本（网页 chat-message.tsx 的同一分支）。
            AnswerVersionNav(versions: versions)
                .padding(.top, 6.4)
                .padding(.leading, -10.4)
        } else if !message.streaming && !failed && !message.generatingImage && !message.images.isEmpty {
            // 只有图片的回答没有复制 / "…"，但要能报告（网页 ReportAnswerButton，应用商店的 AI 生成内容政策）。
            AnswerReportOnlyAction(messageId: message.id)
        }
    }
}

/// 回答顶部：选中的角色（32）+ 模型名（网页 .notion-role-label.is-assistant：间距 8、下距 8.8；
/// 模型名 .notion-role-model：正文字体 13、500、灰色）。不再重复 NOTEFABLE 文字，读屏念"AI 回答 · 模型名"。
/// 图片不是聊天模型画的：图片回答（生成中、成功或失败）不显示模型名。最新一条回答的角色跟着生成状态动。
private struct AssistantLabelRow: View {
    let modelId: String?
    let imageAnswer: Bool
    let isLatest: Bool

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.chat.state
        let modelLabel: String? = imageAnswer ? nil : modelId.flatMap { id in state.models.first { $0.id == id }?.label }
        let character: CharacterState = isLatest ? state.activeReplyCharacterState() : .idle
        let aiReply = L("ai_reply")
        HStack(spacing: 8) {
            AppIconView(
                icon: app.appIcon.icon,
                state: character,
                size: 32,
                animated: character != .idle && character != .hidden
            )
            if let modelLabel {
                Text(modelLabel)
                    .font(.nf(13, weight: 500))
                    .nfLineHeight(18, fontSize: 13)
                    .foregroundStyle(Sm.muted)
            }
        }
        .padding(.bottom, 8.8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(modelLabel.map { "\(aiReply) · \($0)" } ?? aiReply)
    }
}
