package com.kakumine.notefable.ui

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.notefable.BuildConfig
import com.kakumine.notefable.R
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.auth.clearGoogleCredentialState
import com.kakumine.notefable.auth.requestGoogleIdToken
import com.kakumine.notefable.data.EmbedMessage
import com.kakumine.notefable.data.NoteGroupSummary
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.TRASH_RETENTION_DAYS
import kotlinx.coroutines.launch

/** 侧栏里打开的笔记对话框（网页 NotesSidebar / NotesHome 里的同名对话框）。 */
private sealed interface NotesDialogState {
    data class Move(val pageId: String) : NotesDialogState
    data object NewGroup : NotesDialogState
    data class RenameGroup(val group: NoteGroupSummary) : NotesDialogState
    data class DeleteGroup(val group: NoteGroupSummary) : NotesDialogState
    data class TrashNote(val page: NotePageSummary) : NotesDialogState
    /** [kind]：幻灯片是公开树的叶子，没有“包含子页面”（网页 note-share-dialog.tsx 的 kind）。 */
    data class Share(val pageId: String, val kind: com.kakumine.notefable.data.PageKind = com.kakumine.notefable.data.PageKind.Note) : NotesDialogState
}

@Composable
fun NoteFableRoot(viewModel: ChatViewModel, accountViewModel: AccountViewModel, notesViewModel: NotesViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val account by accountViewModel.state.collectAsStateWithLifecycle()
    val notes by notesViewModel.state.collectAsStateWithLifecycle()
    val noteReorder = remember(notesViewModel) {
        NoteReorder(notesViewModel::reorder, notesViewModel::dropIntoGroup, notesViewModel::dismissReorderError)
    }
    // 侧栏的置顶、项目、整理（Batch 3）；会话列表本身仍在 ChatViewModel。
    val sidebarViewModel: SidebarViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = SidebarViewModel.factory(viewModel))
    val activity = LocalActivity.current ?: return
    val app = LocalContext.current.applicationContext as NoteFableApp
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    // 幻灯片在放映（编辑页报上来的）：放映中侧栏不跟着滑动打开。
    var slidesPresenting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf<NotesDialogState?>(null) }
    // 笔记编辑器里上传因存储空间不够被拒绝（网页经桥发来的 storageLimit）：编辑器上方显示提示，关掉为止。
    // 记下是哪个编辑器的提示：只在那个编辑器上显示，换笔记、关掉编辑器时清掉（晚到的旧编辑器的消息不收）。
    var noteStorageLimit by remember { mutableStateOf<Pair<String, StorageLimitInfo>?>(null) }
    // 笔记编辑器里 AI 面板或幻灯片生图撞到使用次数上限（网页经桥发来的 usageLimit）：和 storageLimit 共用编辑器上方提示槽，互斥显示。
    var noteUsageLimit by remember { mutableStateOf<Pair<String, UsageLimitInfo>?>(null) }
    // 白板正在用画图工具的编辑器（网页经桥发来的 drawing 为 true）：只在那个编辑器上让开两侧的返回手势。
    // 同样只认打开着的编辑器发来的，换笔记、关掉编辑器时清掉。
    var drawingEditor by remember { mutableStateOf<String?>(null) }
    val openEditor = notes.open?.editor
    LaunchedEffect(openEditor) {
        if (noteStorageLimit?.first != openEditor) noteStorageLimit = null
        if (noteUsageLimit?.first != openEditor) noteUsageLimit = null
        if (drawingEditor != openEditor) drawingEditor = null
    }
    LaunchedEffect(account.user) {
        noteStorageLimit = null
        noteUsageLimit = null
    }
    // 白板开着（类型和编辑页顶栏一样：列表里有这一篇就用列表的，否则用打开时知道的）：横向拖动是在画布上画 / 平移，
    // 不从边上拉出抽屉（菜单按钮照常打开）；抽屉开着时照常能拖回去、点遮罩关上。
    val whiteboardOpen = notes.workspace == Workspace.Notes && notes.open?.let { open ->
        (notes.pages.firstOrNull { it.id == open.id }?.kind ?: open.kind) == PageKind.Whiteboard
    } == true
    // 全屏检索（Batch 4）：抽屉的 Search 行和顶栏的搜索按钮打开。
    var searchOpen by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    // 还没读过笔记列表时（从聊天直接打开检索）顺便读一次：页面类型的表（检索的类型筛选）跟着 GET /api/pages 的 kinds。
    val openSearch = {
        searchOpen = true
        if (!notes.loaded && !notes.loading) notesViewModel.refresh()
    }
    // 整个工作区共用的常驻 /note-embed WebView 宿主：首次打开笔记时创建，切页与短暂返回列表/聊天时保留热缓存，
    // 在换身份、系统内存紧张、退到后台、空闲超过 120 秒或界面销毁时释放。
    val iconStore = appIconStore()
    val noteEmbedHost = remember(app, activity) {
        NoteEmbedHost(cacheDir = activity.cacheDir, hostScope = scope, currentIcon = { iconStore?.icon?.value })
    }
    DisposableEffect(noteEmbedHost) {
        onDispose { noteEmbedHost.destroy() }
    }
    DisposableEffect(notesViewModel, noteEmbedHost) {
        noteEmbedHost.onPagesChanged = notesViewModel::refresh
        notesViewModel.notifyPagesTrashed = noteEmbedHost::pageTrashed
        notesViewModel.notifyPageUpdated = { pageId, pageJson -> noteEmbedHost.pageUpdated(pageJson, pageId) }
        notesViewModel.notifyPageSettings = { page ->
            noteEmbedHost.pageSettings(com.kakumine.notefable.data.NoteFableJson.encodeToString(com.kakumine.notefable.data.NotePageSummary.serializer(), page))
        }
        onDispose {
            noteEmbedHost.onPagesChanged = {}
            notesViewModel.notifyPagesTrashed = null
            notesViewModel.notifyPageUpdated = null
            notesViewModel.notifyPageSettings = null
        }
    }
    DisposableEffect(app, activity, noteEmbedHost) {
        val callbacks = object : ComponentCallbacks2 {
            @Suppress("DEPRECATION")
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
                    activity.runOnUiThread { if (noteEmbedHost.isParked) noteEmbedHost.destroy() }
                }
            }
            override fun onConfigurationChanged(newConfig: Configuration) = Unit
            @Deprecated("Deprecated in Java")
            override fun onLowMemory() {
                activity.runOnUiThread { if (noteEmbedHost.isParked) noteEmbedHost.destroy() }
            }
        }
        app.registerComponentCallbacks(callbacks)
        onDispose { app.unregisterComponentCallbacks(callbacks) }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, noteEmbedHost) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && noteEmbedHost.isParked) noteEmbedHost.destroy()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val downloadNoteFile = rememberNoteFileDownloader(app.api)
    // 回答"…"的"下载对话"的保存位置选择器：在根上注册，选择器开着时进程被杀后结果也有人接。
    val conversationDownloader = rememberConversationDownloader()
    // 笔记的 Markdown 导出（页面菜单）和导入（侧栏、笔记首页）用的系统文件选择器，同样注册在根上。
    val exportNote = rememberNoteExporter(notesViewModel)
    // 编辑器里导出的文件（白板的 PNG / SVG / PDF 等）的保存位置选择器，同样注册在根上。
    val saveExportFile = rememberExportFileSaver()
    val pickMarkdownImport = rememberMarkdownImportPicker({ notesViewModel.identityGeneration }) { files ->
        // 网页 importMarkdownFiles：先关侧栏；有项目时先问导入到哪里（下面的 ImportTargetDialog），导入后打开第一篇。
        scope.launch { drawerState.close() }
        notesViewModel.pickedForImport(files)
    }
    val closeDrawer: () -> Unit = { scope.launch { drawerState.close() } }
    // 「整理成笔记」窗口开着的聊天（网页 createPageSessionId）。
    var createPageSessionId by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
    // 「画成图」窗口开着的任务（DiagramSource.key）。任务本身在 App 级的 DiagramStore 里，进程重建后没了，窗口随之关掉。
    var diagramKey by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
    val diagrams = remember(app) { app.diagrams() }
    // 笔记"…"的「画成图」项在画的期间显示转圈（网页同）。
    val diagramJobs by diagrams.jobs.collectAsStateWithLifecycle()
    // 菜单选「画成图」时用当时选着的模型（和「整理成笔记」一样）。
    val currentModel by rememberUpdatedState(state.selectedModel?.id)
    val drawAnswerDiagram = remember(diagrams) {
        object : AnswerDiagramLauncher {
            override val jobs = diagrams.jobs
            override fun draw(sessionId: String, messageId: String) {
                diagramKey = diagrams.start(com.kakumine.notefable.data.DiagramSource.Answer(sessionId, messageId), currentModel)
            }
        }
    }
    val onIdentityChanged = {
        noteEmbedHost.destroy()
        viewModel.onIdentityChanged()
        notesViewModel.onIdentityChanged()
        sidebarViewModel.onIdentityChanged()
        // 旧身份整理好的笔记、画好的白板打不开了（网页登录 / 退出会重新加载页面）。
        createPageSessionId = null
        app.answerExports().clearPageJobs()
        diagramKey = null
        diagrams.clear()
    }

    // 返回键：先关抽屉；笔记编辑页自己处理（先交给网页关面板，再保存后回列表）；笔记列表回到聊天；最后退出 App。
    BackHandler(enabled = drawerState.isOpen) { closeDrawer() }
    BackHandler(enabled = !drawerState.isOpen && notes.workspace == Workspace.Notes && notes.open == null) {
        notesViewModel.setWorkspace(Workspace.Chat)
    }
    // 从笔记切回聊天：当前会话可能刚在笔记的 AI 面板里聊过，重读一次。
    var lastWorkspace by remember { mutableStateOf(notes.workspace) }
    LaunchedEffect(notes.workspace) {
        if (notes.workspace == Workspace.Chat && lastWorkspace != Workspace.Chat) viewModel.refreshActiveQuietly()
        lastWorkspace = notes.workspace
    }
    // 每次打开抽屉都刷新列表，拿到其它设备或网页上的新内容。
    LaunchedEffect(drawerState.currentValue) {
        if (drawerState.currentValue == DrawerValue.Open) {
            if (notes.workspace == Workspace.Notes) {
                notesViewModel.refresh()
                // 网页的 iconError 是侧栏组件自己的状态，抽屉关掉就没了：重新打开时不再显示上次的失败。
                notesViewModel.dismissIconError()
            } else {
                viewModel.refreshSessions()
                sidebarViewModel.refreshProjects()
                // 上次"在项目里新建聊天"的失败原因只在当时那次打开里显示（网页的 sendError 下一次操作就清掉）。
                sidebarViewModel.dismissCreateError()
            }
        }
    }

    // 外部链接（MainActivity 的 VIEW intent）：和网页打开新页面一样，先关掉检索面板和抽屉，再切到那段聊天。
    LaunchedEffect(viewModel) {
        viewModel.linkRequests.collect { link ->
            searchOpen = false
            closeDrawer()
            openChatLink(link, viewModel, notesViewModel)
        }
    }

    // 系统分享（MainActivity 的 SEND intent）：先关掉检索面板和抽屉再切到聊天。
    // 如果笔记保存失败暂时留在笔记里，把分享暂存下来，等真正回到聊天工作区时再放进输入栏，不丢用户的分享。
    var deferredShares by remember { mutableStateOf<List<com.kakumine.notefable.data.IncomingShareRequest>>(emptyList()) }
    LaunchedEffect(viewModel) {
        viewModel.shareRequests.collect { share ->
            searchOpen = false
            closeDrawer()
            deferredShares = deferredShares + share
            if (notesViewModel.state.value.workspace != Workspace.Chat) {
                notesViewModel.setWorkspace(Workspace.Chat)
            }
        }
    }
    LaunchedEffect(notes.workspace, deferredShares) {
        if (notes.workspace == Workspace.Chat && deferredShares.isNotEmpty()) {
            val pending = deferredShares
            deferredShares = emptyList()
            pending.forEach(viewModel::applyIncomingShare)
        }
    }

    // 界面语言跟着账号上的语言走（网页 /app 里唯一的 AccountLocaleSync）。
    AccountLocaleSync(account)
    // 设置里的"图标"跟着账号走（网页 AccountAppIconSync，只在登录时）。
    AccountAppIconSync(account)

    // 侧栏底部和上限登录提示（GuestLimitPrompt）的"登录"都只打开登录窗口（网页 SignInButton → SignInDialog）。
    var signInOpen by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    val openSignIn: () -> Unit = { signInOpen = true }
    // 登录成功（账号里有了用户）就关掉窗口。
    LaunchedEffect(account.user != null) { if (account.user != null) signInOpen = false }

    // 窗口里"使用 Google 继续"发起的登录。草稿在 ChatViewModel 里，换身份后仍在。
    val signIn: () -> Unit = {
        scope.launch {
            notesViewModel.flushBeforeIdentityChange()
            accountViewModel.signIn(
                fetchIdToken = { clientId, nonce -> requestGoogleIdToken(activity, clientId, nonce) },
                onSignedIn = onIdentityChanged,
            )
        }
    }

    if (signInOpen && account.configured && account.user == null) {
        SignInDialog(
            account = account,
            profile = accountViewModel,
            onGoogle = signIn,
            // 换身份前先把打开的笔记存掉（和 Google 登录、退出时一样）。
            beforeIdentityChange = { notesViewModel.flushBeforeIdentityChange() },
            onSignedIn = onIdentityChanged,
            onClose = { signInOpen = false },
        )
    }

    val switchWorkspace: (Workspace) -> Unit = { target ->
        // 网页从抽屉里切换时先关抽屉。
        closeDrawer()
        notesViewModel.setWorkspace(target)
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        // 白板开着时横向拖动留给画布，幻灯片放映中和翻页、呼出系统栏的手势冲突：这两种时候不让侧栏跟着边缘滑动打开（开着时照常能拖回）。
        gesturesEnabled = drawerState.isOpen || (!whiteboardOpen && !slidesPresenting),
        drawerContent = {
            AppDrawer(
                workspace = notes.workspace,
                onSwitch = switchWorkspace,
                onClose = closeDrawer,
                footer = {
                    SidebarFooter(
                        account = account,
                        // 换身份前先把打开的笔记存掉（WebView 还带着旧身份的 Cookie），身份换了编辑器会被关掉。
                        onSignIn = openSignIn,
                        onSignOut = {
                            scope.launch {
                                notesViewModel.flushBeforeIdentityChange()
                                accountViewModel.signOut(
                                    clearDeviceChoice = { clearGoogleCredentialState(activity) },
                                    // 退出后按系统语言显示（网页 forgetLocaleChoice）。未登录时语言同步不再清本机的选择，所以在这里清。
                                    // 账号的图标也不留给下一个用这台设备的人（恢复成默认）。
                                    onSignedOut = { forgetLanguageChoice(); app.appIconSync.forgetAccount(); onIdentityChanged() },
                                )
                            }
                        },
                        profile = accountViewModel,
                        // 设置里的"删除账号"：成功后和退出一样换成新的匿名身份（打开的笔记属于被删的账号，不再保存）。
                        deleteAccount = {
                            accountViewModel.deleteAccount(clearDeviceChoice = { clearGoogleCredentialState(activity) })
                                .also { if (it == null) { forgetLanguageChoice(); app.appIconSync.forgetAccount(); onIdentityChanged() } }
                        },
                    )
                },
            ) {
                if (notes.workspace == Workspace.Notes) {
                    NotesDrawerBody(
                        state = notes,
                        onCreate = { kind, groupId -> closeDrawer(); notesViewModel.createNote(kind = kind, groupId = groupId) },
                        onOpen = { id -> closeDrawer(); notesViewModel.openNote(id) },
                        onToggleGroup = notesViewModel::toggleGroup,
                        onMove = { dialog = NotesDialogState.Move(it.id) },
                        onTrash = { dialog = NotesDialogState.TrashNote(it) },
                        onNewGroup = { dialog = NotesDialogState.NewGroup },
                        onRenameGroup = { dialog = NotesDialogState.RenameGroup(it) },
                        onDeleteGroup = { dialog = NotesDialogState.DeleteGroup(it) },
                        onOpenTrash = notesViewModel::openTrash,
                        onChangeIcon = { page, icon -> scope.launch { notesViewModel.changeIcon(page.id, icon) } },
                        modifier = Modifier.weight(1f),
                        onSearch = openSearch,
                        reorder = noteReorder,
                        onToggleExpanded = notesViewModel::toggleExpanded,
                        onCreateInside = { page, kind -> closeDrawer(); notesViewModel.createNote(page.id, kind) },
                        onToggleSection = notesViewModel::toggleSection,
                        onUnfavorite = { page -> scope.launch { notesViewModel.setFavorite(page.id, false) } },
                        onImport = pickMarkdownImport,
                    )
                } else {
                    ChatDrawerBody(
                        state = state,
                        sidebar = sidebarViewModel,
                        onNewChat = { viewModel.newChat(); closeDrawer() },
                        onOpen = { id -> viewModel.openSession(id); closeDrawer() },
                        onRetry = viewModel::refreshSessions,
                        closeDrawer = closeDrawer,
                        onChangeIcon = viewModel::changeSessionIcon,
                        modifier = Modifier.weight(1f),
                        onSearch = openSearch,
                    )
                }
            }
        },
    ) {
        val open = notes.open
        // 回答里的"打开笔记"（项目参考笔记、提案卡片）去笔记页；应用、撤销了提案后刷新笔记列表（网页 notefable:page-updated / page-created），
        // 改动的笔记正开在编辑器里时把新版本交给网页编辑器（不然它还拿着旧版本，下次保存会 409）。
        // 撤销了新建的页面：移进回收站的页面先从列表里去掉，开着的关掉（网页 notefable:pages-trashed）。
        // 回答"存到笔记"建好了笔记（可能已离开那段对话）：同样刷新笔记列表（网页 notefable:page-created）。
        LaunchedEffect(app) {
            app.answerExports().created.collect { notesViewModel.refresh() }
        }
        // 「画成图」画好了白板（窗口关着、在后台画完也一样）：同样刷新笔记列表。
        LaunchedEffect(diagrams) {
            diagrams.created.collect { notesViewModel.refresh() }
        }
        LaunchedEffect(app, noteEmbedHost) {
            app.proposals.changes.collect { change ->
                notesViewModel.onPagesTrashed(change.trashed)
                notesViewModel.refresh()
                val page = change.page
                if (!change.created && page != null) {
                    noteEmbedHost.pageUpdated(page)
                }
            }
        }
        // 消息上的编辑、重新生成、版本切换、分支。分支出的新聊天叫「分支 · 原标题」（网页 branchChat）。
        val branchTitle = stringResource(R.string.branch_title, state.activeTitle ?: stringResource(R.string.new_chat))
        val turnBusy = state.sending || state.upload != null || state.messagesLoading
        val turnActions = remember(viewModel, turnBusy, branchTitle) {
            TurnActions(
                regenerate = viewModel::regenerate,
                edit = viewModel::editMessage,
                showVersion = viewModel::showVersion,
                branch = { id -> viewModel.branch(id, branchTitle) },
                dismissEditDraft = viewModel::dismissRejectedEdit,
                busy = turnBusy,
            )
        }
        val showRecentNotes = notes.workspace == Workspace.Chat && state.messages.isEmpty() &&
            !state.messagesLoading && !state.messagesFailed && !state.sessionsLoading
        val recentNotes = if (showRecentNotes) key(account.user?.email) {
            // An export or applied proposal refreshes notes.pages, including while chat stays open.
            val recent by produceState<List<NotePageSummary>>(emptyList(), notes.pages) {
                try {
                    value = app.api.recentNotes()
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    value = emptyList()
                }
            }
            recent
        } else emptyList()
        when {
            notes.workspace == Workspace.Chat -> androidx.compose.runtime.CompositionLocalProvider(
                LocalOpenNote provides notesViewModel::openNoteFromLink,
                LocalAnswerSessionId provides state.activeSessionId,
                LocalConversationDownloader provides conversationDownloader,
                LocalAnswerDiagram provides drawAnswerDiagram,
            ) { ChatScreen(
                state = state,
                // 草稿在 ViewModel 里：切到笔记时 ChatScreen 离开组合，回来时文字还在。
                input = viewModel.draft,
                onInputChange = viewModel::updateDraft,
                onMenu = { scope.launch { drawerState.open() } },
                onNewChat = viewModel::newChat,
                onSend = viewModel::send,
                onStop = viewModel::stop,
                onSelectModel = viewModel::selectModel,
                onSelectReasoning = viewModel::selectReasoning,
                onRetryMessages = viewModel::reloadActive,
                onImportFiles = viewModel::importFiles,
                onRemoveFile = viewModel::removeFile,
                onImageMode = viewModel::setImageMode,
                onSwitchWorkspace = notesViewModel::setWorkspace,
                onChangeIcon = viewModel::changeIcon,
                onSearch = openSearch,
                onRevealDone = viewModel::consumeReveal,
                account = account,
                onSignIn = openSignIn,
                onDismissGuestLimit = viewModel::dismissGuestLimit,
                onDismissUpgradeLimit = viewModel::dismissUpgradeLimit,
                onDismissStorageLimit = viewModel::dismissStorageLimit,
                loadNotes = { app.api.notes().pages.map { com.kakumine.notefable.data.ChatProjectNote(it.id, it.title, it.icon, it.kind) } },
                recentNotes = recentNotes,
                onToggleRecentNote = viewModel::toggleRecentNote,
                onAttachPages = viewModel::setAttachedPages,
                onRemovePage = viewModel::removeAttachedPage,
                onQuote = viewModel::setQuote,
                onRemoveQuote = viewModel::clearQuote,
                onCreatePage = { id -> createPageSessionId = id },
                turnActions = turnActions,
            ) }
            // 复用同一个 NoteEditorScreen 和常驻 WebView：切页走 window.notefableEmbed.openPage，不再整页重建；
            // 冲突后"另存为新笔记"只改 open.id 不改 open.editor，也不会触发重新切页。
            open != null -> NoteEditorScreen(
                    host = noteEmbedHost,
                    open = open,
                    saveState = notes.saveState,
                    notice = (notes.notice ?: notes.error)?.let { notesErrorText(it) },
                    // 编辑器里的 AI 助手用 App 里选的模型和推理强度（网页按服务端的模型列表核对）。
                    embedUrl = { lang, theme, reveal ->
                        app.api.noteEmbedUrl(open.id, lang, state.selectedModel?.id, state.selectedReasoning, theme, reveal)
                    },
                    model = state.selectedModel?.id,
                    reasoning = state.selectedReasoning,
                    onDownload = downloadNoteFile,
                    baseUrl = BuildConfig.BASE_URL,
                    cookieJar = app.cookieJar,
                    drawerOpen = drawerState.isOpen,
                    onMenu = { scope.launch { drawerState.open() } },
                    onBack = notesViewModel::closeNote,
                    onDismissNotice = notesViewModel::dismissNotice,
                    onPresentingChange = { slidesPresenting = it },
                    onMessage = { editor, message ->
                        when (message) {
                            is EmbedMessage.Ready -> notesViewModel.onEditorReady(editor, message.id, message.title, message.icon, message.kind)
                            is EmbedMessage.Meta -> notesViewModel.onEditorMeta(editor, message.title, message.icon)
                            is EmbedMessage.SaveState -> notesViewModel.onEditorSaveState(editor, message.state)
                            is EmbedMessage.Missing -> notesViewModel.onEditorMissing(editor)
                            EmbedMessage.Trashed -> notesViewModel.onEditorTrashed(editor)
                            is EmbedMessage.OpenPage -> notesViewModel.openNoteFromLink(message.id)
                            EmbedMessage.PagesChanged -> Unit // 由 NoteEmbedHost.onPagesChanged 处理（停靠或切页中也不丢）
                            is EmbedMessage.StorageLimit -> if (notesViewModel.state.value.open?.editor == editor) {
                                noteUsageLimit = null
                                noteStorageLimit = editor to StorageLimitInfo(message.tier, message.used, message.limit)
                            }
                            is EmbedMessage.UsageLimit -> {
                                val current = notesViewModel.state.value.open
                                if (current?.editor == editor && (message.pageId == null || message.pageId == current.id)) {
                                    noteStorageLimit = null
                                    noteUsageLimit = editor to UsageLimitInfo(message.tier, message.kind)
                                }
                            }
                            is EmbedMessage.Drawing -> if (notesViewModel.state.value.open?.editor == editor) {
                                drawingEditor = editor.takeIf { message.active }
                            }
                            // 桥自己处理：flushed 交给等着的 flush；导出文件的块在 JS 线程上拼好，经 onExportFile 交出来；
                            // 放映（横屏、全屏、常亮）由编辑页自己处理（NoteEditorScreen）。
                            is EmbedMessage.Flushed, is EmbedMessage.Presentation, is EmbedMessage.FileStart, is EmbedMessage.FileChunk,
                            is EmbedMessage.FileEnd, is EmbedMessage.FileAbort -> Unit
                        }
                    },
                    registerFlush = { bridge ->
                        notesViewModel.flushEditor = bridge?.let { b -> { b.flush() } }
                        notesViewModel.pushPageSettings = bridge?.let { b ->
                            { page -> b.pageSettings(com.kakumine.notefable.data.NoteFableJson.encodeToString(com.kakumine.notefable.data.NotePageSummary.serializer(), page)) }
                        }
                        notesViewModel.revealInEditor = bridge?.let { b -> { target -> b.reveal(target) } }
                    },
                    onExportFile = saveExportFile,
                    // 抽屉或检索盖在白板上时不在画图，两侧照常能返回（关掉它们）。
                    drawing = drawingEditor == open.editor && !drawerState.isOpen && !searchOpen,
                    onSearch = openSearch,
                    onChatLink = { link -> openChatLink(link, viewModel, notesViewModel) },
                    page = notes.pages.firstOrNull { it.id == open.id },
                    menu = NotePageMenuActions(
                        error = notes.groupError,
                        busy = notes.busy,
                        onSettings = { settings -> scope.launch { notesViewModel.updateSettings(open.id, settings) } },
                        onFavorite = { favorite -> scope.launch { notesViewModel.setFavorite(open.id, favorite) } },
                        onDuplicate = { notesViewModel.duplicate(open.id) },
                        onAddInside = { notesViewModel.createNote(open.id) },
                        onMove = { dialog = NotesDialogState.Move(open.id) },
                        onExport = { exportNote(open.id) },
                        onTrash = { notes.pages.firstOrNull { it.id == open.id }?.let { dialog = NotesDialogState.TrashNote(it) } },
                        // 画成图：先让编辑器存上（服务端读已保存的内容），存不上就提示、不开始；存上了开始（或重开同一篇的任务）并打开窗口。
                        onDrawDiagram = {
                            val pageId = open.id
                            val diagramGeneration = diagrams.currentGeneration
                            val notesGeneration = notesViewModel.identityGeneration
                            scope.launch {
                                if (notesViewModel.identityGeneration != notesGeneration) return@launch
                                diagrams.startWhenReady(
                                    com.kakumine.notefable.data.DiagramSource.Note(pageId),
                                    currentModel,
                                    expectedGeneration = diagramGeneration,
                                ) {
                                    notesViewModel.saveBeforeDiagram(pageId)
                                }?.let { diagramKey = it }
                            }
                        },
                        drawingDiagram = diagramJobs[com.kakumine.notefable.data.DiagramSource.Note(open.id).key] is com.kakumine.notefable.data.DiagramJob.Working,
                    ),
                    onShare = { dialog = NotesDialogState.Share(open.id, notes.pages.firstOrNull { it.id == open.id }?.kind ?: open.kind) },
                    prompt = noteStorageLimit?.takeIf { it.first == open.editor }?.let<Pair<String, StorageLimitInfo>, @Composable () -> Unit> { (_, limit) ->
                        {
                            // 登录成功后编辑器会关掉（身份变了），提示随之消失；取消登录时提示留着。
                            StorageLimitPrompt(
                                limit = limit, account = account, attachmentsLost = false,
                                onSignIn = openSignIn, onClose = { noteStorageLimit = null },
                            )
                        }
                    } ?: noteUsageLimit?.takeIf { it.first == open.editor }?.let { (_, usage) ->
                        when {
                            usage.tier == "guest" && account.configured && account.user == null -> {
                                {
                                    GuestLimitPrompt(
                                        kind = usage.kind,
                                        attachmentsLost = false,
                                        onSignIn = openSignIn,
                                        onClose = { noteUsageLimit = null },
                                    )
                                }
                            }
                            usage.tier == "member" && account.user != null -> {
                                {
                                    UpgradeLimitPrompt(
                                        kind = usage.kind,
                                        onClose = { noteUsageLimit = null },
                                    )
                                }
                            }
                            else -> null
                        }
                    },
                )
            else -> Column(Modifier.fillMaxSize().background(Sm.Background)) {
                // 笔记列表的顶栏：网页手机版是左边菜单、右边搜索。
                Row(Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 10.4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TopIconButton(Lucide.Menu, stringResource(R.string.open_menu), { scope.launch { drawerState.open() } })
                    Spacer(Modifier.weight(1f))
                    TopIconButton(Lucide.Search, stringResource(R.string.search_chats_and_notes), openSearch)
                }
                NotesHome(
                    state = notes,
                    onSwitch = notesViewModel::setWorkspace,
                    onOpen = notesViewModel::openNote,
                    onCreate = { kind -> notesViewModel.createNote(kind = kind) },
                    onMove = { dialog = NotesDialogState.Move(it.id) },
                    onNewGroup = { dialog = NotesDialogState.NewGroup },
                    onRetry = notesViewModel::refresh,
                    reorder = noteReorder,
                    onToggleExpanded = notesViewModel::toggleExpanded,
                    onImport = pickMarkdownImport,
                )
            }
        }
    }

    NotesDialogs(dialog, notes, notesViewModel) { dialog = null }
    if (notes.importTarget) ImportTargetDialog(notes.groups, notesViewModel::chooseImportTarget, notesViewModel::cancelImportTarget)

    createPageSessionId?.let { sessionId ->
        androidx.compose.runtime.key(sessionId) {
            CreatePageDialog(
                sessionId = sessionId,
                model = state.selectedModel?.id,
                busy = sessionId == state.activeSessionId && (state.sending || state.upload != null),
                store = app.answerExports(),
                onOpenPage = { id, title -> notesViewModel.openNote(id, title) },
                onClose = { createPageSessionId = null },
            )
        }
    }

    diagramKey?.let { key ->
        androidx.compose.runtime.key(key) {
            DrawDiagramDialog(
                jobKey = key,
                model = state.selectedModel?.id,
                store = diagrams,
                account = account,
                onSignIn = openSignIn,
                onOpenPage = notesViewModel::openCreatedPage,
                onClose = { diagramKey = null },
            )
        }
    }

    if (searchOpen) {
        val side by sidebarViewModel.state.collectAsStateWithLifecycle()
        val searchBackend = remember { com.kakumine.notefable.data.SearchApi(app.api.http) }
        SearchScreen(
            backend = searchBackend,
            projects = side.projects,
            currentProjectId = state.sessions.firstOrNull { it.id == state.activeSessionId }?.projectId,
            chatFirst = notes.workspace == Workspace.Chat,
            onClose = { searchOpen = false },
            onOpenChat = { id, messageId ->
                closeDrawer()
                openChatLink(com.kakumine.notefable.data.ChatLink.Open(id, messageId), viewModel, notesViewModel)
            },
            onOpenNote = { id, title, icon, kind, reveal ->
                closeDrawer()
                notesViewModel.openNote(id, title, icon, kind, reveal)
            },
        )
    }

    notes.trash?.let { trash ->
        TrashSheet(
            trash = trash,
            onClose = notesViewModel::closeTrash,
            onRetry = notesViewModel::loadTrash,
            onConfirmAll = notesViewModel::confirmEmptyTrash,
            onEmpty = notesViewModel::emptyTrash,
            onRestore = notesViewModel::restore,
            onConfirmOne = notesViewModel::confirmDeleteForever,
            onDeleteForever = notesViewModel::deleteForever,
        )
    }
}

