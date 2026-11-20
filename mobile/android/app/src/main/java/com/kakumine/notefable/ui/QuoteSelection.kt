package com.kakumine.notefable.ui

import android.graphics.Rect as AndroidRect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.contextmenu.builder.item
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuItem
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuKeys
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuSession
import androidx.compose.foundation.text.contextmenu.modifier.appendTextContextMenuComponents
import androidx.compose.foundation.text.contextmenu.modifier.filterTextContextMenuComponents
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.NativeClipboard
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R

/**
 * 回答里选中文字时的「问 NoteFable」（网页 quote-selection.tsx）。
 * [onQuote] 收到选中的文字；[resetKey] 每引用一次加 1，回答用它重建选区（引用后取消选中）。
 */
class QuoteSelection(val onQuote: (String) -> Unit, val resetKey: Int)

/** 没有提供时（笔记里的 AI 助手等）不加「问 NoteFable」。 */
val LocalQuoteSelection = compositionLocalOf<QuoteSelection?> { null }

/**
 * 回答的选区用的剪贴板（放进 LocalClipboard）。Compose 的选区不对外给选中的文字，只在「复制」时把它交给剪贴板，
 * 所以「问 NoteFable」借一次「复制」：[capture] 期间写来的文字直接交给引用，不进系统剪贴板（用户之前复制的图片、文件等不受影响）。
 * 其它时候（普通的「复制」、代码块的复制按钮）照常转给系统剪贴板。
 */
class QuoteClipboard(private val system: Clipboard) : Clipboard {
    private var pending: ((String) -> Unit)? = null

    /** 跑 [copy]（选区的「复制」），把它交来的文字给 [onQuote]。选区的复制是同步写进来的，没写进来就什么也不做。 */
    fun capture(copy: () -> Unit, onQuote: (String) -> Unit) {
        pending = onQuote
        try {
            copy()
        } finally {
            pending = null
        }
    }

    override suspend fun getClipEntry(): ClipEntry? = system.getClipEntry()

    override suspend fun setClipEntry(clipEntry: ClipEntry?) {
        val take = pending
        if (take == null) {
            system.setClipEntry(clipEntry)
            return
        }
        pending = null
        val clip = clipEntry?.clipData
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).text?.toString() else null
        if (!text.isNullOrBlank()) take(text)
    }

    override val nativeClipboard: NativeClipboard get() = system.nativeClipboard
}

/** 在提供 [QuoteClipboard] 的 CompositionLocalProvider 外面调用：包住的是系统剪贴板。 */
@Composable
fun rememberQuoteClipboard(): QuoteClipboard {
    val system = LocalClipboard.current
    return remember(system) { QuoteClipboard(system) }
}

/**
 * 回答的选中菜单：系统的浮动菜单里在「复制」「全选」前面加「问 NoteFable」（ChatGPT 的「ChatGPT に聞く」同样的位置）。
 * 「问 NoteFable」借一次「复制」，由 [QuoteClipboard] 接住选中的文字。
 */
@Composable
fun rememberQuoteTextToolbar(clipboard: QuoteClipboard, onQuote: (String) -> Unit): TextToolbar {
    val view = LocalView.current
    val ask = stringResource(R.string.ask_notefable)
    return remember(view, ask, clipboard, onQuote) { QuoteTextToolbar(view, ask, clipboard, onQuote) }
}

/**
 * 新版 Compose 的文字菜单（foundation 1.10 起默认开启 isNewContextMenuEnabled）不走 LocalTextToolbar，
 * 所以在选区的 Modifier 上做同样的菜单：「问 NoteFable」「复制」「全选」（和 [QuoteTextToolbar] 一致）。
 * 选区自己的项先收集、加在这里的项排在最后，所以 filter 把原来的「复制」「全选」记下并去掉（其它系统项也去掉），
 * 再由这里按顺序加上；没有原来的项时对应的这一项也去掉。「问 NoteFable」借一次「复制」，由 [QuoteClipboard] 接住文字。
 */
@Composable
fun rememberQuoteMenuModifier(clipboard: QuoteClipboard, onQuote: (String) -> Unit): Modifier {
    val ask = stringResource(R.string.ask_notefable)
    val copyLabel = stringResource(android.R.string.copy)
    val selectAllLabel = stringResource(android.R.string.selectAll)
    return remember(clipboard, ask, copyLabel, selectAllLabel, onQuote) {
        // 每次生成菜单时：先跑 builder（清空），filter 再按列表顺序先看到原来的项、后看到这里的项。
        var copy: (TextContextMenuSession.() -> Unit)? = null
        var selectAll: (TextContextMenuSession.() -> Unit)? = null
        Modifier
            .appendTextContextMenuComponents {
                copy = null
                selectAll = null
                item(QuoteMenuKey.Ask, ask) {
                    val doCopy = copy
                    if (doCopy == null) {
                        close()
                        return@item
                    }
                    clipboard.capture({ doCopy() }, onQuote)
                    close()
                }
                item(QuoteMenuKey.Copy, copyLabel) { copy?.invoke(this) ?: close() }
                item(QuoteMenuKey.SelectAll, selectAllLabel) { selectAll?.invoke(this) ?: close() }
            }
            .filterTextContextMenuComponents { component ->
                when (component.key) {
                    QuoteMenuKey.Ask, QuoteMenuKey.Copy -> copy != null
                    QuoteMenuKey.SelectAll -> selectAll != null
                    TextContextMenuKeys.CopyKey -> {
                        copy = (component as? TextContextMenuItem)?.onClick
                        false
                    }
                    TextContextMenuKeys.SelectAllKey -> {
                        selectAll = (component as? TextContextMenuItem)?.onClick
                        false
                    }
                    else -> false
                }
            }
    }
}

