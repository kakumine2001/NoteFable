# 站内页面与自动保存

Notes 是 NoteFable 内部的文字笔记模式。切换模式保留聊天输入、当前会话、正在进行的流式请求和笔记状态。选中的模式及页面 ID 写入 URL 查询参数 `view=pages&page=<id>`，刷新后可重新打开；该 URL 不提供公开分享权限。

## 编辑器与数据

Notes、聊天与头像共用 `emoji-picker-react` 的完整 Unicode 表情选择器，打开时才加载，支持英文搜索、分类、最近使用和肤色。表情以单个 Unicode 字素保存，包含旗帜、键帽和组合表情；原生显示受设备字体支持范围限制。头像照片与封面的现有上传流程保留，不提供独立的图标素材库。

`src/components/note-editor.tsx` 用同版本的 `@blocknote/core`、`@blocknote/react` 和 `@blocknote/ariakit` 社区包构建编辑器，通过 `next/dynamic` 禁用 SSR，在打开页面时加载。显式 schema 只包含段落、H1–H3、项目/编号/待办列表、引用、代码和分隔线；代码块使用 `@blocknote/code-block` 的 Shiki 高亮和语言选择，未知或空语言（包括旧数据）在载入和编辑时统一为 Plain Text；另有上传的图片块和文件块（斜杠菜单 Media 分组里的 Image / File，粘贴或拖入图片也会生成图片块）；不开放表格、视频/音频块、外部链接嵌入、折叠标题或子页面。

## 图片与文件

笔记附件和封面的单文件上限均为 4 MiB（4,194,304 字节）；界面和接口错误文案沿用 “4 MB” 标签。以下容量按实际字节上限描述。

图片块和文件块的 `props.url` 只能是 `/api/pages/files?key=…&name=…`（`parseNoteFileUrl`，`src/lib/note-file-keys.ts`），不接受任意外部 URL；上传前的空块 `url` 为空字符串。文件保存在 `note-files/<用户ID>/<uuid>.<扩展名>`，与封面、聊天图片共用 `src/lib/storage.ts`。保存页面时 `assertNoteFilesOwner` 检查所有被引用的键都在当前用户目录下，否则返回 400。

`POST /api/pages/files` 只收一个 `file` 字段，最大 4 MiB（Vercel 请求体上限 4.5 MB），按实际接收字节数限制。图片按文件头判断（JPEG/PNG/WebP/GIF）；其他文件按扩展名白名单（pdf、txt、md、csv、json、doc/docx、xls/xlsx、ppt/pptx、zip、mp3、wav、mp4），可执行文件、HTML 等被拒绝（400）。`GET /api/pages/files?key=&name=` 只返回当前用户自己的文件：图片内联显示，其他类型以 `attachment` 下载，并带 `nosniff` 和 `Content-Security-Policy: sandbox`。

AI 工具看到上传内容时是 `[Image: 名称 — 说明]` / `[File: 名称]` 占位文字。`propose_note_edit` 可以像其他块一样替换或删除这些块；替换或删除到上传内容时，提案里该处会带 `dropsMedia`，提案卡片提示“上传的图片或文件会从笔记中移除”，用户批准后才会生效。AI 也可以把当前聊天里的图片放进笔记（含用户上传和助手生成的图片）：先用 `list_chat_attachments` 取得附件 ID，再在提案的 Markdown 中单独写一行 `![说明](attachment:ID)`。服务端（`src/lib/note-attachments.ts`）确认该附件属于本会话和本人（不按消息角色排除生成图）、是 PNG/JPEG/WebP/GIF 且不超过 4 MiB，把图片复制到 `note-files/<用户>/`，替换成指向它的图片块；每个提案最多 5 张，同一张只复制一次。聊天里的 PDF / 文本附件只保存了抽出的文字，没有原文件，所以不能作为文件块放进笔记。模型直接写 `![说明](/api/pages/files?...)` 时只接受本人目录下的图片，生成提案和适用提案时都会检查（`assertNoteFilesOwner`）。已上传但不再被引用的文件不会被清理（清理任务已移除）。