@Composable
private fun NotesDialogs(dialog: NotesDialogState?, notes: NotesUiState, vm: NotesViewModel, onClose: () -> Unit) {
    val close = {
        vm.clearGroupError()
        onClose()
    }
    when (dialog) {
        null -> Unit
        is NotesDialogState.Move -> {
            val page = notes.pages.firstOrNull { it.id == dialog.pageId }
            if (page == null) close() else MoveNoteDialog(page, notes.groups, notes.groupError, vm::moveNote, vm::createGroup, close, notes, vm::moveToPage)
        }
        NotesDialogState.NewGroup -> GroupNameDialog(
            stringResource(R.string.new_project), "", stringResource(R.string.create), notes.groupError,
            onSubmit = { name -> vm.createGroup(name) != null }, onClose = close,
        )
        is NotesDialogState.RenameGroup -> GroupNameDialog(
            stringResource(R.string.rename_project), dialog.group.name, stringResource(R.string.save), notes.groupError,
            onSubmit = { name -> vm.renameGroup(dialog.group.id, name) }, onClose = close,
        )
        is NotesDialogState.DeleteGroup -> ConfirmDialog(
            stringResource(R.string.delete_project_title),
            stringResource(R.string.delete_project_body, dialog.group.name),
            stringResource(R.string.delete_project),
            notes.groupError,
            onConfirm = { vm.deleteGroup(dialog.group.id) },
            onClose = close,
        )
        is NotesDialogState.TrashNote -> ConfirmDialog(
            stringResource(R.string.trash_note_title),
            stringResource(R.string.trash_note_body, dialog.page.title, TRASH_RETENTION_DAYS) +
                (if (notes.children(dialog.page.id).isNotEmpty()) " " + stringResource(R.string.pg_subpages_to_trash) else ""),
            stringResource(R.string.move_to_trash),
            notes.error,
            onConfirm = { vm.trashNote(dialog.page.id) },
            onClose = close,
        )
        is NotesDialogState.Share -> NoteShareDialog(dialog.pageId, vm, close, kind = dialog.kind)
    }
}

