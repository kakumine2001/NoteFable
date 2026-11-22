import ImageIO
import SwiftUI
import UIKit

// 附件与「生成图片」模式的界面（Android ui/AttachUi.kt 里画界面的部分）。
// 数值来自网页（src/app/[locale]/app/page.tsx 的输入栏、attach-sheet.tsx、globals.css）。

// MARK: - 缩略图

/// 附件的缩略图：占满 `side` 见方的格子，多出来的裁掉。
/// `source` 可以是本机文件地址（刚选好、刚发出去的附件）、`data:` 地址，或本站的 `/api/attachments/…/image`（带 Cookie 读）。
struct ChatAttachmentThumbnail: View {
    let source: String
    let side: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        Color.clear
            .frame(width: side, height: side)
            .overlay { picture }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    @ViewBuilder
    private var picture: some View {
        if let url = URL(string: source), url.isFileURL {
            ChatLocalImage(url: url, side: side)
        } else {
            RemoteImage(path: source, contentMode: .fill)
        }
    }
}

/// 本机文件里的图片：在后台线程按显示尺寸解一张小图（原图可能有几千像素宽）。
private struct ChatLocalImage: View {
    let url: URL
    let side: CGFloat
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Sm.hover
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            }
        }
        .frame(width: side, height: side)
        .clipped()
        .accessibilityHidden(true)
        .task(id: url) {
            let pixels = Int((side * max(1, displayScale)).rounded(.up))
            let loaded = await ChatLocalImageLoader.thumbnail(url, maxPixel: pixels)
            if !Task.isCancelled { image = loaded }
        }
    }
}

enum ChatLocalImageLoader {
    /// 读不出来（文件没了、不是图片）返回 nil。短边至少有 `maxPixel` 像素。
    static func thumbnail(_ url: URL, maxPixel: Int) async -> UIImage? {
        await Task.detached(priority: .userInitiated) { () -> UIImage? in
            let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
            guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions as CFDictionary) else { return nil }
            // 缩略图按长边算，格子是按短边铺满的：给两倍的余量，细长的图也不会糊。
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel) * 2,
            ]
            guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            return UIImage(cgImage: thumbnail)
        }.value
    }
}

// MARK: - 输入栏上方

/// 输入栏上方的提示（.notion-error）：浅红底、圆角 4.8、内边距 8.8×10.4、字 12.8 / 行高 19.2，下距 12。
struct ComposerError: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.nf(12.8))
            .nfLineHeight(19.2, fontSize: 12.8)
            .foregroundStyle(Sm.errorText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10.4)
            .padding(.vertical, 8.8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Sm.errorBackground, in: RoundedRectangle(cornerRadius: 4.8))
            .padding(.bottom, 12)
    }
}

/// 输入栏上方的引用（网页 .chat-quote，Android ComposerQuote）：左边 2 的竖线、13 灰字、最多 3 行，右边 24 的 ✕；下距 12。
/// 上传附件时（发出的内容已定）不能移除，和附件标签一样。
struct ChatComposerQuote: View {
    let quote: String
    let enabled: Bool
    let onRemove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ChatQuoteText(quote: quote, lineLimit: 3)
                .frame(maxWidth: .infinity, alignment: .leading)
            NFIconButton(
                Lucide.x, label: L("remove_quote"), size: 24, iconSize: 14, disabledColor: Sm.muted,
                cornerRadius: 5.6, action: onRemove
            )
            .disabled(!enabled)
        }
        .padding(.bottom, 12)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("quote"))
    }
}

/// 引用的正文：左边竖线（--notion-border，宽 2）+ 13 / 行高 23.2 的灰字，字离竖线 10.4。
/// 输入栏上方最多 3 行；发言里显示全文（网页 .chat-quote.is-sent）。
struct ChatQuoteText: View {
    let quote: String
    let lineLimit: Int?

    var body: some View {
        Text(quote)
            .font(.nf(13))
            .nfLineHeight(23.2, fontSize: 13)
            .foregroundStyle(Sm.muted)
            .lineLimit(lineLimit)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 12.4)
            // 深色（:root[data-theme="dark"] .chat-quote）：--notion-sidebar 的底、竖线换成 --notion-border-strong。
            .background(Color(light: 0x00FFFFFF, dark: 0xFF202020))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Color(light: 0x1737352F, dark: 0x2EFFFFFF))
                    .frame(width: 2)
                    .accessibilityHidden(true)
            }
    }
}