private enum class QuoteMenuKey { Ask, Copy, SelectAll }

private class QuoteTextToolbar(
    private val view: View,
    private val askLabel: String,
    private val clipboard: QuoteClipboard,
    private val onQuote: (String) -> Unit,
) : TextToolbar {
    private var actionMode: ActionMode? = null
    private var rect = Rect.Zero
    private var onCopy: (() -> Unit)? = null
    private var onSelectAll: (() -> Unit)? = null

    override var status: TextToolbarStatus = TextToolbarStatus.Hidden
        private set

    override fun showMenu(
        rect: Rect,
        onCopyRequested: (() -> Unit)?,
        onPasteRequested: (() -> Unit)?,
        onCutRequested: (() -> Unit)?,
        onSelectAllRequested: (() -> Unit)?,
    ) {
        this.rect = rect
        onCopy = onCopyRequested
        onSelectAll = onSelectAllRequested
        val mode = actionMode
        if (mode == null) {
            status = TextToolbarStatus.Shown
            actionMode = view.startActionMode(callback, ActionMode.TYPE_FLOATING)
        } else {
            mode.invalidate()
            mode.invalidateContentRect()
        }
    }

    override fun hide() {
        status = TextToolbarStatus.Hidden
        actionMode?.finish()
        actionMode = null
    }

    private fun ask() {
        val copy = onCopy ?: return
        clipboard.capture(copy, onQuote)
        hide()
    }

    private val callback = object : ActionMode.Callback2() {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            fill(menu)
            return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
            fill(menu)
            return true
        }

        private fun fill(menu: Menu) {
            menu.clear()
            if (onCopy != null) {
                menu.add(0, ASK, 0, askLabel).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                menu.add(0, COPY, 1, android.R.string.copy).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            }
            if (onSelectAll != null) {
                menu.add(0, SELECT_ALL, 2, android.R.string.selectAll).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
            }
        }

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
            when (item.itemId) {
                ASK -> ask()
                COPY -> { onCopy?.invoke(); hide() }
                SELECT_ALL -> onSelectAll?.invoke()
                else -> return false
            }
            return true
        }

        override fun onDestroyActionMode(mode: ActionMode) {
            actionMode = null
            status = TextToolbarStatus.Hidden
        }

        override fun onGetContentRect(mode: ActionMode, view: View, outRect: AndroidRect) {
            outRect.set(rect.left.toInt(), rect.top.toInt(), rect.right.toInt(), rect.bottom.toInt())
        }
    }

    private companion object {
        const val ASK = 1
        const val COPY = 2
        const val SELECT_ALL = 3
    }
}

/**
 * 输入栏上方的引用（网页 .chat-quote）：左边 2 的竖线（Border 色），13 号 Muted 字、行高 23.2、最多 3 行，右边 24 的 ✕。
 */
@Composable
fun ComposerQuote(quote: String, enabled: Boolean, onRemove: () -> Unit) {
    val label = stringResource(R.string.quote)
    val remove = stringResource(R.string.remove_quote)
    Row(
        Modifier.fillMaxWidth().padding(bottom = 12.dp).semantics { contentDescription = label },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        QuoteText(quote, Modifier.weight(1f))
        Box(
            Modifier.size(24.dp).clip(RoundedCornerShape(5.6.dp))
                // 上传附件时（发出的内容已定）不能移除，和附件标签一样。
                .clickable(enabled = enabled, role = Role.Button, onClick = onRemove)
                .semantics { contentDescription = remove },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.X, 14.dp, Sm.Muted)
        }
    }
}

/** 引用的正文：左边竖线 + 灰字。输入栏上方最多 3 行；发言里显示全文（网页 .chat-quote.is-sent）。 */
@Composable
fun QuoteText(quote: String, modifier: Modifier = Modifier, maxLines: Int = 3) {
    Row(modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(2.dp).fillMaxHeight().background(Sm.Border))
        Text(
            quote,
            color = Sm.Muted,
            fontSize = 13.sp,
            lineHeight = 23.2.sp,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 10.4.dp),
        )
    }
}
