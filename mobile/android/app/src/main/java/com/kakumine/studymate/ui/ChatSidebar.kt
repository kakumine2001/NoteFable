package com.kakumine.studymate.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.studymate.R

// 侧栏的聊天部分："新聊天"（.sidebar-primary-action，与"新笔记"同款：上距 12、高 44、圆角 8、深色、左对齐 16/550），
// 聊天行高 44、圆角 6.4，当前行浅蓝底加左侧蓝条。网页侧栏里的搜索、聊天项目、拖动 / 置顶 / 更多在原生版里还没有对应功能，所以不放。
@Composable
internal fun ChatDrawerBody(
    state: ChatUiState,
    onNewChat: () -> Unit,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        Row(
            Modifier.padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 4.dp).fillMaxWidth().height(44.dp)
                .shadow(1.dp, RoundedCornerShape(8.dp), ambientColor = Color(0x1F0C1730), spotColor = Color(0x1F0C1730))
                .clip(RoundedCornerShape(8.dp)).background(Sm.Ink).clickable(onClick = onNewChat)
                .padding(horizontal = 11.2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LucideIcon(Lucide.Plus, 16.dp, Color.White)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.new_chat), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight(550))
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
