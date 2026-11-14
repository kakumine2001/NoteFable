package com.kakumine.studymate.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.TransferableContent
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.kakumine.studymate.R
import com.kakumine.studymate.data.LocalFile
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.model.markdownPadding
import com.mikepenz.markdown.m3.markdownTypography
import kotlinx.coroutines.launch

// 以下数值来自网页端在 412x915 手机视口下的实测（见 docs/architecture/android-native.md 的对照表）。
private val PageGutter = 24.dp
private val TurnGap = 36.dp

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    state: ChatUiState,
    input: String,
    onInputChange: (String) -> Unit,
    onMenu: () -> Unit,
    onNewChat: () -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onSelectModel: (String) -> Unit,
    onSelectReasoning: (String) -> Unit,
    onRetryMessages: () -> Unit,
    /** 在后台读出附件再加进输入栏；读的期间不能发送（见 ChatViewModel.importFiles）。 */
    onImportFiles: (suspend () -> List<LocalFile>) -> Unit,
    onRemoveFile: (String) -> Unit,
    onImageMode: (Boolean) -> Unit,
    onSwitchWorkspace: (Workspace) -> Unit,
    /** 改当前聊天的图标（还没保存的新聊天是草稿图标）。 */
    onChangeIcon: (String?) -> Unit,
    account: AccountUiState = AccountUiState(),
    onSignIn: () -> Unit = {},
    onDismissGuestLimit: () -> Unit = {},
    onSearch: () -> Unit = {},
    onRevealDone: (Long) -> Unit = {},
) {
    var sheetOpen by rememberSaveable { mutableStateOf(false) }
    var attachOpen by rememberSaveable { mutableStateOf(false) }
    val pickFiles = rememberFilePicker(onImportFiles)
    val context = LocalContext.current
    val pasteImages: (List<android.net.Uri>, TransferableContent) -> Unit = { uris, content ->
        onImportFiles {
            // 键盘插入的图片，临时读取权限挂在 content 里的 InputContentInfo 上：拷贝期间一直引用着 content，
            // 免得它被回收、权限跟着失效；拷完再主动释放。
            try {
                withContext(Dispatchers.IO) { uris.mapNotNull { copyPastedImage(context, it) } }
            } finally {
                releaseKeyboardContentPermission(content)
            }
        }
    }
    // 空白页（网页 emptyState：没有消息）：标题在页面中间，顶栏不放标题和"新建聊天"。读历史中 / 失败时不算。
    val isEmptyChat = state.messages.isEmpty() && !state.messagesLoading && !state.messagesFailed

    Scaffold(
        containerColor = Color.White,
        // 底部的系统栏/键盘留白交给输入栏自己处理，这样键盘弹出时输入栏贴着键盘。
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopBar(
                title = state.activeTitle.takeIf { !isEmptyChat },
                icon = state.activeIcon,
                // 网页的空白首页顶栏没有"新建聊天"，因为已经在新聊天里。
                showNewChat = !isEmptyChat,
                onMenu = onMenu,
                onNewChat = onNewChat,
                onChangeIcon = onChangeIcon,
                onSearch = onSearch,
            )
        },
    ) { inner ->
        Column(Modifier.padding(inner).fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                MessageList(state, onRetryMessages, onSwitchWorkspace, onChangeIcon, onRevealDone)
            }
            val guestLimit = state.guestLimit
            Composer(
                // 未登录撞到上限：网页只在服务端开了登录、且还没登录时显示（GuestLimitPrompt 里的判断）。
                prompt = if (guestLimit != null && account.configured && account.user == null) {
                    {
                        GuestLimitPrompt(
                            kind = guestLimit,
                            attachmentsLost = state.files.isNotEmpty(),
                            onSignIn = onSignIn,
                            onClose = onDismissGuestLimit,
                        )
                    }
                } else null,
                input = input,
                onInputChange = onInputChange,
                sending = state.sending,
                canSend = !state.messagesLoading && !state.messagesFailed && state.filesError == null && state.upload == null &&
                    state.importing == 0,
                modelLabel = state.selectedModel?.label,
                effortLabel = state.selectedReasoning?.let { reasoningLabel(it) },
                files = state.files,
                upload = state.upload,
                imageMode = state.imageMode,
                error = state.filesError?.let { attachErrorText(it) } ?: when (val notice = state.notice) {
                    is ComposerNotice.Rejected -> attachErrorText(notice.error)
                    ComposerNotice.UploadFailed -> stringResource(R.string.upload_failed)
                    ComposerNotice.LoadFailed -> stringResource(R.string.messages_load_failed)
                    ComposerNotice.IconFailed -> stringResource(R.string.em_chat_icon_failed)
                    ComposerNotice.LinkFailed -> stringResource(R.string.messages_load_failed)
                    null -> null
                },
                onSend = { onSend(input) },
                onStop = onStop,
                onModelClick = { sheetOpen = true },
                onAddClick = { attachOpen = true },
                onRemoveFile = onRemoveFile,
                onImageModeOff = { onImageMode(false) },
                onPasteImages = pasteImages,
            )
        }
    }

    if (sheetOpen) {
        ModelSheet(state, onSelectModel, onSelectReasoning, onDismiss = { sheetOpen = false })
    }
    if (attachOpen) {
        AttachSheet(
            imageMode = state.imageMode,
            onPickFiles = pickFiles,
            onToggleImageMode = { onImageMode(!state.imageMode) },
            onDismiss = { attachOpen = false },
        )
    }
}

