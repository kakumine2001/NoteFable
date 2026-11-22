package com.kakumine.notefable.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.Canvas
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.roundToIntRect
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.kakumine.notefable.R
import com.kakumine.notefable.data.EmojiCatalog
import com.kakumine.notefable.data.EmojiIcon
import com.kakumine.notefable.data.EmojiItem
import com.kakumine.notefable.data.EmojiShape
import com.kakumine.notefable.data.PrefsRecentEmojiStore
import com.kakumine.notefable.data.SkinTone
import com.kakumine.notefable.data.pushRecentEmoji
import com.kakumine.notefable.data.unifiedToEmoji
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * 表情选择器（网页 src/components/emoji-picker.tsx + full-emoji-picker.tsx，基于 emoji-picker-react）。
 * 412×915 手机视口下量的值（1dp = 1 CSS px）：
 * - 弹出框（.notes-popover.chat-floating-picker）：宽 min(408, 屏宽 − 24)，白底、圆角 8、阴影 0 4 14 .12 + 1px .05 细环；
 *   位置照 floatingPositionFor：左边对齐按钮（离屏幕边至少 12），下方放得下就在按钮下 6，否则在按钮上方 6。
 * - 顶部条（.notes-picker-bar）：高 36、左 12 右 8、下边 1px 线；左边"Emoji"14/500 + 当前表情（选中标记），
 *   右边"Random"（Shuffle 13 + 4 + 文字）和"Remove"两个高 28、左右 8、圆角 4 的 13 灰字按钮。
 * - 下面是 emoji-picker-react：高 min(380, 屏高 − 60)。头部上下 15、左右 10：搜索框高 40、#F6F6F6、圆角 8、
 *   左右内边距 30、16 字，左侧 10 处放大镜 20，有字时右侧 10 处 30 的圆形清除按钮；右边 28 宽的肤色色块（15、圆角 4、1px #555 边），
 *   点开向左展开 6 个（每个 28），选中的放大 1.3、蓝边。分类导航高 60（上下 15、左右 10），9 个 30 的图标 space-around 分布，
 *   当前分类 #3371B7，其余 #868686；搜索框有字时整条变淡（.3）且不能点。表情区：分类标题高 40、左右 10、16 粗体灰字、白底 .9、吸顶；
 *   表情 34×34（字 24、圆角 8），每行能放几个放几个（grid auto-fill：floor((宽 − 20) / 34)，412 宽时 10 个），两端对齐，左右 10。有肤色变体的表情右下角有浅灰小三角，长按 0.5 秒出变体条。
 * - 打开时和 .notes-popover 一样淡入上移（motion-menu-enter 120ms ease-out）；表情数据读不出来时显示"Could not load emoji."和"Try again"。
 * - 点表情：选中并关闭（记入"最近使用"）；Random：随便换一个，不关；Remove：去掉图标并关闭。
 */

private val PickerText = Sm.Text                    // --epr-text-color = --notes-text
private val CategoryActive = Color(0xFF3371B7)      // --epr-category-icon-active-color
private val CategoryInactive = Color(0xFF868686)    // --epr-category-icon-inactive-color
private val SearchBackground = Color(0xFFF6F6F6)    // --epr-search-input-bg-color
private val Highlight = Color(0xFF007AEB)           // --epr-highlight-color（搜索框聚焦、选中的肤色）
private val VariationIndicator = Color(0xFFE7E7E7)  // --epr-emoji-variation-indicator-color
private val ToneBorder = Color(0xFF555555)          // --epr-skin-tone-outer-border-color
private val PickerBorder = Color(0xFFE7E7E7)        // --epr-picker-border-color

private val EmojiCell = 34.dp
private val ToneItem = 28.dp

/** 弹出框的大小（网页 floatingPositionFor + .full-emoji-picker 的 --emoji-picker-height）。 */
@Immutable
data class EmojiPopoverSize(val width: Dp, val pickerHeight: Dp) {
    val height: Dp get() = BarHeight + pickerHeight

    companion object {
        val BarHeight = 36.dp
        fun of(screenWidth: Dp, screenHeight: Dp) = EmojiPopoverSize(
            width = minOf(408.dp, screenWidth - 24.dp),
            pickerHeight = minOf(380.dp, maxOf(80.dp, screenHeight - 60.dp)),
        )
    }
}

