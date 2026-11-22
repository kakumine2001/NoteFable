package com.kakumine.notefable.data

// 系统「分享」交来的内容（网页 src/lib/share-target.ts、iOS ShareIntake 的同名规则：三端文的组合方式相同）。

/** 分享来的文字，和一段延后读取的文件（要先把外部给的临时地址读出来，所以读取在收到 Intent 时就已开始）。 */
class IncomingShareRequest(val text: String, val loadFiles: (suspend () -> List<LocalFile>)? = null)

/** 标题 + 正文 + 链接合成一段文字：同样的内容（正文里已经有链接、标题等）只留一次。 */
fun composeSharedText(subject: String?, text: String?): String {
    val cleanSubject = subject.orEmpty().trim()
    val cleanText = text.orEmpty().trim()
    val parts = buildList {
        if (cleanSubject.isNotEmpty() && !cleanText.contains(cleanSubject)) add(cleanSubject)
        if (cleanText.isNotEmpty()) add(cleanText)
    }
    return parts.joinToString("\n")
}

/** 输入栏里已经有写了一半的内容时不覆盖，把分享来的文字接在后面。 */
fun mergeDraftWithShare(existingDraft: String, sharedText: String): String = when {
    sharedText.isBlank() -> existingDraft
    existingDraft.isBlank() -> sharedText
    else -> "$existingDraft\n\n$sharedText"
}