// ---------------------------------------------------------------------------------------------
// 顶栏：高 56，左右内边距 10.4，图标按钮 40x40（图标 20，圆角 4.8），标题 14sp 灰。

@Composable
private fun TopBar(
    title: String?,
    icon: String?,
    showNewChat: Boolean,
    onMenu: () -> Unit,
    onNewChat: () -> Unit,
    onChangeIcon: (String?) -> Unit,
    onSearch: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 10.4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TopIconButton(Lucide.Menu, stringResource(R.string.open_menu), onMenu)
        if (title != null) {
            Spacer(Modifier.width(12.dp))
            // 网页 ChatTopbarIcon（手机）：40×40、圆角 4，表情 18 / MessageSquareText 15 灰；点开表情选择器。
            ChatIconButton(icon, onChangeIcon, Modifier.size(40.dp), RoundedCornerShape(4.dp)) {
                if (icon != null) Text(icon, fontSize = 18.sp, lineHeight = 18.sp)
                else LucideIcon(Lucide.MessageSquareText, 15.dp, Sm.Muted)
            }
            Text(
                title,
                modifier = Modifier.weight(1f).padding(start = 6.dp, end = 6.dp),
                color = Sm.Muted,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            Spacer(Modifier.weight(1f))
        }
        // 右侧按钮组（gap 8）：搜索在"新建聊天"前面，空白首页只有搜索（Batch 4）。
        TopIconButton(Lucide.Search, stringResource(R.string.search_chats_and_notes), onSearch)
        if (showNewChat) {
            Spacer(Modifier.width(8.dp))
            TopIconButton(Lucide.Plus, stringResource(R.string.new_chat), onNewChat)
        }
    }
}

@Composable
internal fun TopIconButton(paths: List<String>, description: String, onClick: () -> Unit, iconSize: androidx.compose.ui.unit.Dp = 20.dp) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(4.8.dp)).clickable(onClick = onClick)
            .semantics { contentDescription = description; role = Role.Button },
        Alignment.Center,
    ) {
        LucideIcon(paths, iconSize, Sm.Muted)
    }
}

// ---------------------------------------------------------------------------------------------
// 消息列表