/**
 * 网页 floatingPositionFor：左边对齐按钮，离屏幕边至少 [margin]；按钮下方 6 放得下就放下面，否则放上面，再夹在屏幕里。
 * 全部用像素。
 */
fun floatingEmojiPosition(
    anchor: IntRect,
    viewport: IntSize,
    popup: IntSize,
    margin: Int,
    gap: Int,
    layoutDirection: LayoutDirection = LayoutDirection.Ltr,
): IntOffset {
    val height = minOf(popup.height, viewport.height - margin * 2)
    val start = if (layoutDirection == LayoutDirection.Rtl) anchor.right - popup.width else anchor.left
    val left = maxOf(margin, minOf(start, viewport.width - popup.width - margin))
    val below = anchor.bottom + gap
    val preferred = if (below + height <= viewport.height - margin) below else anchor.top - height - gap
    val top = maxOf(margin, minOf(preferred, viewport.height - height - margin))
    return IntOffset(left, top)
}

private class FloatingPosition(private val margin: Int, private val gap: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize) =
        floatingEmojiPosition(anchorBounds, windowSize, popupContentSize, margin, gap, layoutDirection)
}

/**
 * 按钮旁边弹出的表情选择器（网页 FloatingEmojiPopover）。放在按钮所在的 Box 里，以那个 Box 为锚点。
 * 点外面或按返回键关闭（网页：外侧点击、Esc、手机的"返回"）。
 */
@Composable
fun EmojiPopover(current: String?, onChange: (String?) -> Unit, onClose: () -> Unit, removeLabel: String? = null) {
    val configuration = LocalConfiguration.current
    val size = EmojiPopoverSize.of(configuration.screenWidthDp.dp, configuration.screenHeightDp.dp)
    val density = LocalDensity.current
    val provider = remember(density) { with(density) { FloatingPosition(12.dp.roundToPx(), 6.dp.roundToPx()) } }
    val label = stringResource(R.string.em_choose)
    // .notes-popover 的 motion-menu-enter：120ms ease-out，从透明、下移 4、缩小到 .98 开始（和 LanguageSelect 相同）。
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(120, easing = CssEaseOut)) }
    Popup(popupPositionProvider = provider, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Box(
            Modifier.graphicsLayer {
                val t = enter.value
                alpha = t
                translationY = (1f - t) * 4.dp.toPx()
                val scale = 0.98f + 0.02f * t
                scaleX = scale
                scaleY = scale
            }.width(size.width)
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = Color(0x1F0F0F0F), spotColor = Color(0x1F0F0F0F))
                .border(1.dp, Color(0x0D0F0F0F), RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White)
                .semantics { contentDescription = label },
        ) {
            EmojiPickerBody(current, onChange, onClose, pickerHeight = size.pickerHeight, removeLabel = removeLabel)
        }
    }
}

/**
 * 表情选择器的内容（网页 EmojiPickerBody）：上面一条 Emoji / Random / Remove，下面是表情列表。
 * 可以放进弹出框，也可以像网页的个人资料那样直接放在页面里（[pickerHeight] 由放的地方决定）。
 * 选中后调用 [onChange] 再 [onClose]；Random 只调用 [onChange]；Remove 传 null 并关闭。
 */
