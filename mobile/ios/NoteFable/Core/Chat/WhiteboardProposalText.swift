import Foundation

/// 白板的 AI 提案说明（改前、改后、对象的名字、新白板的概要）是服务端用固定格式的英文写好、跟提案一起保存的。
/// 这里只在显示时翻译认得出的部分（已经保存的历史提案也一样），保存的内容不动。元素里的文字和框名是用户内容，原样显示；
/// 认不出格式的句子也原样显示。规则和网页 `src/lib/whiteboard/proposal-text.ts` 逐条对应（Android 是
/// `data/WhiteboardProposalText.kt`），单元测试 `WhiteboardProposalTextTests` 用网页算出的对照用例核对。
/// 译文在 `system-text.json` 里。比较和切分按码点 / UTF-16，不做 Unicode 等价折叠（和网页一样）。
enum WhiteboardProposalText {
    // 元素种类（Excalidraw 的 type）：没有文字的元素，服务端直接拿种类当名字。
    private static let elementTypes = [
        "rectangle": "Rectangle", "ellipse": "Ellipse", "diamond": "Diamond", "stickynote": "Sticky note",
        "text": "Text", "arrow": "Arrow", "line": "Line", "freedraw": "Pen", "image": "Image",
        // 没有名字的框，服务端（getElementLabel）拿 "Frame" 当名字。
        "Frame": "Frame",
    ]
    private static let shapeTypes = ["rectangle", "ellipse", "diamond", "stickynote", "text"]
    private static let colorNames = [
        "default": "Default", "neutral": "Default", "yellow": "Yellow", "blue": "Blue", "green": "Green",
        "orange": "Orange", "red": "Red", "purple": "Purple", "teal": "Teal", "pink": "Pink", "gray": "Gray", "grey": "Gray",
    ]
    private static let strokeStyles = ["solid": "Solid", "dashed": "Dashed", "dotted": "Dotted"]
    private static let textSizes = ["small": "Small", "medium": "Medium", "large": "Large", "xl": "Extra large"]
    private static let layouts = ["row": "in a row", "column": "in a column", "grid": "in a grid", "cluster": "in a cluster"]
    private static let diagramKinds = [
        "flowchart": "flowchart", "graph": "flowchart", "sequenceDiagram": "sequence diagram", "stateDiagram": "state diagram",
        "stateDiagram-v2": "state diagram", "classDiagram": "class diagram", "erDiagram": "ER diagram", "timeline": "timeline",
        "gantt": "Gantt chart", "quadrantChart": "quadrant chart", "mindmap": "mind map",
    ]