@Composable
private fun MessageList(state: ChatUiState, onRetry: () -> Unit, onSwitchWorkspace: (Workspace) -> Unit, onChangeIcon: (String?) -> Unit, onRevealDone: (Long) -> Unit) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    // 和网页一样按"是否跟着最新内容"决定回答变长时要不要贴住底部（page.tsx 的 followBottomRef）：
    // 打开会话、发出新消息、点"滚动到底部"时跟随；用户一滚（拖动、滚轮、无障碍滚动）离开底部就停止，
    // 滚动停在底部 2 以内又跟随。判断规则在 followAction（ChatFollow.kt）。
    val follow = remember { mutableStateOf(true) }
    // "滚动到底部"按钮自己发起的滚动：不能当成用户往回滚而停止跟随。
    val programmaticScroll = remember { mutableStateOf(false) }
    val lastIndex = state.messages.lastIndex
    // 检索结果 / 链接要定位到某条消息：定位完之前不贴底（网页 openChatFromLink 关掉 pinToBottom）。
    val revealPending = rememberUpdatedState(state.reveal != null && state.reveal.sessionId == state.activeSessionId)
    LaunchedEffect(state.activeSessionId, state.messages.size) { follow.value = true }
    LaunchedEffect(listState) {
        listState.interactionSource.interactions.collect { interaction ->
            when (interaction) {
                is DragInteraction.Start -> follow.value = false
                is DragInteraction.Stop, is DragInteraction.Cancel ->
                    if (distanceToBottom(listState) <= with(density) { 2.dp.toPx() }) follow.value = true
            }
        }
    }
    LaunchedEffect(listState) {
        val threshold = with(density) { 2.dp.toPx() }
        snapshotFlow {
            followAction(
                following = follow.value,
                distanceToBottomPx = distanceToBottom(listState),
                thresholdPx = threshold,
                scrolling = listState.isScrollInProgress,
                programmaticScroll = programmaticScroll.value,
                hasItems = listState.layoutInfo.totalItemsCount > 0,
                revealPending = revealPending.value,
            )
        }.collect { action ->
            when (action) {
                FollowAction.Follow -> follow.value = true
                FollowAction.Unfollow -> follow.value = false
                // 回答在列表没重组时也会变高（Markdown 异步排版），或刚开始跟随：补一次贴底。
                FollowAction.Pin -> listState.requestScrollToItem(listState.layoutInfo.totalItemsCount - 1, PIN_TO_END)
                FollowAction.None -> Unit
            }
        }
    }
    // 跟随时，在这一帧的测量之前就把位置定到最底部：新增的文字直接出现在底部，不会先跳一下。
    SideEffect {
        if (follow.value && !revealPending.value && lastIndex >= 0 && !listState.isScrollInProgress) {
            listState.requestScrollToItem(lastIndex, PIN_TO_END)
        }
    }
    val atBottom by remember {
        derivedStateOf { distanceToBottom(listState) <= with(density) { 8.dp.toPx() } }
    }
    // 检索结果 / 链接：读完后滚到那条消息并闪一下（见 SearchScreen.kt 的 revealMessage）。
    // 滚到了就停止跟随，免得马上被拉回底部；消息已不存在就恢复跟随，停在最底部。
    val flash = revealMessage(state, listState, onRevealed = { found -> follow.value = !found }, onRevealDone = onRevealDone)

    when {
        state.messagesLoading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(Modifier.size(24.dp), color = Sm.Muted, strokeWidth = 2.dp)
        }
        state.messagesFailed -> Column(
            Modifier.fillMaxSize().padding(PageGutter),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.messages_load_failed), color = Sm.Muted, fontSize = 15.sp)
            TextButton(onClick = onRetry) { Text(stringResource(R.string.retry), color = Sm.Blue) }
        }
        // 空白首页：网页手机版在顶栏下方放 Chat / Note 切换（左右 24、上距 4），标题在剩下的空间里居中。
        state.messages.isEmpty() -> Column(Modifier.fillMaxSize()) {
            WorkspaceSwitch(Workspace.Chat, onSwitchWorkspace, Modifier.padding(start = PageGutter, end = PageGutter, top = 4.dp))
            Box(Modifier.weight(1f).fillMaxWidth()) {
                // 已保存但还没有消息的聊天显示它自己的标题和图标（网页 EmptyConversation 的 title = activeTitle）。
                EmptyState(state.activeTitle.takeIf { state.activeSessionId != null }, state.activeIcon, onChangeIcon)
            }
        }
        else -> Box(Modifier.fillMaxSize()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                // 左右 24；顶部 4（顶栏下方）；底部 96 = 网页消息列自己的 pb-12（48）+ 输入栏区顶部"滚动到底部"那一行
                // （按钮 40 + 下距 8；手机宽度下按钮隐藏时也只是透明，照样占位）。
                contentPadding = PaddingValues(start = PageGutter, end = PageGutter, top = 4.dp, bottom = ListBottomPadding),
                verticalArrangement = Arrangement.spacedBy(TurnGap),
            ) {
                items(state.messages, key = { it.key }) { message ->
                    val modelLabel = message.modelId?.let { id -> state.models.firstOrNull { it.id == id }?.label }
                    // 图片不是聊天模型画的：图片回答上方不显示模型名（网页 chat-message.tsx 的 isImageAnswer）。
                    val isImageAnswer = message.generatingImage || message.images.isNotEmpty()
                    Box(Modifier.revealFlash(flash?.takeIf { it.messageId == message.id })) {
                        if (message.role == MessageRole.User) UserTurn(message) else AssistantTurn(message, modelLabel.takeIf { !isImageAnswer })
                    }
                }
            }
            ScrollToBottomButton(
                visible = !atBottom,
                modifier = Modifier.align(Alignment.BottomCenter),
                onClick = {
                    follow.value = true
                    scope.launch {
                        // 生成中直接跳到底（动画追不上变长的末尾），否则平滑滚动，和网页 scrollChatToBottom 一样。
                        val index = state.messages.lastIndex.coerceAtLeast(0)
                        val lastVisible = listState.layoutInfo.visibleItemsInfo.any { it.index == index }
                        programmaticScroll.value = true
                        try {
                            if (state.sending || !lastVisible) listState.scrollToItem(index, PIN_TO_END)
                            else listState.animateScrollBy(distanceToBottom(listState).toFloat())
                        } finally {
                            programmaticScroll.value = false
                        }
                    }
                },
            )
        }
    }
}

