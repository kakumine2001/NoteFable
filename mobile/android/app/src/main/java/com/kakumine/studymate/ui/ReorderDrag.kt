package com.kakumine.studymate.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup

// 列表拖动排序（网页 reorder-handle.tsx + globals.css 的 .list-reorder-*、[data-order-*]），聊天侧栏和笔记侧栏 / 首页共用：
// - 把手（.list-reorder-handle，触屏）宽 28、最小高 44、圆角 4，GripVertical 13 灰；按住直接拖（与网页触屏一致）。
// - 被拖的行半透明 .5；目标行上 / 下出现 2px 蓝线 #2383e2；拖到投放区（项目标题、Chats / Notes 标签）上整块
//   rgba(35,131,226,.12) 底加 1px 蓝框、圆角 4。手指在列表上下边 30 内移动时每次移动滚 12（手指不动就不滚）。
// - 失败提示 .list-reorder-error：行下方，宽 min(220, 90vw)、内边距 6、白底、1px 细线、12 红字，点一下关闭。

internal val DropBlue = Color(0xFF2383E2)
private val DropFill = Color(0x1F2383E2) // rgba(35,131,226,.12)
private val ReorderErrorRed = Color(0xFFB91C1C)

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
 * 拖动把手：按住即拖，松手时调 [onDrop]（目标在 [DragState.target]）。[locked] 时不能拖（这一行正在移动）。
 * 手势协程被取消（行离开组合、key 变了）时 detectDragGestures 不会调 onDragCancel，这里自己收尾。
 */
@Composable
internal fun ReorderGrip(
    id: String,
    label: String,
    drag: DragState,
    locked: Boolean,
    onStart: () -> Unit,
    onDrop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val density = LocalDensity.current
    Box(
        modifier.clip(RoundedCornerShape(4.dp))
            .onGloballyPositioned { coords = it }
            .pointerInput(id, locked) {
                if (locked) return@pointerInput
                try {
                    detectDragGestures(
                        onDragStart = { offset ->
                            val origin = coords?.localToWindow(offset) ?: return@detectDragGestures
                            onStart()
                            drag.dragging = id
                            drag.update(origin)
                        },
                        onDrag = { change, amount ->
                            change.consume()
                            drag.move(drag.pointer + amount, density)
                        },
                        onDragEnd = onDrop,
                        onDragCancel = { drag.clear() },
                    )
                } finally {
                    if (drag.dragging == id) drag.clear()
                }
            }
            .semantics { contentDescription = label },
        Alignment.Center,
    ) { LucideIcon(Lucide.GripVertical, 13.dp, Sm.Muted) }
}

/** .list-reorder-error：放在行的 Box 里，显示在行下方 [rowHeight] 处。点一下关闭。 */
@Composable
internal fun ReorderErrorPopup(text: String, onDismiss: () -> Unit, rowHeight: androidx.compose.ui.unit.Dp = 44.dp) {
    val density = LocalDensity.current
    Popup(offset = IntOffset(0, with(density) { rowHeight.roundToPx() }), onDismissRequest = onDismiss) {
        Text(
            text,
            color = ReorderErrorRed, fontSize = 12.sp, lineHeight = 16.sp,
            modifier = Modifier.widthIn(max = 220.dp).border(1.dp, Sm.Border).background(Color.White).clickable(onClick = onDismiss)
                .padding(6.dp).semantics { liveRegion = LiveRegionMode.Assertive },
        )
    }
}