    // 整句匹配（\A … \z）：ICU 的 $ 会放过末尾换行，和网页的正则不一样。
    private static let frameMembers = ChatRegex(#"\A \(([0-9]+) elements?\)\z"#)
    private static let sizeSegment = ChatRegex(#"\Asize: (small|medium|large|xl)\z"#)
    private static let styleSegment = ChatRegex(#"\Astyle: (solid|dashed|dotted)\z"#)
    private static let colorSegment = ChatRegex(#"\Acolor: ([^\n\r  ]*)\z"#)
    private static let hexColor = ChatRegex(#"\A#(?:[0-9a-f]{3}|[0-9a-f]{6})\z"#)
    private static let groupText = ChatRegex(#"\A(Group|Ungroup) ([0-9]+) elements?\z"#)
    private static let moveText = ChatRegex(#"\AMove into frame "([\s\S]*)"\z"#)
    private static let arrangeText = ChatRegex(#"\AArrange ([0-9]+) elements? in (row|column|grid|cluster)(?: inside frame "([\s\S]*)")?\z"#)
    private static let deletedList = ChatRegex(#"\A([\s\S]*?)( \(\+[0-9]+\))?\z"#)
    private static let diagramText = ChatRegex(#"\ADiagram \(([A-Za-z0-9-]+), ([0-9]+) elements?\)\z"#)
    private static let frameLine = ChatRegex(#"\AFrame "([^\n]*)" \(([0-9]+) items?\)\z"#)
    private static let itemLine = ChatRegex(#"\A- (rectangle|ellipse|diamond|stickynote|text): ([^\n]*)\z"#)

    /// 白板提案的一处改动换成当前语言（只用于 pageKind 是白板的提案）。
    static func change(_ change: ProposalChange, _ system: SystemTextTranslator) -> ProposalChange {
        guard case .elements(let count, let name)? = change.target else { return change }
        switch change.op {
        case .add: return added(change, count: count, name: name, system)
        case .update:
            if name == nil { return grouped(change, system) }
            return updated(change, count: count, name: name, system)
        case .move: return moved(change, count: count, name: name, system)
        case .reorder: return arranged(change, system)
        case .delete: return deleted(change, count: count, name: name, system)
        case .replace, .insertAfter: return change
        }
    }

    /// 新白板提案的概要（Mermaid 图，或框和元素的清单）换成当前语言。
    static func summary(_ content: String, _ system: SystemTextTranslator) -> String {
        if let diagram = groups(diagramText, content), let kind = diagramKinds[diagram[1] ?? ""] {
            return counted(diagram[2] ?? "", "Diagram ({kind}, 1 element)", "Diagram ({kind}, {count} elements)", system, ["kind": system.t(kind)])
        }
        return content.components(separatedBy: "\n").map { line -> String in
            if let frame = groups(frameLine, line) {
                return counted(frame[2] ?? "", "Frame “{name}” (1 item)", "Frame “{name}” ({count} items)", system, ["name": frame[1] ?? ""])
            }
            if let item = groups(itemLine, line) {
                return "- " + system.t("{type}: {text}", ["type": typeName(item[1] ?? "", system), "text": item[2] ?? ""])
            }
            return line
        }.joined(separator: "\n")
    }

    private static func groups(_ regex: ChatRegex, _ text: String) -> [String?]? {
        guard let match = regex.firstMatch(in: text) else { return nil }
        let units = text as NSString
        return (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            return range.location == NSNotFound ? nil : units.substring(with: range)
        }
    }

    // 局限同网页：文字正好是种类英文名（"image"、"line" 等）的元素，和没有文字的元素分不清。
    // 用户起名 "Frame" 的框（或文字是 "Frame" 的元素）和没有名字的框也分不清，一样翻译。
    private static func typeName(_ name: String, _ system: SystemTextTranslator) -> String {
        elementTypes[name].map { system.t($0) } ?? name
    }

    // 说明里的框名：只在没有名字时翻译。
    private static func frameName(_ name: String, _ system: SystemTextTranslator) -> String {
        name == "Frame" ? typeName(name, system) : name
    }

    private static func same(_ left: String, _ right: String) -> Bool {
        left.unicodeScalars.elementsEqual(right.unicodeScalars)
    }

    // 网页 JS 的 \s 和 trim() 认的空白。
    private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    private static func collapse(_ text: String) -> String {
        text.unicodeScalars.split(whereSeparator: isSpace).map { String($0) }.joined(separator: " ")
    }

    // 和服务端 shortLabel 一样（并成一行，最多 48 个 UTF-16 单位）。
    private static func shortLabel(_ text: String, _ fallback: String) -> String {
        let oneLine = collapse(text)
        if oneLine.isEmpty { return fallback }
        let units = Array(oneLine.utf16)
        return units.count > 48 ? String(decoding: units[0..<47], as: UTF16.self) + "…" : oneLine
    }

    private static func counted(_ count: String, _ one: String, _ many: String, _ system: SystemTextTranslator, _ vars: [String: String] = [:]) -> String {
        if Int(count) == 1 { return system.t(one, vars) }
        return system.t(many, vars.merging(["count": count]) { _, new in new })
    }

    private static func placeholder(_ text: String, _ system: SystemTextTranslator) -> String {
        switch text {
        case "(empty)": return system.t("(empty)")
        case "(unnamed)": return system.t("(unnamed)")
        default: return text
        }
    }

    private static func endpoints(_ pair: String, _ system: SystemTextTranslator) -> String {
        let ends = pair.components(separatedBy: " -> ")
        return ends.count == 2 ? ends.map { typeName($0, system) }.joined(separator: " -> ") : pair
    }

    private static func dropping(_ text: String, prefix: Int = 0, suffix: Int = 0) -> String {
        String(String.UnicodeScalarView(text.unicodeScalars.dropFirst(prefix).dropLast(suffix)))
    }

    private static func added(_ change: ProposalChange, count: Int, name: String?, _ system: SystemTextTranslator) -> ProposalChange {
        guard let after = change.after, let name else { return change }
        var next = change
        let quoted = "Frame \"\(name)\""
        if same(after, quoted) {
            next.after = system.t("Frame “{name}”", ["name": name])
            return next
        }
        if after.unicodeScalars.starts(with: "\(quoted) (".unicodeScalars),
           let members = groups(frameMembers, dropping(after, prefix: quoted.unicodeScalars.count)) {
            next.after = counted(members[1] ?? "", "Frame “{name}” (1 element)", "Frame “{name}” ({count} elements)", system, ["name": name])
            return next
        }
        if let type = shapeTypes.first(where: { after.unicodeScalars.starts(with: "\($0): ".unicodeScalars) }) {
            let text = dropping(after, prefix: type.unicodeScalars.count + 2)
            let empty = text == "(empty)" && name == type
            if empty || same(name, shortLabel(text, type)) {
                if empty { next.target = .elements(count: count, name: typeName(type, system)) }
                next.after = system.t("{type}: {text}", ["type": typeName(type, system), "text": empty ? system.t("(empty)") : text])
                return next
            }
        }
        if same(after, name), after.components(separatedBy: " -> ").count > 1 {
            let pair = endpoints(after, system)
            next.target = .elements(count: count, name: pair)
            next.after = pair
            return next
        }
        let label = " (\"\(name)\")"
        if after.unicodeScalars.reversed().starts(with: label.unicodeScalars.reversed()) {
            let pair = dropping(after, suffix: label.unicodeScalars.count)
            if pair.components(separatedBy: " -> ").count > 1 {
                next.after = endpoints(pair, system) + label
                return next
            }
        }
        return change
    }

    /// "文字 · color: x · style: y · size: z" → 写下的文字（没改文字时是 nil）和翻译好的整句。
    private static func updateSummary(_ after: String, _ system: SystemTextTranslator) -> (text: String?, summary: String) {
        var parts = after.components(separatedBy: " · ")
        var settings: [String] = []
        func last() -> String { parts.last ?? "" }
        if let size = groups(sizeSegment, last()) {
            parts.removeLast()
            settings.insert(system.t("Text size: {size}", ["size": system.t(textSizes[size[1] ?? ""] ?? "")]), at: 0)
        }
        if let style = groups(styleSegment, last()) {
            parts.removeLast()
            settings.insert(system.t("Line style: {style}", ["style": system.t(strokeStyles[style[1] ?? ""] ?? "")]), at: 0)
        }
        if let color = groups(colorSegment, last()) {
            let raw = color[1] ?? ""
            let value = collapse(raw).lowercased()
            let key = value.isEmpty ? "Default" : colorNames[value]
            if key != nil || groups(hexColor, value) != nil {
                parts.removeLast()
                settings.insert(system.t("Color: {color}", ["color": key.map { system.t($0) } ?? raw]), at: 0)
            }
        }
        let text: String? = parts.isEmpty ? nil : parts.joined(separator: " · ")
        let summary = ((text.map { [placeholder($0, system)] } ?? []) + settings).joined(separator: " · ")
        return (text, summary)
    }

    private static func updated(_ change: ProposalChange, count: Int, name: String?, _ system: SystemTextTranslator) -> ProposalChange {
        var next = change
        next.before = change.before.map { placeholder($0, system) }
        var written: String? = nil
        // 对象的名字是不是从这段文字来的。
        func named(_ text: String?) -> Bool {
            guard let text, text != "(empty)", let name else { return false }
            return same(name, shortLabel(text, ""))
        }
        if let after = change.after {
            let result = updateSummary(after, system)
            // 名字和改后的整句对得上：改后就是写下的文字（只改了文字）。但去掉末尾的设置项后也对得上时，
            // 是文字和设置都改了（长文字的名字是截断的，和整句也对得上）。
            let split = result.text.map { !same($0, after) } ?? false
            if named(after), !(split && named(result.text)) {
                written = after
            } else {
                written = result.text
                next.after = result.summary
            }
        }
        // 写下的文字和名字一样时名字是用户的文字；否则和种类同名的是没有文字的元素。
        if let name, !named(written) { next.target = .elements(count: count, name: typeName(name, system)) }
        return next
    }

    private static func grouped(_ change: ProposalChange, _ system: SystemTextTranslator) -> ProposalChange {
        guard let group = groups(groupText, change.after ?? "") else { return change }
        let isGroup = group[1] == "Group"
        var next = change
        next.after = counted(
            group[2] ?? "",
            isGroup ? "Group 1 element" : "Ungroup 1 element",
            isGroup ? "Group {count} elements" : "Ungroup {count} elements",
            system
        )
        return next
    }

    private static func moved(_ change: ProposalChange, count: Int, name: String?, _ system: SystemTextTranslator) -> ProposalChange {
        var next = change
        if let into = groups(moveText, change.after ?? "") {
            next.after = system.t("Move into frame “{name}”", ["name": frameName(into[1] ?? "", system)])
        } else if change.after == "Remove from frame" {
            next.after = system.t("Remove from frame")
        }
        if let name { next.target = .elements(count: count, name: typeName(name, system)) }
        return next
    }

    private static func arranged(_ change: ProposalChange, _ system: SystemTextTranslator) -> ProposalChange {
        guard let match = groups(arrangeText, change.after ?? "") else { return change }
        let count = match[1] ?? ""
        let vars = ["layout": system.t(layouts[match[2] ?? ""] ?? "")]
        var next = change
        if let frame = match[3] {
            next.after = counted(
                count, "Arrange 1 element {layout} inside frame “{name}”", "Arrange {count} elements {layout} inside frame “{name}”",
                system, vars.merging(["name": frameName(frame, system)]) { _, new in new }
            )
        } else {
            next.after = counted(count, "Arrange 1 element {layout}", "Arrange {count} elements {layout}", system, vars)
        }
        return next
    }

    private static func deleted(_ change: ProposalChange, count: Int, name: String?, _ system: SystemTextTranslator) -> ProposalChange {
        var next = change
        if let name {
            let shown = typeName(name, system)
            next.target = .elements(count: count, name: shown)
            if let before = change.before, same(before, name) { next.before = shown }
            return next
        }
        // "名字, 名字, …"（最多 6 个，其余是 " (+N)"）：名字里带 ", " 时分不清，个数对得上才翻译。
        guard let list = groups(deletedList, change.before ?? "") else { return change }
        let names = (list[1] ?? "").components(separatedBy: ", ")
        guard names.count == min(count, 6) else { return change }
        next.before = names.map { typeName($0, system) }.joined(separator: ", ") + (list[2] ?? "")
        return next
    }
}