@Composable
fun EmojiPickerBody(
    current: String?,
    onChange: (String?) -> Unit,
    onClose: () -> Unit,
    pickerHeight: Dp,
    modifier: Modifier = Modifier,
    removeLabel: String? = null,
) {
    val (catalog, failed, retry) = rememberEmojiCatalog()
    Column(modifier.fillMaxWidth()) {
        PickerBar(
            current = current,
            removeLabel = removeLabel ?: stringResource(R.string.em_remove),
            onRandom = { catalog?.emojis?.randomOrNull()?.let { onChange(it.emoji) } },
            onRemove = { onChange(null); onClose() },
        )
        if (catalog == null && failed) {
            // emoji-picker-react 的 LoadError：一句"Could not load emoji."和一个"Try again"按钮（包里没有另外的样式）。
            Column(Modifier.fillMaxWidth().height(pickerHeight), Arrangement.Center, Alignment.CenterHorizontally) {
                Text(stringResource(R.string.em_load_failed), color = PickerText, fontSize = 14.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                BarButton(stringResource(R.string.try_again), null, retry)
            }
        } else if (catalog == null) {
            // 网页 .emoji-picker-loading：居中的 14 灰字。
            Box(Modifier.fillMaxWidth().height(pickerHeight), Alignment.Center) {
                Text(stringResource(R.string.em_loading), color = Sm.Muted, fontSize = 14.sp)
            }
        } else {
            EmojiGrid(catalog, pickerHeight) { onChange(it); onClose() }
        }
    }
}

/** 读到的表情数据；读不出来时 failed 为 true，调用 retry 再读一次（emoji-picker-react 的 LoadError / retry）。 */
private data class CatalogLoad(val catalog: EmojiCatalog?, val failed: Boolean, val retry: () -> Unit)

@Composable
private fun rememberEmojiCatalog(): CatalogLoad {
    val context = LocalContext.current
    val locale = stringResource(R.string.ui_locale)
    var attempt by remember { mutableIntStateOf(0) }
    val result by produceState<Result<EmojiCatalog>?>(null, locale, attempt) {
        value = null
        value = withContext(Dispatchers.Default) { runCatching { EmojiCatalog.load(context.applicationContext, locale) } }
    }
    return CatalogLoad(result?.getOrNull(), result?.isFailure == true) { attempt++ }
}

@Composable
private fun PickerBar(current: String?, removeLabel: String, onRandom: () -> Unit, onRemove: () -> Unit) {
    val currentLabel = stringResource(R.string.em_current)
    Row(
        Modifier.fillMaxWidth().height(EmojiPopoverSize.BarHeight)
            .drawBehind { drawRect(Sm.Border, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
            .padding(start = 12.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.em_emoji), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium)
        // 选中标记：网页在"Emoji"后面接一个空格和当前表情（aria-label "Current emoji"）。
        // 笔记的图标是上传图片时没有文字形式，和网页一样不显示（Remove 照常可用）。
        val currentEmoji = com.kakumine.notefable.data.NoteIcons.text(current)
        if (currentEmoji != null) {
            Text(" $currentEmoji", color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.semantics { contentDescription = "$currentLabel $currentEmoji" })
        }
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            BarButton(stringResource(R.string.em_random), Lucide.Shuffle, onRandom)
            BarButton(removeLabel, null, onRemove)
        }
    }
}

@Composable
private fun BarButton(text: String, icon: List<String>?, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier.height(28.dp).clip(RoundedCornerShape(4.dp)).background(if (pressed) Sm.Hover else Color.Transparent)
            .clickable(interaction, indication = null, onClick = onClick).semantics { role = Role.Button }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) LucideIcon(icon, 13.dp, Sm.Muted)
        Text(text, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp)
    }
}

// ---------------------------------------------------------------------------------------------
// 表情列表（emoji-picker-react）

/** 列表里的一行：分类标题，或最多一行列数的表情（显示用的码点 + 表情本身）。 */
private sealed interface GridRow {
    data class Header(val category: String) : GridRow
    data class Emojis(val category: String, val index: Int, val cells: List<Pair<String, EmojiItem>>) : GridRow
}

