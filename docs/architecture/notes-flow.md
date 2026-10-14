# 站内页面与自动保存

Notes 是 StudyMate 内部的文字笔记模式。切换模式保留聊天输入、当前会话、正在进行的流式请求和笔记状态。选中的模式及页面 ID 写入 URL 查询参数 `view=pages&page=<id>`，刷新后可重新打开；该 URL 不提供公开分享权限。

## 编辑器与数据

`src/components/note-editor.tsx` 用同版本的 `@blocknote/core`、`@blocknote/react` 和 `@blocknote/ariakit` 社区包构建编辑器，通过 `next/dynamic` 禁用 SSR，在打开页面时加载。显式 schema 只包含段落、H1–H3、项目/编号/待办列表、引用、代码和分隔线；代码块使用 `@blocknote/code-block` 的 Shiki 高亮和语言选择，未知或空语言（包括旧数据）在载入和编辑时统一为 Plain Text；另有上传的图片块和文件块（斜杠菜单 Media 分组里的 Image / File，粘贴或拖入图片也会生成图片块）；不开放表格、视频/音频块、外部链接嵌入、折叠标题或子页面。

## 图片与文件

图片块和文件块的 `props.url` 只能是 `/api/pages/files?key=…&name=…`（`parseNoteFileUrl`，`src/lib/note-file-keys.ts`），不接受任意外部 URL；上传前的空块 `url` 为空字符串。文件保存在 `note-files/<匿名用户ID>/<uuid>.<扩展名>`，与封面、聊天图片共用 `src/lib/storage.ts`。保存页面时 `assertNoteFilesOwner` 检查所有被引用的键都在当前用户目录下，否则返回 400。

`POST /api/pages/files` 只收一个 `file` 字段，最大 4 MB（Vercel 请求体上限 4.5 MB），按实际接收字节数限制。图片按文件头判断（JPEG/PNG/WebP/GIF）；其他文件按扩展名白名单（pdf、txt、md、csv、json、doc/docx、xls/xlsx、ppt/pptx、zip、mp3、wav、mp4），可执行文件、HTML 等被拒绝（400）。`GET /api/pages/files?key=&name=` 只返回当前用户自己的文件：图片内联显示，其他类型以 `attachment` 下载，并带 `nosniff` 和 `Content-Security-Policy: sandbox`。

AI 工具看到上传内容时是 `[Image: 名称 — 说明]` / `[File: 名称]` 占位文字。`propose_note_edit` 可以像其他块一样替换或删除这些块；替换或删除到上传内容时，提案里该处会带 `dropsMedia`，提案卡片提示“上传的图片或文件会从笔记中移除”，用户批准后才会生效。AI 也可以把用户在当前聊天里发送的图片放进笔记：先用 `list_chat_attachments` 取得附件 ID，再在提案的 Markdown 中单独写一行 `![说明](attachment:ID)`。服务端（`src/lib/note-attachments.ts`）确认该附件属于本会话和本人、是 PNG/JPEG/WebP/GIF 且不超过 4 MB，把图片复制到 `note-files/<用户>/`，替换成指向它的图片块；每个提案最多 5 张，同一张只复制一次。聊天里的 PDF / 文本附件只保存了抽出的文字，没有原文件，所以不能作为文件块放进笔记。模型直接写 `![说明](/api/pages/files?...)` 时只接受本人目录下的图片，生成提案和适用提案时都会检查（`assertNoteFilesOwner`）。已上传但不再被引用的文件不会被清理（清理任务已移除）。

## 分组

笔记可以放进单层的分组（文件夹）。`NoteGroup` 属于匿名用户（最多 50 个，名称最长 60 字符），`NotePage.groupId` 可空，删除分组时其中的笔记保留并回到“无分组”（`SetNull`）。移动笔记只改 `groupId`，不增加内容 `version`，所以不会和自动保存冲突。电脑端在侧栏的 Groups 区域管理（可折叠，折叠状态存在本机 localStorage），手机端在 Notes 列表里按分组显示，每行有移动按钮，底部有 New group。

代码块的外观仿 Notion：浅米色底、圆角 10px、左 32px / 右 16px / 上下 32px 的内边距，长行自动折行。语言选择和复制按钮平时隐藏，鼠标移到代码块上（或键盘聚焦）时才在右上角出现，复制后图标变成对勾。BlockNote 自带的 CSS 在 `globals.css` 之后加载且选择器权重相同，所以覆盖它的选择器必须带上 `.bn-block-content`（例如 `.notes-block-editor .bn-block-content[data-content-type="codeBlock"] > pre`），否则会被静默覆盖。

数据库保存 `editor.document` 原生 JSON，标题、页面图标和封面单独保存；旧草稿或旧客户端缺少 `icon`/`cover` 时按 null 处理。`src/lib/note-document.ts` 校验区块类型、稳定 ID、文字样式、链接协议、区块数量与深度，拒绝不支持的区块和脚本链接。请求流读取上限为 1 MiB，不仅依赖 Content-Length。标题最长 200 字符，正文最多 2,000 个块、8 层嵌套。

`src/lib/note-block-actions.ts` 维护现有文字区块的转换名称与快捷键、复制 ID 规则和代码转换的文字提取。手柄、斜杠菜单和快捷键使用同一份转换定义。复制时递归生成新 ID；转成代码时保留链接显示文字并移除链接和装饰，保持服务器校验兼容。页面列表采用稳定的创建时间顺序，标题立即更新；切换页面和模式写入浏览器历史，后退/前进恢复对应页面。

