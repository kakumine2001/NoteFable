package com.kakumine.notefable.ui

import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.ui.platform.LocalView
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
 * 回答的选中菜单：系统的浮动菜单里在「复制」「全选」前面加「问 NoteFable」（ChatGPT 的「ChatGPT に聞く」同样的位置）。
 * Compose 的选区不对外给选中的文字，所以「问 NoteFable」先走一次「复制」，再从剪贴板读回刚复制的文字。
 */
@Composable
fun rememberQuoteTextToolbar(onQuote: (String) -> Unit): TextToolbar {
    val view = LocalView.current
    val ask = stringResource(R.string.ask_notefable)
    return remember(view, ask, onQuote) { QuoteTextToolbar(view, ask, onQuote) }
}

/**
 * 新版 Compose 的文字菜单（foundation 1.10 起默认开启 isNewContextMenuEnabled）不走 LocalTextToolbar，
 * 所以在选区的 Modifier 上做同样的菜单：「问 NoteFable」「复制」「全选」（和 [QuoteTextToolbar] 一致）。
 * 选区自己的项先收集、加在这里的项排在最后，所以 filter 把原来的「复制」「全选」记下并去掉（其它系统项也去掉），
 * 再由这里按顺序加上；没有原来的项时对应的这一项也去掉。「问 NoteFable」先走一次「复制」，再从剪贴板读回文字。
 */
@Composable
fun rememberQuoteMenuModifier(onQuote: (String) -> Unit): Modifier {
    val view = LocalView.current
    val ask = stringResource(R.string.ask_notefable)
    val copyLabel = stringResource(android.R.string.copy)
    val selectAllLabel = stringResource(android.R.string.selectAll)
    return remember(view, ask, copyLabel, selectAllLabel, onQuote) {
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
                    val clipboard = view.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    doCopy()
                    close()
                    // 复制可能在下一帧才写进剪贴板：等一帧再读。
                    view.post {
                        val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(view.context)?.toString()
                        if (!text.isNullOrBlank()) onQuote(text)
                    }
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
        val clipboard = view.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        copy()
        hide()
        // 复制可能在下一帧才写进剪贴板：等一帧再读。
        view.post {
            val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(view.context)?.toString()
            if (!text.isNullOrBlank()) onQuote(text)
        }
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
fun ComposerQuote(quote: String, onRemove: () -> Unit) {
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
                .clickable(role = Role.Button, onClick = onRemove)
                .semantics { contentDescription = remove },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.X, 14.dp, Sm.Muted)
        }
    }
}

/** 引用的正文：左边竖线 + 灰字，最多 3 行。输入栏上方和发言里共用。 */
@Composable
fun QuoteText(quote: String, modifier: Modifier = Modifier) {
    Row(modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(2.dp).fillMaxHeight().background(Sm.Border))
        Text(
            quote,
            color = Sm.Muted,
            fontSize = 13.sp,
            lineHeight = 23.2.sp,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 10.4.dp),
        )
    }
}
