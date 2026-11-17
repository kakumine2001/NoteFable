package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.serverMessage
import kotlinx.coroutines.launch

private val Danger = Color(0xFFB91C1C) // .notes-delete
private val DangerBorder = Color(0x33B91C1C) // rgba(185, 28, 28, 0.2)
private val DangerFill = Color(0x0AB91C1C) // rgba(185, 28, 28, 0.04)

/**
 * 设置的"账号"卡片里、"退出登录"下面的"删除账号"（网页 settings-dialog.tsx 的 DeleteAccount，Google Play 的账号删除要求）。
 * 外观照网页手机宽度：红色的一行（[SettingsRowButton]，Trash2）；点了在原地换成确认区（底 4% 红、内边距 14×16、14sp / 1.5），
 * 右下角"取消"和红字、20% 红描边的"永久删除"（上距 12）。
 */
@Composable
fun DeleteAccountSection(
    enabled: Boolean,
    onBusyChange: (Boolean) -> Unit,
    deleteAccount: suspend () -> Throwable?,
    onDeleted: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    val scope = rememberCoroutineScope()
    val system = rememberSystemText()

    Column(Modifier.fillMaxWidth()) {
        if (!confirming) {
            SettingsRowButton(Lucide.Trash2, stringResource(R.string.acct_delete_account), enabled = enabled, danger = true) { confirming = true }
            return@Column
        }
        Column(Modifier.fillMaxWidth().background(DangerFill).padding(horizontal = 16.dp, vertical = 14.dp)) {
            Text(stringResource(R.string.acct_delete_account_warning), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp)
            error?.let {
                Text(
                    (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_delete_account),
                    color = Danger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 8.dp),
                )
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NotionButton(stringResource(R.string.cancel), onClick = { confirming = false; error = null }, enabled = !deleting)
                NotionButton(
                    stringResource(if (deleting) R.string.acct_deleting else R.string.acct_delete_permanently),
                    onClick = {
                        deleting = true
                        error = null
                        onBusyChange(true)
                        scope.launch {
                            val failure = deleteAccount()
                            deleting = false
                            onBusyChange(false)
                            if (failure == null) onDeleted() else error = failure
                        }
                    },
                    enabled = !deleting, danger = true,
                    modifier = Modifier.border(1.dp, DangerBorder, RoundedCornerShape(4.8.dp)),
                )
            }
        }
    }
}