/** 网页消息列的 pb-12（48）+ 输入栏区顶部"滚动到底部"那一行（40 + 8）。 */
private val ListBottomPadding = 96.dp

/** 足够大的偏移：定位到最后一项后由列表自己收回到"刚好看到末尾"。 */
private const val PIN_TO_END = 1_000_000

/** 列表末尾（含底部内边距）离可视区底边还有多少像素。最后一项不在可视区时返回一个很大的数。 */
private fun distanceToBottom(state: LazyListState): Int {
    val info = state.layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return 0
    if (last.index < info.totalItemsCount - 1) return Int.MAX_VALUE / 2
    return (last.offset + last.size + info.afterContentPadding - info.viewportEndOffset).coerceAtLeast(0)
}

// "滚动到底部"（.notion-scroll-bottom 里的 .notion-icon-button）：40 的白底按钮、圆角 4.8、--notion-shadow
// （0 4 14 .12 + 1px .05 的细环），ArrowDown 20 / 描边 2.1 灰。位于输入栏区顶部、和下面隔 8；离开底部时 150ms 淡入 + 从 .95 放大。
@Composable
private fun ScrollToBottomButton(visible: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val progress by animateFloatAsState(if (visible) 1f else 0f, tween(150, easing = FastOutSlowInEasing), label = "scroll-bottom")
    if (progress == 0f) return
    val label = stringResource(R.string.scroll_to_bottom)
    val shape = RoundedCornerShape(4.8.dp)
    // 网页里按钮在输入栏区的上内边距 12 之下；原生输入栏区上内边距也是 12，按钮放在列表底部再往下 4，下沿离输入栏内容正好 8。
    Box(
        modifier.offset(y = 4.dp).graphicsLayer {
            alpha = progress
            val scale = 0.95f + 0.05f * progress
            scaleX = scale
            scaleY = scale
        }
            .size(40.dp)
            .shadow(6.dp, shape, ambientColor = Color(0x1F0F0F0F), spotColor = Color(0x1F0F0F0F))
            .background(Color.White, shape)
            .border(1.dp, Color(0x0D0F0F0F), shape)
            .clip(shape)
            .clickable(enabled = visible, onClick = onClick)
            .semantics { contentDescription = label; role = Role.Button },
        Alignment.Center,
    ) {
        LucideIcon(Lucide.ArrowDown, 20.dp, Sm.Muted, strokeWidth = 2.1f)
    }
}