/** 按分类、搜索词和肤色排出要显示的行（emoji-picker-react：没有命中的分类整个隐藏，"最近使用"为空时也隐藏）。 */
internal fun emojiGridSections(
    catalog: EmojiCatalog,
    recent: List<String>,
    tone: SkinTone,
    query: String,
): List<Pair<String, List<Pair<String, EmojiItem>>>> {
    val match = catalog.matcher(query)
    return catalog.categories.mapNotNull { category ->
        val cells = if (category == "suggested") {
            recent.mapNotNull { unified -> catalog.find(unified)?.let { unified to it } }
        } else {
            catalog.inCategory(category).map { it.unifiedFor(tone) to it }
        }.filter { match == null || match(it.second) }
        if (cells.isEmpty()) null else category to cells
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun EmojiGrid(catalog: EmojiCatalog, height: Dp, onPick: (String) -> Unit) {
    val context = LocalContext.current
    val store = remember(context) { PrefsRecentEmojiStore(context.applicationContext) }
    var recent by remember { mutableStateOf(store.load()) }
    var query by remember { mutableStateOf("") }
    var tone by remember { mutableStateOf(SkinTone.Neutral) }
    var toneOpen by remember { mutableStateOf(false) }
    var variationsOf by remember { mutableStateOf<Pair<EmojiItem, IntRect>?>(null) }
    var bodyBounds by remember { mutableStateOf(IntRect.Zero) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current

    BoxWithConstraints(Modifier.fillMaxWidth().height(height)) {
        // grid auto-fill：左右各 10 之间放得下几个 34 就几个（412 宽的手机上是 10 个）。
        val columns = emojiColumns(maxWidth)
        val sections = remember(catalog, recent, tone, query) { emojiGridSections(catalog, recent, tone, query) }
        val rows = remember(sections, columns) {
            sections.flatMap { (category, cells) ->
                listOf<GridRow>(GridRow.Header(category)) +
                    cells.chunked(columns).mapIndexed { index, chunk -> GridRow.Emojis(category, index, chunk) }
            }
        }
        val headerIndex = remember(rows) { rows.withIndex().filter { it.value is GridRow.Header }.associate { (it.value as GridRow.Header).category to it.index } }
        val activeCategory by remember(rows) {
            derivedStateOf {
                val first = listState.firstVisibleItemIndex
                when (val row = rows.getOrNull(first)) {
                    is GridRow.Header -> row.category
                    is GridRow.Emojis -> row.category
                    null -> null
                }
            }
        }

        fun pick(item: EmojiItem, unified: String) {
            recent = pushRecentEmoji(recent, unified).also(store::save)
            onPick(unifiedToEmoji(unified))
        }

        Column(Modifier.fillMaxSize()) {
            // 头部：搜索框 + 肤色（上下 15、左右 10）。
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 15.dp).height(40.dp), verticalAlignment = Alignment.CenterVertically) {
                SearchField(catalog.icons, query, onQueryChange = {
                    query = it
                    variationsOf = null
                    scope.launch { listState.scrollToItem(0) }
                }, modifier = Modifier.weight(1f))
                SkinTonePicker(tone, toneOpen, onToggle = { toneOpen = true }, onPick = {
                    tone = it
                    toneOpen = false
                })
            }
            CategoryNav(catalog, activeCategory, headerIndex.keys, searching = query.isNotEmpty()) { category ->
                headerIndex[category]?.let { index -> scope.launch { listState.scrollToItem(index) } }
            }
            Box(Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { bodyBounds = it.boundsInWindow().roundToIntRect() }) {
                if (rows.isEmpty()) {
                    // emoji-picker-react 的 Empty：搜索没有结果。
                    Box(Modifier.fillMaxWidth().heightIn(min = EmojiCell).padding(10.dp), Alignment.Center) {
                        Text(stringResource(R.string.em_none_found), color = PickerText, fontSize = 14.sp, textAlign = TextAlign.Center)
                    }
                } else {
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        rows.forEach { row ->
                            when (row) {
                                is GridRow.Header -> stickyHeader(key = "h-${row.category}") { CategoryLabel(row.category) }
                                is GridRow.Emojis -> item(key = "${row.category}-${row.index}") {
                                    EmojiRow(row.cells, columns, onPick = { item, unified -> focus.clearFocus(); pick(item, unified) }, onVariations = { item, cell -> variationsOf = item to cell })
                                }
                            }
                        }
                    }
                }
                variationsOf?.let { (item, cell) ->
                    VariationBar(item, cell, bodyBounds, onPick = { unified -> variationsOf = null; pick(item, unified) }, onDismiss = { variationsOf = null })
                }
            }
        }
    }
}

/** 一行放几个表情：emoji-picker-react 的 grid auto-fill（左右各 10 的内边距之间，每格 34）。 */
internal fun emojiColumns(width: Dp): Int = maxOf(1, ((width - 20.dp) / EmojiCell).toInt())