// 侧边栏（网页 .notion-sidebar，手机抽屉）：宽 280（最多 85% 屏宽）、底色 #F5F6F8 / 深色 #111215；头部高 48（品牌）；
// 下面是 Chat / Workspace 切换（左右 10、上距 4），再下面是当前模式的内容，最底部是账号区。
@Composable
private fun AppDrawer(
    workspace: Workspace,
    onSwitch: (Workspace) -> Unit,
    onClose: () -> Unit,
    footer: @Composable () -> Unit,
    body: @Composable ColumnScope.() -> Unit,
) {
    ModalDrawerSheet(
        modifier = Modifier.width(280.dp),
        drawerShape = RectangleShape,
        drawerContainerColor = Sm.Sidebar,
        drawerTonalElevation = 0.dp,
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                // 网页 NoteFableLogo：设置里换过图标就画那个表情 / 图片。
                AppIcon(20.dp, Sm.Ink)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.app_title), color = Sm.Ink, fontSize = 15.sp, fontWeight = FontWeight(680))
                Spacer(Modifier.weight(1f))
                // 头部右侧的"关闭侧栏"（.notion-icon-button 40，PanelLeftClose 17 灰）；聊天和笔记两边的网页侧栏都有。
                TopIconButton(Lucide.PanelLeftClose, stringResource(R.string.sb_close_sidebar), onClose, iconSize = 17.dp)
            }
            WorkspaceSwitch(workspace, onSwitch, Modifier.padding(start = 10.dp, end = 10.dp, top = 4.dp), inDrawer = true)
            body()
            footer()
        }
    }
}