/// 输入栏上方已添加的笔记（网页 page.tsx 的 Attached pages 列表，在附件上面）：间距 8、下距 12，每篇是可点掉的标签。
struct PendingPages: View {
    let pages: [ChatProjectNote]
    let enabled: Bool
    let onRemove: (String) -> Void

    var body: some View {
        ChatFlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(pages) { page in
                PageChip(page: page, removable: true) { onRemove(page.id) }
                    .disabled(!enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 12)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("attached_pages"))
    }
}

/// 笔记标签（网页 page.tsx 输入栏上方的、chat-message.tsx 发言下面的）：圆角 4、1px 描边、浅底、12 灰字，图标是表情或 FileText。
/// 输入栏上方的可移除（`removable`：内边距 10×6、间距 8、图标 13、右边 ✕ 13，读屏念"移除…"）；
/// 发言下面的点了打开笔记（内边距 8×4、间距 4、图标 12）。
struct PageChip: View {
    let page: ChatProjectNote
    let removable: Bool
    let action: () -> Void

    var body: some View {
        let title = page.title.isEmpty ? L("sb_untitled") : page.title
        Button(action: action) {
            HStack(spacing: removable ? 8 : 4) {
                if let icon = page.icon, !icon.isEmpty {
                    Text(icon)
                        .font(.system(size: 12))
                        .lineLimit(1)
                        .fixedSize()
                } else {
                    LucideIcon(Lucide.fileText, size: removable ? 13 : 12, color: Sm.muted)
                }
                Text(title)
                    .font(.nf(12))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                if removable { LucideIcon(Lucide.x, size: 13, color: Sm.muted) }
            }
            .frame(minHeight: 16)
            .padding(.horizontal, removable ? 10 : 8)
            .padding(.vertical, removable ? 6 : 4)
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(Sm.border, lineWidth: 1) }
        }
        .buttonStyle(.pressable(background: Sm.sidebar, cornerRadius: 4))
        .accessibilityLabel(removable ? L("sb_remove_title", title) : title)
    }
}

/// 选好的附件：图片是 96 的缩略图（圆角 6、1px 描边、右上角 6 处 24 的移除键），其他文件是可点掉的标签；间距 8，下距 12。
struct PendingFiles: View {
    let files: [LocalFile]
    let enabled: Bool
    let onRemove: (String) -> Void

    var body: some View {
        ChatFlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(files, id: \.uri) { file in
                if file.isImage {
                    imageTile(file)
                } else {
                    fileChip(file)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 12)
    }

    private func imageTile(_ file: LocalFile) -> some View {
        ChatAttachmentThumbnail(source: file.uri, side: 96, cornerRadius: 6)
            .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(Sm.border, lineWidth: 1) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(file.name)
            .accessibilityAddTraits(.isImage)
            .overlay(alignment: .topTrailing) {
                Button {
                    onRemove(file.uri)
                } label: {
                    LucideIcon(Lucide.x, size: 15, color: .white)
                        .frame(width: 24, height: 24)
                }
                // 半透明黑底 rgba(0,0,0,.55)。
                .buttonStyle(.pressable(background: Color(argb: 0x8C000000), pressedBackground: nil, cornerRadius: 4, scale: 0.97))
                .disabled(!enabled)
                .accessibilityLabel(L("remove_image"))
                .padding(.top, 6)
                .padding(.trailing, 6)
            }
    }

    /// 文件标签：回形针 13 + 文件名 12 灰 + ✕ 13，内边距 10×6、间距 8、圆角 4、浅底 + 1px 描边；点一下移除。
    private func fileChip(_ file: LocalFile) -> some View {
        Button {
            onRemove(file.uri)
        } label: {
            HStack(spacing: 8) {
                LucideIcon(Lucide.paperclip, size: 13, color: Sm.muted)
                Text(file.name)
                    .font(.nf(12))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                LucideIcon(Lucide.x, size: 13, color: Sm.muted)
            }
            .frame(minHeight: 16)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(Sm.border, lineWidth: 1) }
        }
        .buttonStyle(.pressable(background: Sm.sidebar, cornerRadius: 4))
        .disabled(!enabled)
        .accessibilityLabel(L("sb_remove_title", file.name))
    }
}