@Composable
private fun SearchField(icons: Map<String, EmojiIcon>, query: String, onQueryChange: (String) -> Unit, modifier: Modifier) {
    val clearLabel = stringResource(R.string.em_clear_search)
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val placeholder = stringResource(R.string.em_search_placeholder)
    val label = stringResource(R.string.em_search_label)
    BasicTextField(
        value = query,
        onValueChange = onQueryChange,
        singleLine = true,
        interactionSource = interaction,
        textStyle = TextStyle(color = PickerText, fontSize = 16.sp, lineHeight = 24.sp),
        cursorBrush = SolidColor(PickerText),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = modifier.height(40.dp).semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp)).background(SearchBackground)
                    .border(1.dp, if (focused) Highlight else SearchBackground, RoundedCornerShape(8.dp)),
                Alignment.CenterStart,
            ) {
                PickerIcon(icons["search"], CategoryInactive, 20.dp, Modifier.padding(start = 10.dp))
                Box(Modifier.fillMaxWidth().padding(horizontal = 30.dp), Alignment.CenterStart) {
                    if (query.isEmpty()) Text(placeholder, color = PickerText, fontSize = 16.sp, lineHeight = 24.sp, maxLines = 1)
                    inner()
                }
                if (query.isNotEmpty()) {
                    Box(
                        Modifier.align(Alignment.CenterEnd).padding(end = 10.dp).size(30.dp).clip(CircleShape)
                            .clickable { onQueryChange("") }
                            .semantics { role = Role.Button; contentDescription = clearLabel },
                        Alignment.Center,
                    ) { PickerIcon(icons["clear"], CategoryInactive, 20.dp) }
                }
            }
        },
    )
}

private val ToneLabels = mapOf(
    SkinTone.Neutral to R.string.em_tone_neutral,
    SkinTone.Light to R.string.em_tone_light,
    SkinTone.MediumLight to R.string.em_tone_medium_light,
    SkinTone.Medium to R.string.em_tone_medium,
    SkinTone.MediumDark to R.string.em_tone_medium_dark,
    SkinTone.Dark to R.string.em_tone_dark,
)

/** 肤色：收起时只露出当前的色块（28 宽）；点开向左展开 6 个，再点一个就选它并收起（emoji-picker-react SkinTonePicker）。 */
@Composable
private fun SkinTonePicker(tone: SkinTone, open: Boolean, onToggle: () -> Unit, onPick: (SkinTone) -> Unit) {
    val tones = SkinTone.entries
    val width by animateDpAsState(if (open) ToneItem * tones.size else ToneItem, tween(300), label = "toneWidth")
    Box(Modifier.width(width).height(40.dp)) {
        tones.forEachIndexed { index, item ->
            val active = item == tone
            val shift by animateDpAsState(if (open) -(ToneItem * index) else 0.dp, tween(300), label = "toneShift")
            val alpha by animateFloatAsState(if (open || active) 1f else 0f, tween(350), label = "toneAlpha")
            val grow = if (open && active) 1.3f else 1f
            val label = stringResource(ToneLabels.getValue(item))
            // 每个色块占 28 宽的格子，15 的方块贴在格子右侧居中（insetInlineEnd 0）。
            Box(
                Modifier.align(Alignment.CenterEnd).offset(x = shift).size(ToneItem, 40.dp)
                    .then(if (open || active) Modifier.clickable { if (open) onPick(item) else onToggle() } else Modifier)
                    .semantics { contentDescription = label; role = Role.Button; selected = active },
                Alignment.CenterEnd,
            ) {
                Box(
                    Modifier.size(15.dp).scale(grow).alpha(alpha).clip(RoundedCornerShape(4.dp)).background(Color(item.color))
                        .border(1.dp, if (open && active) Highlight else ToneBorder, RoundedCornerShape(4.dp))
                        .padding(1.dp).border(1.dp, Color.White, RoundedCornerShape(3.dp)),
                )
            }
        }
    }
}

@Composable
private fun CategoryNav(catalog: EmojiCatalog, active: String?, available: Set<String>, searching: Boolean, onSelect: (String) -> Unit) {
    val names = categoryNames()
    val navLabel = stringResource(R.string.em_categories)
    // 搜索框有字时（.epr-search-active）整条变淡到 .3，也不能点。
    Row(
        Modifier.fillMaxWidth().height(60.dp).alpha(if (searching) 0.3f else 1f)
            .semantics { contentDescription = navLabel }
            .padding(horizontal = 10.dp, vertical = 15.dp),
        horizontalArrangement = Arrangement.SpaceAround,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        catalog.categories.forEach { category ->
            val selected = category == active
            Box(
                Modifier.size(30.dp).clip(RoundedCornerShape(4.dp))
                    .clickable(enabled = !searching && category in available) { onSelect(category) }
                    .semantics { contentDescription = names[category].orEmpty(); role = Role.Tab; this.selected = selected },
                Alignment.Center,
            ) {
                PickerIcon(catalog.icons[category], if (selected) CategoryActive else CategoryInactive, 30.dp)
            }
        }
    }
}

