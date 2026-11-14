package com.kakumine.studymate.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.kakumine.studymate.R
import kotlinx.coroutines.launch

// 回答一回合（网页 chat-message.tsx 的助手部分）：标签、正文 / 生成中占位、生成的图片、失败文、操作行。
// 数值来自网页 412x915 的实测（见 docs/architecture/android-native.md 的对照表）。

@Composable
internal fun AssistantTurn(message: UiMessage, modelLabel: String?) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val systemText = rememberSystemText()

    Column(Modifier.fillMaxWidth()) {
        // "StudyMate · 模型名"：品牌标志 12，间距 5.6；模型名不转大写，字距 .02em。
        Row(Modifier.padding(bottom = 7.2.dp), verticalAlignment = Alignment.CenterVertically) {
            BrandMark(12.dp, Sm.Ink)
            Spacer(Modifier.width(5.6.dp))
            Text("STUDYMATE", style = RoleLabelBase)
            if (modelLabel != null) {
                Spacer(Modifier.width(5.6.dp))
                Text("· $modelLabel", style = RoleLabelBase.copy(letterSpacing = 0.24.sp))
            }
        }
        when {
            message.generatingImage -> GeneratingImagePreview()
            message.content.isEmpty() && message.streaming ->
                CircularProgressIndicator(Modifier.size(18.dp), color = Sm.Muted, strokeWidth = 2.dp)
            message.content.isNotEmpty() -> SelectionContainer {
                // 使用上限的句子只翻译（网页 t(message.content)），其它回答只替换末尾的"Request failed: …"。
                AnswerMarkdown(if (message.usageLimit) systemText.t(message.content) else systemText.localizeFailure(message.content, message.failure))
            }
        }
        message.images.forEach { image ->
            AsyncImage(
                model = remember(image.dataUrl) { imageModel(image.dataUrl) },
                contentDescription = null,
                contentScale = ContentScale.Fit,
                // .generated-image：最宽 576、圆角 4.8、1px #e2e8f0 描边、#f8fafc 底。
                modifier = Modifier.padding(top = 8.dp).widthIn(max = 576.dp).fillMaxWidth().clip(RoundedCornerShape(4.8.dp))
                    .background(Color(0xFFF8FAFC)).border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(4.8.dp)),
            )
        }
        message.errorDetail?.let { detail ->
            Text(
                stringResource(R.string.request_failed, systemText.localize(detail)),
                color = Sm.Danger,
                fontSize = 15.sp,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (!message.streaming && message.content.isNotEmpty()) {
            // 操作行：36x36 的图标按钮，整体左移 10 让图标和正文左边缘对齐，距正文 6.4。
            Row(Modifier.padding(top = 6.4.dp).offset(x = (-10).dp)) {
                val copyLabel = stringResource(R.string.copy)
                Box(
                    Modifier.size(36.dp).clip(RoundedCornerShape(4.8.dp)).clickable {
                        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("StudyMate", message.content))) }
                    }.semantics { contentDescription = copyLabel; role = Role.Button },
                    Alignment.Center,
                ) {
                    LucideIcon(Lucide.Copy, 16.dp, Sm.Muted, strokeWidth = 1.9f)
                }
            }
        }
    }
}