## 接口

| 路径 | 行为 |
| --- | --- |
| `GET /api/pages` | 返回 `{ pages, groups }`：页面摘要按创建时间排列（含 `groupId`），分组按 `position` 排列 |
| `POST /api/pages` | 新建 `{ title, icon, cover, blocks }` 页面，也用于保存冲突副本 |
| `GET /api/pages/:id` | 读取拥有的页面 |
| `PATCH /api/pages/:id` | 原子保存 `{ title, icon, cover, coverPosition, blocks, version }`，版本递增 |
| `DELETE /api/pages/:id` | 删除拥有的页面 |
| `POST /api/pages/covers` | 上传封面图片（JPEG/PNG/WebP/GIF，按文件头判断，最大 4 MB，按实际接收字节数限制），返回 `upload:` 键；页面引用由随后的自动保存写入 |
| `GET /api/pages/covers?key=` | 只返回当前匿名用户目录下的封面图片 |
| `POST /api/pages/files` | 上传图片块/文件块的文件，返回 `{ url, name, size, kind }`，规则见“图片与文件” |
| `GET /api/pages/files?key=&name=` | 只返回当前用户自己的上传文件 |
| `POST /api/pages/groups` | 新建分组 `{ name }` |
| `PATCH` / `DELETE /api/pages/groups/:groupId` | 重命名 / 删除自己的分组 |
| `PUT /api/pages/:id/group` | 把页面移入自己的分组，或用 `{ groupId: null }` 移出 |

所有操作沿用签名设备 Cookie 和 `getOrCreateAnonymousUser()`；页面不存在或属于其他设备时返回 404。PATCH 版本不一致时返回 409 和当前拥有的页面，正文相同的重复请求可以成功返回，以处理保存响应丢失的情况。GET 使用 no-store；应用内不对写操作限流。

## 笔记里的 AI 助手

打开笔记时，右下角有一个圆形的 AI 按钮（`src/components/note-assistant.tsx`）：电脑上点开是浮在按钮上方的小面板，手机上是底部弹出的面板（端上的“返回”键可以关闭）。面板里可以输入要求，或点常用按钮（Improve writing、Fix spelling & grammar、Summarize、Make it shorter、Continue writing）。发送前先把正在输入的内容保存（`NoteSaveQueue.flush`），保存不了（例如有冲突）就不发送。

面板直接调用 `/api/chat`，额外带上 `noteId`（并固定 `webSearch=off`），使用聊天里当前选的模型和推理强度。服务端确认该笔记属于当前用户（否则 404），新建的会话写入 `Session.noteId`，并在共享的 `buildInstructions()` 里加一行说明“用户正在这篇笔记里提问”，要求先 `read_note` 再 `propose_note_edit`。带 `noteId` 的请求只能续用 `noteId` 相同的会话，普通聊天也不能续用笔记会话（否则 404）；这些会话不会出现在 Chats 列表里，随笔记一起删除。面板只在页面打开期间保留这段对话，刷新后重新开始。

AI 的修改仍然只是“编辑案”：面板里显示同样的提案卡片，点 Apply 才会写入，写入走 `/api/proposals/:id/apply`，打开的编辑器通过 `studymate:page-updated` 事件更新到最新内容；AI 在读完之后笔记又被改过，则应用时返回 409，需要重新要求。

## 保存与恢复

`NoteSaveQueue` 在停止输入一秒后保存。同一页面最多一个保存请求进行中，输入期间的新版本等前一个完成后再提交。只有最后一次修改获得服务端确认后才显示 Saved。

失败草稿在内存中保留，并以 `studymate:page-draft:v1:<pageId>` 临时缓存到 localStorage。保存成功后移除缓存，切换到聊天或隐藏标签页时尝试立即保存，仍有未保存内容时关闭页面会触发浏览器提示。localStorage 不可用或容量不足时显示备份不可用提示，正文仍留在当前标签页。

重新打开页面先从服务端验证归属，再检查本机草稿：基准版本一致时恢复并继续保存，版本不一致时保留草稿并显示冲突。冲突停止自动提交，可以保存为新页面或在确认丢弃草稿后载入最新版本。副本创建成功才释放原页面的冲突草稿。删除页面有确认对话框；存在未解决草稿时先处理草稿再删除。

Cookie 只是设备身份隔离。清除 Cookie 或换浏览器、设备、域名后无法凭当前机制重新认领服务器页面；配置并使用 Google 登录后，同一账号在其他设备登录即可找回。此功能不调用外部模型 API。

## 运行与迁移

无需新增环境变量，沿用 DATABASE_URL 与 COOKIE_SECRET。`20260930150000_note_pages` 迁移只增加 NotePage 表、归属外键和列表索引；`20261006120000_note_page_icon_cover` 只追加可空的 `icon`、`cover` 列；`20261006130000_note_page_cover_position` 只追加可空的 `coverPosition` 列；`20261006140000_note_cover_assets` 新增 `NoteCoverAsset` 表；`20261006150000_note_cover_asset_deleting` 追加 `deletingAt` 列，并把已有的上传封面登记为使用中；`20261014120000_note_groups` 新增 `NoteGroup` 表和可空的 `NotePage.groupId`（均为追加，不改动已有数据）。封面图片与聊天图片共用 `src/lib/storage.ts`（生产为 Private Vercel Blob，本地无令牌时写入 `STUDYMATE_STORAGE_DIR`）。使用 `npm run prisma:migrate`，不使用 db push 或数据库重置。预览环境仍须使用独立数据库。