@Composable
private fun categoryNames(): Map<String, String> = mapOf(
    "suggested" to stringResource(R.string.em_cat_suggested),
    "smileys_people" to stringResource(R.string.em_cat_smileys_people),
    "animals_nature" to stringResource(R.string.em_cat_animals_nature),
    "food_drink" to stringResource(R.string.em_cat_food_drink),
    "travel_places" to stringResource(R.string.em_cat_travel_places),
    "activities" to stringResource(R.string.em_cat_activities),
    "objects" to stringResource(R.string.em_cat_objects),
    "symbols" to stringResource(R.string.em_cat_symbols),
    "flags" to stringResource(R.string.em_cat_flags),
)

@Composable
private fun CategoryLabel(category: String) {
    val name = categoryNames()[category].orEmpty()
    Box(Modifier.fillMaxWidth().height(40.dp).background(Color(0xE6FFFFFF)).padding(horizontal = 10.dp), Alignment.CenterStart) {
        Text(name, color = Sm.Muted, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun EmojiRow(cells: List<Pair<String, EmojiItem>>, columns: Int, onPick: (EmojiItem, String) -> Unit, onVariations: (EmojiItem, IntRect) -> Unit) {
    // grid auto-fill 的 [columns] 列（每列 34）、justify-content: space-between：最后一行不满时也对齐到同样的列。
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        for (column in 0 until columns) {
            val cell = cells.getOrNull(column)
            if (cell == null) Spacer(Modifier.size(EmojiCell))
            else EmojiButton(cell.first, cell.second, showVariations = true, onClick = { onPick(cell.second, cell.first) },
                onLongClick = if (cell.second.variations.isNotEmpty()) ({ bounds -> onVariations(cell.second, bounds) }) else null)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun EmojiButton(unified: String, item: EmojiItem, showVariations: Boolean, onClick: () -> Unit, onLongClick: ((IntRect) -> Unit)?) {
    val interaction = remember { MutableInteractionSource() }
    var bounds by remember { mutableStateOf(IntRect.Zero) }
    val pressed by interaction.collectIsPressedAsState()
    val hasVariations = showVariations && item.variations.isNotEmpty()
    Box(
        Modifier.size(EmojiCell).clip(RoundedCornerShape(8.dp)).background(if (pressed) Sm.Hover else Color.Transparent)
            .onGloballyPositioned { bounds = it.boundsInWindow().roundToIntRect() }
            .combinedClickable(interaction, indication = null, onClick = onClick, onLongClick = onLongClick?.let { longClick -> { longClick(bounds) } })
            .semantics { contentDescription = item.label; role = Role.Button }
            .drawBehind {
                if (!hasVariations) return@drawBehind
                // 右下角（RTL 为左下角）的小三角（::after，4px 边框旋转 135°）。
                val leg = 5.6.dp.toPx()
                val bottom = size.height - 1.dp.toPx()
                val path = Path().apply {
                    if (layoutDirection == LayoutDirection.Rtl) {
                        moveTo(0f, bottom - leg)
                        lineTo(0f, bottom)
                        lineTo(leg, bottom)
                    } else {
                        val right = size.width
                        moveTo(right, bottom - leg)
                        lineTo(right, bottom)
                        lineTo(right - leg, bottom)
                    }
                    close()
                }
                drawPath(path, VariationIndicator)
            },
        Alignment.Center,
    ) {
        Text(unifiedToEmoji(unified), fontSize = 24.sp, lineHeight = 30.sp, color = Color.Black)
    }
}

/**
 * 长按出现的肤色变体条（emoji-picker-react EmojiVariationPicker）：左右各缩 15、高 45、内边距 5、平均分布，
 * 白底、1px #E7E7E7 边、圆角 3、阴影 0 2 5 .2；放在那一行上方，上方放不下就放下方。
 * 画在选择器自己的弹窗里（表情区上面盖一层），不再开一个嵌套的 Popup：嵌套弹窗按屏幕坐标摆，
 * 而 [cell] / [body] 是外层弹窗里的坐标，会错位。点变体条以外的地方关闭。
 */
@Composable
private fun VariationBar(item: EmojiItem, cell: IntRect, body: IntRect, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val density = LocalDensity.current
    val options = (listOf(item.unified) + item.variations).take(6)
    val barHeight = with(density) { 45.dp.roundToPx() }
    val inset = with(density) { 15.dp.roundToPx() }
    val above = cell.top - body.top - barHeight
    val y = if (above >= 0) above else cell.bottom - body.top
    Box(
        Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { onDismiss() } },
    ) {
        Row(
            Modifier.offset { IntOffset(inset, y) }
                .width(with(density) { (body.width).toDp() } - 30.dp).height(45.dp)
                .shadow(5.dp, RoundedCornerShape(3.dp), ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
                .clip(RoundedCornerShape(3.dp)).background(Color.White).border(1.dp, PickerBorder, RoundedCornerShape(3.dp))
                .pointerInput(Unit) { detectTapGestures { } }
                .padding(5.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            options.forEach { unified -> EmojiButton(unified, item, showVariations = false, onClick = { onPick(unified) }, onLongClick = null) }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// emoji-picker-react 自带的图标（分类、放大镜、清除），路径数据在 emoji.json 里。

private class ParsedIcon(val viewBox: List<Float>, val shapes: List<Pair<Path, EmojiShape>>)

private fun parseIcon(icon: EmojiIcon) = ParsedIcon(icon.viewBox, icon.shapes.map { shape ->
    PathParser().parsePathString(shape.d).toPath().apply { if (shape.evenOdd) fillType = PathFillType.EvenOdd } to shape
})

@Composable
private fun PickerIcon(icon: EmojiIcon?, tint: Color, size: Dp, modifier: Modifier = Modifier) {
    if (icon == null) return Spacer(modifier.size(size))
    val parsed = remember(icon) { parseIcon(icon) }
    Canvas(modifier.size(size)) {
        val (x, y, w) = parsed.viewBox
        scale(this.size.width / w, pivot = Offset.Zero) {
            translate(-x, -y) {
                parsed.shapes.forEach { (path, shape) ->
                    if (shape.fill) drawPath(path, tint)
                    if (shape.stroke) drawPath(path, tint, style = Stroke(width = shape.strokeWidth, cap = if (shape.round) StrokeCap.Round else StrokeCap.Butt))
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 打开选择器的按钮（网页 ChatTopbarIcon / ChatTitleIcon / 侧栏行的 .chat-row-icon-button）。

/**
 * 点一下在按钮旁弹出表情选择器，再点一下或点外面关闭。按下和打开时是 --notes-hover 灰底（网页 :hover / aria-expanded）。
 * [content] 画按钮里的图标；尺寸、圆角由调用处按网页给。
 */
@Composable
fun EmojiTriggerButton(
    current: String?,
    onChange: (String?) -> Unit,
    description: String,
    modifier: Modifier = Modifier,
    shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(4.dp),
    enabled: Boolean = true,
    removeLabel: String? = null,
    content: @Composable () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier.clip(shape).background(if (pressed || open) Sm.Hover else Color.Transparent)
            .clickable(interaction, indication = null, enabled = enabled) { open = !open }
            .semantics { contentDescription = description; role = Role.Button },
        Alignment.Center,
    ) {
        content()
        if (open) EmojiPopover(current, onChange = onChange, onClose = { open = false }, removeLabel = removeLabel)
    }
}

/** 聊天图标按钮（aria-label "Change chat icon"）。 */
@Composable
fun ChatIconButton(
    icon: String?,
    onChange: (String?) -> Unit,
    modifier: Modifier,
    shape: androidx.compose.ui.graphics.Shape,
    content: @Composable () -> Unit,
) = EmojiTriggerButton(icon, onChange, stringResource(R.string.em_change_chat_icon), modifier, shape, content = content)
