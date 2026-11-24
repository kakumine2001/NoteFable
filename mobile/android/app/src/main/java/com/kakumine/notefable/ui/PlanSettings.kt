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
import androidx.compose.runtime.Stable
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
import com.kakumine.notefable.data.formatStorageSize
import com.kakumine.notefable.data.serverMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val MeterFull = Color(0xFFB45309) // .settings-plan-bar.is-full

/** "方案"卡片的状态：读到的方案、读取失败的原因、Play 的商品、购买窗口开没开、购买的结果。 */
@Stable
internal class PlanSettingsState {
    var attempt by mutableIntStateOf(0)
    var plan by mutableStateOf<PlanInfo?>(null)
    var loadError by mutableStateOf<Throwable?>(null)
    var product by mutableStateOf<PlayProduct?>(null)
    var purchasing by mutableStateOf(false)
    var outcome by mutableStateOf<PlayPurchaseEvent?>(null)
}

/**
 * 读方案、读 Play 的商品、收购买的结果。在设置窗口里调用，不在"方案"页里：设置分成了一览和各栏的页面，
 * 而网页各栏一直挂着（只是不显示），所以方案在打开设置时读一次，进出"方案"页不重读，购买的结果离开页面再回来也还在。
 */
@Composable
internal fun rememberPlanSettingsState(load: suspend () -> Result<PlanInfo>): PlanSettingsState {
    val state = remember { PlanSettingsState() }
    val billing = (LocalContext.current.applicationContext as NoteFableApp).playBilling

    LaunchedEffect(state.attempt) {
        load().onSuccess { state.plan = it }.onFailure { state.loadError = it }
    }
    // 免费且能在 App 里买：先把之前没报告成的购买补报（开通了就重读方案），再读 Play 的商品和价格。
    val plan = state.plan
    val productId = plan?.takeIf { it.plan != "pro" && it.googlePlay && it.accountId != null }?.productId
    val allowTrial = (plan?.trialDays ?: 0) > 0
    LaunchedEffect(productId, allowTrial) {
        if (productId == null) return@LaunchedEffect
        if (billing.recover(productId)) {
            state.attempt++
            return@LaunchedEffect
        }
        state.product = billing.product(productId, allowTrial)
    }
    LaunchedEffect(billing) {
        billing.events.collect { event ->
            state.purchasing = false
            if (event != PlayPurchaseEvent.Cancelled) state.outcome = event
            if (event == PlayPurchaseEvent.Subscribed) state.attempt++
        }
    }
    return state
}

/**
 * 设置里“方案”卡片的内容（网页 src/components/plan-settings.tsx，样式 settings-dialog.css 的 .settings-plan-*，手机宽度）：
 * 第一行“NoteFable”17/650 墨色，后接徽章（12/600、左右 8 上下 2、全圆角；免费是浅灰底灰字，Pro 是浅蓝底蓝字）；
 * Pro 时一行 13 灰的续费 / 结束 / 扣款失败说明；两条用量（14 正文标签 + 右侧 13 灰的 “用了 / 上限”，下面 6 高的全圆角进度条，
 * 底色 hover 灰、填充蓝，用满时橙），条目间距 14、上距 16。
 * 免费用户：服务端开了 Play 结算（googlePlay）且 Play 商品读得到时，显示 Pro 的介绍框和“升级到 Pro”（Google Play 的购买窗口，
 * 网页是 Stripe）；还能免费试用时（服务端 trialDays > 0 且 Play 给了带试用的 offer）多一行试用说明，按钮写“开始 N 天免费试用”；Play 里买的 Pro 显示“在 Google Play 上管理订阅”（.settings-chip，上距 16）。网页（Stripe）买的订阅在 App 里不提供管理入口。
 * 状态在 [PlanSettingsState] 里，由设置窗口拿着（[rememberPlanSettingsState]）。
 */
