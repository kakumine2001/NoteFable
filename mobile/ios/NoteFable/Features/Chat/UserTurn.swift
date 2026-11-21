import SwiftUI

/// 一条提问（Android ChatScreen.kt 的 `UserTurn`，网页 chat-message.tsx 的用户消息）。提问上方没有标签。
/// - 提问块（.notion-user-block）：整行宽、圆角 14、底色 --nf-user-bubble、内边距 12×16；图片缩略图 128（圆角 4）在文字上方，
///   间距 8、下距 12；文字 15 / 行高 28（不是回答正文的 16），可以选中复制。引用来问的提问，开头的引用灰字在上（下距 8）。
/// - 非图片附件：块下方 12 处的文件标签；添加的笔记：再往下 8 处的笔记标签，点一下打开那篇笔记。
/// - 已经保存到服务端的提问下面有版本切换、复制、编辑；编辑在块里直接改写。
struct UserTurn: View {
    let message: UiMessage
    /// 生成图片的提问不能编辑。
    let canEdit: Bool
    /// 被拒绝的改写（上限、断网）：编辑框带着这段文字重新打开（网页 rejectedEdit）。
    let editDraft: String?
    let busy: Bool
    let maxEditorHeight: CGFloat

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var editing: Bool

    init(message: UiMessage, canEdit: Bool, editDraft: String?, busy: Bool, maxEditorHeight: CGFloat) {
        self.message = message
        self.canEdit = canEdit
        self.editDraft = editDraft
        self.busy = busy
        self.maxEditorHeight = maxEditorHeight
        _editing = State(initialValue: editDraft != nil)
    }

    var body: some View {
        let images = message.attachments.filter { Self.isImage($0) }
        let files = message.attachments.filter { !Self.isImage($0) }
        let bubble = RoundedRectangle(cornerRadius: 14)
        VStack(alignment: .leading, spacing: 0) {
            if editing {
                UserMessageEditor(
                    initial: editDraft ?? message.content,
                    busy: busy,
                    maxHeight: maxEditorHeight,
                    onCancel: {
                        editing = false
                        if editDraft != nil { app.chat.dismissRejectedEdit() }
                    },
                    onSubmit: { text in
                        editing = false
                        app.chat.editMessage(message.id, text: text)
                    }
                )
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Sm.userBubble, in: bubble)
            } else if !images.isEmpty || !message.content.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    if !images.isEmpty {
                        ChatFlowLayout(spacing: 8, lineSpacing: 8) {
                            ForEach(images) { image in
                                ChatAttachmentThumbnail(source: image.dataUrl ?? "", side: 128, cornerRadius: 4)
                                    .accessibilityElement(children: .ignore)
                                    .accessibilityLabel(image.filename)
                                    .accessibilityAddTraits(.isImage)
                            }
                        }
                        .padding(.bottom, message.content.isEmpty ? 0 : 12)
                    }
                    if !message.content.isEmpty {
                        UserTurnText(content: message.content)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Sm.userBubble, in: bubble)
            }
            if !files.isEmpty {
                ChatFlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(files) { file in
                        ChatFileChip(name: file.filename)
                    }
                }
                .padding(.top, 12)
            }
            if !message.pages.isEmpty {
                ChatFlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(message.pages) { page in
                        PageChip(page: page, removable: false) { router.openNote(page.id) }
                    }
                }
                .padding(.top, 8)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("attached_pages"))
            }
            // 复制、编辑、版本切换：已经保存到服务端的提问才有（网页 isSavedMessageId）。
            if !editing, !message.id.hasPrefix(ChatViewModel.LOCAL_ID_PREFIX) {
                UserTurnActions(message: message, busy: busy, canEdit: canEdit) { editing = true }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // 被拒的改写回来时重新打开编辑框；它被清掉（取消、换了聊天）时关上。
        .onChange(of: editDraft) { _, draft in
            editing = draft != nil
        }
    }

    private static func isImage(_ attachment: AttachmentDto) -> Bool {
        attachment.dataUrl != nil && attachment.mimeType.hasPrefix("image/")
    }
}

/// 提问的文字：回答里引用来问的，开头的引用和提问分开显示（`ChatQuote.split`）。
private struct UserTurnText: View {
    let content: String

    var body: some View {
        let parts = ChatQuote.split(content)
        VStack(alignment: .leading, spacing: 0) {
            if let quote = parts.quote {
                ChatQuoteText(quote: quote, lineLimit: nil)
                    .padding(.bottom, 8)
            }
            Text(parts.body)
                .font(.nf(15))
                .nfLineHeight(28, fontSize: 15)
                .foregroundStyle(Sm.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .textSelection(.enabled)
    }
}
