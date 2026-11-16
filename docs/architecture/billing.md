# 付费方案（Pro）与用量上限

NoteFable 的收费只有一种：月额订阅 **Pro**，每月 ¥300（税込）。目标是用订阅费大致抵消 API 费用，不追求利润。付款、解约、更换支付方式和收据都交给 Stripe（Checkout 与 Customer Portal），服务端只保存 Stripe 的客户 ID、订阅 ID 和订阅状态，不接触卡号。

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

改上限只改 `usage-plans.ts`，然后重新生成 Android 的 `assets/usage-limits.json`（`npx tsx scripts/gen-native-usage-limits.ts`）。

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
- Customer Portal：允许取消订阅、更新支付方式、查看收据。
- Billing → 订阅与邮件 → 重试用尽后：选“取消订阅”（不要选“保持逾期”，否则会一直是 Pro）。
- 日本的“特定商取引法に基づく表記”页面（Stripe 审核和日本法律都要求）还没做。

本地测试：用测试模式的密钥，`stripe listen --forward-to localhost:3000/api/billing/webhook` 拿到临时 `whsec_`，测试卡 `4242 4242 4242 4242`。

## Android

原生 App 的设置里显示方案和本期用量（`ui/PlanSettings.kt`，读 `GET /api/billing`），**没有购买和管理订阅的入口**：Google Play 要求 App 内的数字内容订阅走 Play 结算，不能引导到外部付款。服务端的上限提示句也因此不提“升级”，升级提示只在网页界面里。要在 App 内销售需要另接 Google Play Billing（未做，见 [android-native.md](android-native.md)）。