## 分组

笔记可以放进单层的分组（文件夹），界面统一称为 Projects。`NoteGroup` 属于当前用户（匿名设备或已登录账号）（最多 50 个，名称最长 60 字符），`NotePage.groupId` 可空，删除项目时其中的笔记保留并回到“无项目”（`SetNull`）。移动笔记只改 `groupId`，不增加内容 `version`，所以不会和自动保存冲突。侧栏顺序与 Chat 一致：New note → Projects → Notes；Projects 可折叠，折叠状态存在本机 localStorage。通过六点手柄可把笔记拖到项目标题（空项目或折叠项目也支持），成功后自动展开；拖到 Notes 标题可移出项目。手机端 Notes 列表的项目标题和 Notes / No project 标题也接受拖放，每行保留移动按钮，底部提供 New project。笔记项目与聊天项目仍独立存储。

代码块的外观仿 Notion：浅米色底、圆角 10px、左 32px / 右 16px / 上下 32px 的内边距，长行自动折行。语言选择和复制按钮平时隐藏，鼠标移到代码块上（或键盘聚焦）时才在右上角出现，复制后图标变成对勾。BlockNote 自带的 CSS 在 `globals.css` 之后加载且选择器权重相同，所以覆盖它的选择器必须带上 `.bn-block-content`（例如 `.notes-block-editor .bn-block-content[data-content-type="codeBlock"] > pre`），否则会被静默覆盖。

数据库保存 `editor.document` 原生 JSON，标题、页面图标和封面单独保存；旧草稿或旧客户端缺少 `icon`/`cover` 时按 null 处理。`src/lib/note-document.ts` 校验区块类型、稳定 ID、文字样式、链接协议、区块数量与深度，拒绝不支持的区块和脚本链接。请求流读取上限为 1 MiB，不仅依赖 Content-Length。标题最长 200 字符，正文最多 2,000 个块、8 层嵌套。

`src/lib/note-block-actions.ts` 维护现有文字区块的转换名称与快捷键、复制 ID 规则和代码转换的文字提取。手柄、斜杠菜单和快捷键使用同一份转换定义。复制时递归生成新 ID；转成代码时保留链接显示文字并移除链接和装饰，保持服务器校验兼容。页面列表按可拖动保存的 `position` 顺序排列（同序时按创建时间倒序），修改正文不会改变顺序，标题立即更新；切换页面和模式写入浏览器历史，后退/前进恢复对应页面。

## 接口

