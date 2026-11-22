# Play Console 表单答案

Play Console → 应用内容（App content）里各个声明的填写方式。依据是当前实现（[README.md](../../README.md)、[隐私政策](https://notefable.com/privacy)、[billing.md](../architecture/billing.md)）；改了收集或发送的数据后，同时改隐私政策和这里，再到 Console 更新声明。

## 隐私权政策

`https://notefable.com/privacy`

## 应用访问权限（App access）

"所有功能都无需特殊访问权限即可使用"：不登录也能使用聊天和笔记。登录只用于同步和购买 Pro，审核员不需要测试账号。Pro 只提高使用上限，不解锁别的功能。

## 广告

不包含广告。

## 内容分级（IARC 问卷）

- 类别：参考、新闻或教育（Reference, News, or Educational）。
- 暴力、性、粗俗语言、受管制物品、赌博：全部"否"。
- 用户之间互动 / 分享内容：否（没有公开分享、聊天室或协作）。
- 分享用户位置：否。
- 数字商品购买：是（Pro 月额订阅，走 Google Play 结算）。
- 应用含有 AI 生成内容：是。回答和图片由 OpenAI / Anthropic / DeepSeek 生成，经过各提供商的安全过滤；应用内可以举报回答（见下面"AI 生成内容"）。

预计分级：IARC 3+ / Everyone 或 12+（以问卷结果为准）。

## 目标受众和内容

- 目标年龄：18 岁及以上（也可勾 13–17、18+）。不面向 13 岁以下儿童（隐私政策第 8 节）。
- 不是"适合家庭"的应用，不加入"教师认可"计划。

## 新闻应用

否。

## 金融功能、健康、政府应用

都不是。

## 数据安全（Data safety）

总体：

| 问题 | 答案 |
| --- | --- |
| 是否收集或分享所需的用户数据类型 | 是 |
| 传输中的数据是否都经过加密 | 是（只走 HTTPS） |
| 是否提供让用户请求删除数据的方式 | 是：App 和网页的 设置 → 账号 → 删除账号；网址 https://notefable.com/delete-account |
| 账号创建方式 | 用户名和其他验证方式（邮箱验证码）＋ OAuth（Google）；可不建账号使用 |

收集的数据（全部"收集"，都**不**"分享"：发给 AI 提供商、Vercel、Neon、Resend、Stripe、Google 属于代表我们处理数据的服务提供商，按 Play 的定义不算分享）：

| 数据类型 | 是否可选 | 是否只在设备上临时处理 | 用途 |
| --- | --- | --- | --- |
| 个人信息 → 姓名 | 可选（Google 登录同步，或已登录用户在设置中自定义显示名） | 否 | 应用功能、账号管理 |
| 个人信息 → 电子邮件地址 | 可选（只在登录时） | 否 | 应用功能、账号管理 |
| 个人信息 → 用户 ID | 必需 | 否 | 应用功能、账号管理 |
| 财务信息 → 购买记录（订阅状态、期间、Google Play 购买令牌） | 可选（只在购买 Pro 时） | 否 | 应用功能、账号管理 |
| 照片和视频 → 照片 | 可选（用户自己添加的照片、头像） | 否 | 应用功能 |
| 文件和文档 | 可选（用户添加的文件） | 否 | 应用功能 |
| 应用活动 → 其他用户生成的内容（聊天消息、笔记、自定义指令） | 必需 | 否 | 应用功能 |
| 设备或其他 ID（随机的设备 Cookie） | 必需 | 否 | 应用功能、反欺诈 / 安全（匿名使用的每日额度） |

不收集：位置、通讯录、日历、健康、财务信息（购买记录以外：卡号等付款信息由 Google Play / Stripe 处理，服务端拿不到）、短信、通话、音频、网页浏览记录、应用使用分析、崩溃日志、广告 ID。

## 应用内购买（订阅）

- 商品：订阅 `notefable_pro`，基础方案 `monthly`（按月自动续订、宽限期 7 天、日本 ¥300，其他国家按汇率换算），附带首次订阅 30 天免费试用优惠 `free-trial-30d`（资格“新客户获取”）。服务端配置和测试方法见 [billing.md](../architecture/billing.md#androidgoogle-play-结算)。
- 订阅条款（价格、自动续订、解约、退款）写在 [服务条款](https://notefable.com/terms) 第 3 节和 [特定商取引法に基づく表記](https://notefable.com/legal-notice)；App 的购买窗口由 Play 显示价格和续订说明。
- 改价格、额度或解约规则时，同时改 `src/lib/usage-plans.ts`、重跑 `npx tsx scripts/gen-native-usage-limits.ts`（更新 Android/iOS 共用的 `assets/usage-limits.json`）、更新 `src/components/legal-page.tsx` 的 `LEGAL_UPDATED_ISO`（条款与特商法页面直接读取 `usage-plans.ts` 的数值，文案改动时一并修改）、[listing.md](listing.md) 和 Play Console 的商品。

## AI 生成内容

Google Play 的 AI 生成内容政策要求能在应用内举报冒犯性的 AI 内容。App 和网页的每条回答都有"举报"操作（三点菜单），提交后服务端把被举报的回答和理由发给开发者邮箱，不需要离开应用。

商店详情保存时的"AI 素材申告"（AI アセットの申告）选"不给素材加标签"：截图从 App 实际界面截取，外框用 HTML 模板生成；图标、置顶大图和角色都是代码绘制的矢量图，都没有用图片生成 AI。截图里出现的 AI 回答是 App 功能本身的画面。以后如果商店图片改用生成式 AI 制作或修改，改选"给 AI 素材加标签"，并逐张标注。

## 政府 ID、照片和视频权限

- 不申请 `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`：用系统照片选择器和文件选择器，只读用户选中的文件。
- `WRITE_EXTERNAL_STORAGE` 只在 Android 8–9（`maxSdkVersion=28`）用于把生成的图片存进相册。
- 没有前台服务、精确闹钟、无障碍、VPN、短信 / 通话等需要单独声明的权限。

## 发布前检查清单

已完成（2026-11-17）：开发者账号、创建应用（NoteFable，`com.kakumine.notefable`）、订阅商品 `notefable_pro` 的创建、RTDN 和服务端环境变量（见 [billing.md](../architecture/billing.md#配置google-play)）、商店文字和图片、隐私政策 / 服务条款 / 特商法页面里的订阅说明。

已完成（2026-11-20–22）：1.0.12（versionCode 22）起在内部测试和封闭测试（Alpha 轨道）完全发布，当前 Alpha 为 1.0.14（versionCode 24）；订阅 `notefable_pro` 的基础方案 `monthly` 与 30 天免费试用 `free-trial-30d` 已启用；Play Console 的应用内容声明和商店介绍已填写；封闭测试已于 2026-11-22 通过 Testers Community 启动（15 名测试人员，16 天，见 `AGENTS.md`）。之后提高 versionCode 的 PR 合入 main 时，GitHub Actions 自动同时发布到内部测试和 Alpha（见 [android.md](../architecture/android.md#正式签名与-google-play)），不用再手动上传 AAB。

剩下的（都要在 Play Console 上由所有者操作）：

1. ~~Play 应用签名~~：已完成（Google 生成的应用签名密钥，使用中）。首次上传 AAB 时选"使用 Google 生成的应用签名密钥"（`bundleRelease`，用上传密钥签名，见 [android.md](../architecture/android.md#正式签名与-google-play)）。每次上传前 `versionCode` 加 1。
2. ~~在 Google Cloud 新建 Android OAuth 客户端~~：已完成：`NoteFable-Android`（Play 应用签名的 SHA-1）是唯一的 Android 客户端，登记 debug 签名和上传密钥的旧客户端已删除（见 [android.md](../architecture/android.md#正式签名与-google-play)）。
3. ~~启用订阅 `notefable_pro` 的基础方案 `monthly`~~：已完成（连同 `free-trial-30d` 优惠一并启用）。
4. ~~填写应用内容声明与商店信息~~：已完成；后续改动文案或图片（见 [listing.md](listing.md) 和 `mobile/android/play-store/`）时再到 Console 同步。
5. 把测试账号加到"许可测试"，从测试轨道安装 App，真机走一遍：购买 → 报告（设置里变成 Pro）→ RTDN 到达 → 在 Play 里取消（到期前仍是 Pro）→ 删除账号停止续费。许可测试的订阅按几分钟一个周期续订，便于看续费和到期。
6. 封闭测试进行中（2026-11-22 启动，目标满足 12 名以上测试人员连续 14 天；期间按计划向 Alpha 发 2–3 次更新）。
7. 正式版：封闭测试满 14 天后在 Play Console（Reports → Production Access Report）申请正式版权限，选择国家 / 地区并提交审核。
