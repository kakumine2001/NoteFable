import CoreText
import Foundation
import SwiftUI

// 表情选择器里不画界面的部分：本机字体能不能画出某个表情、要显示哪些分类和表情、弹出框的大小和位置、
// emoji-picker-react 自带的图标（分类、放大镜、清除；路径数据在 emoji.json 里）。

// MARK: - 本机字体能不能画

/// 本机的 Apple Color Emoji 能不能把这个表情画成一个字形（Android 的 `Paint.hasGlyph`；网页同样隐藏浏览器不支持的表情）。
/// 画不出来有两种：字体里没有这个码点（CoreText 会换成别的字体）；ZWJ / 肤色序列没有合成的字形（会拆成几个表情并排）。
/// 只用 CoreText 的不可变对象，可以在任何线程调用（表情目录在后台线程解析）。
enum EmojiGlyphs {
    private static let fontName = "AppleColorEmoji"
    private static let fontSize: CGFloat = 20
    private static let font: CTFont = CTFontCreateWithName(fontName as CFString, fontSize, nil)
    /// 一个表情的宽度（用 😀 量；量不出来时按字号估）。
    private static let singleWidth: Double = {
        let measured = measure("\u{1F600}")
        return measured.width > 0 ? measured.width : Double(fontSize) * 1.3
    }()

    static func isSupported(_ emoji: String) -> Bool {
        guard !emoji.isEmpty else { return false }
        let measured = measure(emoji)
        // 全部由表情字体画出，而且只有一个表情那么宽。
        return measured.emojiFontOnly && measured.width > 0 && measured.width <= singleWidth * 1.5
    }

    private static func measure(_ text: String) -> (emojiFontOnly: Bool, width: Double) {
        let attributes = [kCTFontAttributeName as String: font] as CFDictionary
        guard let attributed = CFAttributedStringCreate(nil, text as CFString, attributes) else { return (false, 0) }
        let line = CTLineCreateWithAttributedString(attributed)
        let runs = CTLineGetGlyphRuns(line) as NSArray
        var emojiFontOnly = runs.count > 0
        for element in runs {
            // swiftlint:disable:next force_cast
            let run = element as! CTRun
            let runAttributes = CTRunGetAttributes(run) as NSDictionary
            guard let value = runAttributes[kCTFontAttributeName as String] else {
                emojiFontOnly = false
                continue
            }
            // swiftlint:disable:next force_cast
            let runFont = value as! CTFont
            if (CTFontCopyPostScriptName(runFont) as String) != fontName { emojiFontOnly = false }
        }
        let width = CTLineGetTypographicBounds(line, nil, nil, nil)
        return (emojiFontOnly, width)
    }
}

// MARK: - 颜色（emoji-picker-react 的 CSS 变量）

enum EmojiPickerColors {
    static let text = Sm.text                                   // --epr-text-color = --notes-text
    static let categoryActive = Sm.blue                         // --epr-category-icon-active-color
    static let categoryInactive = Sm.faint                      // --epr-category-icon-inactive-color
    static let searchBackground = Color.primary.opacity(0.06)   // --epr-search-input-bg-color（适配浅深色与玻璃）
    static let highlight = Sm.blue                              // --epr-highlight-color（搜索框聚焦、选中的肤色）
    static let variationIndicator = Color.primary.opacity(0.14) // --epr-emoji-variation-indicator-color
    static let toneBorder = Sm.faint                            // --epr-skin-tone-outer-border-color
    static let pickerBorder = Sm.borderStrong                   // --epr-picker-border-color
    static let categoryLabelBackground = Sm.surface.opacity(0.9) // 分类标题底色（非 .ultraThinMaterial 时兜底）
}

// MARK: - 弹出框的顶部条高度

enum EmojiPopoverSize {
    static let barHeight: CGFloat = 36
}

// MARK: - 要显示的分类和表情

/// 表情区里的一格：显示用的码点（含肤色）+ 表情本身。
struct EmojiGridCell: Equatable, Identifiable {
    let unified: String
    let item: EmojiItem

    var id: String { unified }
}

struct EmojiGridSection: Equatable, Identifiable {
    let category: String
    let cells: [EmojiGridCell]

    var id: String { category }
}

