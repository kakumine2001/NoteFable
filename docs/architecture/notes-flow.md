# 站内页面与自动保存

Pages 是 StudyMate 内部的文字笔记模式。切换模式保留聊天输入、当前会话、正在进行的流式请求和笔记状态。选中的模式及页面 ID 写入 URL 查询参数 `view=pages&page=<id>`，刷新后可重新打开；该 URL 不提供公开分享权限。

## 编辑器与数据

`src/components/note-editor.tsx` 用同版本的 `@blocknote/core`、`@blocknote/react` 和 `@blocknote/ariakit` 社区包构建编辑器，通过 `next/dynamic` 禁用 SSR，在打开页面时加载。显式 schema 只包含段落、H1–H3、项目/编号/待办列表、引用、代码和分隔线；代码块使用 `@blocknote/code-block` 的 Shiki 高亮和语言选择，未知或空语言（包括旧数据）在载入和编辑时统一为 Plain Text；不开放表格、媒体、文件、折叠标题或子页面。

数据库保存 `editor.document` 原生 JSON，标题、页面图标和封面单独保存；旧草稿或旧客户端缺少 `icon`/`cover` 时按 null 处理。`src/lib/note-document.ts` 校验区块类型、稳定 ID、文字样式、链接协议、区块数量与深度，拒绝不支持的区块和脚本链接。请求流读取上限为 1 MiB，不仅依赖 Content-Length。标题最长 200 字符，正文最多 2,000 个块、8 层嵌套。

`src/lib/note-block-actions.ts` 维护现有文字区块的转换名称与快捷键、复制 ID 规则和代码转换的文字提取。手柄、斜杠菜单和快捷键使用同一份转换定义。复制时递归生成新 ID；转成代码时保留链接显示文字并移除链接和装饰，保持服务器校验兼容。页面列表采用稳定的创建时间顺序，标题立即更新；切换页面和模式写入浏览器历史，后退/前进恢复对应页面。

## 接口

| 路径 | 行为 |
| --- | --- |
| `GET /api/pages` | 按创建时间返回当前匿名用户的页面摘要 |
| `POST /api/pages` | 新建 `{ title, icon, cover, blocks }` 页面，也用于保存冲突副本 |
| `GET /api/pages/:id` | 读取拥有的页面 |
| `PATCH /api/pages/:id` | 原子保存 `{ title, icon, cover, coverPosition, blocks, version }`，版本递增 |
| `DELETE /api/pages/:id` | 删除拥有的页面 |
| `POST /api/pages/covers` | 上传封面图片（JPEG/PNG/WebP/GIF，按文件头判断，最大 4 MB，按实际接收字节数限制），返回 `upload:` 键；页面引用由随后的自动保存写入 |
| `GET /api/pages/covers?key=` | 只返回当前匿名用户目录下的封面图片 |

所有操作沿用签名设备 Cookie 和 `getOrCreateAnonymousUser()`；页面不存在或属于其他设备时返回 404。PATCH 版本不一致时返回 409 和当前拥有的页面，正文相同的重复请求可以成功返回，以处理保存响应丢失的情况。GET 使用 no-store；应用内不对写操作限流。

## 保存与恢复

`NoteSaveQueue` 在停止输入一秒后保存。同一页面最多一个保存请求进行中，输入期间的新版本等前一个完成后再提交。只有最后一次修改获得服务端确认后才显示 Saved。

失败草稿在内存中保留，并以 `studymate:page-draft:v1:<pageId>` 临时缓存到 localStorage。保存成功后移除缓存，切换到聊天或隐藏标签页时尝试立即保存，仍有未保存内容时关闭页面会触发浏览器提示。localStorage 不可用或容量不足时显示备份不可用提示，正文仍留在当前标签页。

重新打开页面先从服务端验证归属，再检查本机草稿：基准版本一致时恢复并继续保存，版本不一致时保留草稿并显示冲突。冲突停止自动提交，可以保存为新页面或在确认丢弃草稿后载入最新版本。副本创建成功才释放原页面的冲突草稿。删除页面有确认对话框；存在未解决草稿时先处理草稿再删除。

Cookie 只是设备身份隔离。清除 Cookie 或换浏览器、设备、域名后无法凭当前机制重新认领服务器页面；配置并使用 Google 登录后，同一账号在其他设备登录即可找回。此功能不调用外部模型 API。

## 运行与迁移

无需新增环境变量，沿用 DATABASE_URL 与 COOKIE_SECRET。`20260930150000_note_pages` 迁移只增加 NotePage 表、归属外键和列表索引；`20261006120000_note_page_icon_cover` 只追加可空的 `icon`、`cover` 列；`20261006130000_note_page_cover_position` 只追加可空的 `coverPosition` 列；`20261006140000_note_cover_assets` 新增 `NoteCoverAsset` 表；`20261006150000_note_cover_asset_deleting` 追加 `deletingAt` 列，并把已有的上传封面登记为使用中。封面图片与聊天图片共用 `src/lib/storage.ts`（生产为 Private Vercel Blob，本地无令牌时写入 `STUDYMATE_STORAGE_DIR`）。使用 `npm run prisma:migrate`，不使用 db push 或数据库重置。预览环境仍须使用独立数据库。
