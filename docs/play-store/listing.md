# Google Play 商店信息

Play Console → 发布 → 商店展示 → 主要商店详情。默认语言用 English (United States)，翻译覆盖 App 的全部界面语言：简体中文（zh-CN）、繁体中文（zh-TW）、日语（ja-JP）、韩语（ko-KR）、西班牙语（es-419 和 es-ES 用同一份）、法语（fr-FR）、德语（de-DE）、葡萄牙语（pt-BR）、意大利语（it-IT）、印尼语（id）、越南语（vi）、泰语（th）、印地语（hi-IN）、阿拉伯语（ar）、土耳其语（tr-TR）、俄语（ru-RU）。字数上限：应用名 30，简短说明 80，完整说明 4000。图片在 `mobile/android/play-store/`（[README](../../mobile/android/play-store/README.md)）。App Store 的文案在 [docs/app-store/listing.md](../app-store/listing.md)，完整说明沿用这里的文字（登录同步那条和价格段在那边另写）。拼出的 App Store 描述比这里长，同样限 4000：改应用名或完整说明后运行 `python3 scripts/release/ios-store-listing.py --check`。

内容只写已经上线的功能（见 [README.md](../../README.md)）；改了功能或额度后同步改这里。Play Console 分批同步这里的内容，不是每次改动后马上同步（见 `AGENTS.md`）。