/// 一行表情（最多一行的列数）。
struct EmojiGridRow: Equatable, Identifiable {
    let category: String
    let index: Int
    let cells: [EmojiGridCell]

    var id: String { "\(category)-\(index)" }
}

/// 按分类、搜索词和肤色排出要显示的内容（emoji-picker-react：没有命中的分类整个隐藏，"最近使用"为空时也隐藏）。
func emojiGridSections(catalog: EmojiCatalog, recent: [String], tone: SkinTone, query: String) -> [EmojiGridSection] {
    let match = catalog.matcher(query)
    var sections: [EmojiGridSection] = []
    for category in catalog.categories {
        var cells: [EmojiGridCell] = []
        if category == "suggested" {
            var seen = Set<String>()
            for unified in recent {
                guard let item = catalog.find(unified), seen.insert(unified).inserted else { continue }
                cells.append(EmojiGridCell(unified: unified, item: item))
            }
        } else {
            for item in catalog.emojis where item.category == category {
                cells.append(EmojiGridCell(unified: item.unifiedFor(tone), item: item))
            }
        }
        if let match {
            cells = cells.filter { match($0.item) }
        }
        if !cells.isEmpty {
            sections.append(EmojiGridSection(category: category, cells: cells))
        }
    }
    return sections
}

/// 把一个分类的表情按列数切成行。
func emojiGridRows(_ section: EmojiGridSection, columns: Int) -> [EmojiGridRow] {
    let size = max(1, columns)
    var rows: [EmojiGridRow] = []
    var start = 0
    while start < section.cells.count {
        let end = min(start + size, section.cells.count)
        rows.append(EmojiGridRow(category: section.category, index: rows.count, cells: Array(section.cells[start..<end])))
        start = end
    }
    return rows
}

/// 一行放几个表情：emoji-picker-react 的 grid auto-fill（左右各 10 的内边距之间，每格 34）。
func emojiColumns(width: CGFloat) -> Int {
    max(1, Int((width - 20) / 34))
}

/// 分类的名字（读屏和吸顶标题用）。
func emojiCategoryName(_ category: String) -> String {
    switch category {
    case "suggested": return L("em_cat_suggested")
    case "smileys_people": return L("em_cat_smileys_people")
    case "animals_nature": return L("em_cat_animals_nature")
    case "food_drink": return L("em_cat_food_drink")
    case "travel_places": return L("em_cat_travel_places")
    case "activities": return L("em_cat_activities")
    case "objects": return L("em_cat_objects")
    case "symbols": return L("em_cat_symbols")
    case "flags": return L("em_cat_flags")
    default: return ""
    }
}

func emojiToneName(_ tone: SkinTone) -> String {
    switch tone {
    case .neutral: return L("em_tone_neutral")
    case .light: return L("em_tone_light")
    case .mediumLight: return L("em_tone_medium_light")
    case .medium: return L("em_tone_medium")
    case .mediumDark: return L("em_tone_medium_dark")
    case .dark: return L("em_tone_dark")
    }
}

// MARK: - emoji-picker-react 自带的图标

/// 分类图标、放大镜、清除图标：把 `viewBox` 缩放到 `size` 见方，按数据填色 / 描边。没有数据时只占位置。
struct EmojiPickerIcon: View {
    let icon: EmojiIcon?
    let tint: Color
    let size: CGFloat

    var body: some View {
        Canvas { context, canvasSize in
            guard let icon, icon.viewBox.count >= 3, icon.viewBox[2] > 0 else { return }
            let scale = canvasSize.width / CGFloat(icon.viewBox[2])
            var scaled = context
            scaled.scaleBy(x: scale, y: scale)
            scaled.translateBy(x: -CGFloat(icon.viewBox[0]), y: -CGFloat(icon.viewBox[1]))
            for shape in icon.shapes {
                let path = SVGPath.path(shape.d)
                if shape.fill {
                    scaled.fill(path, with: .color(tint), style: FillStyle(eoFill: shape.evenOdd))
                }
                if shape.stroke {
                    scaled.stroke(
                        path, with: .color(tint),
                        style: StrokeStyle(lineWidth: CGFloat(shape.strokeWidth), lineCap: shape.round ? .round : .butt)
                    )
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
