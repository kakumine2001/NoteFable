package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.PlanInfo
import com.kakumine.notefable.data.PlanUsage
import com.kakumine.notefable.data.serverMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val MeterFull = Color(0xFFB45309) // .settings-plan-bar.is-full

/**
 * 设置里的“方案”（网页 src/components/plan-settings.tsx，样式 globals.css 的 .settings-plan-*）：
 * 标题 14/600 后接徽章（12/600、左右 8 上下 1、全圆角；免费是浅灰底灰字，Pro 是浅蓝底蓝字）；
 * Pro 时一行 13 灰的续费 / 结束 / 扣款失败说明；两条用量（13 正文标签 + 右侧 13 灰的 “用了 / 上限”，下面 4 高的全圆角进度条，
 * 底色 hover 灰、填充蓝，用满时橙），条目间距 10、上距 9.6。
 * 网页免费用户还有“升级到 Pro”和“管理订阅”；原生端不提供购买和订阅管理（Google Play 的付费规定，见 android-native.md），只显示。
 */
@Composable
internal fun PlanSettings(load: suspend () -> Result<PlanInfo>) {
    var attempt by remember { mutableIntStateOf(0) }
    var plan by remember { mutableStateOf<PlanInfo?>(null) }
    var loadError by remember { mutableStateOf<Throwable?>(null) }
    val system = rememberSystemText()

    LaunchedEffect(attempt) {
        load().onSuccess { plan = it }.onFailure { loadError = it }
    }

    val current = plan
    val pro = current?.plan == "pro"
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.plan_title), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
        if (current != null) {
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (pro) R.string.plan_pro else R.string.plan_free),
                color = if (pro) Sm.Blue else Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (pro) Sm.AccentSoft else Sm.Hover).padding(horizontal = 8.dp, vertical = 1.dp),
            )
        }
    }
    when {
        loadError != null -> {
            val error = loadError
            Text(
                (error as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.plan_load_failed),
                color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
            )
            NotionButton(stringResource(R.string.try_again), onClick = { loadError = null; attempt++ }, modifier = Modifier.padding(top = 8.dp))
        }
        current == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
            SpinningLoader(14.dp)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
        }
        else -> {
            val subscription = current.subscription
            if (pro && subscription != null) {
                val cancelAt = subscription.cancelAt
                val periodEnd = subscription.periodEnd
                when {
                    subscription.status == "past_due" -> SettingsHelpText(stringResource(R.string.plan_past_due))
                    cancelAt != null -> SettingsHelpText(stringResource(R.string.plan_ends, planDate(cancelAt)))
                    periodEnd != null -> SettingsHelpText(stringResource(R.string.plan_renews, planDate(periodEnd)))
                }
            }
            Column(Modifier.padding(top = 9.6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                current.usage["chat"]?.let { usage ->
                    PlanMeter(
                        stringResource(
                            when {
                                usage.period == "day" -> R.string.plan_messages_today
                                pro -> R.string.plan_messages_period
                                else -> R.string.plan_messages_month
                            },
                        ),
                        usage,
                    )
                }
                current.usage["image"]?.let { usage ->
                    PlanMeter(
                        stringResource(
                            when {
                                usage.period == "day" -> R.string.plan_images_today
                                pro -> R.string.plan_images_period
                                else -> R.string.plan_images_month
                            },
                        ),
                        usage,
                    )
                }
            }
        }
    }
}

@Composable
private fun PlanMeter(label: String, usage: PlanUsage) {
    val ratio = if (usage.limit > 0) (usage.used.toFloat() / usage.limit).coerceIn(0f, 1f) else 1f
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(label, Modifier.weight(1f), color = Sm.Text, fontSize = 13.sp, lineHeight = 19.5.sp)
            Text(
                "${usage.used} / ${usage.limit}", color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, textAlign = TextAlign.End,
                style = TextStyle(fontFeatureSettings = "tnum"),
            )
        }
        Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(999.dp)).background(Sm.Hover)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(ratio).clip(RoundedCornerShape(999.dp)).background(if (ratio >= 1f) MeterFull else Sm.Blue))
        }
    }
}

/** 网页 `toLocaleDateString(tag, { year: "numeric", month: "short", day: "numeric" })`，按界面语言。 */
@Composable
private fun planDate(iso: String): String {
    val locale = Locale.forLanguageTag(AppLanguage.acceptLanguage(stringResource(R.string.ui_locale)))
    return remember(iso, locale) {
        runCatching {
            val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, "yMMMd")
            DateTimeFormatter.ofPattern(pattern, locale).format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
        }.getOrDefault("")
    }
}
