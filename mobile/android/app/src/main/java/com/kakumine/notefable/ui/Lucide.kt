package com.kakumine.notefable.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import com.kakumine.notefable.data.PageKind

/**
 * 网页用的是 lucide 图标（线条图标，24x24 画布，描边 2，圆头）。
 * 这里直接用同一份路径数据绘制，和网页的图标一模一样；Material 图标的线宽和造型不一样，所以不用。
 */
object Lucide {
    val Menu = listOf("M4 5h16", "M4 12h16", "M4 19h16")
    val Plus = listOf("M5 12h14", "M12 5v14")
    val ArrowUp = listOf("m5 12 7-7 7 7", "M12 19V5")
    val ChevronDown = listOf("m6 9 6 6 6-6")
    val Check = listOf("M20 6 9 17l-5-5")
    val Languages = listOf("m5 8 6 6", "m4 14 6-6 2-3", "M2 5h12", "M7 2h1", "m22 22-5-10-5 10", "M14 18h6")
    val X = listOf("M18 6 6 18", "m6 6 12 12")
    val ChevronsUpDown = listOf("m7 15 5 5 5-5", "m7 9 5-5 5 5")
    val ImagePlus = listOf(
        "M16 5h6",
        "M19 2v6",
        "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",
        "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
        "M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    )
    val Copy = listOf(
        "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
        "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
    )
    val MessageSquareText = listOf(
        "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
        "M7 11h10",
        "M7 15h6",
        "M7 7h8",
    )
    val RotateCcw = listOf("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val LogOut = listOf("m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4")
    val CreditCard = listOf("M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M2 10h20")
    val Globe = listOf("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20")
    val ExternalLink = listOf("M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")
    val FileText = listOf(
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M10 9H8",
        "M16 13H8",
        "M16 17H8",
    )
    // 页面类型的默认图标（网页 page-kind-icon.tsx）：白板 Shapes、幻灯片 Presentation，lucide-react 1.16.0；rect / circle 换成等价的 path。
    val Shapes = listOf(
        "M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z",
        "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1Z",
        "M14 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0",
    )
    val Presentation = listOf(
        "M2 3h20",
        "M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3",
        "m7 21 5-5 5 5",
    )
    // 「整理成笔记」（网页 page.tsx / create-page-dialog.tsx 的 FilePlus）。
    val FilePlus = listOf(
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M9 15h6",
        "M12 18v-6",
    )
    private const val FolderOutline =
        "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    val Folder = listOf(FolderOutline)
    val FolderPlus = listOf("M12 10v6", "M9 13h6", FolderOutline)
    val FolderInput = listOf(
        "M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",
        "M2 13h10",
        "m9 16 3-3-3-3",
    )
    val Pencil = listOf(
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
        "m15 5 4 4",
    )
    val Trash2 = listOf(
        "M10 11v6",
        "M14 11v6",
        "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
        "M3 6h18",
        "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    )
    val ChevronRight = listOf("m9 18 6-6-6-6")
    val ChevronLeft = listOf("m15 18-6-6 6-6")
    val History = listOf("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2")
    val Paperclip = listOf("m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551")
    // 侧栏的帮助菜单（help-menu.tsx）。circle 换成等价的 path。
    val CircleHelp = listOf("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    val Info = listOf("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 16v-4", "M12 8h.01")
    val Shield = listOf("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z")
    val Scale = listOf("M12 3v18", "m19 8 3 8a5 5 0 0 1-6 0zV7", "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1", "m5 8 3 8a5 5 0 0 1-6 0zV7", "M7 21h10")

    // 后续批次（进度条、提案卡片、代码块、搜索、侧栏、设置、拍照等）要用的图标，从 lucide-react 1.16.0 一次性生成：
    // 渲染网页用的同名组件，把 circle / rect / line 换成等价的 path。网页 import 的名字照抄（Code2、MoreHorizontal 等别名也保留）。
    val ArrowDown = listOf(
        "M12 5v14",
        "m19 12-7 7-7-7",
    )
    val ArrowLeft = listOf(
        "m12 19-7-7 7-7",
        "M19 12H5",
    )
    val ArrowUpRight = listOf(
        "M7 7h10v10",
        "M7 17 17 7",
    )
    val Camera = listOf(
        "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z",
        "M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    )
    val Code2 = listOf(
        "m18 16 4-4-4-4",
        "m6 8-4 4 4 4",
        "m14.5 4-5 16",
    )
    val Download = listOf(
        "M12 15V3",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
        "m7 10 5 5 5-5",
    )
    val Lock = listOf(
        "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
        "M7 11V7a5 5 0 0 1 10 0v4",
    )
    val Star = listOf(
        "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
    )
    val StarOff = listOf(
        "m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152",
        "m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099",
        "m2 2 20 20",
    )
    val Ellipsis = listOf(
        "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
        "M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
        "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    )
    val FilePenLine = listOf(
        "M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z",
        "M14.487 7.858A1 1 0 0 1 14 7V2",
        "M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516",
        "M8 18h1",
    )
    val FilePlus2 = listOf(
        "M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M14 19h6",
        "M17 16v6",
    )
    val FileSearch = listOf(
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M9 14.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0",
        "M13.3 16.3 15 18",
    )
    val FolderOpen = listOf(
        "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
    )
    val Lightbulb = listOf(
        "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
        "M9 18h6",
        "M10 22h4",
    )
    val LoaderCircle = listOf("M21 12a9 9 0 1 1-6.219-8.56")
    val NotebookText = listOf(
        "M2 6h4",
        "M2 10h4",
        "M2 14h4",
        "M2 18h4",
        "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2Z",
        "M9.5 8h5",
        "M9.5 12H16",
        "M9.5 16H14",
    )
    val PanelLeftClose = listOf(
        "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2Z",
        "M9 3v18",
        "m16 15-3-3 3-3",
    )
    val Pin = listOf(
        "M12 17v5",
        "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    )
    val PinOff = listOf(
        "M12 17v5",
        "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",
        "m2 2 20 20",
        "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
    )
    val GitBranch = listOf(
        "M15 6a9 9 0 0 0-9 9V3",
        "M21 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0",
        "M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0",
    )
    val RefreshCw = listOf(
        "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
        "M21 3v5h-5",
        "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
        "M8 16H3v5",
    )
    val ScrollText = listOf(
        "M15 12h-5",
        "M15 8h-5",
        "M19 17V5a2 2 0 0 0-2-2H4",
        "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
    )
    val Search = listOf(
        "m21 21-4.34-4.34",
        "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0",
    )
    val Settings = listOf(
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
        "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    )
    val Settings2 = listOf(
        "M14 17H5",
        "M19 7h-9",
        "M14 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
        "M4 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    )
    val Shuffle = listOf(
        "m18 14 4 4-4 4",
        "m18 2 4 4-4 4",
        "M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22",
        "M2 6h1.972a4 4 0 0 1 3.6 2.2",
        "M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45",
    )
    val Smile = listOf(
        "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
        "M8 14s1.5 2 4 2 4-2 4-2",
        "M9 9L9.01 9",
        "M15 9L15.01 9",
    )
    val Sparkles = listOf(
        "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
        "M20 2v4",
        "M22 4h-4",
        "M2 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    )
    val TextSearch = listOf(
        "M21 5H3",
        "M10 12H3",
        "M10 19H3",
        "M14 15a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
        "m21 19-1.9-1.9",
    )
    val Upload = listOf(
        "M12 3v12",
        "m17 8-5-5-5 5",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    )
    // 设置的入口一览（settings-dialog.tsx 的 TABS），同样从 lucide-react 1.16.0 取；CircleUser 的两个 circle 换成等价的 path。
    val SlidersHorizontal = listOf(
        "M10 5H3",
        "M12 19H3",
        "M14 3v4",
        "M16 17v4",
        "M21 12h-9",
        "M21 19h-5",
        "M21 5h-7",
        "M8 10v4",
        "M8 12H3",
    )
    val PenLine = listOf(
        "M13 21h8",
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    )
    val CircleUser = listOf(
        "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
        "M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
        "M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662",
    )
    // 外観テーマ（System / Light / Dark）用アイコン（lucide-react 1.16.0 の Monitor / Sun / Moon）。
    val Monitor = listOf(
        "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
        "M8 21h8",
        "M12 17v4",
    )
    val Sun = listOf(
        "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
        "M12 2v2",
        "M12 20v2",
        "m4.93 4.93 1.41 1.41",
        "m17.66 17.66 1.41 1.41",
        "M2 12h2",
        "M20 12h2",
        "m6.34 17.66-1.41 1.41",
        "m19.07 4.93-1.41 1.41",
    )
    val Moon = listOf(
        "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
    )
    val MoreHorizontal = Ellipsis
    val Loader2 = LoaderCircle

    internal val RtlMirrored = setOf(
        ArrowLeft,
        ChevronLeft,
        ChevronRight,
        PanelLeftClose,
        LogOut,
        FolderInput,
    )
}

/**
 * 页面类型的默认图标（页面没有表情 / 图片图标时显示，网页 PageKindIcon）：笔记 FileText、白板 Shapes、幻灯片 Presentation。
 * iOS（DesignSystem/Lucide.swift）用同样的图形。
 */
fun pageKindIcon(kind: PageKind): List<String> = when (kind) {
    PageKind.Note -> Lucide.FileText
    PageKind.Whiteboard -> Lucide.Shapes
    PageKind.Slides -> Lucide.Presentation
}

@Composable
fun LucideIcon(
    paths: List<String>,
    size: Dp,
    tint: Color,
    modifier: Modifier = Modifier,
    strokeWidth: Float = 2f,
    mirrorInRtl: Boolean = paths in Lucide.RtlMirrored,
) {
    val parsed = remember(paths) { paths.map { PathParser().parsePathString(it).toPath() } }
    val rtl = mirrorInRtl && LocalLayoutDirection.current == LayoutDirection.Rtl
    Canvas(modifier.size(size)) {
        scale(scaleX = if (rtl) -1f else 1f, scaleY = 1f, pivot = center) {
            scale(this.size.width / 24f, pivot = Offset.Zero) {
                val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
                parsed.forEach { drawPath(it, tint, style = stroke) }
            }
        }
    }
}