同步到 Google Play：GitHub Actions 的 `Google Play store listing` 工作流按本文和 `mobile/android/play-store/` 写入（先 dry run 看差异，再勾选 apply；apply 即送审，托管发布关闭时审核通过就上线，见 [android.md](../architecture/android.md#google-play-商店资料写入)）。分批同步的时机不变（见上一段和 `AGENTS.md`）。脚本按本文的结构读取：每个语言一节，标题末尾括号里是 Play 语言代码（共用一份的用逗号分开，如 es-419, es-ES），节里依次是应用名、简短说明（各和标签同一行）、完整说明（标签下面的全部文字）；增删语言时同时改 `scripts/release/play-store-listing.py` 的 `LANGUAGES`。改完运行 `python3 scripts/release/play-store-listing.py --check`。“其他字段”表里的内容工作流不写，仍在 Console 里手动填。

定位：AI 对话 + 工作区（Workspace：笔记、幻灯片、白板）。应用名是 “AI Chat & Workspace”，30 字放不下的语言（德、印尼、越、泰、阿、土、俄）用“AI 工作区”；工作区的叫法和 App 里一致。notes 等搜索词由简短说明和完整说明带出，并写清三种页面。

## English (en-US)

**App name**: NoteFable: AI Chat & Workspace

**Short description**: Chat with AI and keep what you learn in notes, slides and whiteboards.

**Full description**:

NoteFable puts AI chat and your Workspace in one place. Keep answers as notes, build slide decks and think on whiteboards, so what you learn doesn't get lost in a chat history.

ASK ANYTHING
• Chat with several AI models (OpenAI GPT, Anthropic Claude and DeepSeek) and pick how hard each one thinks.
• Built-in web search automatically pulls in up-to-date answers with sources when needed (supported models).
• Attach photos, PDFs and text files and ask about them.
• Create and edit images from a text description.

KEEP IT IN YOUR WORKSPACE
• Save any answer as a note, or turn a whole chat into a page.
• Notes: a clean block editor with headings, lists, to-dos, code, math equations, images and files.
• Slide decks with layouts, themes, text, math, images and shapes: present full screen, write speaker notes, export to PDF or PowerPoint, or share a link to view them. Any note can be presented as slides, too.
• Whiteboards for free-form thinking: draw, add sticky notes, shapes, arrows and images, mark up PDF pages, and share a read-only link.
• Mind maps and study templates on whiteboards: Cornell notes, timeline, Venn diagram and comparison table.
• Organize everything with projects, sub-pages, favorites and emoji icons.
• Link pages with @, see what links to each note, and publish notes to the web with a read-only link.
• Edit history and a trash bin, so nothing is lost by accident.
• Import Markdown files as notes, and export any note as Markdown.
• Embed live whiteboards or frames right in your notes, and insert whiteboard frames into slides with manual refresh.

LET AI HELP
• Attach notes, slides or whiteboards to a chat and the AI reads them as context.
• Ask the AI to rewrite or extend a note, or to edit slides or a whiteboard: it proposes the change, and you decide whether to apply it.
• Let the AI draw an answer or a note as an editable diagram on a whiteboard.
• Let the AI make a slide deck from a topic, your notes or a chat; you can edit the outline first.
• Turn a whiteboard sketch into a polished image with AI.
• Projects keep related chats together with shared instructions and reference pages.
• Custom instructions tell NoteFable about you and how you like your answers.
• Pick an AI character companion—or upload your own icon—for chat and your Workspace.

FIND IT AGAIN
• Search across all your chats, notes, slides and whiteboards at once.

WORKS EVERYWHERE
• Try it without an account. Sign in with Google or an email code to keep your chats and Workspace in sync between the app and notefable.com.
• Light and dark mode: follow your system or pick one.
• Available in English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe and Русский.

Free to use with daily and monthly limits on AI messages and images, and 500 MB of file storage when signed in. Need more? NoteFable Pro (monthly subscription, cancel anytime) raises the limits to 2,000 messages and 60 images a month (up to 10 images a day) and storage to 10 GB, and your first 30 days are free. No ads.

Privacy policy: https://notefable.com/privacy

## 简体中文 (zh-CN)

**应用名称**：NoteFable：AI 对话与工作区

**简短说明**：和 AI 对话，把学到的东西存进笔记、幻灯片和白板。

**完整说明**：

NoteFable 把 AI 对话和你的工作区放在一起：把回答存成笔记，做幻灯片，在白板上整理思路，学到的东西不会埋没在聊天记录里。

随时提问
• 可以和多个 AI 模型对话（OpenAI GPT、Anthropic Claude、DeepSeek），还能选择思考强度。
• 支持的模型会在需要时自动联网搜索，提供带来源的最新回答。
• 添加照片、PDF 和文本文件，直接针对内容提问。
• 用文字描述生成或修改图片。

存进工作区
• 把回答存为笔记，或把整段对话整理成一页笔记。
• 笔记：简洁的块编辑器，支持标题、列表、待办、代码、数学公式、图片和文件。
• 幻灯片：版式、主题、文字、公式、图片和形状；全屏放映，添加演讲备注，导出 PDF 或 PowerPoint，也能分享放映链接。任何笔记也都能直接当幻灯片放映。
• 白板：自由地画，贴便签，放形状、箭头和图片，在 PDF 页面上批注，还能分享只读链接。
• 白板支持思维导图和学习模板：康奈尔笔记、时间线、韦恩图、对比表。
• 用项目、子页面、收藏和表情图标整理全部内容。
• 用 @ 链接页面，查看链接到笔记的页面和对话，还能把笔记发布成只读链接。
• 编辑历史和回收站，误删也能找回。
• 把 Markdown 文件导入成笔记，也可以把笔记导出为 Markdown。
• 在笔记中直接嵌入实时白板或单个框，也可将白板框插入幻灯片并随时手动刷新。

让 AI 帮忙
• 把笔记、幻灯片或白板添加到对话里，AI 会把它们作为参考内容。
• 让 AI 改写或扩充笔记、修改幻灯片或白板：AI 先提出修改建议，由你决定是否应用。
• 让 AI 把回答或笔记画成白板上可编辑的图。
• 让 AI 根据主题、笔记或对话生成幻灯片，生成前可以修改大纲。
• 用 AI 把白板草图变成图片。
• 项目把相关的对话放在一起，共用指示和参考页面。
• 自定义指令：告诉 NoteFable 你是谁、希望它怎样回答。
• 选择喜欢的 AI 角色形象（或上传自己的图标），陪伴你聊天和使用工作区。

随时找回
• 一次搜索全部对话、笔记、幻灯片和白板。

多端同步
• 不注册也能直接试用。用 Google 或邮箱验证码登录后，对话和工作区在 App 和 notefable.com 之间同步。
• 支持浅色和深色模式，可跟随系统或自行选择。
• 支持 English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Italiano、Bahasa Indonesia、Tiếng Việt、ไทย、हिन्दी、العربية、Türkçe、Русский。

免费使用，AI 消息和图片有每天、每月的使用上限，登录后有 500 MB 文件存储空间。需要更多可以订阅 NoteFable Pro（按月订阅，随时可以取消），每月可用 2,000 条消息和 60 张图片（每天最多 10 张），存储空间增至 10 GB，首次订阅前 30 天免费。没有广告。

隐私政策：https://notefable.com/privacy

## 繁體中文 (zh-TW)

**應用程式名稱**：NoteFable：AI 對話與工作區

**簡短說明**：和 AI 對話，把學到的東西存進筆記、投影片和白板。

**完整說明**：

NoteFable 把 AI 對話和你的工作區放在一起：把回答存成筆記，做投影片，在白板上整理思緒，學到的東西不會埋沒在聊天紀錄裡。

隨時提問
• 可以和多個 AI 模型對話（OpenAI GPT、Anthropic Claude、DeepSeek），還能選擇思考強度。
• 支援的模型會在需要時自動進行網路搜尋，提供附來源的最新回答。
• 加入照片、PDF 和文字檔，直接針對內容提問。
• 用文字描述產生或修改圖片。

存進工作區
• 把回答存成筆記，或把整段對話整理成一頁筆記。
• 筆記：簡潔的區塊編輯器，支援標題、清單、待辦、程式碼、數學公式、圖片和檔案。
• 投影片：版面、主題、文字、公式、圖片和形狀；全螢幕放映，新增演講備註，匯出 PDF 或 PowerPoint，也能分享放映連結。任何筆記也都能直接當投影片放映。
• 白板：自由地畫，貼便利貼，放形狀、箭頭和圖片，在 PDF 頁面上批註，還能分享唯讀連結。
• 白板支援心智圖和學習模板：康奈爾筆記、時間線、韋恩圖、對比表。
• 用專案、子頁面、收藏和表情符號圖示整理全部內容。
• 用 @ 連結頁面，查看連結到筆記的頁面和對話，還能把筆記發布成唯讀連結。
• 編輯紀錄和垃圾桶，誤刪也能找回。
• 把 Markdown 檔案匯入成筆記，也可以把筆記匯出為 Markdown。
• 在筆記中直接嵌入即時白板或單個框，也可將白板框插入投影片並隨時手動重新整理。

讓 AI 幫忙
• 把筆記、投影片或白板加入對話，AI 會把它們當作參考內容。
• 讓 AI 改寫或擴充筆記、修改投影片或白板：AI 先提出修改建議，由你決定是否套用。
• 讓 AI 把回答或筆記畫成白板上可編輯的圖。
• 讓 AI 根據主題、筆記或對話生成投影片，生成前可以修改大綱。
• 用 AI 把白板草圖變成圖片。
• 專案把相關的對話放在一起，共用指示和參考頁面。
• 自訂指示：告訴 NoteFable 你是誰、希望它怎麼回答。
• 選擇喜歡的 AI 角色形象（或上傳自己的圖示），陪伴你聊天與使用工作區。

隨時找回
• 一次搜尋全部對話、筆記、投影片和白板。

多裝置同步
• 不註冊也能直接試用。用 Google 或電子郵件驗證碼登入後，對話和工作區會在 App 和 notefable.com 之間同步。
• 支援淺色與深色模式，可跟隨系統或自行選擇。
• 支援 English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Italiano、Bahasa Indonesia、Tiếng Việt、ไทย、हिन्दी、العربية、Türkçe、Русский。

免費使用，AI 訊息和圖片有每天、每月的使用上限，登入後有 500 MB 檔案儲存空間。需要更多可以訂閱 NoteFable Pro（按月訂閱，隨時可以取消），每月可使用 2,000 則訊息和 60 張圖片（每天最多 10 張），儲存空間增至 10 GB，首次訂閱前 30 天免費。沒有廣告。

隱私權政策：https://notefable.com/privacy

## 日本語 (ja-JP)

**アプリ名**：NoteFable：AIチャット＆ワークスペース

**簡単な説明**：AIとチャットして、学んだことをノート・スライド・ホワイトボードにまとめられる。

**詳しい説明**：

NoteFable は AI チャットとワークスペースをひとつにまとめたアプリです。答えをノートに残し、スライドを作り、ホワイトボードで考えを整理できるので、学んだことがチャット履歴に埋もれません。

なんでも質問
• 複数の AI モデル（OpenAI GPT、Anthropic Claude、DeepSeek）とチャットでき、考える深さも選べます。
• 対応モデルが必要なときに自動で Web 検索を行い、出典つきの最新の回答を届けます。
• 写真・PDF・テキストファイルを添付して、その内容について質問できます。
• テキストから画像を生成・編集できます。

ワークスペースに残す
• 回答をノートとして保存。チャット全体を 1 ページにまとめることもできます。
• ノート：見出し・リスト・ToDo・コード・数式・画像・ファイルが使えるシンプルなブロックエディタ。
• スライド：レイアウト・テーマ・テキスト・数式・画像・図形。全画面で発表し、発表者ノートを書いたり、PDF や PowerPoint に書き出したり、リンクで共有したりできます。どのノートもそのままスライドとして発表できます。
• ホワイトボード：自由に描いて、付箋・図形・矢印・画像を置き、PDF のページに書き込み、閲覧専用のリンクで共有できます。
• ホワイトボードでマインドマップや学習テンプレート（コーネルノート、タイムライン、ベン図、比較表）が使えます。
• プロジェクト・サブページ・お気に入り・絵文字アイコンですべてを整理。
• @ でページ同士をリンクし、ノートへのバックリンクを確認。ノートは閲覧専用リンクで公開もできます。
• 編集履歴とゴミ箱があるので、うっかり消しても戻せます。
• Markdown ファイルをノートとして読み込み、ノートを Markdown で書き出せます。
• ホワイトボード全体やフレームをノートに埋め込め、スライドにもホワイトボードの枠を挿入して手動で更新できます。

AI が手伝う
• ノート・スライド・ホワイトボードをチャットに添付すると、AI がそれを参考にして答えます。
• ノートの書き直しや追記、スライドやホワイトボードの編集を頼むと、AI が変更を提案し、適用するかはあなたが決めます。
• 回答やノートを、AI がホワイトボード上の編集できる図として描きます。
• テーマ・ノート・チャットから AI がスライドを作ります。作る前に構成を直せます。
• ホワイトボードのスケッチを AI で画像にできます。
• プロジェクトで関連するチャットをまとめ、共通の指示と参考ページを設定できます。
• カスタム指示で、自分のことや回答の好みを伝えられます。
• 好みの AI キャラクターを選ぶか自分のアイコンをアップロードして、チャットやワークスペースで使えます。

すぐに見つかる
• すべてのチャット・ノート・スライド・ホワイトボードをまとめて検索。

どこでも使える
• アカウントなしですぐに試せます。Google またはメールの確認コードでログインすると、チャットとワークスペースがアプリと notefable.com で同期されます。
• ライトモードとダークモードに対応。システム設定に合わせるか、好きなほうを選べます。
• English・简体中文・繁體中文・日本語・한국어・Español・Français・Deutsch・Português (Brasil)・Italiano・Bahasa Indonesia・Tiếng Việt・ไทย・हिन्दी・العربية・Türkçe・Русскийに対応。

無料で使えます（AI メッセージと画像には 1 日・1 か月の上限があり、ログインするとファイルを 500 MB まで保存できます）。もっと使いたい方は NoteFable Pro（月額サブスクリプション、いつでも解約可）で、1 か月にメッセージ 2,000 件・画像 60 枚まで（1 日 10 枚まで）使え、保存容量は 10 GB になります。初めての方は最初の 30 日間無料です。広告はありません。

プライバシーポリシー：https://notefable.com/privacy

## 한국어 (ko-KR)

**앱 이름**: NoteFable: AI 채팅 & 워크스페이스

**간단한 설명**: AI와 대화하고, 배운 것을 노트·슬라이드·화이트보드에 남기세요.

**자세한 설명**:

NoteFable은 AI 채팅과 워크스페이스를 한곳에 모았습니다. 답변을 노트로 남기고, 슬라이드를 만들고, 화이트보드에서 생각을 정리하세요. 배운 내용이 채팅 기록에 묻히지 않아요.

무엇이든 질문하기
• 여러 AI 모델(OpenAI GPT, Anthropic Claude, DeepSeek)과 대화하고, 모델마다 얼마나 깊이 생각할지 고를 수 있어요.
• 필요할 때 웹 검색이 자동으로 실행되어 출처가 있는 최신 답변을 알려 줍니다(지원 모델).
• 사진, PDF, 텍스트 파일을 첨부하고 그 내용에 대해 질문하세요.
• 텍스트 설명으로 이미지를 만들고 편집할 수 있어요.

워크스페이스에 남기기
• 답변을 노트로 저장하거나, 채팅 전체를 한 페이지로 정리하세요.
• 노트: 제목, 목록, 할 일, 코드, 수식, 이미지, 파일을 쓸 수 있는 깔끔한 블록 편집기.
• 슬라이드: 레이아웃, 테마, 텍스트, 수식, 이미지, 도형. 발표자 노트를 작성하고 전체 화면으로 발표하며, PDF나 PowerPoint로 내보내거나 링크로 공유할 수 있어요. 어떤 노트든 그대로 슬라이드로 발표할 수도 있어요.
• 화이트보드: 자유롭게 그리고, 메모지·도형·화살표·이미지를 놓고, PDF 페이지에 필기하고, 보기 전용 링크로 공유할 수 있어요.
• 화이트보드에서 마인드맵과 학습 템플릿(코넬 노트, 타임라인, 벤 다이어그램, 비교표)을 쓸 수 있어요.
• 프로젝트, 하위 페이지, 즐겨찾기, 이모지 아이콘으로 모든 것을 정리하세요.
• @로 페이지를 링크해 노트의 백링크를 확인하고, 노트를 보기 전용 링크로 게시할 수도 있어요.
• 편집 기록과 휴지통이 있어 실수로 지워도 되살릴 수 있어요.
• Markdown 파일을 노트로 가져오고, 어떤 노트든 Markdown으로 내보낼 수 있어요.
• 화이트보드 전체나 프레임을 노트에 바로 삽입하고, 슬라이드에도 화이트보드 프레임을 넣어 필요할 때 새로고침할 수 있어요.

AI가 도와줘요
• 노트, 슬라이드, 화이트보드를 채팅에 첨부하면 AI가 그 내용을 참고해 답해요.
• 노트를 다시 쓰거나 보충하거나 슬라이드나 화이트보드를 편집해 달라고 하면 AI가 변경안을 제안하고, 적용할지는 직접 결정해요.
• 답변이나 노트를 AI가 화이트보드 위에 편집할 수 있는 다이어그램으로 그려 줘요.
• 주제, 노트, 채팅으로 AI가 슬라이드를 만들어 줘요. 생성 전에 개요를 고칠 수 있어요.
• 화이트보드에 그린 스케치를 AI가 이미지로 바꿔 줘요.
• 프로젝트로 관련 채팅을 모으고 공통 지침과 참고 페이지를 설정할 수 있어요.
• 맞춤 지침으로 나에 대한 정보와 원하는 답변 방식을 알려 주세요.
• 마음에 드는 AI 캐릭터를 고르거나 직접 아이콘을 올려 채팅과 워크스페이스에서 쓸 수 있어요.

다시 찾기
• 모든 채팅, 노트, 슬라이드, 화이트보드를 한 번에 검색하세요.

어디서나 사용
• 계정 없이 바로 써 볼 수 있어요. Google 또는 이메일 인증 코드로 로그인하면 앱과 notefable.com 사이에서 채팅과 워크스페이스가 동기화됩니다.
• 라이트 모드와 다크 모드: 시스템 설정을 따르거나 직접 고르세요.
• 지원 언어: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

무료로 쓸 수 있으며 AI 메시지와 이미지에는 일일·월간 한도가 있고, 로그인하면 파일 저장 공간 500 MB를 쓸 수 있어요. 더 필요하다면 NoteFable Pro(월 구독, 언제든 해지 가능)로 한도가 한 달 메시지 2,000개, 이미지 60개(하루 최대 10개)까지 늘어나고 저장 공간은 10 GB가 되며, 처음 30일은 무료예요. 광고는 없습니다.

개인정보처리방침: https://notefable.com/privacy

## Español (es-419, es-ES)

**Nombre de la app**: NoteFable: chat IA y Espacio

**Descripción breve**: Chatea con IA y guarda lo que aprendes en notas, presentaciones y pizarras.

**Descripción completa**:

NoteFable reúne el chat con IA y tu Espacio en un solo lugar. Guarda respuestas como notas, crea presentaciones y piensa en pizarras, para que lo que aprendes no se pierda en el historial de chats.

PREGUNTA LO QUE QUIERAS
• Chatea con varios modelos de IA (OpenAI GPT, Anthropic Claude y DeepSeek) y elige cuánto razona cada uno.
• La búsqueda web integrada aporta respuestas actualizadas con fuentes cuando hace falta (modelos compatibles).
• Adjunta fotos, PDF y archivos de texto y pregunta sobre ellos.
• Crea y edita imágenes a partir de una descripción.

GUÁRDALO EN TU ESPACIO
• Guarda cualquier respuesta como nota o convierte un chat completo en una página.
• Notas: un editor de bloques limpio con títulos, listas, tareas, código, ecuaciones, imágenes y archivos.
• Presentaciones con diseños, temas, texto, ecuaciones, imágenes y formas: presenta a pantalla completa, añade notas del orador, exporta a PDF o PowerPoint, o comparte un enlace para verlas. Cualquier nota también se puede presentar como diapositivas.
• Pizarras para pensar con libertad: dibuja, añade notas adhesivas, formas, flechas e imágenes, anota páginas de PDF y comparte un enlace de solo lectura.
• Mapas mentales y plantillas de estudio en las pizarras: notas Cornell, línea de tiempo, diagrama de Venn y tabla comparativa.
• Organízalo todo con proyectos, subpáginas, favoritos e iconos emoji.
• Enlaza páginas con @, mira qué enlaza a cada nota y publica notas con un enlace de solo lectura.
• Historial de ediciones y papelera, para que nada se pierda por error.
• Importa archivos Markdown como notas y exporta cualquier nota en Markdown.
• Incrusta pizarras o marcos en vivo en tus notas e inserta marcos de pizarra en presentaciones con actualización manual.

DEJA QUE LA IA TE AYUDE
• Adjunta notas, presentaciones o pizarras a un chat y la IA las usa como contexto.
• Pide a la IA que reescriba o amplíe una nota, o que edite presentaciones o una pizarra: propone el cambio y tú decides si aplicarlo.
• Deja que la IA dibuje una respuesta o una nota como un diagrama editable en una pizarra.
• Deja que la IA cree presentaciones a partir de un tema, tus notas o un chat; antes revisas el esquema.
• Convierte un boceto de la pizarra en una imagen con IA.
• Los proyectos agrupan chats relacionados con instrucciones y páginas de referencia compartidas.
• Las instrucciones personalizadas le cuentan a NoteFable quién eres y cómo prefieres las respuestas.
• Elige un personaje de IA, o sube tu propio icono, para el chat y tu Espacio.

ENCUÉNTRALO DE NUEVO
• Busca en todos tus chats, notas, presentaciones y pizarras a la vez.

FUNCIONA EN TODAS PARTES
• Pruébalo sin cuenta. Inicia sesión con Google o con un código por correo para sincronizar tus chats y tu Espacio entre la app y notefable.com.
• Modo claro y oscuro: sigue el sistema o elige uno.
• Disponible en English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Uso gratuito con límites diarios y mensuales de mensajes e imágenes de IA, y 500 MB de almacenamiento para tus archivos al iniciar sesión. ¿Necesitas más? NoteFable Pro (suscripción mensual, cancela cuando quieras) sube los límites a 2.000 mensajes y 60 imágenes al mes (hasta 10 imágenes al día) y el almacenamiento a 10 GB, y los primeros 30 días son gratis. Sin anuncios.

Política de privacidad: https://notefable.com/privacy

## Français (fr-FR)

**Nom de l'application**: NoteFable : chat IA et Espace

**Description courte**: Discutez avec l'IA et gardez vos acquis en notes, présentations et tableaux.

**Description complète**:

NoteFable réunit chat IA et Espace au même endroit. Gardez vos réponses en notes, créez des présentations et pensez sur des tableaux blancs pour ne rien perdre dans l'historique.

POSEZ VOS QUESTIONS
• Discutez avec plusieurs modèles d'IA (OpenAI GPT, Anthropic Claude et DeepSeek) et choisissez leur niveau de réflexion.
• Recherche web intégrée avec sources à jour si besoin (modèles compatibles).
• Joignez des photos, des PDF et des fichiers texte, et posez des questions dessus.
• Créez et modifiez des images à partir d'une description.

GARDEZ TOUT DANS VOTRE ESPACE
• Enregistrez une réponse en note ou transformez une conversation en page.
• Notes : éditeur par blocs (titres, listes, tâches, code, équations, images, fichiers).
• Des présentations avec mises en page, thèmes, texte, équations, images et formes : présentez en plein écran, ajoutez des notes du présentateur, exportez en PDF ou PowerPoint, ou partagez un lien pour les consulter. Toute note peut aussi être présentée sous forme de diapositives.
• Des tableaux blancs pour réfléchir librement : dessinez, ajoutez des notes adhésives, des formes, des flèches et des images, annotez des pages PDF et partagez un lien en lecture seule.
• Cartes mentales et modèles d'étude sur les tableaux : notes Cornell, frise chronologique, diagramme de Venn et tableau comparatif.
• Organisez tout avec des projets, des sous-pages, des favoris et des icônes emoji.
• Liez des pages avec @, voyez ce qui renvoie à une note et publiez-la avec un lien en lecture seule.
• Historique des modifications et corbeille : rien ne se perd par erreur.
• Importez et exportez vos notes en Markdown.
• Intégrez tableaux blancs et cadres dans vos notes, ou des cadres actualisables dans vos présentations.

L'IA VOUS AIDE
• Joignez des notes, des présentations ou des tableaux blancs à une conversation : l'IA s'en sert comme contexte.
• Demandez à l'IA de réécrire ou de compléter une note, ou de modifier des présentations ou un tableau blanc : elle propose la modification, vous décidez de l'appliquer.
• Laissez l'IA dessiner une réponse ou une note sous forme de schéma modifiable sur un tableau blanc.
• Laissez l'IA créer des présentations à partir d'un sujet, de notes ou d'une conversation ; vous relisez d'abord le plan.
• Transformez un croquis du tableau en image avec l'IA.
• Les projets regroupent les conversations liées avec des instructions et des pages de référence communes.
• Les instructions personnalisées indiquent à NoteFable qui vous êtes et comment vous aimez les réponses.
• Choisissez un personnage IA, ou importez votre propre icône, pour le chat et votre Espace.

RETROUVEZ TOUT
• Recherchez dans toutes vos conversations, notes, présentations et tableaux blancs à la fois.

PARTOUT
• Essayez sans compte. Connectez-vous avec Google ou un code reçu par e-mail pour synchroniser vos conversations et votre Espace entre l'application et notefable.com.
• Mode clair et sombre : suivez le système ou choisissez.
• Disponible en English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Gratuit, avec des limites quotidiennes et mensuelles sur les messages et images IA, et 500 MB de stockage pour vos fichiers une fois connecté. Besoin de plus ? NoteFable Pro (abonnement mensuel, résiliable à tout moment) porte les limites à 2 000 messages et 60 images par mois (jusqu'à 10 images par jour) et le stockage à 10 GB, et les 30 premiers jours sont offerts. Sans publicité.

Politique de confidentialité : https://notefable.com/privacy

## Deutsch (de-DE)

**App-Name**: NoteFable: KI-Arbeitsbereich

**Kurzbeschreibung**: Mit KI chatten und Gelerntes in Notizen, Folien und Whiteboards festhalten.

**Vollständige Beschreibung**:

NoteFable bringt KI-Chat und deinen Arbeitsbereich an einen Ort. Halte Antworten als Notizen fest, erstelle Präsentationen und denk auf Whiteboards weiter, damit dein Wissen nicht im Chatverlauf verloren geht.

FRAG, WAS DU WILLST
• Chatte mit mehreren KI-Modellen (OpenAI GPT, Anthropic Claude und DeepSeek) und wähle, wie gründlich jedes nachdenkt.
• Die integrierte Websuche liefert bei Bedarf automatisch aktuelle Antworten mit Quellen (unterstützte Modelle).
• Hänge Fotos, PDFs und Textdateien an und stelle Fragen dazu.
• Erstelle und bearbeite Bilder anhand einer Beschreibung.

ALLES IN DEINEM ARBEITSBEREICH
• Speichere jede Antwort als Notiz oder mache aus einem ganzen Chat eine Seite.
• Notizen: ein übersichtlicher Block-Editor mit Überschriften, Listen, To-dos, Code, Formeln, Bildern und Dateien.
• Präsentationen mit Layouts, Designs, Text, Formeln, Bildern und Formen: im Vollbild präsentieren, Sprechernotizen hinzufügen, als PDF oder PowerPoint exportieren oder per Link teilen. Jede Notiz lässt sich auch als Folien präsentieren.
• Whiteboards zum freien Denken: zeichnen, Haftnotizen, Formen, Pfeile und Bilder hinzufügen, PDF-Seiten beschriften und einen schreibgeschützten Link teilen.
• Mindmaps und Lernvorlagen auf Whiteboards: Cornell-Notizen, Zeitleiste, Venn-Diagramm, Vergleichstabelle.
• Ordne alles mit Projekten, Unterseiten, Favoriten und Emoji-Symbolen.
• Verlinke Seiten mit @, sieh Rückverweise und veröffentliche Notizen per schreibgeschütztem Link.
• Bearbeitungsverlauf und Papierkorb, damit nichts versehentlich verloren geht.
• Importiere Markdown-Dateien als Notizen und exportiere jede Notiz als Markdown.
• Bette Live-Whiteboards oder Rahmen direkt in Notizen ein und füge Whiteboard-Rahmen mit manueller Aktualisierung in Folien ein.

LASS DIR VON DER KI HELFEN
• Hänge Notizen, Präsentationen oder Whiteboards an einen Chat an, und die KI nutzt sie als Kontext.
• Bitte die KI, eine Notiz umzuschreiben oder zu ergänzen oder Folien oder ein Whiteboard zu bearbeiten: Sie schlägt die Änderung vor, und du entscheidest, ob sie übernommen wird.
• Lass die KI eine Antwort oder Notiz als bearbeitbares Diagramm auf ein Whiteboard zeichnen.
• Lass die KI aus einem Thema, Notizen oder einem Chat eine Präsentation erstellen; die Gliederung prüfst du vorher.
• Verwandle eine Whiteboard-Skizze mit KI in ein Bild.
• Projekte bündeln zusammengehörige Chats mit gemeinsamen Anweisungen und Referenzseiten.
• Mit eigenen Anweisungen erzählst du NoteFable, wer du bist und wie du Antworten magst.
• Wähle eine KI-Figur als Begleiter – oder lade dein eigenes Symbol hoch – für Chat und Arbeitsbereich.

SCHNELL WIEDERFINDEN
• Durchsuche alle Chats, Notizen, Präsentationen und Whiteboards auf einmal.

ÜBERALL NUTZBAR
• Ohne Konto ausprobieren. Melde dich mit Google oder einem Code per E-Mail an, um Chats und Arbeitsbereich zwischen App und notefable.com zu synchronisieren.
• Heller und dunkler Modus: wie im System oder selbst gewählt.
• Verfügbar auf English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Kostenlos nutzbar mit täglichen und monatlichen Limits für KI-Nachrichten und -Bilder und 500 MB Speicherplatz für deine Dateien, wenn du angemeldet bist. Du brauchst mehr? NoteFable Pro (Monatsabo, jederzeit kündbar) erhöht die Limits auf 2.000 Nachrichten und 60 Bilder im Monat (bis zu 10 Bilder pro Tag) und den Speicherplatz auf 10 GB, und die ersten 30 Tage sind kostenlos. Keine Werbung.

Datenschutzerklärung: https://notefable.com/privacy

## Português (pt-BR)

**Nome do app**: NoteFable: chat IA e Espaço

**Descrição curta**: Converse com IA e guarde o que aprende em notas, slides e quadros brancos.

**Descrição completa**:

O NoteFable reúne o chat com IA e o seu Espaço em um só lugar. Guarde respostas como notas, monte apresentações e pense em quadros brancos, para que o que você aprende não se perca no histórico de conversas.

PERGUNTE O QUE QUISER
• Converse com vários modelos de IA (OpenAI GPT, Anthropic Claude e DeepSeek) e escolha o quanto cada um pensa.
• A busca na web integrada traz respostas atualizadas com fontes quando necessário (modelos compatíveis).
• Anexe fotos, PDFs e arquivos de texto e faça perguntas sobre eles.
• Crie e edite imagens a partir de uma descrição.

GUARDE TUDO NO SEU ESPAÇO
• Salve qualquer resposta como nota ou transforme uma conversa inteira em uma página.
• Notas: um editor de blocos simples com títulos, listas, tarefas, código, equações, imagens e arquivos.
• Apresentações com layouts, temas, texto, equações, imagens e formas: apresente em tela cheia, adicione notas do apresentador, exporte para PDF ou PowerPoint ou compartilhe um link para visualizá-las. Qualquer nota também pode ser apresentada como slides.
• Quadros brancos para pensar livremente: desenhe, adicione notas adesivas, formas, setas e imagens, anote páginas de PDF e compartilhe um link somente leitura.
• Mapas mentais e modelos de estudo nos quadros brancos: notas Cornell, linha do tempo, diagrama de Venn e tabela comparativa.
• Organize tudo com projetos, subpáginas, favoritos e ícones de emoji.
• Vincule páginas com @, veja o que aponta para cada nota e publique notas com um link somente leitura.
• Histórico de edições e lixeira, para nada se perder por engano.
• Importe arquivos Markdown como notas e exporte qualquer nota em Markdown.
• Incorpore quadros brancos ou quadros ao vivo nas suas notas e insira quadros em slides com atualização manual.

DEIXE A IA AJUDAR
• Anexe notas, apresentações ou quadros brancos a uma conversa e a IA usa o conteúdo como contexto.
• Peça à IA para reescrever ou ampliar uma nota, ou para editar slides ou um quadro branco: ela sugere a mudança e você decide se aplica.
• Deixe a IA desenhar uma resposta ou uma nota como um diagrama editável em um quadro branco.
• Deixe a IA criar apresentações a partir de um tema, notas ou conversa; antes, você ajusta o roteiro.
• Transforme um esboço do quadro branco em imagem com IA.
• Projetos reúnem conversas relacionadas com instruções e páginas de referência em comum.
• Instruções personalizadas contam ao NoteFable quem você é e como prefere as respostas.
• Escolha um personagem de IA, ou envie seu próprio ícone, para o chat e o seu Espaço.

ENCONTRE DE NOVO
• Pesquise em todas as suas conversas, notas, apresentações e quadros brancos de uma vez.

FUNCIONA EM TODO LUGAR
• Experimente sem conta. Entre com o Google ou com um código por e-mail para sincronizar conversas e o seu Espaço entre o app e o notefable.com.
• Modo claro e escuro: siga o sistema ou escolha um.
• Disponível em English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Uso gratuito com limites diários e mensais de mensagens e imagens de IA, e 500 MB de armazenamento para seus arquivos ao entrar na conta. Precisa de mais? O NoteFable Pro (assinatura mensal, cancele quando quiser) aumenta os limites para 2.000 mensagens e 60 imagens por mês (até 10 imagens por dia) e o armazenamento para 10 GB, e os primeiros 30 dias são grátis. Sem anúncios.

Política de privacidade: https://notefable.com/privacy

## Italiano (it-IT)

**Nome dell'app**: NoteFable: chat IA e Spazio

**Descrizione breve**: Chatta con l'IA e conserva ciò che impari in note, presentazioni e lavagne.

**Descrizione completa**:

NoteFable riunisce la chat con l'IA e il tuo Spazio in un unico posto. Conserva le risposte come note, crea presentazioni e ragiona sulle lavagne, così ciò che impari non si perde nella cronologia delle chat.

CHIEDI QUALSIASI COSA
• Chatta con diversi modelli di IA (OpenAI GPT, Anthropic Claude e DeepSeek) e scegli quanto ragiona ciascuno.
• La ricerca web integrata fornisce risposte aggiornate con le fonti quando serve (modelli supportati).
• Allega foto, PDF e file di testo e fai domande sul loro contenuto.
• Crea e modifica immagini a partire da una descrizione.

TUTTO NEL TUO SPAZIO
• Salva qualsiasi risposta come nota, o trasforma un'intera chat in una pagina.
• Note: un editor a blocchi pulito con titoli, elenchi, attività, codice, equazioni, immagini e file.
• Presentazioni con layout, temi, testo, formule, immagini e forme: presenta a schermo intero, aggiungi le note del relatore, esporta in PDF o PowerPoint o condividi un link per vederle. Ogni nota si può anche presentare come diapositive.
• Lavagne per pensare liberamente: disegna, aggiungi note adesive, forme, frecce e immagini, annota pagine PDF e condividi un link di sola lettura.
• Mappe mentali e modelli di studio sulle lavagne: note Cornell, linea del tempo, diagramma di Venn, tabella di confronto.
• Organizza tutto con progetti, sottopagine, preferiti e icone emoji.
• Collega le pagine con @, vedi cosa rimanda a ogni nota e pubblica le note con un link di sola lettura.
• Cronologia delle modifiche e cestino, così niente va perso per errore.
• Importa file Markdown come note ed esporta qualsiasi nota in Markdown.
• Incorpora lavagne o riquadri in tempo reale nelle note e inserisci riquadri nelle presentazioni con aggiornamento manuale.

LASCIATI AIUTARE DALL'IA
• Allega note, presentazioni o lavagne a una chat e l'IA le usa come contesto.
• Chiedi all'IA di riscrivere o ampliare una nota, o di modificare diapositive o una lavagna: propone la modifica e decidi tu se applicarla.
• Lascia che l'IA disegni una risposta o una nota come diagramma modificabile su una lavagna.
• Lascia che l'IA crei presentazioni da un argomento, dalle note o da una chat; prima rivedi la scaletta.
• Trasforma uno schizzo della lavagna in un'immagine con l'IA.
• I progetti raccolgono le chat correlate con istruzioni e pagine di riferimento condivise.
• Le istruzioni personalizzate dicono a NoteFable chi sei e come preferisci le risposte.
• Scegli un personaggio IA, o carica la tua icona, per la chat e il tuo Spazio.

RITROVA TUTTO
• Cerca in tutte le chat, note, presentazioni e lavagne in una volta.

FUNZIONA OVUNQUE
• Provalo senza account. Accedi con Google o con un codice via email per sincronizzare chat e Spazio tra l'app e notefable.com.
• Modalità chiara e scura: segui il sistema o scegline una.
• Disponibile in English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Gratuito con limiti giornalieri e mensili per messaggi e immagini IA, e 500 MB di spazio per i tuoi file quando accedi. Ti serve di più? NoteFable Pro (abbonamento mensile, disdici quando vuoi) porta i limiti a 2.000 messaggi e 60 immagini al mese (fino a 10 immagini al giorno) e lo spazio a 10 GB, e i primi 30 giorni sono gratuiti. Nessuna pubblicità.

Informativa sulla privacy: https://notefable.com/privacy

## Bahasa Indonesia (id)

**Nama aplikasi**: NoteFable: Ruang Kerja AI

**Deskripsi singkat**: Chat dengan AI dan simpan yang Anda pelajari di catatan, slide, dan papan tulis.

**Deskripsi lengkap**:

NoteFable menyatukan chat AI dan Ruang kerja Anda di satu tempat. Simpan jawaban sebagai catatan, buat presentasi, dan susun ide di papan tulis, sehingga apa yang Anda pelajari tidak tenggelam di riwayat chat.

TANYA APA SAJA
• Chat dengan beberapa model AI (OpenAI GPT, Anthropic Claude, dan DeepSeek) dan pilih seberapa dalam masing-masing berpikir.
• Penelusuran web bawaan otomatis memberi jawaban terbaru beserta sumbernya saat diperlukan (model yang didukung).
• Lampirkan foto, PDF, dan file teks, lalu tanyakan isinya.
• Buat dan edit gambar dari deskripsi teks.

SIMPAN DI RUANG KERJA
• Simpan jawaban sebagai catatan, atau ubah seluruh chat menjadi satu halaman.
• Catatan: editor blok yang rapi dengan judul, daftar, tugas, kode, persamaan, gambar, dan file.
• Presentasi dengan tata letak, tema, teks, rumus, gambar, dan bentuk: presentasikan layar penuh, tambahkan catatan pembicara, ekspor ke PDF atau PowerPoint, atau bagikan tautan untuk melihatnya. Catatan apa pun juga bisa dipresentasikan sebagai slide.
• Papan tulis untuk berpikir bebas: menggambar, menambahkan catatan tempel, bentuk, panah, dan gambar, membuat catatan di halaman PDF, serta membagikan tautan hanya-baca.
• Peta pikiran dan template belajar di papan tulis: catatan Cornell, linimasa, diagram Venn, tabel perbandingan.
• Atur semuanya dengan proyek, subhalaman, favorit, dan ikon emoji.
• Tautkan halaman dengan @, lihat tautan balik tiap catatan, dan publikasikan catatan lewat tautan hanya-baca.
• Riwayat edit dan tempat sampah, jadi tidak ada yang hilang karena salah hapus.
• Impor file Markdown sebagai catatan, dan ekspor catatan apa pun sebagai Markdown.
• Sematkan papan tulis atau bingkai langsung di catatan, dan sisipkan bingkai papan tulis ke slide dengan pembaruan manual.

BIARKAN AI MEMBANTU
• Lampirkan catatan, presentasi, atau papan tulis ke chat dan AI memakainya sebagai konteks.
• Minta AI menulis ulang atau melengkapi catatan, atau mengedit slide maupun papan tulis: AI mengusulkan perubahan, Anda yang memutuskan untuk menerapkannya.
• Biarkan AI menggambar jawaban atau catatan sebagai diagram yang bisa diedit di papan tulis.
• Biarkan AI membuat presentasi dari topik, catatan, atau chat; kerangkanya bisa Anda edit dulu.
• Ubah sketsa di papan tulis menjadi gambar dengan AI.
• Proyek mengelompokkan chat terkait dengan instruksi dan halaman referensi bersama.
• Instruksi khusus memberi tahu NoteFable tentang Anda dan gaya jawaban yang Anda sukai.
• Pilih karakter AI, atau unggah ikon Anda sendiri, untuk chat dan Ruang kerja.

TEMUKAN KEMBALI
• Cari di semua chat, catatan, presentasi, dan papan tulis sekaligus.

BISA DI MANA SAJA
• Coba tanpa akun. Masuk dengan Google atau kode email untuk menyinkronkan chat dan Ruang kerja antara aplikasi dan notefable.com.
• Mode terang dan gelap: ikuti sistem atau pilih sendiri.
• Tersedia dalam English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Gratis digunakan dengan batas harian dan bulanan untuk pesan dan gambar AI, serta penyimpanan file 500 MB setelah masuk. Perlu lebih? NoteFable Pro (langganan bulanan, bisa dibatalkan kapan saja) menaikkan batas menjadi 2.000 pesan dan 60 gambar per bulan (hingga 10 gambar per hari) dan penyimpanan menjadi 10 GB, dan 30 hari pertama gratis. Tanpa iklan.

Kebijakan privasi: https://notefable.com/privacy

## Tiếng Việt (vi)

**Tên ứng dụng**: NoteFable: Không gian AI

**Mô tả ngắn**: Trò chuyện với AI và lưu những gì bạn học vào ghi chú, trình chiếu, bảng trắng.

**Mô tả đầy đủ**:

NoteFable gom chat AI và Không gian của bạn về một nơi. Lưu câu trả lời thành ghi chú, tạo bản trình chiếu và sắp xếp ý tưởng trên bảng trắng, để những gì bạn học không bị chìm trong lịch sử trò chuyện.

HỎI BẤT CỨ ĐIỀU GÌ
• Trò chuyện với nhiều mô hình AI (OpenAI GPT, Anthropic Claude và DeepSeek) và chọn mức độ suy nghĩ của từng mô hình.
• Tìm kiếm web tích hợp tự động mang lại câu trả lời mới nhất kèm nguồn khi cần (các mô hình được hỗ trợ).
• Đính kèm ảnh, PDF và tệp văn bản rồi hỏi về nội dung.
• Tạo và chỉnh sửa hình ảnh từ mô tả bằng chữ.

LƯU VÀO KHÔNG GIAN
• Lưu câu trả lời thành ghi chú, hoặc biến cả cuộc trò chuyện thành một trang.
• Ghi chú: trình soạn thảo khối gọn gàng với tiêu đề, danh sách, việc cần làm, mã, công thức toán, hình ảnh và tệp.
• Bản trình chiếu với bố cục, chủ đề, văn bản, công thức, hình ảnh và hình khối: trình chiếu toàn màn hình, thêm ghi chú của người thuyết trình, xuất ra PDF hoặc PowerPoint, hoặc chia sẻ liên kết để xem. Mọi ghi chú cũng có thể trình chiếu như slide.
• Bảng trắng để suy nghĩ tự do: vẽ, thêm ghi chú dán, hình, mũi tên và hình ảnh, ghi chú lên trang PDF và chia sẻ liên kết chỉ xem.
• Sơ đồ tư duy và mẫu học tập trên bảng trắng: ghi chú Cornell, dòng thời gian, biểu đồ Venn, bảng so sánh.
• Sắp xếp mọi thứ bằng dự án, trang con, mục yêu thích và biểu tượng emoji.
• Liên kết trang bằng @, xem liên kết ngược của ghi chú và xuất bản ghi chú qua liên kết chỉ xem.
• Lịch sử chỉnh sửa và thùng rác, để không mất gì vì lỡ tay.
• Nhập tệp Markdown thành ghi chú và xuất bất kỳ ghi chú nào ra Markdown.
• Nhúng trực tiếp bảng trắng hoặc khung vào ghi chú và chèn khung bảng trắng vào bản trình chiếu với nút làm mới thủ công.

ĐỂ AI GIÚP BẠN
• Đính kèm ghi chú, bản trình chiếu hoặc bảng trắng vào cuộc trò chuyện và AI dùng chúng làm ngữ cảnh.
• Nhờ AI viết lại hoặc bổ sung ghi chú, hay chỉnh sửa bản trình chiếu hoặc bảng trắng: AI đề xuất thay đổi, bạn quyết định có áp dụng hay không.
• Để AI vẽ câu trả lời hoặc ghi chú thành sơ đồ có thể chỉnh sửa trên bảng trắng.
• Để AI tạo bản trình chiếu từ chủ đề, ghi chú hoặc cuộc trò chuyện; bạn sửa dàn ý trước.
• Biến phác thảo trên bảng trắng thành hình ảnh bằng AI.
• Dự án gom các cuộc trò chuyện liên quan với chỉ dẫn và trang tham khảo chung.
• Chỉ dẫn tùy chỉnh cho NoteFable biết về bạn và cách bạn muốn được trả lời.
• Chọn một nhân vật AI, hoặc tải lên biểu tượng của riêng bạn, cho chat và Không gian.

TÌM LẠI DỄ DÀNG
• Tìm kiếm trong mọi cuộc trò chuyện, ghi chú, bản trình chiếu và bảng trắng cùng lúc.

DÙNG Ở MỌI NƠI
• Dùng thử không cần tài khoản. Đăng nhập bằng Google hoặc mã qua email để đồng bộ chat và Không gian giữa ứng dụng và notefable.com.
• Chế độ sáng và tối: theo hệ thống hoặc tự chọn.
• Hỗ trợ English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Miễn phí với giới hạn hằng ngày và hằng tháng cho tin nhắn và hình ảnh AI, cùng 500 MB lưu trữ tệp khi đăng nhập. Cần nhiều hơn? NoteFable Pro (gói tháng, hủy bất cứ lúc nào) nâng giới hạn lên 2.000 tin nhắn và 60 hình ảnh mỗi tháng (tối đa 10 hình ảnh mỗi ngày) và dung lượng lưu trữ lên 10 GB, và 30 ngày đầu miễn phí. Không có quảng cáo.

Chính sách quyền riêng tư: https://notefable.com/privacy

## ไทย (th)

**ชื่อแอป**: NoteFable: พื้นที่ทำงาน AI

**คำอธิบายแบบย่อ**: แชทกับ AI แล้วเก็บสิ่งที่ได้เรียนไว้ในโน้ต สไลด์ และไวท์บอร์ด

**คำอธิบายแบบเต็ม**:

NoteFable รวมแชท AI และพื้นที่ทำงานของคุณไว้ในที่เดียว เก็บคำตอบเป็นโน้ต สร้างชุดสไลด์ และเรียบเรียงความคิดบนไวท์บอร์ด สิ่งที่คุณเรียนรู้จะไม่จมหายไปในประวัติแชท

ถามได้ทุกเรื่อง
• แชทกับโมเดล AI หลายตัว (OpenAI GPT, Anthropic Claude และ DeepSeek) และเลือกได้ว่าแต่ละตัวจะคิดลึกแค่ไหน
• การค้นหาเว็บในตัวจะดึงคำตอบล่าสุดพร้อมแหล่งที่มาให้อัตโนมัติเมื่อจำเป็น (เฉพาะโมเดลที่รองรับ)
• แนบรูปภาพ PDF และไฟล์ข้อความ แล้วถามเกี่ยวกับเนื้อหาได้เลย
• สร้างและแก้ไขรูปภาพจากคำอธิบาย

เก็บไว้ในพื้นที่ทำงาน
• บันทึกคำตอบเป็นโน้ต หรือเปลี่ยนแชททั้งหมดเป็นหนึ่งหน้า
• โน้ต: ตัวแก้ไขแบบบล็อกที่เรียบง่าย มีหัวข้อ รายการ สิ่งที่ต้องทำ โค้ด สมการ รูปภาพ และไฟล์
• ชุดสไลด์พร้อมเลย์เอาต์ ธีม ข้อความ สมการ รูปภาพ และรูปร่าง นำเสนอแบบเต็มจอ เพิ่มบันทึกผู้บรรยาย ส่งออกเป็น PDF หรือ PowerPoint หรือแชร์ลิงก์ให้ผู้อื่นดู โน้ตใดก็นำเสนอเป็นสไลด์ได้ทันที
• ไวท์บอร์ดสำหรับคิดอย่างอิสระ: วาดได้ตามใจ เพิ่มโน้ตแปะ รูปทรง ลูกศร และรูปภาพ เขียนกำกับบนหน้า PDF และแชร์ลิงก์แบบดูอย่างเดียว
• แผนผังความคิดและเทมเพลตการเรียนบนไวท์บอร์ด: บันทึกแบบคอร์เนลล์ ไทม์ไลน์ แผนภาพเวนน์ ตารางเปรียบเทียบ
• จัดระเบียบทุกอย่างด้วยโปรเจกต์ หน้าย่อย รายการโปรด และไอคอนอีโมจิ
• ลิงก์หน้าด้วย @ ดูลิงก์ย้อนกลับของโน้ต และเผยแพร่โน้ตด้วยลิงก์แบบดูอย่างเดียว
• มีประวัติการแก้ไขและถังขยะ ไม่ต้องกลัวลบผิด
• นำเข้าไฟล์ Markdown เป็นโน้ต และส่งออกโน้ตใดก็ได้เป็น Markdown
• ฝังไวท์บอร์ดหรือกรอบแบบเรียลไทม์ลงในโน้ต และแทรกกรอบไวท์บอร์ดลงในสไลด์พร้อมรีเฟรชเองได้ทุกเมื่อ

ให้ AI ช่วย
• แนบโน้ต ชุดสไลด์ หรือไวท์บอร์ดเข้าแชท แล้ว AI จะใช้เป็นบริบทในการตอบ
• ขอให้ AI เขียนใหม่หรือเพิ่มเติมโน้ต หรือแก้ไขสไลด์และไวท์บอร์ด: AI จะเสนอการเปลี่ยนแปลง และคุณเป็นคนตัดสินใจว่าจะใช้หรือไม่
• ให้ AI วาดคำตอบหรือโน้ตออกมาเป็นแผนภาพที่แก้ไขได้บนไวท์บอร์ด
• ให้ AI สร้างชุดสไลด์จากหัวข้อ โน้ต หรือแชท โดยแก้โครงร่างก่อนได้
• เปลี่ยนภาพร่างบนไวท์บอร์ดเป็นรูปภาพด้วย AI
• โปรเจกต์รวมแชทที่เกี่ยวข้องกันไว้ พร้อมคำสั่งและหน้าอ้างอิงที่ใช้ร่วมกัน
• คำสั่งที่กำหนดเองช่วยบอก NoteFable ว่าคุณเป็นใครและชอบคำตอบแบบไหน
• เลือกตัวละคร AI หรืออัปโหลดไอคอนของคุณเองสำหรับแชทและพื้นที่ทำงาน

ค้นหาได้ทุกเมื่อ
• ค้นหาในแชท โน้ต ชุดสไลด์ และไวท์บอร์ดทั้งหมดได้ในครั้งเดียว

ใช้ได้ทุกที่
• ลองใช้ได้โดยไม่ต้องมีบัญชี ลงชื่อเข้าใช้ด้วย Google หรือรหัสทางอีเมลเพื่อซิงค์แชทและพื้นที่ทำงานระหว่างแอปกับ notefable.com
• โหมดสว่างและโหมดมืด: ตามระบบหรือเลือกเอง
• รองรับ English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский

ใช้ฟรีโดยมีขีดจำกัดรายวันและรายเดือนสำหรับข้อความและรูปภาพ AI และมีพื้นที่เก็บไฟล์ 500 MB เมื่อลงชื่อเข้าใช้ ต้องการมากกว่านี้? NoteFable Pro (สมัครรายเดือน ยกเลิกได้ทุกเมื่อ) เพิ่มขีดจำกัดเป็น 2,000 ข้อความและ 60 รูปต่อเดือน (สูงสุด 10 รูปต่อวัน) และพื้นที่เก็บไฟล์เป็น 10 GB และใช้ฟรี 30 วันแรก ไม่มีโฆษณา

นโยบายความเป็นส่วนตัว: https://notefable.com/privacy

## हिन्दी (hi-IN)

**ऐप का नाम**: NoteFable: AI चैट व वर्कस्पेस

**छोटा विवरण**: AI से चैट करें और सीखी बातें नोट्स, स्लाइड और व्हाइटबोर्ड में रखें।

**पूरा विवरण**:

NoteFable AI चैट और आपके वर्कस्पेस को एक ही जगह रखता है। जवाबों को नोट्स में सहेजें, स्लाइड डेक बनाएँ और व्हाइटबोर्ड पर अपने विचार व्यवस्थित करें, ताकि आपने जो सीखा वह चैट हिस्ट्री में खो न जाए।

कुछ भी पूछें
• कई AI मॉडल (OpenAI GPT, Anthropic Claude और DeepSeek) से चैट करें और चुनें कि हर मॉडल कितना गहराई से सोचे।
• ज़रूरत पड़ने पर बिल्ट-इन वेब सर्च अपने-आप स्रोतों के साथ ताज़ा जवाब लाता है (समर्थित मॉडल)।
• फ़ोटो, PDF और टेक्स्ट फ़ाइलें जोड़ें और उनके बारे में सवाल पूछें।
• टेक्स्ट में बताकर इमेज बनाएं और बदलें।

वर्कस्पेस में सहेजें
• किसी भी जवाब को नोट के रूप में सहेजें, या पूरी चैट को एक पेज बना दें।
• नोट्स: हेडिंग, सूची, टू-डू, कोड, गणित के समीकरण, इमेज और फ़ाइलों वाला साफ़-सुथरा ब्लॉक एडिटर।
• लेआउट, थीम, टेक्स्ट, गणितीय सूत्र, इमेज और आकृतियों वाले स्लाइड डेक: फ़ुल स्क्रीन में प्रस्तुत करें, वक्ता नोट्स जोड़ें, PDF या PowerPoint में एक्सपोर्ट करें, या देखने के लिए लिंक शेयर करें। किसी भी नोट को सीधे स्लाइड की तरह भी प्रस्तुत किया जा सकता है।
• खुलकर सोचने के लिए व्हाइटबोर्ड: ड्रॉ करें, स्टिकी नोट, आकृतियाँ, तीर और छवियाँ जोड़ें, PDF पेजों पर निशान लगाएँ और केवल देखने वाला लिंक साझा करें।
• व्हाइटबोर्ड पर माइंड मैप और पढ़ाई के टेम्पलेट: कॉर्नेल नोट्स, टाइमलाइन, वेन आरेख, तुलना तालिका।
• प्रोजेक्ट, सब-पेज, पसंदीदा और इमोजी आइकन से सब कुछ व्यवस्थित करें।
• @ से पेज लिंक करें, नोट के बैकलिंक देखें और नोट को केवल देखने वाले लिंक से प्रकाशित करें।
• एडिट हिस्ट्री और ट्रैश, ताकि गलती से कुछ न खोए।
• Markdown फ़ाइलों को नोट्स के रूप में इंपोर्ट करें और किसी भी नोट को Markdown में एक्सपोर्ट करें।
• नोट्स में लाइव व्हाइटबोर्ड या फ़्रेम एम्बेड करें, और स्लाइड में व्हाइटबोर्ड फ़्रेम जोड़कर ज़रूरत पर रिफ़्रेश करें।

AI से मदद लें
• नोट्स, स्लाइड डेक या व्हाइटबोर्ड को चैट में जोड़ें, AI उन्हें संदर्भ के रूप में पढ़ता है।
• AI से किसी नोट को दोबारा लिखने या बढ़ाने, या स्लाइड डेक या व्हाइटबोर्ड को संपादित करने को कहें: वह बदलाव सुझाता है और लागू करना है या नहीं, यह आप तय करते हैं।
• AI से किसी जवाब या नोट को व्हाइटबोर्ड पर एडिट करने लायक डायग्राम के रूप में बनवाएँ।
• AI से किसी विषय, नोट्स या चैट पर स्लाइड डेक बनवाएँ; रूपरेखा पहले आप ठीक करें।
• व्हाइटबोर्ड के स्केच को AI से इमेज में बदलें।
• प्रोजेक्ट मिलती-जुलती चैट को साझा निर्देशों और संदर्भ पेज के साथ एक जगह रखते हैं।
• कस्टम निर्देशों से NoteFable को बताएं कि आप कौन हैं और कैसे जवाब पसंद करते हैं।
• चैट और वर्कस्पेस के लिए कोई AI किरदार चुनें या अपना आइकन अपलोड करें।

फिर से ढूंढें
• अपनी सभी चैट, नोट्स, स्लाइड डेक और व्हाइटबोर्ड में एक साथ खोजें।

हर जगह काम करे
• बिना खाते के आज़माएं। ऐप और notefable.com के बीच चैट और वर्कस्पेस सिंक करने के लिए Google या ईमेल कोड से साइन इन करें।
• लाइट और डार्क मोड: सिस्टम के हिसाब से या खुद चुनें।
• उपलब्ध भाषाएं: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский।

AI संदेशों और इमेज की दैनिक और मासिक सीमाओं के साथ मुफ़्त, और साइन इन करने पर फ़ाइलों के लिए 500 MB स्टोरेज। और चाहिए? NoteFable Pro (मासिक सदस्यता, कभी भी रद्द करें) सीमा को हर महीने 2,000 संदेश और 60 इमेज (रोज़ 10 इमेज तक) तक और स्टोरेज को 10 GB तक बढ़ाता है, और पहले 30 दिन मुफ़्त हैं। कोई विज्ञापन नहीं।

गोपनीयता नीति: https://notefable.com/privacy

## العربية (ar)

**اسم التطبيق**: NoteFable: مساحة عمل AI

**الوصف المختصر**: تحدّث مع الذكاء الاصطناعي واحفظ ما تتعلمه في ملاحظات وشرائح وسبورات.

**الوصف الكامل**:

يجمع NoteFable دردشة الذكاء الاصطناعي ومساحة العمل في مكان واحد. احفظ الإجابات كملاحظات، وأنشئ مجموعات شرائح، ورتّب أفكارك على السبورات، فلا يضيع ما تتعلمه في سجل المحادثات.

اسأل عن أي شيء
• تحدّث مع عدة نماذج ذكاء اصطناعي (OpenAI GPT وAnthropic Claude وDeepSeek) واختر مدى عمق تفكير كل منها.
• يجلب البحث المدمج على الويب تلقائيًا إجابات حديثة مع مصادرها عند الحاجة (النماذج المدعومة).
• أرفق صورًا وملفات PDF وملفات نصية واسأل عن محتواها.
• أنشئ الصور وعدّلها من وصف نصي.

احفظه في مساحة العمل
• احفظ أي إجابة كملاحظة، أو حوّل محادثة كاملة إلى صفحة.
• الملاحظات: محرر كتل بسيط يدعم العناوين والقوائم والمهام والشيفرات والمعادلات والصور والملفات.
• مجموعات شرائح بتخطيطات وسمات ونصوص ومعادلات وصور وأشكال: اعرضها بملء الشاشة، وأضف ملاحظات المتحدث، أو صدّرها بصيغة PDF أو PowerPoint، أو شارك رابطًا لعرضها. ويمكن أيضًا عرض أي ملاحظة كشرائح.
• سبورات للتفكير بحرية: ارسم وأضف ملاحظات لاصقة وأشكالًا وأسهمًا وصورًا، ودوّن على صفحات PDF، وشارك رابطًا للعرض فقط.
• خرائط ذهنية وقوالب دراسية على السبورات: ملاحظات كورنيل، خط زمني، مخطط فن، جدول مقارنة.
• نظّم كل شيء بالمشاريع والصفحات الفرعية والمفضلة وأيقونات الرموز التعبيرية.
• اربط الصفحات باستخدام @، واطّلع على الروابط الخلفية، وانشر الملاحظات برابط للقراءة فقط.
• سجل للتعديلات وسلة مهملات، فلا يضيع شيء بالخطأ.
• استورد ملفات Markdown كملاحظات، وصدّر أي ملاحظة بصيغة Markdown.
• ضمّن السبورات أو إطاراتها مباشرة في ملاحظاتك، وأدرج إطارات السبورة في الشرائح مع إمكانية التحديث اليدوي.

دع الذكاء الاصطناعي يساعدك
• أرفق الملاحظات أو الشرائح أو السبورات بالمحادثة ليستخدمها الذكاء الاصطناعي كسياق.
• اطلب من الذكاء الاصطناعي إعادة كتابة ملاحظة أو توسيعها، أو تعديل الشرائح أو السبورة: يقترح التغيير وأنت تقرر تطبيقه.
• دع الذكاء الاصطناعي يرسم إجابة أو ملاحظة كمخطط قابل للتعديل على سبورة.
• دع الذكاء الاصطناعي ينشئ مجموعة شرائح من موضوع أو ملاحظات أو محادثة، ويمكنك تعديل المخطط التفصيلي أولًا.
• حوّل رسمًا على السبورة إلى صورة بالذكاء الاصطناعي.
• تجمع المشاريع المحادثات المترابطة مع تعليمات وصفحات مرجعية مشتركة.
• تخبر التعليمات المخصصة NoteFable بمن تكون وكيف تفضّل الإجابات.
• اختر شخصية ذكاء اصطناعي، أو ارفع أيقونتك الخاصة، للدردشة ومساحة العمل.

اعثر عليه مجددًا
• ابحث في كل محادثاتك وملاحظاتك وشرائحك وسبوراتك دفعة واحدة.

يعمل في كل مكان
• جرّبه دون حساب. سجّل الدخول عبر Google أو برمز عبر البريد الإلكتروني لمزامنة المحادثات ومساحة العمل بين التطبيق وnotefable.com.
• الوضع الفاتح والداكن: اتبع إعدادات النظام أو اختر بنفسك.
• متاح باللغات: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

مجاني مع حدود يومية وشهرية لرسائل وصور الذكاء الاصطناعي، و500 MB لتخزين ملفاتك عند تسجيل الدخول. تحتاج إلى المزيد؟ يرفع NoteFable Pro (اشتراك شهري يمكن إلغاؤه في أي وقت) الحدود إلى 2,000 رسالة و60 صورة شهريًا (حتى 10 صور يوميًا) والتخزين إلى 10 GB، وأول 30 يومًا مجانية. بلا إعلانات.

سياسة الخصوصية: https://notefable.com/privacy

## Türkçe (tr-TR)

**Uygulama adı**: NoteFable: AI Çalışma Alanı

**Kısa açıklama**: Yapay zekâyla sohbet et; öğrendiklerini not, slayt ve beyaz tahtada sakla.

**Tam açıklama**:

NoteFable yapay zekâ sohbetini ve Çalışma alanını tek bir yerde toplar. Yanıtları not olarak sakla, slayt desteleri hazırla ve beyaz tahtalarda fikirlerini düzenle; öğrendiklerin sohbet geçmişinde kaybolmaz.

HER ŞEYİ SOR
• Birden fazla yapay zekâ modeliyle (OpenAI GPT, Anthropic Claude ve DeepSeek) sohbet et ve her birinin ne kadar derin düşüneceğini seç.
• Yerleşik web araması gerektiğinde kaynaklarıyla birlikte güncel yanıtlar getirir (desteklenen modeller).
• Fotoğraf, PDF ve metin dosyası ekleyip içerikleri hakkında soru sor.
• Metin açıklamasından görsel oluştur ve düzenle.

ÇALIŞMA ALANINDA SAKLA
• Herhangi bir yanıtı not olarak kaydet ya da bütün bir sohbeti sayfaya dönüştür.
• Notlar: başlık, liste, yapılacaklar, kod, denklem, görsel ve dosya içeren sade bir blok düzenleyici.
• Düzenler, temalar, metin, formüller, görseller ve şekillerle slayt desteleri: tam ekran sun, konuşmacı notları ekle, PDF veya PowerPoint olarak dışa aktar ya da görüntülemek için bir bağlantı paylaş. Her not da slayt olarak sunulabilir.
• Özgürce düşünmek için beyaz tahtalar: çiz; yapışkan not, şekil, ok ve görsel ekle; PDF sayfalarına not al ve salt okunur bir bağlantı paylaş.
• Beyaz tahtada zihin haritaları ve ders şablonları: Cornell notları, zaman çizelgesi, Venn şeması, karşılaştırma tablosu.
• Her şeyi projeler, alt sayfalar, favoriler ve emoji simgeleriyle düzenle.
• Sayfaları @ ile bağla, notların geri bağlantılarını gör ve notları salt okunur bağlantıyla yayımla.
• Düzenleme geçmişi ve çöp kutusu sayesinde yanlışlıkla hiçbir şey kaybolmaz.
• Markdown dosyalarını not olarak içe aktar, istediğin notu Markdown olarak dışa aktar.
• Notlarına canlı beyaz tahtalar veya çerçeveler yerleştir, slaytlara da elle yenilenebilen beyaz tahta çerçeveleri ekle.

YAPAY ZEKÂ YARDIM ETSİN
• Notları, slaytları veya beyaz tahtaları bir sohbete ekle, yapay zekâ onları bağlam olarak kullansın.
• Yapay zekâdan bir notu yeniden yazmasını veya genişletmesini ya da slaytları veya bir beyaz tahtayı düzenlemesini iste: Değişikliği önerir, uygulayıp uygulamamaya sen karar verirsin.
• Bir yanıtı veya notu yapay zekâya beyaz tahtada düzenlenebilir bir diyagram olarak çizdir.
• Yapay zekâ bir konudan, notlarından veya sohbetten slayt destesi oluştursun; ana hattı önce sen düzenle.
• Beyaz tahtadaki bir çizimi yapay zekâyla görsele dönüştür.
• Projeler, ilgili sohbetleri ortak talimatlar ve referans sayfalarıyla bir arada tutar.
• Özel talimatlarla NoteFable'a kim olduğunu ve nasıl yanıtlar istediğini anlat.
• Sohbet ve Çalışma alanı için bir yapay zekâ karakteri seç ya da kendi simgeni yükle.

TEKRAR BUL
• Tüm sohbetlerinde, notlarında, slaytlarında ve beyaz tahtalarında aynı anda ara.

HER YERDE ÇALIŞIR
• Hesap açmadan dene. Sohbetlerini ve Çalışma alanını uygulama ile notefable.com arasında eşitlemek için Google ya da e-posta koduyla giriş yap.
• Açık ve koyu mod: sistemi takip et ya da birini seç.
• Desteklenen diller: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Yapay zekâ mesajları ve görselleri için günlük ve aylık sınırlarla ücretsiz; oturum açınca dosyaların için 500 MB depolama alanı. Daha fazlası mı lazım? NoteFable Pro (aylık abonelik, istediğin zaman iptal) sınırları ayda 2.000 mesaj ve 60 görsele (günde en fazla 10 görsel), depolamayı da 10 GB'a çıkarır ve ilk 30 gün ücretsizdir. Reklam yok.

Gizlilik politikası: https://notefable.com/privacy

## Русский (ru-RU)

**Название приложения**: NoteFable: ИИ-пространство

**Краткое описание**: Общайтесь с ИИ и сохраняйте знания в заметках, презентациях и на досках.

**Полное описание**:

NoteFable объединяет ИИ-чат и ваше «Пространство» в одном месте. Сохраняйте ответы как заметки, создавайте презентации и раскладывайте идеи на досках, чтобы узнанное не терялось в истории переписки.

СПРАШИВАЙТЕ О ЧЁМ УГОДНО
• Общайтесь с несколькими ИИ-моделями (OpenAI GPT, Anthropic Claude и DeepSeek) и выбирайте, насколько глубоко каждая рассуждает.
• Встроенный веб-поиск при необходимости сам находит актуальные ответы с источниками (поддерживаемые модели).
• Прикрепляйте фото, PDF и текстовые файлы и задавайте вопросы по ним.
• Создавайте и редактируйте изображения по текстовому описанию.

ВСЁ В «ПРОСТРАНСТВЕ»
• Сохраняйте любой ответ как заметку или превращайте весь чат в страницу.
• Заметки: удобный блочный редактор с заголовками, списками, задачами, кодом, формулами, изображениями и файлами.
• Презентации с макетами, темами, текстом, формулами, изображениями и фигурами: показывайте их на весь экран, добавляйте заметки докладчика, экспортируйте в PDF или PowerPoint или делитесь ссылкой для просмотра. Любую заметку тоже можно показать как слайды.
• Доски для свободных идей: рисуйте, добавляйте стикеры, фигуры, стрелки и изображения, делайте пометки на страницах PDF и делитесь ссылкой только для просмотра.
• Интеллект-карты и учебные шаблоны на досках: заметки Корнелла, хронология, диаграмма Венна, сравнительная таблица.
• Упорядочивайте всё с помощью проектов, подстраниц, избранного и значков-эмодзи.
• Связывайте страницы через @, смотрите обратные ссылки и публикуйте заметки по ссылке только для чтения.
• История правок и корзина — ничего не пропадёт по ошибке.
• Импортируйте файлы Markdown как заметки и экспортируйте любую заметку в Markdown.
• Встраивайте живые доски или их рамки прямо в заметки и вставляйте рамки досок в слайды с ручным обновлением.

ИИ ПОМОГАЕТ
• Прикрепите заметки, презентации или доски к чату, и ИИ будет опираться на них.
• Попросите ИИ переписать или дополнить заметку либо отредактировать презентацию или доску: он предложит изменение, а применять ли его — решаете вы.
• Попросите ИИ нарисовать ответ или заметку в виде редактируемой схемы на доске.
• Пусть ИИ создаст презентацию по теме, заметкам или чату — план сначала можно поправить.
• Превращайте набросок на доске в изображение с помощью ИИ.
• Проекты объединяют связанные чаты с общими инструкциями и справочными страницами.
• Пользовательские инструкции расскажут NoteFable о вас и о том, какие ответы вам нравятся.
• Выберите ИИ-персонажа или загрузите свой значок для чата и «Пространства».

НАХОДИТЕ СНОВА
• Ищите сразу по всем чатам, заметкам, презентациям и доскам.

РАБОТАЕТ ВЕЗДЕ
• Попробуйте без аккаунта. Войдите через Google или по коду из письма, чтобы синхронизировать чаты и «Пространство» между приложением и notefable.com.
• Светлая и тёмная тема: как в системе или на ваш выбор.
• Доступно на языках: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Italiano, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी, العربية, Türkçe, Русский.

Бесплатно, с дневными и месячными лимитами на сообщения и изображения ИИ и 500 MB для ваших файлов после входа. Нужно больше? NoteFable Pro (ежемесячная подписка, отмена в любой момент) повышает лимиты до 2000 сообщений и 60 изображений в месяц (до 10 изображений в день), хранилище — до 10 GB, а первые 30 дней бесплатны. Без рекламы.

Политика конфиденциальности: https://notefable.com/privacy

## 其他字段

| 字段 | 值 |
| --- | --- |
| 应用类别 | 应用 → 教育（Education） |
| 标签 | 学习、笔记、AI 助手、效率 |
| 联系邮箱 | 与 `src/components/legal-page.tsx` 的 `LEGAL_CONTACT_EMAIL` 相同 |
| 网站 | https://notefable.com |
| 隐私权政策 | https://notefable.com/privacy |
| 账号删除网址 | https://notefable.com/delete-account |
| 特定商取引法に基づく表記 | https://notefable.com/legal-notice |
| 价格 | 免费；**含应用内购买**（Pro 月额订阅，日本 ¥300 / 月）；不含广告 |