// 空白首页：左对齐的"图标 + 32sp 粗体标题"，下面一行 17sp 灰色说明，整体在可用区域里垂直居中。
// 网页的消息列容器自带 48 的底部内边距，居中的是"标题块 + 48"；手机宽度（< 640）下输入栏区顶部那一行"滚动到底部"
// （40 + 8）在空白首页也只是透明、照样占位（只有 ≥ 640 才 display: none）。所以这里底部留 48 + 48，标题的位置才和网页一致。
@Composable
private fun EmptyState(title: String?, icon: String?, onChangeIcon: (String?) -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(start = PageGutter, end = PageGutter, bottom = ListBottomPadding),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 网页 ChatTitleIcon：1.3em（41.6）、圆角 6；表情 0.85em（27.2），没有时 MessageSquareText 0.7em（22.4）描边 1.8。
            ChatIconButton(icon, onChangeIcon, Modifier.size(41.6.dp), RoundedCornerShape(6.dp)) {
                if (icon != null) Text(icon, fontSize = 27.2.sp, lineHeight = 27.2.sp)
                else LucideIcon(Lucide.MessageSquareText, 22.4.dp, Sm.Muted, strokeWidth = 1.8f)
            }
            Spacer(Modifier.width(9.6.dp))
            Text(
                title ?: stringResource(R.string.new_chat),
                color = Sm.Ink,
                fontSize = 32.sp,
                lineHeight = 36.8.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-1.28).sp,
            )
        }
        Text(
            stringResource(R.string.empty_hint),
            modifier = Modifier.padding(top = 8.8.dp),
            color = Sm.Muted,
            fontSize = 17.sp,
            lineHeight = 27.2.sp,
        )
    }
}

// 角色标签：12sp 等宽、大写、字距 .06em、灰色，和下面的内容隔 7.2。
internal val RoleLabelBase = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 12.sp,
    lineHeight = 18.sp,
    fontWeight = FontWeight.Medium,
    letterSpacing = 0.72.sp,
    color = Sm.Muted,
)

// 网页的等宽字体（Geist Mono）没有日文 / 中文字形，这些字回落到普通 UI 字体；原生版的系统等宽字体回落时会出现倾斜字形，
// 所以含中日文的标签直接用默认字体，拉丁字母的标签仍用等宽。
internal fun roleLabelStyle(text: String): TextStyle =
    if (text.any { it.code >= 0x2E80 }) RoleLabelBase.copy(fontFamily = FontFamily.Default) else RoleLabelBase

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UserTurn(message: UiMessage) {
    Column(Modifier.fillMaxWidth()) {
        val you = stringResource(R.string.you).uppercase()
        Text(you, style = roleLabelStyle(you), modifier = Modifier.padding(bottom = 7.2.dp))
        val images = message.attachments.filter { it.dataUrl != null && it.mimeType.startsWith("image/") }
        val files = message.attachments.filterNot { it in images }
        if (images.isNotEmpty() || message.content.isNotEmpty()) {
            // 提问块（.notion-user-block）：圆角 14、内边距 12×16；图片缩略图 128、圆角 4，在文字上方，间距 8，下距 12。
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Sm.UserBubble)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                if (images.isNotEmpty()) {
                    FlowRow(
                        Modifier.padding(bottom = if (message.content.isNotEmpty()) 12.dp else 0.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        images.forEach { image ->
                            AsyncImage(
                                model = image.dataUrl,
                                contentDescription = image.filename,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(128.dp).clip(RoundedCornerShape(4.dp)),
                            )
                        }
                    }
                }
                if (message.content.isNotEmpty()) {
                    // 网页提问文字是 15px / 行高 28（leading-7），不是回答正文的 16。
                    SelectionContainer {
                        Text(message.content, color = Sm.Text, fontSize = 15.sp, lineHeight = 28.sp)
                    }
                }
            }
        }
        if (files.isNotEmpty()) {
            // 非图片附件：块下方 12 处的文件标签（12 灰字、回形针 12、浅底 + 1px 描边、圆角 4、内边距 8×4）。
            FlowRow(
                Modifier.padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                files.forEach { file -> FileChip(file.filename) }
            }
        }
    }
}

