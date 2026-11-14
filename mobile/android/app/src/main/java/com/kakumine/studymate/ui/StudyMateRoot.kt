package com.kakumine.studymate.ui

import androidx.activity.compose.LocalActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape

import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.studymate.R
import com.kakumine.studymate.auth.clearGoogleCredentialState
import com.kakumine.studymate.auth.requestGoogleIdToken
import kotlinx.coroutines.launch

@Composable
fun StudyMateRoot(viewModel: ChatViewModel, accountViewModel: AccountViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val account by accountViewModel.state.collectAsStateWithLifecycle()
    val activity = LocalActivity.current ?: return
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    // 返回键先关抽屉，再退出 App。
    BackHandler(enabled = drawerState.isOpen) { scope.launch { drawerState.close() } }
    // 每次打开抽屉都刷新列表，拿到其它设备或网页上的新聊天。
    LaunchedEffect(drawerState.currentValue) {
        if (drawerState.currentValue == DrawerValue.Open) viewModel.refreshSessions()
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            SessionDrawer(
                state = state,
                onNewChat = {
                    viewModel.newChat()
                    scope.launch { drawerState.close() }
                },
                onOpen = { id ->
                    viewModel.openSession(id)
                    scope.launch { drawerState.close() }
                },
                onRetry = viewModel::refreshSessions,
                footer = {
                    SidebarFooter(
                        account = account,
                        onSignIn = {
                            accountViewModel.signIn(
                                fetchIdToken = { clientId, nonce -> requestGoogleIdToken(activity, clientId, nonce) },
                                onSignedIn = viewModel::onIdentityChanged,
                            )
                        },
                        onSignOut = {
                            accountViewModel.signOut(
                                clearDeviceChoice = { clearGoogleCredentialState(activity) },
                                onSignedOut = viewModel::onIdentityChanged,
                            )
                        },
                        onSaveName = accountViewModel::saveName,
                        onResetToGoogle = accountViewModel::resetToGoogle,
                    )
                },
            )
        },
    ) {
        ChatScreen(
            state = state,
            onMenu = { scope.launch { drawerState.open() } },
            onNewChat = viewModel::newChat,
            onSend = viewModel::send,
            onStop = viewModel::stop,
            onSelectModel = viewModel::selectModel,
            onSelectReasoning = viewModel::selectReasoning,
            onRetryMessages = viewModel::reloadActive,
            onAddFiles = viewModel::addFiles,
            onRemoveFile = viewModel::removeFile,
            onImageMode = viewModel::setImageMode,
        )
    }
}

// 侧边栏（网页 .notion-sidebar）：宽 240、底色 #F7F7F5；头部高 48；"新聊天"按钮高 44、圆角 8、深色底；
// 聊天行高 44、圆角 6.4，当前行浅蓝底加左侧蓝条。网页侧栏里的 Chat/Notes 切换、搜索、项目、语言、隐私政策
// 在原生版里还没有对应功能，所以这里不放（不放不能用的入口）。
@Composable
private fun SessionDrawer(
    state: ChatUiState,
    onNewChat: () -> Unit,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    footer: @Composable () -> Unit,
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
            }
            Row(
                Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp).fillMaxWidth().height(44.dp)
                    .clip(RoundedCornerShape(8.dp)).background(Sm.Ink).clickable(onClick = onNewChat),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                LucideIcon(Lucide.Plus, 16.dp, Color.White)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.new_chat), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            }

            // 分区小标题：12sp 等宽大写灰字（和回答上方的角色标签同一套样式）。
            val chatsLabel = stringResource(R.string.chats).uppercase()
            Text(
                chatsLabel,
                modifier = Modifier.padding(start = 16.dp, top = 14.4.dp, bottom = 4.8.dp),
                style = roleLabelStyle(chatsLabel),
            )

            Box(Modifier.weight(1f).fillMaxWidth()) { when {
                state.sessionsLoading -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = Sm.Muted, strokeWidth = 2.dp)
                }
                // 网页没有单独的"列表加载失败"文案，这里只给一个重试按钮（文案用网页已有的 Retry）。
                state.sessionsFailed -> TextButton(onClick = onRetry, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(stringResource(R.string.retry), color = Sm.Blue)
                }
                state.sessions.isEmpty() -> Text(
                    stringResource(R.string.chats_empty),
                    color = Sm.Muted,
                    fontSize = 12.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.sessions, key = { it.id }) { session ->
                        SessionRow(session.title, session.icon, active = session.id == state.activeSessionId) { onOpen(session.id) }
                    }
                }
            } }
            footer()
        }
    }
}

@Composable
private fun SessionRow(title: String, icon: String?, active: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.padding(horizontal = 8.dp).fillMaxWidth().height(44.dp)
            .clip(RoundedCornerShape(6.4.dp))
            .background(if (active) Sm.AccentSoft else Color.Transparent)
            .clickable(onClick = onClick)
            .drawBehind {
                if (active) drawRect(Sm.Blue, size = Size(3.dp.toPx(), size.height))
            }
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(20.dp), Alignment.Center) {
            if (icon != null) Text(icon, fontSize = 16.sp) else LucideIcon(Lucide.MessageSquareText, 15.dp, Sm.Muted)
        }
        Spacer(Modifier.width(12.dp))
        Text(
            title,
            color = if (active) Sm.Ink else Sm.Text,
            fontSize = 16.sp,
            fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
