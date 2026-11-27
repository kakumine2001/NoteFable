# App Store 审核信息

App Store Connect 里提交审核前要填、又能用 API 写入的内容：年龄分级问卷、审核备注、版权、订阅的显示名和描述、TestFlight 测试版说明。和商店文案（[listing.md](listing.md)）一起由 GitHub Actions 的 `iOS App Store listing` 工作流写入（默认 dry run，见 [ios.md](../architecture/ios.md#app-store-商店信息写入)）。依据是当前实现（[隐私政策](https://notefable.com/privacy)、[billing.md](../architecture/billing.md)、[Play Console 表单答案](../play-store/console-answers.md)）；改了功能、额度或发送的数据时同步改这里。

脚本按本文的结构读取：“年龄分级”的表格、“审核备注”“版权”“TestFlight 测试版说明”各一个 `text` 代码块、“订阅”的表格。改节标题或表格列时同时改 `scripts/release/ios-store-review.py`。改完运行 `python3 scripts/release/ios-store-listing.py --check`。仓库和 Actions 日志都是公开的：这里不写姓名、电话、邮箱、账号密码。

## 年龄分级

App Store Connect → App 信息 → 年龄分级。频率只用 `NONE`、`INFREQUENT`、`FREQUENT`。AI 能按要求写出和画出各种题材，Apple 要求把 AI 功能产生敏感内容的可能算进频率：App 自己没有内容过滤，靠 OpenAI / Anthropic / DeepSeek 的安全过滤，所以提供商允许的温和题材按 `INFREQUENT` 填，提供商拒绝的露骨内容按 `NONE`。`kidsAgeBand` 和各种分级覆盖项不写。

| 字段 | 值 | 依据 |
| --- | --- | --- |
| `advertising` | false | 没有广告和付费推广。 |
| `ageAssurance` | false | 没有年龄验证或年龄估计。 |
| `datingAndRelationships` | false | 没有交友功能。AI 角色只是可换的形象和动画，没有恋爱或性陪伴设定。 |
| `gambling` | false | 没有任何下注。 |
| `healthOrWellnessTopics` | true | 不是健康类 App，但向 AI 提问会得到饮食、运动、作息一类建议。 |
| `lootBox` | false | 没有随机内容的购买。 |
| `messagingAndChat` | false | 对话只在用户和 AI 之间，用户之间没有私信、群聊、评论或公开发帖区。 |
| `parentalControls` | false | 没有家长管理功能。 |
| `sharedLocation` | false | 不读取也不分享位置。 |
| `socialMedia` | false | 没有信息流、关注、推荐或公开目录。 |
| `socialMediaAgeRestricted` | false | 没有社交功能，也没有按年龄关闭功能。 |
| `unrestrictedWebAccess` | false | 没有内置浏览器。联网搜索由模型执行，结果是带来源的回答；链接在系统浏览器里打开。 |
| `userGeneratedContent` | true | 用户可以把笔记、白板、幻灯片发布成只读网页链接，拿到链接的人都能看。没有目录或推荐（页面设了 noindex）；按从严的理解填 true。 |
| `alcoholTobaccoOrDrugUseOrReferences` | INFREQUENT | 用户问到时，AI 回答可能提到烟酒和药物。 |
| `contests` | NONE | 没有比赛、排名或奖励。 |
| `gamblingSimulated` | NONE | 没有模拟赌博玩法。 |
| `gunsOrOtherWeapons` | INFREQUENT | 历史等学习话题的回答、联网结果或生成的图片里可能出现武器。 |
| `horrorOrFearThemes` | INFREQUENT | 用户要求写故事或画图时可能出现恐怖题材。 |
| `matureOrSuggestiveThemes` | INFREQUENT | 回答和联网结果可能涉及犯罪、战争、政治冲突等现实话题。 |
| `medicalOrTreatmentInformation` | INFREQUENT | 用户问到时，AI 会给出一般性的健康和医疗信息。 |
| `profanityOrCrudeHumor` | INFREQUENT | 用户要求时，AI 回答可能带粗话或低俗玩笑。 |
| `sexualContentGraphicAndNudity` | NONE | 露骨内容和裸露由提供商拒绝生成，App 不提供。 |
| `sexualContentOrNudity` | INFREQUENT | 恋爱故事、生理知识等不露骨的内容可能出现。 |
| `violenceCartoonOrFantasy` | INFREQUENT | 故事和生成的图片里可能有虚构打斗。 |
| `violenceRealistic` | INFREQUENT | 历史和时事话题可能描述现实暴力。 |
| `violenceRealisticProlongedGraphicOrSadistic` | NONE | 血腥、虐待性的内容由提供商拒绝生成。 |

## 审核备注

App Store 版本页 → App 审核信息 → 备注（上限 4000 字节）。只写备注；联系人姓名、电话、邮箱由所有者在 App Store Connect 里填，App 不登录就能用，所以没有演示账号。

```text
NoteFable is an AI study assistant: AI chat plus a Workspace for notes, slide decks and whiteboards.

NO ACCOUNT NEEDED
Chat and the Workspace work right after launch, so no demo account is provided. Daily and monthly limits apply to AI messages and image generations.

SIGNING IN (optional)
Sign in with Apple, Google or an email code. Signing in syncs data and is required to buy Pro.

IN-APP PURCHASE
NoteFable Pro is a monthly auto-renewing subscription (com.kakumine.notefable.pro.monthly). Sign in (Sign in with Apple works with your own Apple ID), then open Settings > Plan > Upgrade to Pro. The same screen has Restore Purchases and links to the Terms of Use and Privacy Policy. Pro raises the AI usage limits and file storage; it does not unlock other features.

AI CONTENT
Chat replies come from the OpenAI, Anthropic or DeepSeek model the user selects, and images come from OpenAI. These providers apply their own safety filters. Supported models can search the web; source links open in the browser. Users can report AI content inside the app: "Report answer" in the menu of an answer, "Report AI content" on AI page proposals and on pages the AI wrote.

SHARING
A user can publish a note, slide deck or whiteboard to a read-only web link and unpublish it at any time. There is no feed, directory, comments or messaging between users.

ACCOUNT DELETION
Settings > the account at the top > Delete account.

The app has no ads and does not use location.
```

## 版权

App Store 版本页 → 版权（版权符号由 Apple 自动加）。

```text
2026 NoteFable
```

## TestFlight 测试版说明

TestFlight → 测试信息 → Beta 版 App 描述（en-US）。反馈邮箱和联系人由所有者填。

```text
NoteFable is an AI study assistant with chat and a Workspace for notes, slide decks and whiteboards. You can try it without an account.

Please try asking questions, attaching photos or PDFs, saving answers as notes, building slides, drawing on whiteboards and searching your content. If you sign in, check that your chats and Workspace sync between your devices. Tell us about anything that is confusing or broken through TestFlight feedback.
```

## 订阅

已经建好的订阅组 NoteFable Pro 和月付商品 `com.kakumine.notefable.pro.monthly`（[billing.md](../architecture/billing.md#ios)）。工具只写这两项的显示名和描述，不创建订阅组或商品，不改价格和销售范围。显示名 2–30 字，描述最多 55 字。Apple 的帮助文档只给 App 内购买项目写了上限（[In-App Purchase information](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information)：显示名 2–30、描述 45），订阅的参考页没有写字数。订阅描述不适用 45（App Store Connect 已经收下 51 字的英文描述）；55 是订阅本地化表单的计数器上限，来自[第三方的实测记录](https://github.com/AhmedOsman00/terraform-provider-apple/issues/22)，不是 Apple 的文档。同一记录说订阅显示名可到 35，这里仍按 30。英语、简体中文、繁体中文、日语的订阅显示名和描述是 App Store Connect 上已经填好的原文，不要改写；其他语言照它们的写法。描述写 Pro 每月的消息数、图片数和存储容量（`src/lib/usage-plans.ts`），改上限时一起改；图片的每日上限写不下，完整数字在商店描述和 App 里。没有草稿版本、而已批准或被拒的版本要改文字时，工具建一个新的草稿元数据版本，之后由所有者送审。不写价格和试用（App Store 自己显示）。语言名与 [listing.md](listing.md) 的节标题相同。

| 语言 | 订阅组显示名 | 订阅显示名 | 订阅描述 |
| --- | --- | --- | --- |
| English (U.S.) | NoteFable Pro | NoteFable Pro Monthly | 2,000 messages, 60 images/month, and 10 GB storage. |
| Chinese (Simplified) | NoteFable Pro | NoteFable Pro 月度订阅 | 每月 2,000 条消息、60 张图片与 10 GB 存储空间。 |
| Chinese (Traditional) | NoteFable Pro | NoteFable Pro 月度訂閱 | 每月 2,000 則訊息、60 張圖片與 10 GB 儲存空間。 |
| Japanese | NoteFable Pro | NoteFable Pro 月額プラン | 月2,000件のメッセージ、60枚の画像、10 GBの保存容量。 |
| Korean | NoteFable Pro | NoteFable Pro 월간 구독 | 월 메시지 2,000개, 이미지 60개, 저장 공간 10 GB. |
| Spanish (Mexico) / Spanish (Spain) | NoteFable Pro | NoteFable Pro mensual | 2000 mensajes y 60 imágenes al mes, 10 GB de espacio. |
| French | NoteFable Pro | NoteFable Pro mensuel | 2 000 messages, 60 images/mois et 10 GB de stockage. |
| German | NoteFable Pro | NoteFable Pro Monatsabo | 2.000 Nachrichten, 60 Bilder/Monat, 10 GB Speicher. |
| Portuguese (Brazil) | NoteFable Pro | NoteFable Pro mensal | 2.000 mensagens, 60 imagens/mês e 10 GB de espaço. |
| Italian | NoteFable Pro | NoteFable Pro mensile | 2.000 messaggi, 60 immagini al mese e 10 GB di spazio. |
| Indonesian | NoteFable Pro | NoteFable Pro Bulanan | 2.000 pesan, 60 gambar per bulan, penyimpanan 10 GB. |
| Vietnamese | NoteFable Pro | NoteFable Pro hằng tháng | 2.000 tin nhắn, 60 hình ảnh/tháng và 10 GB lưu trữ. |
| Thai | NoteFable Pro | NoteFable Pro รายเดือน | 2,000 ข้อความ 60 รูปต่อเดือน และพื้นที่ 10 GB |
| Hindi | NoteFable Pro | NoteFable Pro मासिक प्लान | हर महीने 2,000 संदेश, 60 इमेज और 10 GB स्टोरेज। |
| Arabic | NoteFable Pro | NoteFable Pro الشهري | 2,000 رسالة و60 صورة شهريًا، وتخزين 10 GB. |
| Turkish | NoteFable Pro | NoteFable Pro Aylık | Ayda 2.000 mesaj, 60 görsel ve 10 GB depolama. |
| Russian | NoteFable Pro | NoteFable Pro на месяц | 2000 сообщений, 60 изображений в месяц, 10 GB места. |

## 需要所有者确认

这些是按现状从严填的，所有者可以改上面的表再运行工作流：

- `userGeneratedContent`：只读链接算不算 Apple 说的“大范围分发”没有明确答案。填 true 不抬高分级，但审核可能按指南 1.2 要求过滤、举报、拉黑和联系方式；公开页面目前没有举报入口。
- 各项频率：Apple 没有给 AI 助手单独的问题和频率标准。`medicalOrTreatmentInformation` 和 `sexualContentOrNudity` 填 `INFREQUENT` 预计让分级到 13+ 左右（以 App Store Connect 算出的结果为准）。
- `healthOrWellnessTopics`：App 没有健康功能，只因为 AI 会回答这类问题而填 true。
- `sexualContentGraphicAndNudity` 和 `violenceRealisticProlongedGraphicOrSadistic` 填 `NONE`，这两项不确定：只靠 OpenAI / Anthropic / DeepSeek 自己的过滤（强度没有实测），App 没有内容过滤；用户上传的图片、文件和自己写的文字完全不经过滤，也能出现在公开只读链接里。
- Play 的内容分级问卷对暴力、性、粗俗语言等全部填“否”（[console-answers.md](../play-store/console-answers.md)），和这里的口径不同。

## 工具不写的项目

由所有者在 App Store Connect 里处理：内容版权声明（Content Rights，法律声明）、App 审核联系人和反馈邮箱、价格与销售范围、订阅的价格、销售范围和审核截图、App 隐私、DSA 交易者身份、协议、银行和税务信息、选构建、提交审核（第一个订阅要和 App 版本一起送审）。工具运行时的只读检查会列出其中 API 能看到的缺项。
