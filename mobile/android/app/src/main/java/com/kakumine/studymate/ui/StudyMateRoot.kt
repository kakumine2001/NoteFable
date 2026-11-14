package com.kakumine.studymate.ui

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.studymate.BuildConfig
import com.kakumine.studymate.R
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.auth.clearGoogleCredentialState
import com.kakumine.studymate.auth.requestGoogleIdToken
import com.kakumine.studymate.data.EmbedMessage
import com.kakumine.studymate.data.NoteGroupSummary
import com.kakumine.studymate.data.NotePageSummary
import com.kakumine.studymate.data.TRASH_RETENTION_DAYS
import kotlinx.coroutines.launch

/** 侧栏里打开的笔记对话框（网页 NotesSidebar / NotesHome 里的同名对话框）。 */
private sealed interface NotesDialogState {
    data class Move(val pageId: String) : NotesDialogState
    data object NewGroup : NotesDialogState
    data class RenameGroup(val group: NoteGroupSummary) : NotesDialogState
    data class DeleteGroup(val group: NoteGroupSummary) : NotesDialogState
    data class TrashNote(val page: NotePageSummary) : NotesDialogState
}

@Composable
fun StudyMateRoot(viewModel: ChatViewModel, accountViewModel: AccountViewModel, notesViewModel: NotesViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val account by accountViewModel.state.collectAsStateWithLifecycle()
    val notes by notesViewModel.state.collectAsStateWithLifecycle()
    // 侧栏的置顶、项目、整理（Batch 3）；会话列表本身仍在 ChatViewModel。
    val sidebarViewModel: SidebarViewModel = androidx.lifecycle.viewmodel.compose.viewModel(factory = SidebarViewModel.factory(viewModel))
    val activity = LocalActivity.current ?: return
    val app = LocalContext.current.applicationContext as StudyMateApp
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf<NotesDialogState?>(null) }
    // 当前打开着的网页编辑器的 JS 桥（没有打开笔记时为 null）。
    var editorBridge by remember { mutableStateOf<NoteEmbedBridge?>(null) }
    val downloadNoteFile = rememberNoteFileDownloader(app.api)
    val closeDrawer: () -> Unit = { scope.launch { drawerState.close() } }
    val onIdentityChanged = {
        viewModel.onIdentityChanged()
        notesViewModel.onIdentityChanged()
        sidebarViewModel.onIdentityChanged()
    }

    // 返回键：先关抽屉；笔记编辑页自己处理（先交给网页关面板，再保存后回列表）；笔记列表回到聊天；最后退出 App。
    BackHandler(enabled = drawerState.isOpen) { closeDrawer() }
    BackHandler(enabled = !drawerState.isOpen && notes.workspace == Workspace.Notes && notes.open == null) {
        notesViewModel.setWorkspace(Workspace.Chat)
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

    // 侧栏底部和上限登录提示（GuestLimitPrompt）共用的登录。草稿在 ChatViewModel 里，换身份后仍在。
    val signIn: () -> Unit = {
        scope.launch {
            notesViewModel.flushBeforeIdentityChange()
            accountViewModel.signIn(
                fetchIdToken = { clientId, nonce -> requestGoogleIdToken(activity, clientId, nonce) },
                onSignedIn = onIdentityChanged,
            )
        }
    }

    val switchWorkspace: (Workspace) -> Unit = { target ->
        // 网页从抽屉里切换时先关抽屉。
        closeDrawer()
        notesViewModel.setWorkspace(target)
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            AppDrawer(
                workspace = notes.workspace,
                onSwitch = switchWorkspace,
                onClose = closeDrawer,
                footer = {
                    SidebarFooter(
                        account = account,
                        // 换身份前先把打开的笔记存掉（WebView 还带着旧身份的 Cookie），身份换了编辑器会被关掉。
                        onSignIn = signIn,
                        onSignOut = {
                            scope.launch {
                                notesViewModel.flushBeforeIdentityChange()
                                accountViewModel.signOut(
                                    clearDeviceChoice = { clearGoogleCredentialState(activity) },
                                    onSignedOut = onIdentityChanged,
                                )
                            }
                        },
                        onSaveName = accountViewModel::saveName,
                        onResetToGoogle = accountViewModel::resetToGoogle,
                    )
                },
            ) {
                if (notes.workspace == Workspace.Notes) {
                    NotesDrawerBody(
                        state = notes,
                        onCreate = { closeDrawer(); notesViewModel.createNote() },
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
                    )
                }
            }
        },
    ) {
        val open = notes.open
        // 回答里的"打开笔记"（项目参考笔记、提案卡片）去笔记页；应用了提案后刷新笔记列表（网页 studymate:page-updated / page-created），
        // 改动的笔记正开在编辑器里时把新版本交给网页编辑器（不然它还拿着旧版本，下次保存会 409）。
        LaunchedEffect(app) {
            app.proposals.changes.collect { change ->
                notesViewModel.refresh()
                val page = change.page
                if (!change.created && page != null && change.pageId != null && notesViewModel.state.value.open?.id == change.pageId) {
                    editorBridge?.pageUpdated(page)
                }
            }
        }
        when {
            notes.workspace == Workspace.Chat -> androidx.compose.runtime.CompositionLocalProvider(LocalOpenNote provides notesViewModel::openNoteFromLink) { ChatScreen(
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
                account = account,
                onSignIn = signIn,
                onDismissGuestLimit = viewModel::dismissGuestLimit,
            ) }
            // 按编辑器分，不按页面 id：冲突后"另存为新笔记"换到副本时，WebView 留着不重新加载。
            open != null -> androidx.compose.runtime.key(open.editor) {
                NoteEditorScreen(
                    open = open,
                    saveState = notes.saveState,
                    notice = (notes.notice ?: notes.error)?.let { notesErrorText(it) },
                    // 编辑器里的 AI 助手用 App 里选的模型和推理强度（网页按服务端的模型列表核对）。
                    embedUrl = { lang -> app.api.noteEmbedUrl(open.id, lang, state.selectedModel?.id, state.selectedReasoning) },
                    onDownload = downloadNoteFile,
                    baseUrl = BuildConfig.BASE_URL,
                    cookieJar = app.cookieJar,
                    drawerOpen = drawerState.isOpen,
                    onMenu = { scope.launch { drawerState.open() } },
                    onBack = notesViewModel::closeNote,
                    onDismissNotice = notesViewModel::dismissNotice,
                    onMessage = { editor, message ->
                        when (message) {
                            is EmbedMessage.Ready -> notesViewModel.onEditorReady(editor, message.id, message.title, message.icon)
                            is EmbedMessage.Meta -> notesViewModel.onEditorMeta(editor, message.title, message.icon)
                            is EmbedMessage.SaveState -> notesViewModel.onEditorSaveState(editor, message.state)
                            EmbedMessage.Missing -> notesViewModel.onEditorMissing(editor)
                            EmbedMessage.Trashed -> notesViewModel.onEditorTrashed(editor)
                            is EmbedMessage.Flushed -> Unit
                        }
                    },
                    registerFlush = { bridge ->
                        editorBridge = bridge
                        notesViewModel.flushEditor = bridge?.let { b -> { b.flush() } }
                    },
                )
            }
            else -> Column(Modifier.fillMaxSize().background(Color.White)) {
                // 笔记列表的顶栏：网页手机版只有菜单（和搜索；原生版还没有搜索）。
                Row(Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 10.4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TopIconButton(Lucide.Menu, stringResource(R.string.open_menu), { scope.launch { drawerState.open() } })
                }
                NotesHome(
                    state = notes,
                    onSwitch = notesViewModel::setWorkspace,
                    onOpen = notesViewModel::openNote,
                    onCreate = notesViewModel::createNote,
                    onMove = { dialog = NotesDialogState.Move(it.id) },
                    onNewGroup = { dialog = NotesDialogState.NewGroup },
                    onRetry = notesViewModel::refresh,
                )
            }
        }
    }

    NotesDialogs(dialog, notes, notesViewModel) { dialog = null }

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
            if (page == null) close() else MoveNoteDialog(page, notes.groups, notes.groupError, vm::moveNote, vm::createGroup, close)
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
            stringResource(R.string.trash_note_body, dialog.page.title, TRASH_RETENTION_DAYS),
            stringResource(R.string.move_to_trash),
            notes.error,
            onConfirm = { vm.trashNote(dialog.page.id) },
            onClose = close,
        )
    }
}