@Composable
private fun FileChip(name: String) {
    val shape = RoundedCornerShape(4.dp)
    Row(
        Modifier.clip(shape).background(Sm.Sidebar).border(1.dp, Sm.Border, shape).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        LucideIcon(Lucide.Paperclip, 12.dp, Sm.Muted)
        Text(name, color = Sm.Muted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------------------------------------------------------------------------------------------
// 输入栏（.notion-composer）：外边距 10.4 / 上 12 / 下 16，白底、1px 描边、圆角 16、内边距 10。

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun Composer(
    prompt: (@Composable () -> Unit)?,
    input: String,
    onInputChange: (String) -> Unit,
    sending: Boolean,
    canSend: Boolean,
    modelLabel: String?,
    effortLabel: String?,
    files: List<LocalFile>,
    upload: UploadProgress?,
    imageMode: Boolean,
    error: String?,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onModelClick: () -> Unit,
    onAddClick: () -> Unit,
    onRemoveFile: (String) -> Unit,
    onImageModeOff: () -> Unit,
    onPasteImages: (List<android.net.Uri>, TransferableContent) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    // 输入框用 TextFieldState（粘贴图片要用 contentReceiver，只有这种输入框支持）；草稿仍在 ViewModel 里，两边同步：
    // 打字时把文字交给 ViewModel；ViewModel 自己改了草稿（发出后清空、上限时放回被拒的原文）时再写回输入框。
    val field = rememberTextFieldState(input)
    var pushed by remember { mutableStateOf(input) }
    LaunchedEffect(field) {
        snapshotFlow { field.text.toString() }.collect { text ->
            if (text != pushed) {
                pushed = text
                onInputChange(text)
            }
        }
    }
    LaunchedEffect(input) {
        if (input != pushed) {
            pushed = input
            field.setTextAndPlaceCursorAtEnd(input)
        }
    }
    val context = LocalContext.current
    val shape = RoundedCornerShape(16.dp)
    val insets = WindowInsets.navigationBars.union(WindowInsets.ime)
    // 对应网页的 padding-bottom: max(1rem, safe-area)；键盘弹出时贴着键盘留 16。
    val density = LocalDensity.current
    val navBottom = with(density) { WindowInsets.navigationBars.getBottom(density).toDp() }
    val bottomPad = if (WindowInsets.isImeVisible) 16.dp else (16.dp - navBottom).coerceAtLeast(0.dp)

    Column(
        Modifier.fillMaxWidth().windowInsetsPadding(insets)
            .padding(start = 10.4.dp, end = 10.4.dp, top = 12.dp, bottom = bottomPad),
    ) {
        prompt?.invoke()
        if (error != null) ComposerError(error)
        if (files.isNotEmpty()) PendingFiles(files, enabled = upload == null, onRemove = onRemoveFile)
        Column(
            Modifier.fillMaxWidth()
                .shadow(8.dp, shape, ambientColor = Sm.ComposerShadow, spotColor = Sm.ComposerShadow)
                .background(Color.White, shape)
                .drawBehind {
                    // 聚焦：3px 的浅蓝光圈（--sm-accent-soft）。
                    if (focused) {
                        val ring = 3.dp.toPx()
                        drawRoundRect(
                            color = Sm.AccentSoft,
                            topLeft = Offset(-ring / 2, -ring / 2),
                            size = Size(size.width + ring, size.height + ring),
                            cornerRadius = CornerRadius(16.dp.toPx() + ring / 2),
                            style = Stroke(ring),
                        )
                    }
                }
                .border(1.dp, if (focused) Sm.AccentLine else Sm.BorderStrong, shape)
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (imageMode) ImageModeChip(onImageModeOff)
            BasicTextField(
                state = field,
                // 上传附件期间不能改文字（网页此时输入框是只读的）。
                readOnly = upload != null,
                modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp).onFocusChanged { focused = it.isFocused }
                    // 粘贴图片：只把 PNG / JPEG / WEBP 交给附件流程（网页 onPaste），其它内容照常粘贴成文字。
                    .contentReceiver { content ->
                        if (!content.hasMediaType(MediaType.Image)) return@contentReceiver content
                        val images = mutableListOf<android.net.Uri>()
                        val rest = content.consume { item ->
                            val uri = item.uri
                            val type = uri?.let { runCatching { context.contentResolver.getType(it) }.getOrNull()?.lowercase() }
                            (uri != null && type in PASTE_IMAGE_TYPES).also { if (it) images += uri!! }
                        }
                        if (images.isNotEmpty() && upload == null) onPasteImages(images, content)
                        rest
                    },
                textStyle = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = Sm.Text),
                cursorBrush = SolidColor(Sm.Ink),
                lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = 6),
                decorator = { inner ->
                    Box(Modifier.padding(start = 6.dp, top = 4.dp)) {
                        if (input.isEmpty()) {
                            Text(
                                stringResource(if (imageMode) R.string.image_hint else R.string.message_hint),
                                color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.sp,
                            )
                        }
                        inner()
                    }
                },
            )
            // 左端是「＋」（40 的图标按钮，图标 18、描边 1.8），右边 6 处是模型按钮（按内容宽度，最多到发送键左边 6 处）；发送键固定在右端。
            Box(Modifier.fillMaxWidth()) {
                val addLabel = stringResource(R.string.attach_add)
                Box(
                    Modifier.align(Alignment.CenterStart).size(40.dp).clip(RoundedCornerShape(4.8.dp))
                        .clickable(enabled = upload == null, onClick = onAddClick)
                        .semantics { contentDescription = addLabel; role = Role.Button },
                    Alignment.Center,
                ) {
                    LucideIcon(Lucide.Plus, 18.dp, Sm.Muted, strokeWidth = 1.8f)
                }
                if (modelLabel != null) {
                    ModelPill(modelLabel, effortLabel, onModelClick, Modifier.align(Alignment.CenterStart).padding(start = 46.dp, end = 46.dp))
                }
                SendButton(
                    sending,
                    enabled = sending || (canSend && input.isNotBlank()),
                    onClick = if (sending) onStop else onSend,
                    modifier = Modifier.align(Alignment.CenterEnd),
                )
            }
        }
        ComposerStatus(files, upload)
    }
}

