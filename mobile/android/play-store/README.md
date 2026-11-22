# Google Play 商店素材与发布说明

上传到 Play Console → 商店展示 → 主要商店详情。文字见 [docs/play-store/listing.md](../../../docs/play-store/listing.md)。

| 文件 | 用途 | 规格 |
| --- | --- | --- |
| `icon-512.png` | 应用图标 | 512×512 PNG，满版方形（Play 自己加圆角），与 `src/app/icon.svg` 同一图形 |
| `feature-graphic-1024x500.png` | 置顶大图 | 1024×500 PNG |
| `screenshots/01-…05-*.png` | 手机屏幕截图 | 1080×1920（9:16），按文件名顺序上传 |
| `release-notes.txt` | 版本说明（`whatsnew-en-US`） | UTF-8 纯文本；仅在发版 PR 修改该文件时由 `.github/workflows/android-release.yml` 随 AAB 上传 |

截图来自原生 App（`Medium_Phone_API_37` 模拟器，1080×2400，英文界面，演示账号的聊天和笔记），再放进带标题的手机外框里。外框模板是一个临时 HTML 页面（未入仓库），用 Chrome 无头模式截成 PNG。界面改版后重新截图：

1. 模拟器装 debug 包（`-Pnotefable.baseUrl=http://10.0.2.2:<端口> -Pnotefable.siteUrl=http://10.0.2.2:<端口>` 指向本机开发服务器；若截笔记编辑器，改用 `adb reverse` + `localhost`），用演示邮箱登录，准备聊天和笔记。
2. `adb exec-out screencap -p > shots/<名字>.png`（状态栏用系统 demo 模式固定时间和信号）。
3. 外框：标题区 + 800px 宽的手机，截图上方裁掉状态栏；本地准备 `frame.html` 后执行 `chrome --headless=new --window-size=1080,1920 --screenshot=… frame.html?s=<名字>&e=<小标题>&t=<标题>`。

Play 的截图长宽比不能超过 2:1，模拟器原图（20:9）不能直接上传。
