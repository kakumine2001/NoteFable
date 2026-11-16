package com.kakumine.notefable.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountApi
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.PlanInfo
import com.kakumine.notefable.data.PlanUsage
import com.kakumine.notefable.data.PlayProduct
import com.kakumine.notefable.data.PlayPurchaseEvent
import com.kakumine.notefable.data.UsageLimit
import com.kakumine.notefable.data.UsageLimits
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
 * 免费用户：服务端开了 Play 结算（googlePlay）且 Play 商品读得到时，显示 Pro 的介绍框和“升级到 Pro”（Google Play 的购买窗口，
 * 网页是 Stripe）；Play 里买的 Pro 显示“在 Google Play 上管理订阅”。网页（Stripe）买的订阅在 App 里不提供管理入口。
 */
@Composable
internal fun PlanSettings(load: suspend () -> Result<PlanInfo>) {
    var attempt by remember { mutableIntStateOf(0) }
    var plan by remember { mutableStateOf<PlanInfo?>(null) }
    var loadError by remember { mutableStateOf<Throwable?>(null) }
    val system = rememberSystemText()
    val context = LocalContext.current
    val billing = (context.applicationContext as NoteFableApp).playBilling
    val activity = LocalActivity.current
    var product by remember { mutableStateOf<PlayProduct?>(null) }
    var purchasing by remember { mutableStateOf(false) }
    var outcome by remember { mutableStateOf<PlayPurchaseEvent?>(null) }

    LaunchedEffect(attempt) {
        load().onSuccess { plan = it }.onFailure { loadError = it }
    }
    // 免费且能在 App 里买：先把之前没报告成的购买补报（开通了就重读方案），再读 Play 的商品和价格。
    val productId = plan?.takeIf { it.plan != "pro" && it.googlePlay && it.accountId != null }?.productId
    LaunchedEffect(productId) {
        if (productId == null) return@LaunchedEffect
        if (billing.recover(productId)) {
            attempt++
            return@LaunchedEffect
        }
        product = billing.product(productId)
    }
    LaunchedEffect(billing) {
        billing.events.collect { event ->
            purchasing = false
            if (event != PlayPurchaseEvent.Cancelled) outcome = event
            if (event == PlayPurchaseEvent.Subscribed) attempt++
        }
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
            when (val event = outcome) {
                PlayPurchaseEvent.Subscribed -> SettingsHelpText(stringResource(R.string.plan_welcome))
                PlayPurchaseEvent.Pending -> SettingsHelpText(stringResource(R.string.plan_pending))
                is PlayPurchaseEvent.Failed -> Text(
                    event.message?.let(system::localize) ?: stringResource(R.string.plan_purchase_failed),
                    color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
                )
                else -> Unit
            }
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
            val offer = product
            val accountId = current.accountId
            if (!pro && offer != null && accountId != null) {
                PlanOffer(offer, purchasing) {
                    if (activity != null && !purchasing) {
                        outcome = null
                        purchasing = billing.launch(activity, offer, accountId)
                        if (!purchasing) outcome = PlayPurchaseEvent.Failed(null)
                    }
                }
            }
            current.manageUrl?.let { url ->
                SettingsInlineAction(Lucide.CreditCard, stringResource(R.string.plan_manage_play), enabled = true) {
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
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

// .settings-plan-offer（手机）：上距 13.6、内边距 12/14、1px 蓝描边、圆角 10、和上限提示一样的浅蓝到浅黄渐变；
// 标题 14/600 墨色、前面 15 的蓝色 Sparkles（间距 6）；说明 13 灰；按钮上距 10、高 44、全圆角、墨色底白字 15/600、占满一行。
@Composable
private fun PlanOffer(product: PlayProduct, busy: Boolean, onUpgrade: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    val limits = rememberProLimits()
    Column(
        Modifier.padding(top = 13.6.dp).fillMaxWidth().clip(shape).background(Color.White)
            .drawBehind {
                val d = 0.70710677f
                val half = (size.width + size.height) * d / 2f
                val c = Offset(size.width / 2f, size.height / 2f)
                drawRect(Brush.linearGradient(listOf(Sm.AccentSoft, Color(0x29FFE27A)), c - Offset(d, d) * half, c + Offset(d, d) * half))
            }
            .border(1.dp, Sm.AccentLine, shape).padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LucideIcon(Lucide.Sparkles, 15.dp, Sm.Blue)
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.plan_offer_title, product.formattedPrice), color = Sm.Ink, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
        }
        SettingsHelpText(stringResource(R.string.plan_offer_body, "%,d".format(limits.chat), limits.image))
        Box(
            Modifier.padding(top = 10.dp).fillMaxWidth().height(44.dp).clip(CircleShape).background(Sm.Ink)
                .clickable(enabled = !busy, onClick = onUpgrade).semantics { role = Role.Button },
            Alignment.Center,
        ) {
            Text(
                stringResource(if (busy) R.string.plan_opening else R.string.plan_upgrade),
                color = Color.White.copy(alpha = if (busy) 0.6f else 1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** Pro 的上限（安装包里的 assets/usage-limits.json，和网页 USAGE_LIMITS.pro 同源）。 */
@Composable
internal fun rememberProLimits(): UsageLimit {
    val context = LocalContext.current
    return remember {
        runCatching { context.assets.open("usage-limits.json").use { UsageLimits.parse(it.readBytes().decodeToString()) }.pro }
            .getOrDefault(UsageLimit(0, 0))
    }
}

/**
 * 免费用户撞到上限时，输入栏上方的升级提示（网页 UpgradePrompt）。外框和动画沿用 [GuestLimitPrompt]，按钮打开 Play 的购买窗口。
 * 服务端没开 Play 结算、或 Play 商品读不到（不是从 Play 安装的 APK 等）时不显示。开通后自动关掉。
 * 在 App 里买不会离开页面，附件不会丢，所以不显示网页那句附件提醒；购买失败或付款处理中时，在同一位置显示原因。
 */
@Composable
fun UpgradeLimitPrompt(kind: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as NoteFableApp
    val billing = app.playBilling
    val activity = LocalActivity.current
    val system = rememberSystemText()
    val limits = rememberProLimits()
    var offer by remember { mutableStateOf<Pair<PlayProduct, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val failedText = stringResource(R.string.plan_purchase_failed)
    val pendingText = stringResource(R.string.plan_pending)

    LaunchedEffect(Unit) {
        val plan = runCatching { AccountApi(app.api.http).plan() }.getOrNull() ?: return@LaunchedEffect
        val productId = plan.productId
        val accountId = plan.accountId
        if (!plan.googlePlay || plan.plan == "pro" || productId == null || accountId == null) return@LaunchedEffect
        offer = billing.product(productId)?.let { it to accountId }
    }
    LaunchedEffect(billing) {
        billing.events.collect { event ->
            busy = false
            when (event) {
                PlayPurchaseEvent.Subscribed -> onClose()
                PlayPurchaseEvent.Pending -> failure = pendingText
                is PlayPurchaseEvent.Failed -> failure = event.message?.let(system::localize) ?: failedText
                PlayPurchaseEvent.Cancelled -> Unit
            }
        }
    }

    val (product, accountId) = offer ?: return
    GuestLimitPrompt(
        kind = kind,
        attachmentsLost = false,
        onSignIn = {
            if (activity != null && !busy) {
                failure = null
                busy = billing.launch(activity, product, accountId)
                if (!busy) failure = failedText
            }
        },
        onClose = onClose,
        title = stringResource(if (kind == "image") R.string.upgrade_title_image else R.string.guest_limit_title_chat),
        body = stringResource(R.string.upgrade_body, "%,d".format(limits.chat), limits.image, product.formattedPrice),
        note = failure,
        actionLabel = stringResource(if (busy) R.string.plan_opening else R.string.plan_upgrade),
    )
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