@Composable
private fun ModelPill(label: String, effort: String?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.height(40.dp).clip(CircleShape).background(Sm.ModelPill).clickable(onClick = onClick)
            .padding(horizontal = 13.6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.4.dp),
    ) {
        Text(
            label,
            modifier = Modifier.weight(1f, fill = false),
            color = Sm.Text,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (effort != null) Text(effort, color = Sm.Muted, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        LucideIcon(Lucide.ChevronDown, 16.dp, Sm.Text)
    }
}

// 发送键：40 的圆；可发送时深色底白箭头（箭头 24、描边 2.1），不可发送时 .08 灰底、.36 灰箭头。
// 生成中显示深色底的白色方块（网页没有停止键，这是原生版额外加的，替代发送键）。
@Composable
private fun SendButton(sending: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val label = stringResource(if (sending) R.string.stop else R.string.send)
    Box(
        modifier.size(40.dp).clip(CircleShape).background(if (enabled) Sm.Ink else Sm.Hover)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = label; role = Role.Button },
        Alignment.Center,
    ) {
        if (sending) {
            Box(Modifier.size(14.dp).background(Color.White, RoundedCornerShape(3.dp)))
        } else {
            LucideIcon(Lucide.ArrowUp, 24.dp, if (enabled) Color.White else Sm.Faint, strokeWidth = 2.1f)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 模型与推理强度底部抽屉（.model-sheet）。

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelSheet(
    state: ChatUiState,
    onSelectModel: (String) -> Unit,
    onSelectReasoning: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val selected = state.selectedModel
    val current = state.selectedReasoning

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 17.6.dp, topEnd = 17.6.dp),
        scrimColor = Color(0x590F0F0F),
        tonalElevation = 0.dp,
        dragHandle = {
            Box(Modifier.padding(top = 12.dp, bottom = 8.dp).size(width = 40.dp, height = 4.dp).clip(CircleShape).background(Sm.SheetGrab))
        },
    ) {
        // 内容超过可用高度（横屏、系统字体放大）时可以滚动，和网页的 overflow-y: auto 一致。
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            SheetTitle(stringResource(R.string.model))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                state.models.forEach { model ->
                    val isSelected = model.id == selected?.id
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(10.4.dp))
                            .background(if (isSelected) Sm.Hover else Color.Transparent)
                            .clickable { onSelectModel(model.id) }.padding(horizontal = 13.6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            model.label,
                            modifier = Modifier.weight(1f),
                            color = Sm.Text,
                            fontSize = 17.sp,
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        )
                        if (isSelected) LucideIcon(Lucide.Check, 20.dp, Sm.Text)
                    }
                }
            }

            if (selected != null && selected.reasoningEfforts.size > 1) {
                SheetTitle(stringResource(R.string.reasoning))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    selected.reasoningEfforts.chunked(3).forEach { rowEfforts ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            rowEfforts.forEach { effort ->
                                val isSelected = effort == current
                                Box(
                                    Modifier.weight(1f).heightIn(min = 46.4.dp).clip(RoundedCornerShape(10.4.dp))
                                        .background(if (isSelected) Sm.Blue else Color.Transparent)
                                        .border(1.dp, if (isSelected) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(10.4.dp))
                                        .clickable { onSelectReasoning(effort) },
                                    Alignment.Center,
                                ) {
                                    Text(
                                        reasoningLabel(effort),
                                        color = if (isSelected) Color.White else Sm.Text,
                                        fontSize = 15.sp,
                                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                    )
                                }
                            }
                            // 最后一行不足三个时补空位，保证列宽一致。
                            repeat(3 - rowEfforts.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
                current?.let {
                    Text(
                        reasoningDescription(it),
                        modifier = Modifier.padding(start = 4.dp, top = 10.4.dp),
                        color = Sm.Muted,
                        fontSize = 14.sp,
                    )
                }
            }

            Box(
                Modifier.padding(top = 16.dp).fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                    .background(Sm.Text).clickable {
                        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
                    },
                Alignment.Center,
            ) {
                Text(stringResource(R.string.done), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun SheetTitle(text: String) {
    Text(
        text,
        modifier = Modifier.padding(start = 4.dp, top = 12.dp, bottom = 5.6.dp),
        color = Sm.Muted,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun reasoningLabel(effort: String): String = when (effort) {
    "none" -> stringResource(R.string.reasoning_none)
    "minimal" -> stringResource(R.string.reasoning_minimal)
    "low" -> stringResource(R.string.reasoning_low)
    "medium" -> stringResource(R.string.reasoning_medium)
    "high" -> stringResource(R.string.reasoning_high)
    "xhigh" -> stringResource(R.string.reasoning_xhigh)
    "max" -> stringResource(R.string.reasoning_max)
    else -> effort
}

@Composable
private fun reasoningDescription(effort: String): String = when (effort) {
    "none" -> stringResource(R.string.reasoning_none_desc)
    "minimal" -> stringResource(R.string.reasoning_minimal_desc)
    "low" -> stringResource(R.string.reasoning_low_desc)
    "medium" -> stringResource(R.string.reasoning_medium_desc)
    "high" -> stringResource(R.string.reasoning_high_desc)
    "xhigh" -> stringResource(R.string.reasoning_xhigh_desc)
    "max" -> stringResource(R.string.reasoning_max_desc)
    else -> ""
}
