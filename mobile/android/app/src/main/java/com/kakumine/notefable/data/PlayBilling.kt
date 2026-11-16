package com.kakumine.notefable.data

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

/** Play 商店里的 Pro 商品：月额的本地化价格（例 "¥300"）和购买时要用的 offer。 */
class PlayProduct internal constructor(val details: ProductDetails, val offerToken: String, val formattedPrice: String)

/** 一次购买的结果，交给界面显示（[PlayBilling.events]）。 */
sealed interface PlayPurchaseEvent {
    /** 服务端确认并开通了 Pro。 */
    data object Subscribed : PlayPurchaseEvent
    /** 付款还在处理（便利店付款等），完成后 Google 会通知服务端。 */
    data object Pending : PlayPurchaseEvent
    /** 用户在 Play 的购买窗口里取消了。 */
    data object Cancelled : PlayPurchaseEvent
    /** 失败。message 是服务端的英文原句（经系统文词典翻译后显示），null 时显示通用的失败文。 */
    data class Failed(val message: String?) : PlayPurchaseEvent
}

/**
 * Google Play Billing（Pro 的月额订阅，网页是 Stripe）。见 docs/architecture/billing.md。
 * 买到后把购买令牌交给 `report`（`POST /api/billing/google`）：服务端向 Google 核对、确认（acknowledge）并开通 Pro，App 不自己确认。
 * 购买时带上服务端给的 accountId（`setObfuscatedAccountId`），服务端据此确认这笔购买是这个用户的。
 * 报告没送到的购买（断网、App 被关），下次打开设置时 [recover] 再送；服务端的 RTDN 也会确认，三天内没确认 Google 会自动退款。
 * 放在 App 单例里：购买窗口的结果回到监听器时，打开它的界面可能已经不在了。
 */
class PlayBilling(context: Context, private val scope: CoroutineScope, private val report: suspend (String) -> PlayClaim) {
    private val _events = MutableSharedFlow<PlayPurchaseEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<PlayPurchaseEvent> = _events.asSharedFlow()

    private val connectLock = Mutex()
    private val client: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { result, purchases -> onPurchasesUpdated(result, purchases) }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    /** 连上 Play 的结算服务。没装 Play 商店、或不是从 Play 安装（例如 Drive 发的 APK）时连不上，返回 false。 */
    private suspend fun connect(): Boolean = connectLock.withLock {
        if (client.isReady) return true
        suspendCancellableCoroutine { continuation ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (continuation.isActive) continuation.resume(result.responseCode == BillingClient.BillingResponseCode.OK)
                }

                override fun onBillingServiceDisconnected() {
                    if (continuation.isActive) continuation.resume(false)
                }
            })
        }
    }

    /** 读 Pro 商品。连不上 Play 或商品没上架时返回 null（界面不显示购买按钮）。 */
    suspend fun product(productId: String): PlayProduct? {
        if (!connect()) return null
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.SUBS).build()))
            .build()
        val result = client.queryProductDetails(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) return null
        val details = result.productDetailsList?.firstOrNull() ?: return null
        val offer = details.subscriptionOfferDetails?.firstOrNull() ?: return null
        val price = offer.pricingPhases.pricingPhaseList.lastOrNull()?.formattedPrice ?: return null
        return PlayProduct(details, offer.offerToken, price)
    }

    /** 打开 Play 的购买窗口。结果从 [events] 回来。 */
    fun launch(activity: Activity, product: PlayProduct, accountId: String): Boolean {
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product.details).setOfferToken(product.offerToken).build()),
            )
            .setObfuscatedAccountId(accountId)
            .build()
        return client.launchBillingFlow(activity, params).responseCode == BillingClient.BillingResponseCode.OK
    }

    /** 把还没确认的购买（之前报告没送到的）再报告一次。有开通的返回 true。 */
    suspend fun recover(productId: String): Boolean {
        if (!connect()) return false
        val result = client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build())
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) return false
        var subscribed = false
        for (purchase in result.purchasesList) {
            if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged || productId !in purchase.products) continue
            if (runCatching { report(purchase.purchaseToken) }.getOrNull() == PlayClaim.Subscribed) subscribed = true
        }
        return subscribed
    }

    private fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::handle)
            BillingClient.BillingResponseCode.USER_CANCELED -> _events.tryEmit(PlayPurchaseEvent.Cancelled)
            // 已经有这份订阅（在别的设备上买过等）：把它报告给服务端开通。
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> scope.launch {
                val event = runCatching { client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()) }
                    .getOrNull()?.purchasesList?.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                if (event != null) handle(event) else _events.tryEmit(PlayPurchaseEvent.Failed(null))
            }
            else -> _events.tryEmit(PlayPurchaseEvent.Failed(null))
        }
    }

    private fun handle(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
            _events.tryEmit(PlayPurchaseEvent.Pending)
            return
        }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        scope.launch {
            val event = try {
                when (report(purchase.purchaseToken)) {
                    PlayClaim.Subscribed -> PlayPurchaseEvent.Subscribed
                    PlayClaim.Pending -> PlayPurchaseEvent.Pending
                }
            } catch (error: ApiException) {
                PlayPurchaseEvent.Failed(error.serverMessage())
            } catch (error: Exception) {
                PlayPurchaseEvent.Failed(null)
            }
            _events.emit(event)
        }
    }
}

/** 服务端对购买报告的回答（`POST /api/billing/google`：200 开通、202 付款处理中；其他是 [ApiException]）。 */
enum class PlayClaim { Subscribed, Pending }