@Composable
internal fun PlanSettings(state: PlanSettingsState) {
    val system = rememberSystemText()
    val context = LocalContext.current
    val billing = (context.applicationContext as NoteFableApp).playBilling
    val activity = LocalActivity.current
    val loadError = state.loadError
    val product = state.product
    val purchasing = state.purchasing

    val current = state.plan
    val pro = current?.plan == "pro"
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("NoteFable", color = Sm.Ink, fontSize = 17.sp, lineHeight = 25.5.sp, fontWeight = FontWeight(650))
        if (current != null) {
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (pro) R.string.plan_pro else R.string.plan_free),
                color = if (pro) Sm.Blue else Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (pro) Sm.AccentSoft else Sm.Hover).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
    when {
        loadError != null -> {
            Text(
                (loadError as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.plan_load_failed),
                color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
            )
            NotionButton(stringResource(R.string.try_again), onClick = { state.loadError = null; state.attempt++ }, modifier = Modifier.padding(top = 8.dp))
        }
        current == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
            SpinningLoader(14.dp)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
        }
        else -> {
            when (val event = state.outcome) {
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
                    subscription.status == "trialing" && periodEnd != null ->
                        SettingsHelpText(stringResource(R.string.plan_trial_ends, planDate(periodEnd), current.priceJpy))
                    periodEnd != null -> SettingsHelpText(stringResource(R.string.plan_renews, planDate(periodEnd)))
                }
            }
            Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
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
                    // 免费方案平时不显示「本月图片生成」，只显示今天的；撞到月上限时再显示满额条以免用户困惑。Pro 同时显示本期上限与今日上限。
                    if (pro || usage.daily == null || usage.used >= usage.limit) {
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
                    usage.daily?.let { PlanMeter(stringResource(R.string.plan_images_today), PlanUsage(it.used, it.limit)) }
                }
                // 文件存储（聊天的图片、生成的图片、笔记的文件和封面等）的用量。
                current.storage?.let { storage ->
                    val locale = uiLocale()
                    PlanMeterRow(
                        stringResource(R.string.plan_storage),
                        "${formatStorageSize(storage.used, locale)} / ${formatStorageSize(storage.limit, locale)}",
                        if (storage.limit > 0) (storage.used.toDouble() / storage.limit).toFloat().coerceIn(0f, 1f) else 1f,
                        // 满不满用字节数比较（Float 的比例在上限附近会进位成 1）。
                        full = storage.limit <= 0 || storage.used >= storage.limit,
                    )
                }
            }
            if (current.storage != null) SettingsHelpText(stringResource(R.string.plan_storage_help))
            val offer = product
            val accountId = current.accountId
            if (!pro && offer != null && accountId != null) {
                PlanOffer(offer, purchasing) {
                    if (activity != null && !state.purchasing) {
                        state.outcome = null
                        state.purchasing = billing.launch(activity, offer, accountId)
                        if (!state.purchasing) state.outcome = PlayPurchaseEvent.Failed(null)
                    }
                }
            }
            current.manageUrl?.let { url ->
                SettingsChip(Lucide.CreditCard, stringResource(R.string.plan_manage_play), Modifier.padding(top = 16.dp)) {
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                }
            }
        }
    }
}

@Composable
private fun PlanMeter(label: String, usage: PlanUsage) =
    PlanMeterRow(
        label, "${usage.used} / ${usage.limit}", if (usage.limit > 0) (usage.used.toFloat() / usage.limit).coerceIn(0f, 1f) else 1f,
        full = usage.limit <= 0 || usage.used >= usage.limit,
    )

@Composable
private fun PlanMeterRow(label: String, count: String, ratio: Float, full: Boolean) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(label, Modifier.weight(1f), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp)
            Text(
                count, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, textAlign = TextAlign.End,
                style = TextStyle(fontFeatureSettings = "tnum"),
            )
        }
        Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(999.dp)).background(Sm.Hover)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(ratio).clip(RoundedCornerShape(999.dp)).background(if (full) MeterFull else Sm.Blue))
        }
    }
}

