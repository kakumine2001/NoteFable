# 付费方案（Pro）与用量上限

NoteFable 的收费只有一种：月额订阅 **Pro**，每月 ¥300（税込），第一次订阅先免费试用 30 天（见“免费试用”）。目标是用订阅费大致抵消 API 费用，不追求利润。网页用 Stripe（Checkout 与 Customer Portal），Android App 用 Google Play 结算（见下面的“Android”）；iOS 用 App Store（StoreKit 2），月价由 App Store 商品决定（见下面的“iOS”）。服务端只保存客户 ID、订阅 ID / 购买令牌和订阅状态，不接触卡号。

## 档位与上限

数值在 `src/lib/usage-plans.ts`（`USAGE_LIMITS` 次数、`USAGE_PERIODS` 计数周期、`USAGE_DAILY_LIMITS` 月上限之外的每日上限、`STORAGE_LIMITS` 文件存储上限、`MAX_STORED_FILE_BYTES` 工作区单文件上限），计数在 `src/lib/usage-limits.ts`，存储见 [database.md](database.md#usagecounter)；文件存储的用量在 `src/lib/stored-files.ts`（[database.md](database.md#storedfile)）。

| 档位 | 条件 | 聊天 | 图片 | 文件存储 |
| --- | --- | --- | --- | --- |
| guest | 未登录 | 20 / 天 | 10 / 月，且 3 / 天 | 100 MB |
| member | 已登录、免费 | 40 / 天 | 20 / 月，且 5 / 天 | 500 MB |
| pro | `User.plan = PRO` | 2,000 / 账期 | 60 / 账期，且 10 / 天 | 10 GB |

- “天”是日本时间的一天；免费的“月”是日本时间的自然月；Pro 的“账期”是 Stripe 的当前计费周期（`subscriptionPeriodStart`〜`subscriptionPeriodEnd`），续费时重新计算。账期已过但续费通知还没到时，先按自然月计（不会被上一期用满的计数卡住）。Pro 和免费的月计数是不同的行（`chat:pro` / `image:pro` 与 `image:month`），所以升级时免费额度的用量不带进 Pro，回到免费时也不按旧账期算。
- 图片有两层上限：月（账期）总量和每日张数，任何一层满了就拒绝，提示句会说明是今天的还是本月的。每日上限让用户每天都能用，月总量控制成本（一张图约 ¥4–8，是聊天的几十倍）。设置的“方案”里 Pro 显示两条图片生成用量（本期 / 今日），免费方案平时只显示今日图片生成（后台仍执行月总量上限，触顶时补显示满额的本月条）。
- 同一网络的未登录用户另有共同上限：聊天 100 / 天，图片 30 / 月（未登录清 Cookie 就是新用户，图片靠这个上限兜底；登录后不受限）。网络按 IPv4 地址或 IPv6 的前 64 位计（`networkAddress`），在自己的 /64 里换地址逃不掉；换 IP（代理）仍然逃得掉，没有全站的未登录总量上限。
- 免费的月用量（40 × 31 = 1,240 条）低于 Pro，测试会检查。
- **文件存储**是这个用户放在文件仓库里的全部文件的合计（聊天附件图片、生成的图片、笔记的图片和文件、封面和页面图标、头像、设置里的图标；1 MB = 1 MiB，界面写作 MB / GB）。工作区上传（笔记文件、封面、图标，以及将来白板 / 幻灯片的图片）单个最多 4 MB，聊天附件仍是单个 20 MB。放不下时新的上传（和图片生成）被拒绝：413 `{ error, code: "storage_limit", tier, used, limit }`，三端显示用量和原因，游客另有登录按钮、免费用户另有 Pro 升级按钮（网页 Stripe、Android Play；iOS 没有内购，只说明原因）；服务端的句子不提升级。已有的文件不受影响。删掉的文件在不再被引用约一周后才释放空间（编辑历史、Trash 里的笔记仍算引用）。设置的“方案”页显示“存储”用量条（`GET /api/billing` 的 `storage: { used, limit }`，字节）。成本参考：Vercel Blob 按存储量和操作次数计费，Pro 的 10 GB 存满时主要是存储费；清理任务每天的 `list()` 次数很少（[database.md](database.md#storedfile)）。

### 定价依据（2026-11 查价）

- 聊天模型：GPT-6 Luna 与 Claude Haiku 5.5 都是输入 $0.10 / 输出 $0.50（每百万 token，第三方汇总与 Anthropic 官方价）。按每条约 3K 输入 + 800 输出估，短对话约 ¥0.1 / 条，带长历史时约 ¥0.5 / 条。
- 图片：`gpt-image-2.6-sunburst` 1024² 约 $0.025–0.053 / 张（≈ ¥4–8，按 token 计费，第三方估算），和画质关系不大，所以按张数计。
- Stripe 日本：卡支付 3.6% + Billing 0.7%，¥300 到手约 ¥287。
- Pro 用满（2,000 条 + 60 张）最坏约 ¥440–1,480（聊天 ¥200–1,000 + 图片 ¥240–480），高于到手的 ¥287；平均用量远低于此，初期允许亏损。web search 的额外费用未计入。
- 免费用户没有收入：登录用户每天用满，每月最坏约 ¥200–780（聊天 1,240 条 + 图片 20 张）；未登录每个 IP 的图片最坏约 ¥120–240 / 月。实际用量明显偏高时先收紧这些数值。

改上限（含存储上限）或价格只改 `usage-plans.ts`，然后重新生成 Android 与 iOS 共用的 `mobile/android/app/src/main/assets/usage-limits.json`（`npx tsx scripts/gen-native-usage-limits.ts`；每档带 `storage` 字节数，原生的存储提示和 Pro 说明用它）。服务条款第 3、4 节和特商法标示直接读这里的数值；写成文字的 [Play 商店说明](../play-store/listing.md) 要手动改，并改 `legal-page.tsx` 的 `LEGAL_UPDATED_ISO`。

## iOS

- App Store Connect 的订阅组为 NoteFable Pro，月付商品 ID 为 `com.kakumine.notefable.pro.monthly`。商品价格在 App Store Connect 的各店面配置，App 通过 StoreKit 显示当地价格。首次内购需随 App 版本送审。
- App 在发起购买前请求服务端检查已有权益并取得此账号专用的随机 UUID。StoreKit 把 UUID 和 App Store 交易绑定。恢复购买只能恢复原来的 NoteFable 账号。待批准期间会暂缓其他渠道发起订阅，取消购买或确认成交可提前解除等候。
- 服务端验证 Apple 签名、产品、环境、交易和账号绑定，在账号账务锁内查询 Apple 的最新订阅状态。App 交付成功后才结束 StoreKit 交易。签名通知 v2 使用 `/api/billing/apple/notify`，续费、退款、撤销和宽限期同步到共用权益。
- App Store 订阅由 Apple 管理。删除 NoteFable 账号之前提供 App Store 订阅管理入口，用户可以在那里取消续费。

## 免费试用

第一次订阅 Pro 的用户先免费用 30 天（`PRO_TRIAL_DAYS`），要先登记付款方式，到期自动开始按月扣费；试用期间解约不扣费，Pro 用到试用结束。每个账号一次。

- **资格**：`isTrialEligible`（`src/lib/billing.ts`）= 用户行的 `subscriptionStatus` 为 null（两种来源都没订阅过；订阅过一次这个字段就一直留着）。`GET /api/billing` 返回 `trialDays`（有资格是 30，否则 0）；`GET /api/account` 只在 Stripe 计费已配置且有资格时返回 30（否则 0）。界面据此把按钮写成“开始 30 天免费试用”并加一行“前 30 天免费，之后每月 ¥300。试用结束前取消就不会扣费。”
- **网页（Stripe）**：建 Checkout Session 时，有资格且这个 Stripe 客户没有任何过往订阅，就在 `subscription_data` 里加 `trial_period_days` 和 `trial_settings.end_behavior.missing_payment_method = cancel`。Checkout 默认要求登记付款方式，并在页面上显示“30 天免费，之后每月 ¥300”。试用中的订阅状态是 `trialing`（算 Pro），账期就是试用期，月上限按它计；设置里显示“免费试用将于…结束，之后 Pro 每月 ¥300”。
- **Android（Google Play）**：试用是 Play Console 里基础方案 `monthly` 上的“免费试用”优惠（30 天）。资格必须选“新客户获取”（Play 保证每个 Google 账号只给一次）；不要选“开发者指定”：那种优惠 Play 不检查资格，服务端也不核对购买用的是哪个 offer，改过的客户端就能反复试用。App 读商品时，服务端说有资格（`trialDays > 0`）就优先选第一阶段价格为 0 的 offer，试用天数取自这个阶段的计费周期（`isoPeriodDays`）；没有这种 offer（Console 里没建，或 Play 判断这个 Google 账号没资格）就照常显示“升级到 Pro”。服务端说没资格时只用不带试用的基础方案。Play 的试用期间状态是 `ACTIVE`。
- 已知的漏洞，暂时接受：删除账号后重新注册、或换一个邮箱注册，同一张卡可以再试用一次（不按卡去重）；试用结束时扣款失败的订阅在 Stripe 重试期间是 `past_due`，仍算 Pro 并拿到新一期的额度。后者靠 Stripe 后台把重试期设短（Billing → 订阅与邮件）来限制。用量出现这类滥用时再做按卡指纹去重。
- 试用的条件写在服务条款第 3 节和特商法标示（“無料トライアル”“支払時期”）里，改天数或规则时一起改。

## 订阅流程

代码在 `src/lib/billing.ts`（服务端）、`src/lib/billing-client.ts`（网页）、`src/app/api/billing/`。

1. **申请**：设置的“方案”或上限提示（`UpgradePrompt`）里的“升级到 Pro” → `POST /api/billing/checkout`（同源、已登录）。在按用户的账务锁（`withUserBillingLock`）内重读用户行，没有 Stripe 客户就先建一个（幂等键 `notefable-customer-<userId>`）并写回 `stripeCustomerId`。随后**先让这个客户开着的旧 Checkout Session 过期**（避免两个页面同时付款），**再向 Stripe 列出这个客户的订阅**：有还在扣费的（`canceled`、`incomplete_expired` 以外，包括刚在过期前完成付款的）就同步它并返回 409；没有才创建 `mode: subscription` 的 Checkout Session 并返回 URL。被拒的草稿先存进 `sessionStorage`，回来后放回输入栏；附件不保留，提示里会说明。
2. **回来**：Stripe 跳回 `/app?billing=success`。`BillingReturnNotice` 去掉地址里的参数，调 `GET /api/billing?refresh=1`：服务端向外部刷新当前用户的订阅状态并同步（有 Stripe 客户时向 Stripe 列出订阅同步；有 Google Play 购买令牌且已配置 Play 结算时也会重新同步 Play 订阅），不等 Webhook；显示“欢迎使用 Pro”或“正在确认付款”。
3. **Webhook**：`POST /api/billing/webhook` 校验 `stripe-signature` 后，对 `checkout.session.completed`、`checkout.session.async_payment_succeeded` 和 `customer.subscription.created|updated|deleted|paused|resumed`，用事件里的订阅 ID **重新向 Stripe 取订阅**再写库（`syncSubscription`），所以事件乱序或重发都只会写最新状态。同步失败返回 500，让 Stripe 重试。
4. **状态 → 方案**：`active`、`trialing`、`past_due` 视为 Pro（`past_due` 是 Stripe 在重试扣款；后台必须设成重试用尽后取消订阅，否则会一直停在 `past_due`、一直是 Pro）；其他状态回到 FREE。用户有另一份有效订阅时，旧订阅的结束通知不会把他降回 FREE。预约解约（`cancel_at`，或 `cancel_at_period_end` 时取账期结束）期间仍是 Pro，日期存在 `subscriptionCancelAt`，设置里显示“Pro 将于…结束”。收到持有者已删除（找不到行）但还在扣费的 NoteFable 订阅（`metadata.userId`）时，直接取消它。
5. **管理**：Pro 用户（或有过订阅的用户）在设置里点“管理订阅” → `POST /api/billing/portal` → Stripe Customer Portal（解约、换卡、收据），返回 `/app?billing=portal`。Portal 用后台的默认构成（Stripe 邮件里的“管理订阅”链接也用它），但解约方式由代码保证：打开 Portal 前（每个实例每 10 分钟最多一次）读默认构成，解约不是“在计费周期结束时取消”或被关掉时，用 API 改回（`ensurePortalCancelsAtPeriodEnd`，只改解约这一项，其他项目照后台设置）。一并把 `proration_behavior` 设成 `none`（即时解约用的按比例结算值留着时，Stripe 会拒绝改 mode）；这两个请求各自最多等 5 秒、不重试。读或改失败时照常打开 Portal，不让用户失去解约手段，1 分钟后再试。这是服务条款第 3 节和特商法标示的承诺。
6. **删除账号**：有 Stripe 客户时，`DELETE /api/account` 先让开着的 Checkout Session 过期，并立即取消这个客户所有还在扣费的订阅（`cancelCustomerBilling`，包括还没同步到库里的和重复的），最后删除 Stripe 的客户（邮箱和 `userId`；发票和支付记录留在 Stripe）。任何一步失败就返回 502、不删账号，避免行删掉后无人能找到订阅而继续扣费。已经不存在或已结束的订阅、已经不存在的客户视为成功。

手动把 `plan` 改成 `PRO`（没有订阅）仍然有效，月上限按自然月计。

## 配置（Stripe）

环境变量（三项都设置才开放申请；缺任何一项时不显示升级入口，`/api/billing/checkout` 返回 404，设置里只显示方案和用量。Webhook 和“管理订阅”（`/api/billing/portal`）只需要 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`：去掉价格来暂停新申请时，已有订阅照常同步，用户也照样能解约——服务条款承诺了解约方法）：

```text
STRIPE_SECRET_KEY       # sk_live_… / 测试用 sk_test_…
STRIPE_PRICE_ID         # ¥300 / 月的 recurring price（price_…）
STRIPE_WEBHOOK_SECRET   # Webhook 端点的签名密钥（whsec_…）
```

Stripe 后台要做的事：

- 产品 “NoteFable Pro”，价格 ¥300 / 月（JPY、recurring、税込）。把 price ID 填进 `STRIPE_PRICE_ID`。
- Webhook 端点 `https://app.notefable.com/api/billing/webhook`（接口只在工作区主机，`notefable.com/api/*` 返回 421），订阅上面第 3 步列出的事件。
- Customer Portal：允许取消订阅、更新支付方式、查看收据；隐私政策和服务条款的链接填 notefable.com 的 `/privacy`、`/terms`。解约方式由代码改成“在计费周期结束时取消”（见上面第 5 步），后台不用手动改；用受限密钥（`rk_…`）时要给它 Customer Portal 构成的读写权限。
- Billing → 订阅与邮件 → 重试用尽后：选“取消订阅”（不要选“保持逾期”，否则会一直是 Pro）。
- 日本的“特定商取引法に基づく表記”在 `/legal-notice`（`src/app/legal-notice/page.tsx`）：姓名、住所、电话按法 11 条但书写成“请求时立即开示”。Stripe 后台“公开业务信息”里填这个网址。价格、上限、解约或退款规则变了，同时改这一页和服务条款第 3 节。

本地测试：用测试模式的密钥，`stripe listen --forward-to localhost:3000/api/billing/webhook` 拿到临时 `whsec_`，测试卡 `4242 4242 4242 4242`。

## Android（Google Play 结算）

Google Play 要求 App 内的数字订阅走 Play 结算，不能引导去网页付款。所以 App 里用 Play Billing 卖同一个 Pro，网页用 Stripe；两边写进同一组 `User` 列（`subscriptionProvider` = `stripe` / `google`，`src/lib/subscription-state.ts`）。服务端的上限提示句不提“升级”，升级提示由各端界面自己显示；App 内嵌的笔记编辑页（`/note-embed`）不显示网页的 Stripe 升级提示。Play 收 15%，¥300 到手约 ¥255。

1. **购买**（`data/PlayBilling.kt`，billing-ktx 9.1.0）：设置的“方案”（`ui/PlanSettings.kt`）和上限提示（`UpgradeLimitPrompt`）在 `GET /api/billing` 的 `googlePlay` 为 true、且能读到 Play 商品时显示“升级到 Pro”，价格用 Play 返回的本地化价格。购买窗口带上 `accountId`（`setObfuscatedAccountId`，就是 `User.id`）。不是从 Play 安装的 APK（例如 Drive 发的）连不上 Play 结算，不显示购买按钮。
2. **报告**：买到后 App 把购买令牌发到 `POST /api/billing/google`。服务端用 Play Developer API（`purchases.subscriptionsv2.get`）核对：令牌上的 `obfuscatedExternalAccountId`（Play 商店里重新购买时是原购买的）必须是当前用户；没有这个 ID 时，只认已经记录在当前用户上的令牌（或它的前一个令牌）；令牌也不能已被别的用户用过。有效就确认（acknowledge）并写入，返回 Pro。付款还在处理（`PENDING`）时返回 202。网页（Stripe）已经是 Pro 时不确认这笔购买，Google 3 天后自动退款，返回 409。App 打开设置时会把没报告成功的购买（还没确认的）再报告一次。
3. **RTDN**：Play 的 Real-time developer notifications 经 Pub/Sub push 到 `POST /api/billing/google/notify`。Pub/Sub 在 `Authorization` 里带一个用推送服务账号签名的 Google ID 令牌（OIDC），服务端校验签名、发行者、audience（这个地址）和发送者邮箱（`GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT`），不在地址里放口令（`verifyPushToken`）。只取通知里的购买令牌，状态每次向 Google 重新读取（`syncPlayPurchase`）；按令牌、被替换的旧令牌（`linkedPurchaseToken`）、再按 `accountId` 找用户。App 没报告到的有效购买在这里确认。持有者已删除时停止续费。失败返回 500 让 Pub/Sub 重发。
4. **状态对应**：`ACTIVE`（未到期）→ `active`（已到期则 `canceled`）；`CANCELED`（已取消续费）到期前仍是 `active`，`subscriptionCancelAt` = 到期时间；`IN_GRACE_PERIOD` → `past_due`（仍是 Pro）；`ON_HOLD` → `unpaid`、`PAUSED` → `paused`、`PENDING` → `incomplete`、`PENDING_PURCHASE_CANCELED` → `incomplete_expired`、`EXPIRED` → `canceled`（都不是 Pro）。Play 不返回账期开始日：第一次按到期前一个月计，之后同一份订阅只在真正续费（状态为 ACTIVE 且到期时间往后推了一天以上）时把上一期的到期时间作为新的开始日；宽限期里 Google 每天延长到期时间，这时开始日不变（否则月上限的计数会被重置）。
5. **管理**：Play 买的 Pro 在网页和 Android App 的设置里都显示“在 Google Play 上管理订阅”，打开 Play 的订阅页面。网页（Stripe）买的订阅在 Android App 里没有管理入口；iOS 端方案卡片为只读，两种来源均不显示购买或管理按钮。
6. **删除账号**：先停止 Play 订阅的续费（`purchases.subscriptions.cancel`，已付的期限内 Google 侧仍有效，之后不再扣费），失败就不删除。

并发：同一个用户的所有计费处理（结账、Stripe / Play 的同步、购买报告、删除账号）都在按用户的 Postgres advisory lock 里一次只做一个（`withUserBillingLock`，锁里重新读用户行，库操作走同一个事务连接）。所以并发的通知不会用旧状态盖掉新状态；两个页面同时结账，后一个会先让前一个的页面过期再检查订阅；等着结账的请求在删号之后拿到锁时，读不到用户行就放弃。

两个来源同时扣费时（例如 Play 订阅在保留期间用户又在网页买了，之后 Play 恢复），以用户行上记录的那份为准，另一份停掉：Stripe 的立即取消并把已付的账单退款（按支付加幂等键，只退一次），Play 的未确认就不确认（Google 退款），已确认就退款并终止（`revoke`）（`subscriptionAction` 的 `duplicate`）。Play 换购后的新令牌（`linkedPurchaseToken`），或过期后在 Play 商店重新购买（`outOfAppPurchaseContext.expiredPurchaseToken`）的新令牌，指向记录的旧令牌时算同一份订阅。

### 配置（Google Play）

环境变量（`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` 和 `GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT` 都设置才开放 App 内购买）：

```text
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  # 机密：服务账号 play-billing 的 JSON 密钥（整段）
GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT  # pubsub-push@studymate-511413.iam.gserviceaccount.com（Pub/Sub push 签名用的服务账号）
GOOGLE_PLAY_PUSH_AUDIENCE         # https://app.notefable.com/api/billing/google/notify（不设时用请求的地址）
GOOGLE_PLAY_PACKAGE_NAME          # 可选，默认 com.kakumine.notefable
GOOGLE_PLAY_PRODUCT_ID            # 可选，默认 notefable_pro
```

已经建好的（2026-11-17）：

- Play Console：App `NoteFable`（`com.kakumine.notefable`），已不再是草稿应用（2026-11-20 发布 1.0.12 至内部测试与 Alpha，当前 Alpha 为 1.0.14 / versionCode 24），之后的版本由 GitHub Actions 同时发布到内部测试和 Alpha（见 [android.md](android.md#正式签名与-google-play)）；订阅 `notefable_pro` 的基础方案 `monthly`（按月自动续订、宽限期 7 天、日本 ¥300，其他国家按汇率换算），已启用；上面有免费试用优惠 `free-trial-30d`（资格“新客户获取：没用过这个订阅”，30 天，已启用）；收益化设置里开了实时通知，主题 `projects/studymate-511413/topics/play-rtdn`。
- Play Console 用户：`play-billing@studymate-511413.iam.gserviceaccount.com`，权限“查看销售数据…”和“管理订单和订阅”。
- Google Cloud 项目 `studymate-511413`：开了 Google Play Android Developer API 和 Pub/Sub；服务账号 `play-billing`（JSON 密钥已下载，只放 Vercel）、`pubsub-push`（无密钥，Pub/Sub 服务代理有它的 Token Creator）；主题 `play-rtdn`（`google-play-developer-notifications@system.gserviceaccount.com` 是发布者）；push 订阅 `play-rtdn-push` → `https://app.notefable.com/api/billing/google/notify`，用 `pubsub-push` 做 OIDC 认证，audience 同地址。
- 测试：把测试账号加到“许可测试”，App 必须从 Play 的测试轨道安装（Drive 的 APK 不能购买）。
