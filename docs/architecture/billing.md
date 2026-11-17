# 付费方案（Pro）与用量上限

NoteFable 的收费只有一种：月额订阅 **Pro**，每月 ¥300（税込）。目标是用订阅费大致抵消 API 费用，不追求利润。网页用 Stripe（Checkout 与 Customer Portal），Android App 用 Google Play 结算（见下面的“Android”）。服务端只保存客户 ID、订阅 ID / 购买令牌和订阅状态，不接触卡号。

## 档位与上限

数值在 `src/lib/usage-plans.ts`（`USAGE_LIMITS` 次数、`USAGE_PERIODS` 计数周期），计数在 `src/lib/usage-limits.ts`，存储见 [database.md](database.md#usagecounter)。

| 档位 | 条件 | 聊天 | 图片 |
| --- | --- | --- | --- |
| guest | 未登录 | 10 / 天 | 不能生成（要登录） |
| member | 已登录、免费 | 20 / 天 | 5 / 月 |
| pro | `User.plan = PRO` | 1,000 / 账期 | 40 / 账期 |

- “天”是日本时间的一天；免费的“月”是日本时间的自然月；Pro 的“账期”是 Stripe 的当前计费周期（`subscriptionPeriodStart`〜`subscriptionPeriodEnd`），续费时重新计算。账期已过但续费通知还没到时，先按自然月计（不会被上一期用满的计数卡住）。Pro 和免费的月计数是不同的行（`chat:pro` / `image:pro` 与 `image:month`），所以升级时免费额度的用量不带进 Pro，回到免费时也不按旧账期算。
- 同一网络（IP）的未登录用户另有共同上限：聊天 50 / 天，图片 0。
- 免费的月用量（20 × 31 = 620 条）低于 Pro，测试会检查。

### 定价依据（2026-11 查价）

- 聊天模型：GPT-6 Luna 与 Claude Haiku 5.5 都是输入 $0.10 / 输出 $0.50（每百万 token，第三方汇总与 Anthropic 官方价）。按每条约 3K 输入 + 800 输出估，短对话约 ¥0.1 / 条，带长历史时约 ¥0.5 / 条。
- 图片：`gpt-image-2.6-sunburst` 1024² 约 $0.025–0.053 / 张（≈ ¥4–8，按 token 计费，第三方估算），和画质关系不大，所以按张数计。
- Stripe 日本：卡支付 3.6% + Billing 0.7%，¥300 到手约 ¥287。
- Pro 用满（1,000 条 + 40 张）最坏约 ¥400，平均用量远低于此；初期允许少量亏损。web search 的额外费用未计入。

改上限或价格只改 `usage-plans.ts`，然后重新生成 Android 的 `assets/usage-limits.json`（`npx tsx scripts/gen-native-usage-limits.ts`）。服务条款第 3 节和特商法标示直接读这里的数值；写成文字的 [Play 商店说明](../play-store/listing.md) 要手动改，并改 `legal-page.tsx` 的 `LEGAL_UPDATED_ISO`。

## 订阅流程

代码在 `src/lib/billing.ts`（服务端）、`src/lib/billing-client.ts`（网页）、`src/app/api/billing/`。

1. **申请**：设置的“方案”或上限提示（`UpgradePrompt`）里的“升级到 Pro” → `POST /api/billing/checkout`（同源、已登录）。没有 Stripe 客户就先建一个（幂等键 `notefable-customer-<userId>`，只在 `stripeCustomerId` 为空时写回，并发也只有一个客户）。库里的状态可能还没同步，所以再向 Stripe 列出这个客户的订阅：有还在扣费的（`canceled`、`incomplete_expired` 以外）就同步它并返回 409；没有就先让这个客户开着的旧 Checkout Session 过期（避免两个页面都付款），再创建 `mode: subscription` 的 Checkout Session 并返回 URL。被拒的草稿先存进 `sessionStorage`，回来后放回输入栏；附件不保留，提示里会说明。
2. **回来**：Stripe 跳回 `/app?billing=success`。`BillingReturnNotice` 去掉地址里的参数，调 `GET /api/billing?refresh=1`：服务端直接向 Stripe 列出这个客户的订阅并同步，不等 Webhook；显示“欢迎使用 Pro”或“正在确认付款”。
3. **Webhook**：`POST /api/billing/webhook` 校验 `stripe-signature` 后，对 `checkout.session.completed`、`checkout.session.async_payment_succeeded` 和 `customer.subscription.created|updated|deleted|paused|resumed`，用事件里的订阅 ID **重新向 Stripe 取订阅**再写库（`syncSubscription`），所以事件乱序或重发都只会写最新状态。同步失败返回 500，让 Stripe 重试。
4. **状态 → 方案**：`active`、`trialing`、`past_due` 视为 Pro（`past_due` 是 Stripe 在重试扣款；后台必须设成重试用尽后取消订阅，否则会一直停在 `past_due`、一直是 Pro）；其他状态回到 FREE。用户有另一份有效订阅时，旧订阅的结束通知不会把他降回 FREE。预约解约（`cancel_at`，或 `cancel_at_period_end` 时取账期结束）期间仍是 Pro，日期存在 `subscriptionCancelAt`，设置里显示“Pro 将于…结束”。收到持有者已删除（找不到行）但还在扣费的 NoteFable 订阅（`metadata.userId`）时，直接取消它。
5. **管理**：Pro 用户（或有过订阅的用户）在设置里点“管理订阅” → `POST /api/billing/portal` → Stripe Customer Portal（解约、换卡、收据），返回 `/app?billing=portal`。
6. **删除账号**：有 Stripe 客户时，`DELETE /api/account` 先让开着的 Checkout Session 过期，并立即取消这个客户所有还在扣费的订阅（`cancelCustomerBilling`，包括还没同步到库里的和重复的），失败就返回 502、不删账号，避免行删掉后无人能找到订阅而继续扣费。已经不存在或已结束的订阅视为成功。

手动把 `plan` 改成 `PRO`（没有订阅）仍然有效，月上限按自然月计。

## 配置（Stripe）

环境变量（三项都设置才开放申请；缺任何一项时不显示升级入口，`/api/billing/checkout|portal` 返回 404，设置里只显示方案和用量。Webhook 只需要 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`：去掉价格来暂停新申请时，已有订阅照常同步）：

```text
STRIPE_SECRET_KEY       # sk_live_… / 测试用 sk_test_…
STRIPE_PRICE_ID         # ¥300 / 月的 recurring price（price_…）
STRIPE_WEBHOOK_SECRET   # Webhook 端点的签名密钥（whsec_…）
```

Stripe 后台要做的事：

- 产品 “NoteFable Pro”，价格 ¥300 / 月（JPY、recurring、税込）。把 price ID 填进 `STRIPE_PRICE_ID`。
- Webhook 端点 `https://notefable.com/api/billing/webhook`，订阅上面第 3 步列出的事件。
- Customer Portal：允许取消订阅、更新支付方式、查看收据。取消方式必须选“在计费周期结束时取消”（不要选“立即取消”）：服务条款和特商法标示都承诺解约后用到已付期间结束。
- Billing → 订阅与邮件 → 重试用尽后：选“取消订阅”（不要选“保持逾期”，否则会一直是 Pro）。
- 日本的“特定商取引法に基づく表記”在 `/legal-notice`（`src/app/legal-notice/page.tsx`）：姓名、住所、电话按法 11 条但书写成“请求时立即开示”。Stripe 后台“公开业务信息”里填这个网址。价格、上限、解约或退款规则变了，同时改这一页和服务条款第 3 节。

本地测试：用测试模式的密钥，`stripe listen --forward-to localhost:3000/api/billing/webhook` 拿到临时 `whsec_`，测试卡 `4242 4242 4242 4242`。

## Android（Google Play 结算）

Google Play 要求 App 内的数字订阅走 Play 结算，不能引导去网页付款。所以 App 里用 Play Billing 卖同一个 Pro，网页用 Stripe；两边写进同一组 `User` 列（`subscriptionProvider` = `stripe` / `google`，`src/lib/subscription-state.ts`）。服务端的上限提示句不提“升级”，升级提示由各端界面自己显示；App 内嵌的笔记编辑页（`/note-embed`）不显示网页的 Stripe 升级提示。Play 收 15%，¥300 到手约 ¥255。

1. **购买**（`data/PlayBilling.kt`，billing-ktx 9.1.0）：设置的“方案”（`ui/PlanSettings.kt`）和上限提示（`UpgradeLimitPrompt`）在 `GET /api/billing` 的 `googlePlay` 为 true、且能读到 Play 商品时显示“升级到 Pro”，价格用 Play 返回的本地化价格。购买窗口带上 `accountId`（`setObfuscatedAccountId`，就是 `User.id`）。不是从 Play 安装的 APK（例如 Drive 发的）连不上 Play 结算，不显示购买按钮。
2. **报告**：买到后 App 把购买令牌发到 `POST /api/billing/google`。服务端用 Play Developer API（`purchases.subscriptionsv2.get`）核对：令牌上的 `obfuscatedExternalAccountId`（Play 商店里重新购买时是原购买的）必须是当前用户；没有这个 ID 时，只认已经记录在当前用户上的令牌（或它的前一个令牌）；令牌也不能已被别的用户用过。有效就确认（acknowledge）并写入，返回 Pro。付款还在处理（`PENDING`）时返回 202。网页（Stripe）已经是 Pro 时不确认这笔购买，Google 3 天后自动退款，返回 409。App 打开设置时会把没报告成功的购买（还没确认的）再报告一次。
3. **RTDN**：Play 的 Real-time developer notifications 经 Pub/Sub push 到 `POST /api/billing/google/notify`。Pub/Sub 在 `Authorization` 里带一个用推送服务账号签名的 Google ID 令牌（OIDC），服务端校验签名、发行者、audience（这个地址）和发送者邮箱（`GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT`），不在地址里放口令（`verifyPushToken`）。只取通知里的购买令牌，状态每次向 Google 重新读取（`syncPlayPurchase`）；按令牌、被替换的旧令牌（`linkedPurchaseToken`）、再按 `accountId` 找用户。App 没报告到的有效购买在这里确认。持有者已删除时停止续费。失败返回 500 让 Pub/Sub 重发。
4. **状态对应**：`ACTIVE` → active；`CANCELED`（已取消续费）到期前仍是 active，`subscriptionCancelAt` = 到期时间；`IN_GRACE_PERIOD` → past_due（仍是 Pro）；`ON_HOLD` → unpaid、`PAUSED` → paused、`PENDING` → incomplete、`EXPIRED` → canceled（都不是 Pro）。Play 不返回账期开始日：第一次按到期前一个月计，之后同一份订阅只在真正续费（状态为 ACTIVE 且到期时间往后推了一天以上）时把上一期的到期时间作为新的开始日；宽限期里 Google 每天延长到期时间，这时开始日不变（否则月上限的计数会被重置）。
5. **管理**：Play 买的 Pro 在网页和 App 的设置里都显示“在 Google Play 上管理订阅”，打开 Play 的订阅页面。网页（Stripe）买的订阅在 App 里没有管理入口。
6. **删除账号**：先停止 Play 订阅的续费（`purchases.subscriptions.cancel`，已付的期限内 Google 侧仍有效，之后不再扣费），失败就不删除。

并发：同一个用户的所有计费处理（结账、Stripe / Play 的同步、购买报告、删除账号）都在按用户的 Postgres advisory lock 里一次只做一个（`withUserBillingLock`，锁里重新读用户行，库操作走同一个事务连接）。所以并发的通知不会用旧状态盖掉新状态；两个页面同时结账，后一个会先让前一个的页面过期再检查订阅；等着结账的请求在删号之后拿到锁时，读不到用户行就放弃。

两个来源同时扣费时（例如 Play 订阅在保留期间用户又在网页买了，之后 Play 恢复），以用户行上记录的那份为准，另一份停掉：Stripe 的立即取消并把已付的账单退款（按支付加幂等键，只退一次），Play 的未确认就不确认（Google 退款），已确认就退款并终止（`revoke`）（`subscriptionAction` 的 `duplicate`）。Play 换购后的新令牌（`linkedPurchaseToken`），或过期后在 Play 商店重新购买（`outOfAppPurchaseContext.expiredPurchaseToken`）的新令牌，指向记录的旧令牌时算同一份订阅。

### 配置（Google Play）

环境变量（`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` 和 `GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT` 都设置才开放 App 内购买）：

```text
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  # 机密：服务账号 play-billing 的 JSON 密钥（整段）
GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT  # pubsub-push@studymate-511413.iam.gserviceaccount.com（Pub/Sub push 签名用的服务账号）
GOOGLE_PLAY_PUSH_AUDIENCE         # https://notefable.com/api/billing/google/notify（不设时用请求的地址）
GOOGLE_PLAY_PACKAGE_NAME          # 可选，默认 com.kakumine.notefable
GOOGLE_PLAY_PRODUCT_ID            # 可选，默认 notefable_pro
```

已经建好的（2026-11-17）：

- Play Console：App `NoteFable`（`com.kakumine.notefable`），内部测试有 1.0.6（versionCode 16）的草稿；订阅 `notefable_pro` 的基础方案 `monthly`（按月自动续订、宽限期 7 天、日本 ¥300，其他国家按汇率换算），尚未启用；收益化设置里开了实时通知，主题 `projects/studymate-511413/topics/play-rtdn`。
- Play Console 用户：`play-billing@studymate-511413.iam.gserviceaccount.com`，权限“查看销售数据…”和“管理订单和订阅”。
- Google Cloud 项目 `studymate-511413`：开了 Google Play Android Developer API 和 Pub/Sub；服务账号 `play-billing`（JSON 密钥已下载，只放 Vercel）、`pubsub-push`（无密钥，Pub/Sub 服务代理有它的 Token Creator）；主题 `play-rtdn`（`google-play-developer-notifications@system.gserviceaccount.com` 是发布者）；push 订阅 `play-rtdn-push` → `https://notefable.com/api/billing/google/notify`，用 `pubsub-push` 做 OIDC 认证，audience 同地址。
- 测试：把测试账号加到“许可测试”，App 必须从 Play 的测试轨道安装（Drive 的 APK 不能购买）。