| 路径 | 行为 |
| --- | --- |
| `GET /api/pages` | 返回 `{ pages, groups }`：页面摘要按 `position`、创建时间排列（含 `groupId`、`position`），分组按 `position` 排列。只含不在 Trash 里的笔记 |
| `POST /api/pages` | 新建 `{ title, icon, cover, blocks }` 页面，也用于保存冲突副本，以及聊天回答下方的 “Save to Notes”（块由浏览器按回答生成，规则见 [chat-flow.md](chat-flow.md#回答的复制保存到-notes-与-markdown-导出)；服务端照常校验） |
| `POST /api/pages/from-answer` | Android App 的 “Save to page”：`{ markdown, sessionId, messageId?, savedOn? }`，服务端核对会话归属后用 `answerToNoteContent` 生成块，经 `validateNoteContent` 与 `createNotePage`（同 `POST /api/pages`）新建，201 `{ page }` |
| `GET /api/pages/:id` | 读取拥有的页面（Trash 里的笔记返回 404） |
| `PATCH /api/pages/:id` | 原子保存 `{ title, icon, cover, coverPosition, blocks, version }`，版本递增；同一事务内按需先写一份 `AUTO` 历史（见“编辑历史与恢复”）。Trash 里的笔记返回 404 |
| `DELETE /api/pages/:id` | **移入 Trash**（软删除）：只写 `deletedAt`，响应 `{ ok: true }`；不是永久删除。成功后顺带尽力清理本人超期的 Trash 笔记 |
| `GET /api/pages/trash` | 返回 `{ pages: NoteTrashItem[] }`（`id`、`title`、`icon`、`deletedAt`、`purgeAt`），最近放入的在前。先清理本人超期的笔记再列出；`Cache-Control: no-store` |
| `DELETE /api/pages/trash[?before=<ISO 时间>]` | 清空 Trash：永久删除本人 Trash 里的笔记，返回 `{ ok: true, count }`。带 `before` 时只删除不晚于该时间放进 Trash 的笔记（界面用确认时看到的最新一条的时间，避免删掉确认期间别的标签页刚丢进来、用户没看到的笔记）；时间无法解析返回 400 |
| `POST /api/pages/trash/:id` | 复原一篇笔记（保留期内才行），返回与 `GET /api/pages` 单项同形的 `{ page }`；不在 Trash、不是本人的、已过期的返回 404 `Note not found in the trash.` |
| `DELETE /api/pages/trash/:id` | 永久删除 Trash 里的这一篇；正常笔记不能用它删除（404） |
| `GET /api/pages/:id/revisions` | 返回 `{ revisions }`（`id`、`reason`、`title`、`version`、`createdAt`，不含正文），最新在前，最多 50 条 |
| `GET /api/pages/:id/revisions/:revisionId` | 返回 `{ revision }`，含 `icon` 和 `blocks`，用于预览 |
| `POST /api/pages/:id/revisions/:revisionId/restore` | 把笔记恢复为该历史的标题、图标和正文。body `{ version }` 是客户端当前的笔记版本；成功返回完整的 `{ page }`，版本过期返回 409（带最新的 `page`） |
| `POST /api/pages/covers` | 上传封面图片（JPEG/PNG/WebP/GIF，按文件头判断，最大 4 MiB，按实际接收字节数限制），返回 `upload:` 键；页面引用由随后的自动保存写入 |
| `GET /api/pages/covers?key=` | 只返回当前用户目录下的封面图片 |
| `POST /api/pages/files` | 上传图片块/文件块的文件，返回 `{ url, name, size, kind }`，规则见“图片与文件” |
| `GET /api/pages/files?key=&name=` | 只返回当前用户自己的上传文件 |
| `POST /api/pages/groups` | 新建分组 `{ name }` |
| `PATCH` / `DELETE /api/pages/groups/:groupId` | 重命名 / 删除自己的分组 |
| `PUT /api/pages/:id/group` | 把页面移入自己的分组，或用 `{ groupId: null }` 移出 |
| `PUT /api/pages/:id/icon` | 侧栏里点行首图标修改**未打开**笔记的图标：`{ icon: <单个 emoji 或 null> }`，返回 `{ page }`。图标也在自动保存的 PATCH 里，所以这里把 `version` 加 1，其他标签页里旧内容的保存会得到 409，不会把图标改回去；已打开的笔记走编辑器自己的自动保存，不调这个接口 |

所有操作通过 `getOrCreateUser()` 识别当前用户（签名设备 Cookie 或 Google / 邮箱登录会话）；页面不存在、属于其他用户或在 Trash 里时，除 Trash 接口外都返回 404。PATCH 版本不一致时返回 409 和当前拥有的页面，正文相同的重复请求可以成功返回，以处理保存响应丢失的情况。GET 使用 no-store；应用内不对写操作限流。

## Trash（回收站）

删除笔记不再永久删除：`DELETE /api/pages/:id` 只给 `NotePage.deletedAt` 写入当前时间，位置、分组、封面、正文和 `version` 都不动，笔记助手的对话（`Session.noteId`）和编辑历史也原样保留。放进 Trash 的笔记从其他所有地方消失：侧栏和 Notes 首页的列表、`GET/PATCH /api/pages/:id`、移动分组、拖动排序、`/api/search`、AI 的 `search_notes` / `read_note` / `propose_note_edit`、适用 AI 提案、笔记里 AI 助手的 `noteId` 校验、项目参考笔记，全部带 `deletedAt: null`（新增读取笔记的代码必须遵守，见 [database.md](database.md)）。

- **入口与保留期。** Notes 侧栏的 Trash 按钮打开 `NoteTrashDialog`；删除笔记的确认框写明“移入 Trash，30 天内可复原”。保留期 30 天（`TRASH_RETENTION_DAYS`，`src/types/notes.ts`）；列表里每项带 `purgeAt = deletedAt + 30 天`，对话框显示“Deleted N days ago · M days left”。
- **复原**（`POST /api/pages/trash/:id`）把 `deletedAt` 清空，笔记保留原来的 `position` 值和分组（分组在此期间被删，则回到“无项目”；列表顺序见“页面排序”）。只在保留期内才允许，边界与清理共用 `trashCutoff()`。对话框随后派发 `studymate:page-created`（detail 是返回的摘要），`useNotePages` 据此把它加进侧栏列表，不需要重新拉取列表。复原不弹确认，因为它可逆。
- **永久删除**有三条路径：单篇“Delete forever”、“Empty trash”（两者都有行内二次确认）和超期清理。永久删除会级联删除这篇笔记的编辑历史、项目参考关联和笔记助手的对话，不可恢复。
- **没有定时清理。** 超期笔记在三个时机被删：打开 Trash 列表时、把另一篇笔记放进 Trash 时（尽力而为，失败只记日志、不影响删除本身）、清空 Trash 时。超期笔记在被真正删除之前也不会在任何接口里出现，复原会被拒绝。
- 放进 Trash 前，`remove()` 先把该笔记的未保存编辑 flush；flush 失败则不删除，并提示先处理未保存草稿。成功后丢弃该页的本地队列和 `studymate:page-draft:v1:<pageId>` 草稿缓存，所以复原后看到的是服务端保存的正文，不会被旧草稿覆盖。
- Trash 里的笔记仍引用它的上传封面，因此保留期内封面图片不会被回收（见 [database.md](database.md) 的 `NotePage`）。

## 编辑历史与恢复

`NoteRevision` 保存笔记被覆盖之前的快照（标题、图标、正文和当时的版本）。写入时机：

- **自动保存**：`PATCH /api/pages/:id` 的事务里、更新之前，若该笔记最近 10 分钟内没有 `AUTO` 历史，就把当前已保存的状态复制成一份。这是 DB 内的一条 `INSERT ... SELECT ... FOR UPDATE`，正文不经过应用，自动保存不会因此变慢；`FOR UPDATE` 避免同一版本的两个并发保存都写入。版本冲突（409）、响应丢失后的重发、笔记在 Trash、正文为空时都不写。所以一个连续编辑的笔记大约每 10 分钟留下一份，不是每次保存一份。
- **AI 编辑**：`applyProposal` 适用编辑提案时，在同一事务里先把覆盖前的状态写成 `AI_EDIT` 历史再改笔记；之后任何一步失败，整个事务回滚，历史一起消失，重试不会重复。笔记已在 Trash 或版本变了，则走既有的冲突路径（404 / 409），提案保持待确认。
- **恢复**：写 `RESTORE` 历史（见下）。

每篇笔记最多保留 50 份：自动快照最新 30 份（超过 90 天的也删除），AI 编辑前 / 复原前的快照最新 20 份，两类各自计数，所以连续的自动保存不会挤掉“AI 编辑前”的快照。自动快照在自动保存的事务里用 SAVEPOINT 保护，快照失败只记录日志，不影响保存本身。`GET /api/pages/:id/revisions` 最多返回 50 条摘要，预览时再按需取单份的正文。

**恢复流程**（`POST /api/pages/:id/revisions/:revisionId/restore`，body `{ version }`）：客户端先 flush 未保存的编辑，flush 失败就不恢复；然后带着当前的笔记版本发请求。服务端在一个事务里重读笔记，版本不一致则 409；用保存时同一套 `validateNoteContent` 和 `assertNoteFilesOwner` 重新校验历史内容（失败 400，消息以 “This version cannot be restored.” 开头）；把当前状态写成 `RESTORE` 历史；再按版本条件写入历史的标题、图标和正文，`version` +1。读完到写入之间被别的标签页抢先保存时，条件更新不命中，事务回滚（连同刚写的 `RESTORE` 历史），同样返回 409 和最新的页面。封面、封面位置、分组和位置不变。因为恢复前的状态已被保存，恢复本身也可以再恢复回去。

**打开着的编辑器如何刷新**：恢复成功后，历史对话框派发 `studymate:page-updated`（detail 是返回的完整页面），`useNotePages` 收到后调用该页队列的 `loadLatest()` 并递增编辑器的 `editorEpoch`，编辑器以新正文重新挂载，本地版本号同步为新版本，下一次自动保存不会 409。收到 409 时对话框同样派发 `studymate:page-updated` 带上最新页面，打开的编辑器与版本号随之同步，并提示关闭后重新打开历史。若队列里恰有未保存的编辑，则不覆盖，而是标记为冲突（正常流程里恢复前已 flush，不会发生）。

对话框预览用 `blocksToMarkdown` 转成 Markdown，经 `AssistantMarkdown` 渲染（不使用 `dangerouslySetInnerHTML`），电脑上左右两栏、手机上先选版本再看预览。

## 笔记里的 AI 助手

打开笔记时，右下角有一个圆形的 AI 按钮（`src/components/note-assistant.tsx`）：电脑上点开是浮在按钮上方的小面板，手机上是底部弹出的面板（端上的“返回”键可以关闭）。面板里可以输入要求，或点常用按钮（Improve writing、Fix spelling & grammar、Summarize、Make it shorter、Continue writing）。发送前先把正在输入的内容保存（`NoteSaveQueue.flush`），保存不了（例如有冲突）就不发送。

面板直接调用 `/api/chat`，额外带上 `noteId`（并固定 `webSearch=off`），使用聊天里当前选的模型和推理强度。服务端确认该笔记属于当前用户（否则 404），新建的会话写入 `Session.noteId`，并在共享的 `buildInstructions()` 里加一行说明“用户正在这篇笔记里提问”，要求先 `read_note` 再 `propose_note_edit`。带 `noteId` 的请求只能续用 `noteId` 相同的会话，普通聊天也不能续用笔记会话（否则 404）；这些会话不会出现在 Chats 列表里，也不会被跨 Chats/Notes 搜索命中。笔记放进 Trash 时这些会话保留（`Session.noteId` 不动），只有笔记被永久删除时才随笔记一起级联删除；笔记在 Trash 期间不能再向它发送助手请求（`/api/chat` 的笔记校验带 `deletedAt: null`，返回 404）。面板只在页面打开期间保留这段对话，刷新后重新开始。

AI 的修改仍然只是“编辑案”：面板里显示同样的提案卡片，点 Apply 才会写入，写入走 `/api/proposals/:id/apply`，打开的编辑器通过 `studymate:page-updated` 事件更新到最新内容；AI 在读完之后笔记又被改过（或笔记已进 Trash），则应用时返回 409（或 404），需要重新要求。适用前会把被覆盖的状态存成一份 `AI_EDIT` 历史，所以 AI 改坏了可以从“编辑历史”里一键回到适用之前的版本。

## 保存与恢复

`NoteSaveQueue` 在停止输入一秒后保存。同一页面最多一个保存请求进行中，输入期间的新版本等前一个完成后再提交。只有最后一次修改获得服务端确认后才显示 Saved。

失败草稿在内存中保留，并以 `studymate:page-draft:v1:<pageId>` 临时缓存到 localStorage。保存成功后移除缓存，切换到聊天或隐藏标签页时尝试立即保存，仍有未保存内容时关闭页面会触发浏览器提示。localStorage 不可用或容量不足时显示备份不可用提示，正文仍留在当前标签页。

重新打开页面先从服务端验证归属，再检查本机草稿：基准版本一致时恢复并继续保存，版本不一致时保留草稿并显示冲突。冲突停止自动提交，可以保存为新页面或在确认丢弃草稿后载入最新版本。副本创建成功才释放原页面的冲突草稿。把页面移入 Trash 有确认对话框；存在未解决草稿时先处理草稿再移入（见上文“Trash”）。

Cookie 只是设备身份隔离。清除 Cookie 或换浏览器、设备、域名后无法凭当前机制重新认领服务器页面；配置并使用 Google 登录后，同一账号在其他设备登录即可找回。此功能不调用外部模型 API。

## 运行与迁移

无需新增环境变量，沿用 DATABASE_URL 与 COOKIE_SECRET。`20260930150000_note_pages` 迁移只增加 NotePage 表、归属外键和列表索引；`20261006120000_note_page_icon_cover` 只追加可空的 `icon`、`cover` 列；`20261006130000_note_page_cover_position` 只追加可空的 `coverPosition` 列；`20261006140000_note_cover_assets` 新增 `NoteCoverAsset` 表；`20261006150000_note_cover_asset_deleting` 追加 `deletingAt` 列，并把已有的上传封面登记为使用中；`20261014120000_note_groups` 新增 `NoteGroup` 表和可空的 `NotePage.groupId`；`20261015100000_note_trash_and_revisions` 新增可空的 `NotePage.deletedAt`（及 `(userId, deletedAt)` 索引）、枚举 `NoteRevisionReason` 和 `NoteRevision` 表（均为追加，不改动已有数据）。历史快照 SQL 用到 `gen_random_uuid()`（PostgreSQL 13+），并显式带 schema（本地 `public`，Neon `studymate`）。Trash 和历史没有新的环境变量，也没有定时任务。封面图片与聊天图片共用 `src/lib/storage.ts`（生产为 Private Vercel Blob，本地无令牌时写入 `STUDYMATE_STORAGE_DIR`）。使用 `npm run prisma:migrate`，不使用 db push 或数据库重置。预览环境仍须使用独立数据库。

## 页面排序

桌面侧栏和手机 Notes 首页每行有拖动柄，拖动时显示插入线；聚焦拖动柄后上下方向键也可移动。`POST /api/pages/reorder` 接受 `{ id, targetId, after }`，服务端在用户级事务锁内验证两个页面归属并保存完整顺序；拖到其他分组的页面旁会随之移动分组。排序只更新列表元数据，不改变正文、版本或保存时间；编辑器保存响应沿用当前列表的顺序与分组。刷新请求若早于排序完成，不会把顺序恢复成旧值。排序只涉及不在 Trash 里的笔记；放进 Trash 的笔记保留自己的 `position` 值，复原后按这个值和创建时间重新参与排序（期间其他笔记被重排过的话，不保证回到完全相同的位置）。

## Android 应用内嵌编辑器（`/note-embed`）

原生 Android 应用（`mobile/android`）自己绘制笔记列表、项目和 Trash，编辑器本身仍用网页的 BlockNote：应用在 WebView 里打开 `<baseUrl>/note-embed?page=<pageId>`（可加 `&lang=en|zh|zh-Hant|ja`，见 [i18n.md](i18n.md)；`&model=<id>&reasoning=<effort>` 是应用里选的模型和推理强度）。页面是按语言预先生成的静态页 `src/app/[locale]/note-embed/page.tsx`，由 `src/proxy.ts` 像 `/app` 一样 rewrite；要打开的页面 ID 在浏览器端从 URL 读取。

- **内容。** `NoteEmbed`（`src/components/note-embed.tsx`）只渲染手机 Notes 编辑页的正文：封面、图标、标题、BlockNote 编辑器、保存失败/冲突提示和右下角 AI 按钮，复用 `NotesWorkspace`（`embedded`）、`useNotePages(false, { embedded: true })` 和 `NoteSaveQueue`。不显示网页的顶栏、侧栏和 Chat/Notes 切换；返回、标题、版本历史和保存状态由应用的原生顶栏负责（与网页手机顶栏一样没有“更多”菜单）。412×915 下正文的位置和字号与 `/app?view=pages&page=…` 相同（顶栏高度之外）。不读取笔记列表。
- **保存与恢复照旧。** 一秒防抖自动保存、`studymate:page-draft:v1:<pageId>` 本地草稿、重新打开时的草稿恢复、409 冲突提示（Save as new note / Load latest）、`beforeunload` 和 `visibilitychange` 时的 flush 都与网页相同。WebView 需开启 JavaScript 和 DOM Storage。冲突时选择“另存为新笔记”会把内嵌页切换到新建的副本（URL 用 `replaceState`，不增加历史），并再次发送 `ready`。
- **认证。** 与 API 使用同一组 Cookie：应用加载前把 `studymate_device`（以及登录后的 Auth.js 会话 Cookie）写入 WebView 的 `CookieManager`。笔记文件（`/api/pages/files?key=…`）的下载由应用拦下、带着自己的 Cookie 下载，不交给系统浏览器。
- **AI 模型。** 右下角 AI 助手用 URL 里的 `model` / `reasoning`（`readEmbedModelPreference`，再用 `resolveModelPreference` 按服务端模型列表核对：没有的模型不用，选不了的强度换成默认）；没带或无效时用这个 WebView 里最后一次的选择（localStorage），再没有就用服务端默认。

**网页 → 应用**：存在 `window.StudyMateNative`（`@JavascriptInterface`）时，调用 `window.StudyMateNative.postMessage(JSON.stringify(msg))`，`msg` 为：

| 消息 | 时机 |
| --- | --- |
| `{type:"ready", page:{id,title,icon}}` | 页面数据读取完毕、保存队列已建立（BlockNote 是动态加载的，此时可能仍显示 Loading editor…，不代表编辑器已可输入）；打开的页面换成另一篇（冲突副本）时用新 `id` 再发一次，应用据此把打开的笔记换成副本 |
| `{type:"meta", title, icon}` | 本地编辑改变了标题或图标（空标题发 `Untitled`，无图标为 `null`） |
| `{type:"saveState", state}` | 保存状态变化：`saved` / `unsaved`（等待输入停止，网页显示 Saving…）/ `saving` / `error`（Not saved）/ `conflict` |
| `{type:"missing"}` | 没有 `page` 参数，或页面不存在、不属于本人、在 Trash 里（404）；编辑中保存返回 404（别处已移入 Trash 或彻底删除）时也发，本地草稿保留 |
| `{type:"flushed", requestId, ok, kept?}` | 对 `flush(requestId)` 的回复；`ok` 为 false 时带 `kept` |
| `{type:"trashed"}` | 预留：内嵌页目前不提供移入 Trash 的入口，Trash 由应用在 flush 成功后调用 `DELETE /api/pages/:id` |

**应用 → 网页**：`window.studymateEmbed`。

- `flush(requestId)`：立即保存未保存的编辑，返回 `Promise<boolean>`，并回复 `{type:"flushed", requestId, ok}`。`ok` 为 true 表示没有未保存内容；冲突或保存失败时为 false（草稿仍在本地）。`kept` 为 true 表示失败不是冲突、草稿已存进 localStorage（下次打开会恢复并重试），应用可以在提示后允许离开，和 `/app` 切走时只 `void flush()` 一样。离开编辑页、移入 Trash、切换页面、登录或退出前先调用。
- `openHistory()`：打开该笔记的 `NoteHistoryDialog`（与网页相同，恢复前先 flush）。
- `pageUpdated(page)`：应用在聊天里应用了编辑案、而被改的笔记正开在编辑器里时，把 `POST /api/proposals/:id/apply` 返回的 `page`（JSON 字符串或对象）传进来。网页校验后发出与编辑案卡片相同的 `studymate:page-updated`，由 `useNotePages` 处理：没有未保存的编辑就 `loadLatest` 并换掉编辑器，有就标成冲突。不传的话编辑器仍是旧版本，下次保存会 409。格式不对时返回 false、什么也不做。

消息的组装与 flush 的回复在 `src/lib/native-bridge.ts`（有单元测试）；更改约定时同时修改应用端和 [android-native.md](android-native.md)。