// .settings-plan-offer（手机）：上距 16、内边距 14/16、1px 蓝描边、圆角 12、和上限提示一样的浅蓝到浅黄渐变；
// 标题 15/600 墨色、前面 17 的产品角色图标（间距 7）；说明 13 灰；按钮上距 12、高 44、全圆角、墨色底白字 15/600、占满一行。
@Composable
private fun PlanOffer(product: PlayProduct, busy: Boolean, onUpgrade: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    val limits = rememberProLimits()
    Column(
        Modifier.padding(top = 16.dp).fillMaxWidth().clip(shape).background(Sm.Surface)
            .drawBehind {
                val d = 0.70710677f
                val half = (size.width + size.height) * d / 2f
                val c = Offset(size.width / 2f, size.height / 2f)
                drawRect(Brush.linearGradient(listOf(Sm.AccentSoft, Color(0x24FFE27A)), c - Offset(d, d) * half, c + Offset(d, d) * half))
            }
            .border(1.dp, Sm.AccentLine, shape).padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AppIcon(17.dp, Sm.Ink)
            Spacer(Modifier.width(7.dp))
            Text(stringResource(R.string.plan_offer_title, product.formattedPrice), color = Sm.Ink, fontSize = 15.sp, lineHeight = 22.5.sp, fontWeight = FontWeight.SemiBold)
        }
        SettingsHelpText(stringResource(R.string.plan_offer_body, "%,d".format(limits.chat), limits.image, formatStorageSize(limits.storage, uiLocale())))
        if (product.trialDays > 0) SettingsHelpText(stringResource(R.string.plan_trial_note, product.trialDays, product.formattedPrice))
        Box(
            Modifier.padding(top = 12.dp).fillMaxWidth().height(44.dp).clip(CircleShape).background(Sm.Ink)
                .clickable(enabled = !busy, onClick = onUpgrade).semantics { role = Role.Button },
            Alignment.Center,
        ) {
            Text(
                upgradeLabel(busy, product),
                color = Sm.OnInk.copy(alpha = if (busy) 0.6f else 1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** 购买按钮的文字：打开中 / 还能试用时“开始 N 天免费试用” / “升级到 Pro”。 */
@Composable
private fun upgradeLabel(busy: Boolean, product: PlayProduct): String = when {
    busy -> stringResource(R.string.plan_opening)
    product.trialDays > 0 -> stringResource(R.string.plan_trial_start, product.trialDays)
    else -> stringResource(R.string.plan_upgrade)
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
fun UpgradeLimitPrompt(
    kind: String,
    onClose: () -> Unit,
    /** 文件存储空间不够（网页 StorageLimitPrompt 的升级部分）：标题和说明换成存储空间的。 */
    storage: StorageLimitInfo? = null,
    /** 在 App 里买不了（Play 没开、商品读不到）时显示的东西（存储空间不够时仍要说明原因）。 */
    unavailable: @Composable () -> Unit = {},
) {
    val context = LocalContext.current
    val app = context.applicationContext as NoteFableApp
    val billing = app.playBilling
    val activity = LocalActivity.current
    val system = rememberSystemText()
    val limits = rememberProLimits()
    var offer by remember { mutableStateOf<Pair<PlayProduct, String>?>(null) }
    // Play の商品を読み終えたか。読んでいる間は何も出さない（読めなかったときだけ unavailable を出す）。
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val failedText = stringResource(R.string.plan_purchase_failed)
    val pendingText = stringResource(R.string.plan_pending)

    LaunchedEffect(Unit) {
        try {
            val plan = runCatching { AccountApi(app.api.http).plan() }.getOrNull() ?: return@LaunchedEffect
            val productId = plan.productId
            val accountId = plan.accountId
            if (!plan.googlePlay || plan.plan == "pro" || productId == null || accountId == null) return@LaunchedEffect
            offer = billing.product(productId, plan.trialDays > 0)?.let { it to accountId }
        } finally {
            loaded = true
        }
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

    val (product, accountId) = offer ?: return if (loaded) unavailable() else Unit
    val locale = uiLocale()
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
        title = if (storage != null) stringResource(R.string.storage_limit_title)
        else stringResource(if (kind == "image") R.string.upgrade_title_image else R.string.guest_limit_title_chat),
        body = if (storage != null) {
            listOf(
                stringResource(R.string.storage_limit_used, formatStorageSize(storage.used, locale), formatStorageSize(storage.limit, locale)),
                stringResource(R.string.storage_limit_upgrade, formatStorageSize(limits.storage, locale), product.formattedPrice),
            ).joinToString("\n")
        } else stringResource(R.string.upgrade_body, "%,d".format(limits.chat), limits.image, product.formattedPrice),
        note = listOfNotNull(
            failure ?: if (product.trialDays > 0) stringResource(R.string.plan_trial_note, product.trialDays, product.formattedPrice) else null,
            if (storage != null) stringResource(R.string.storage_limit_delete) else null,
        ).joinToString("\n").ifEmpty { null },
        actionLabel = upgradeLabel(busy, product),
        icon = if (storage != null) Lucide.HardDrive else null,
    )
}

/** 界面语言的 Locale（数字和日期的写法跟着它）。 */
@Composable
internal fun uiLocale(): Locale = Locale.forLanguageTag(AppLanguage.acceptLanguage(stringResource(R.string.ui_locale)))

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