/// 发言下面的文件标签（非图片附件）：12 灰字、回形针 12、浅底 + 1px 描边、圆角 4、内边距 8×4、间距 4。
struct ChatFileChip: View {
    let name: String

    var body: some View {
        HStack(spacing: 4) {
            LucideIcon(Lucide.paperclip, size: 12, color: Sm.muted)
            Text(name)
                .font(.nf(12))
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
        }
        .frame(minHeight: 16)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Sm.sidebar, in: RoundedRectangle(cornerRadius: 4))
        .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(Sm.border, lineWidth: 1) }
    }
}

/// 输入栏下方的小字（上距 8、左右 4、12 灰 / 行高 16）：已附上的数量和总大小，上传时是进度。
struct ComposerStatus: View {
    let files: [LocalFile]
    let upload: ChatUploadProgress?

    var body: some View {
        let lines = statusLines
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.nf(12))
                        .nfLineHeight(16, fontSize: 12)
                        .foregroundStyle(Sm.muted)
                        .padding(.top, 8)
                        .padding(.horizontal, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var statusLines: [String] {
        var lines: [String] = []
        if !files.isEmpty {
            let total = files.reduce(0) { $0 + $1.size }
            lines.append(L("attached_count", files.count, MAX_UPLOAD_FILES) + " · " + formatUploadSize(total))
        }
        switch upload {
        case .preparing:
            lines.append(L("upload_preparing"))
        case .uploading(let index, let total, let name, let percent):
            lines.append(L("upload_progress", index, total, name, percent))
        case nil:
            break
        }
        return lines
    }
}

/// 「生成图片」模式打开时，输入框上方的可点掉的标记（.image-mode-chip）：高 32、全圆角、浅蓝底 rgba(35,131,226,.12)、
/// 蓝字 14 / 500，图标 ImagePlus 16、✕ 14，间距 6.4、左右 11.2，离行首 4。
struct ImageModeChip: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6.4) {
                LucideIcon(Lucide.imagePlus, size: 16, color: Sm.blue)
                Text(L("create_image"))
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(Sm.blue)
                    .lineLimit(1)
                LucideIcon(Lucide.x, size: 14, color: Sm.blue)
            }
            .padding(.horizontal, 11.2)
            .frame(height: 32)
        }
        .buttonStyle(.pressable(background: Color(argb: 0x1F2383E2), cornerRadius: 16, scale: 0.97))
        .accessibilityLabel(L("image_mode_off"))
        .padding(.leading, 4)
    }
}

// MARK: - 「＋」抽屉

/// 点「＋」后从底部出来的抽屉里的几行（网页 attach-sheet.tsx）：添加文件或照片、添加页面、切换「生成图片」，
/// 已保存且有消息的聊天还有最后一行「整理成笔记」（FilePlus，副标题 create_page_title）。
/// 选了一项先关抽屉，等它滑下去再做事（网页：先关抽屉，再开选笔记的窗口）。行多了放不下时抽屉自己在里面滚动。
struct AttachSheet: View {
    let imageMode: Bool
    let onPickFiles: () -> Void
    let onAttachPages: () -> Void
    let onToggleImageMode: () -> Void
    /// 「整理成笔记」；nil 时没有这一行（空白的新聊天）。
    let onCreatePage: (() -> Void)?
    /// 当前聊天在发送（含上传附件）时这一行变淡（.45）不能点：最后的回答还没存下。
    let createPageEnabled: Bool

    @Environment(\.nfDismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SheetActionRow(L("attach_files"), icon: Lucide.paperclip) { closeThen(onPickFiles) }
            SheetActionRow(L("attach_pages"), detail: L("attach_pages_desc"), icon: Lucide.fileText) { closeThen(onAttachPages) }
            SheetActionRow(
                L("create_image"),
                detail: L(imageMode ? "create_image_on" : "create_image_desc"),
                icon: Lucide.imagePlus,
                isOn: imageMode
            ) {
                closeThen(onToggleImageMode)
            }
            if let onCreatePage {
                SheetActionRow(L("create_page"), detail: L("create_page_title"), icon: Lucide.filePlus) {
                    closeThen(onCreatePage)
                }
                .disabled(!createPageEnabled)
                .opacity(createPageEnabled ? 1 : 0.45)
            }
        }
    }

    private func closeThen(_ action: @escaping () -> Void) {
        dismiss()
        // 抽屉退场 200ms。
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 200_000_000)
            action()
        }
    }
}
