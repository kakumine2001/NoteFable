# Google Play 商店素材与发布说明

用 GitHub Actions 的 `Google Play store listing` 工作流写到 Google Play（图标、置顶大图和截图只传默认语言 en-US，见 [android.md](../../../docs/architecture/android.md#google-play-商店资料写入)）。文字见 [docs/play-store/listing.md](../../../docs/play-store/listing.md)。改图后运行 `python3 scripts/release/play-store-listing.py --check`。

| 文件 | 用途 | 规格 |
| --- | --- | --- |
| `icon-512.png` | 应用图标 | 512×512 PNG，满版方形（Play 自己加圆角），与 `src/app/icon.svg` 同一图形 |
| `feature-graphic-1024x500.png` | 置顶大图 | 1024×500 PNG |
| `screenshots/01-…07-*.png` | 手机屏幕截图 | 1080×1920（9:16），按文件名顺序上传 |
| `release-notes.txt` | 版本说明（`whatsnew-en-US`） | UTF-8 纯文本；仅在发版 PR 修改该文件时由 `.github/workflows/android-release.yml` 随 AAB 上传 |

截图来自原生 App（`Medium_Phone_API_37.0` 模拟器，1080×2400，英文界面，演示账号的聊天和工作区页面），再放进带标题的手机外框里。外框模板是一个临时 HTML 页面（未入仓库），用 Chrome 无头模式截成 PNG。界面改版后重新截图：

1. 模拟器装 debug 包（`-Pnotefable.baseUrl=http://10.0.2.2:<端口> -Pnotefable.siteUrl=http://10.0.2.2:<端口>` 指向本机开发服务器；截编辑器画面时（04 白板、05 幻灯片，各类页面的编辑器都是 WebView）改用 `adb reverse` + `localhost`），用演示邮箱登录，准备：
   - 几段聊天（01、02、06、07；06 是聊天上方打开的模型抽屉）；
   - 工作区页面：几篇笔记、一块插了思维导图模板的白板（04）、一套几页的幻灯片（05）；
   - 把其中两个页面加到收藏，让 03 的工作区首页看得到最近编辑、类型筛选和 Favorites。
2. `adb exec-out screencap -p > shots/<名字>.png`（状态栏用系统 demo 模式固定时间和信号）。
3. 外框：标题区 + 800px 宽的手机，截图上方裁掉状态栏（原图上方 109px）。底色 `#f7f6f2`，小标题 `#2383e2`、30px、字距 0.14em、全大写，标题 `#0f172a`、79px 粗体、字距 -0.045em，字体都是 Segoe UI Variable Display；手机从 (140, 520) 起，18px 的 `#111` 边框、圆角 70px，带柔和的阴影，下端超出画面。本地准备 `frame.html` 后执行 `chrome --headless=new --window-size=1080,1920 --screenshot=… frame.html?s=<名字>&e=<小标题>&t=<标题>`。

Play 的截图长宽比不能超过 2:1，模拟器原图（20:9）不能直接上传。

iOS 的 App Store 截图沿用这套标题和顺序（写在 `mobile/ios/scripts/ci-store-compose.sh`，对话内容在 iOS 的 `FixtureStoreData.swift`）：改这里的画面或标题时一起改。
