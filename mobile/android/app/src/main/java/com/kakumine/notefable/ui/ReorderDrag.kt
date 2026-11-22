package com.kakumine.notefable.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.gestures.drag
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup

// 列表拖动排序（网页 reorder-row-button.tsx + globals.css 的 .list-reorder-*、[data-order-*]），聊天侧栏和笔记侧栏 / 首页共用：
// - 没有专门的把手：长按行的主体（标题区）后拖动（与网页触屏一致），点按照常打开。
// - 被拖的行半透明 .5；目标行上 / 下出现 2px 蓝线 #2383e2；拖到投放区（项目标题、Chats / Notes 标签）上整块
//   rgba(35,131,226,.12) 底加 1px 蓝框、圆角 4。手指在列表上下边 30 内移动时每次移动滚 12（手指不动就不滚）。
// - 失败提示 .list-reorder-error：行下方，宽 min(220, 90vw)、内边距 6、白底、1px 细线、12 红字，点一下关闭。

internal val DropBlue: Color get() = Sm.Blue
private val DropFill: Color get() = Sm.pick(Color(0x1F2383E2), Sm.AccentSoft) // rgba(35,131,226,.12)
private val ReorderErrorRed: Color get() = Sm.pick(Color(0xFFB91C1C), Sm.ErrorText) // 深色 .list-reorder-error：--nf-error-text

/** 拖动时手指下的目标：某一行的前 / 后，或某个容器（项目；null = 无项目）。 */
internal sealed interface DropTarget {
    data class Row(val id: String, val after: Boolean) : DropTarget
    data class Into(val containerId: String?) : DropTarget
}

/**
 * 拖动状态：被拖的行、手指在窗口里的位置、当前目标。行和投放区的位置由各自 onGloballyPositioned 登记，
 * 离开组合（折叠、删除）时由 DisposableEffect 注销，免得命中已经看不见的行。
 */
internal class DragState(private val scroll: ScrollState) {
    var dragging by mutableStateOf<String?>(null)
    var pointer by mutableStateOf(Offset.Zero)
    var target by mutableStateOf<DropTarget?>(null)
    /** 当前目标是投放区时，它在 [zones] 里的键（同一个容器可以有几个投放区，只高亮手指下的那个）。 */
    var targetZone by mutableStateOf<String?>(null)
    /** 列表可见区域（窗口坐标），自动滚动用。 */
    var listBounds = Rect.Zero
    val rows = mutableStateMapOf<String, Rect>()
    /** 投放区：键 → 区域。键是容器 id；空白键（""、" "）都表示无项目。 */
    val zones = mutableStateMapOf<String, Rect>()

    fun update(point: Offset) {
        pointer = point
        val id = dragging ?: return
        target = dropTargetAt(point, id, zones, rows)
        targetZone = if (target is DropTarget.Into) zones.entries.firstOrNull { it.value.contains(point) }?.key else null
    }

    /** 手指移动一次：先找目标，再在列表上下边 30 以内滚 12（网页 updateTarget）。 */
    fun move(point: Offset, density: Density) {
        update(point)
        val edge = with(density) { 30.dp.toPx() }
        val step = with(density) { 12.dp.toPx() }
        val delta = when {
            point.y < listBounds.top + edge -> -step
            point.y > listBounds.bottom - edge -> step
            else -> 0f
        }
        if (delta != 0f) scroll.dispatchRawDelta(delta)
    }

    fun clear() {
        dragging = null
        target = null
        targetZone = null
    }
}

/** 投放区优先，其次是别的行（按手指在行的上半 / 下半决定前 / 后）。 */
internal fun dropTargetAt(point: Offset, dragging: String, zones: Map<String, Rect>, rows: Map<String, Rect>): DropTarget? {
    val zone = zones.entries.firstOrNull { it.value.contains(point) }
    if (zone != null) return DropTarget.Into(zone.key.ifBlank { null })
    return rows.entries.firstOrNull { it.key != dragging && it.value.contains(point) }
        ?.let { DropTarget.Row(it.key, point.y > it.value.center.y) }
}

/** 投放区高亮（[data-order-drop="into"]）。 */
internal fun Modifier.dropZone(active: Boolean): Modifier = if (!active) this else drawBehind {
    val r = CornerRadius(4.dp.toPx())
    drawRoundRect(DropFill, cornerRadius = r)
    drawRoundRect(DropBlue, cornerRadius = r, style = Stroke(1.dp.toPx()))
}

/** 目标行的插入线（[data-order-drop="before|after"]）：上边或下边 2px 蓝线。 */
internal fun Modifier.dropLine(before: Boolean, after: Boolean): Modifier = if (!before && !after) this else drawWithContent {
    drawContent()
    val line = 2.dp.toPx()
    if (before) drawRect(DropBlue, size = Size(size.width, line))
    if (after) drawRect(DropBlue, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
}

/**
 * 整行拖动（网页 ReorderRowButton 包住行的主体按钮，触屏长按后拖）：长按后拖，松手时调 [onDrop]（目标在 [DragState.target]）。
 * 点按仍交给同一行的 clickable；普通滑动照常滚动列表。[locked] 时不能拖（这一行正在移动）。
 * 要放在 clickable 的里层（链上更靠后）：长按开始后的抬起由这里吃掉，原地松手也不会再打开这一行（网页 suppressClick）。
 * 手势协程被取消（行离开组合、key 变了）时由 finally 收尾。
 */
internal fun Modifier.reorderDrag(
    id: String,
    drag: DragState,
    locked: Boolean,
    onStart: () -> Unit,
    onDrop: () -> Unit,
): Modifier = composed {
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val start by rememberUpdatedState(onStart)
    val drop by rememberUpdatedState(onDrop)
    onGloballyPositioned { coords = it }
        .pointerInput(id, locked) {
            if (locked) return@pointerInput
            try {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val press = awaitLongPressOrCancellation(down.id) ?: return@awaitEachGesture
                    val origin = coords?.localToWindow(press.position) ?: return@awaitEachGesture
                    press.consume()
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    start()
                    drag.dragging = id
                    drag.update(origin)
                    val released = this.drag(press.id) { change ->
                        drag.move(drag.pointer + change.positionChange(), density)
                        change.consume()
                    }
                    currentEvent.changes.forEach { if (it.changedToUp()) it.consume() }
                    if (released) drop() else drag.clear()
                }
            } finally {
                if (drag.dragging == id) drag.clear()
            }
        }
}

/** .list-reorder-error：放在行的 Box 里，显示在行下方 [rowHeight] 处。点一下关闭。 */
@Composable
internal fun ReorderErrorPopup(text: String, onDismiss: () -> Unit, rowHeight: androidx.compose.ui.unit.Dp = 44.dp) {
    val density = LocalDensity.current
    Popup(offset = IntOffset(0, with(density) { rowHeight.roundToPx() }), onDismissRequest = onDismiss) {
        Text(
            text,
            color = ReorderErrorRed, fontSize = 12.sp, lineHeight = 16.sp,
            modifier = Modifier.widthIn(max = 220.dp).border(1.dp, Sm.Border).background(Sm.Surface).background(Sm.pick(Color.Transparent, Sm.ErrorBg)).clickable(onClick = onDismiss)
                .padding(6.dp).semantics { liveRegion = LiveRegionMode.Assertive },
        )
    }
}