// 侧边栏（网页 .notion-sidebar，手机抽屉）：宽 240、底色 #F7F7F5；头部高 48（品牌）；
// 下面是 Chat / Note 切换（左右 8、上距 4），再下面是当前模式的内容，最底部是账号区。
@Composable
private fun AppDrawer(
    workspace: Workspace,
    onSwitch: (Workspace) -> Unit,
    onClose: () -> Unit,
    footer: @Composable () -> Unit,
    body: @Composable ColumnScope.() -> Unit,
) {
    ModalDrawerSheet(
        modifier = Modifier.width(240.dp),
        drawerShape = RectangleShape,
        drawerContainerColor = Sm.Sidebar,
        drawerTonalElevation = 0.dp,
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                BrandMark(20.dp, Sm.Ink)
                Spacer(Modifier.width(7.2.dp))
                Text(stringResource(R.string.app_title), color = Sm.Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                // 头部右侧的"关闭侧栏"（.notion-icon-button 40，PanelLeftClose 17 灰）；聊天和笔记两边的网页侧栏都有。
                TopIconButton(Lucide.PanelLeftClose, stringResource(R.string.sb_close_sidebar), onClose, iconSize = 17.dp)
            }
            WorkspaceSwitch(workspace, onSwitch, Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp))
            body()
            footer()
        }
    }
}
