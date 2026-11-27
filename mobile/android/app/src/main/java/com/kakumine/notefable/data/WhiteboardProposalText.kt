package com.kakumine.notefable.data

/**
 * 白板的 AI 提案说明（改前、改后、对象的名字、新白板的概要）是服务端用固定格式的英文写好、跟提案一起保存的。
 * 这里只在显示时翻译认得出的部分（已经保存的历史提案也一样），保存的内容不动。元素里的文字和框名是用户内容，原样显示；
 * 认不出格式的句子也原样显示。规则和网页 `src/lib/whiteboard/proposal-text.ts` 逐条对应（iOS 是
 * `Core/Chat/WhiteboardProposalText.swift`），单元测试 `WhiteboardProposalTextTest` 用网页算出的对照用例核对。
 * 译文在 `assets/system-text.json` 里。
 */
object WhiteboardProposalText {
    // 元素种类（Excalidraw 的 type）：没有文字的元素，服务端直接拿种类当名字。
    private val elementTypes = mapOf(
        "rectangle" to "Rectangle", "ellipse" to "Ellipse", "diamond" to "Diamond", "stickynote" to "Sticky note",
        "text" to "Text", "arrow" to "Arrow", "line" to "Line", "freedraw" to "Pen", "image" to "Image",
    )
    private val shapeTypes = setOf("rectangle", "ellipse", "diamond", "stickynote", "text")
    private val colorNames = mapOf(
        "default" to "Default", "neutral" to "Default", "yellow" to "Yellow", "blue" to "Blue", "green" to "Green",
        "orange" to "Orange", "red" to "Red", "purple" to "Purple", "teal" to "Teal", "pink" to "Pink", "gray" to "Gray", "grey" to "Gray",
    )
    private val strokeStyles = mapOf("solid" to "Solid", "dashed" to "Dashed", "dotted" to "Dotted")
    private val textSizes = mapOf("small" to "Small", "medium" to "Medium", "large" to "Large", "xl" to "Extra large")
    private val layouts = mapOf("row" to "in a row", "column" to "in a column", "grid" to "in a grid", "cluster" to "in a cluster")
    private val diagramKinds = mapOf(
        "flowchart" to "flowchart", "graph" to "flowchart", "sequenceDiagram" to "sequence diagram", "stateDiagram" to "state diagram",
        "stateDiagram-v2" to "state diagram", "classDiagram" to "class diagram", "erDiagram" to "ER diagram", "timeline" to "timeline",
        "gantt" to "Gantt chart", "quadrantChart" to "quadrant chart", "mindmap" to "mind map",
    )

    // 网页 JS 的 \s 和 trim() 认的空白（Java 的 \s 只认 ASCII）。
    private val jsSpaces = Regex("""[\t\n\x0B\f\r    -     　﻿]+""")

    private val frameMembers = Regex(""" \(([0-9]+) elements?\)""")
    private val sizeSegment = Regex("""size: (small|medium|large|xl)""")
    private val styleSegment = Regex("""style: (solid|dashed|dotted)""")
    private val colorSegment = Regex("""color: ([^\n\r  ]*)""")
    private val hexColor = Regex("""#(?:[0-9a-f]{3}|[0-9a-f]{6})""")
    private val groupText = Regex("""(Group|Ungroup) ([0-9]+) elements?""")
    private val moveText = Regex("""Move into frame "([\s\S]*)"""")
    private val arrangeText = Regex("""Arrange ([0-9]+) elements? in (row|column|grid|cluster)(?: inside frame "([\s\S]*)")?""")
    private val deletedList = Regex("""([\s\S]*?)( \(\+[0-9]+\))?""")
    private val diagramText = Regex("""Diagram \(([A-Za-z0-9-]+), ([0-9]+) elements?\)""")
    private val frameLine = Regex("""Frame "([^\n]*)" \(([0-9]+) items?\)""")
    private val itemLine = Regex("""- (rectangle|ellipse|diamond|stickynote|text): ([^\n]*)""")

    private fun typeName(name: String, t: SystemTextTranslator) = elementTypes[name]?.let { t.t(it) } ?: name

    // 和服务端 shortLabel 一样（并成一行，最多 48 个 UTF-16 单位）。
    private fun shortLabel(text: String, fallback: String): String {
        val oneLine = jsSpaces.replace(text, " ").trim(' ')
        if (oneLine.isEmpty()) return fallback
        return if (oneLine.length > 48) oneLine.substring(0, 47) + "…" else oneLine
    }

    private fun counted(count: String, one: String, many: String, t: SystemTextTranslator, vars: Map<String, String> = emptyMap()) =
        if (count.toLongOrNull() == 1L) t.t(one, vars) else t.t(many, vars + ("count" to count))

    private fun placeholder(text: String, t: SystemTextTranslator) = when (text) {
        "(empty)" -> t.t("(empty)")
        "(unnamed)" -> t.t("(unnamed)")
        else -> text
    }

    private fun endpoints(pair: String, t: SystemTextTranslator): String {
        val ends = pair.split(" -> ")
        return if (ends.size == 2) ends.joinToString(" -> ") { typeName(it, t) } else pair
    }

    private fun added(change: ProposalChange, target: ProposalTarget.Elements, t: SystemTextTranslator): ProposalChange {
        val after = change.after ?: return change
        val name = target.name ?: return change
        val quoted = "Frame \"$name\""
        if (after == quoted) return change.copy(after = t.t("Frame “{name}”", mapOf("name" to name)))
        if (after.startsWith("$quoted (")) {
            frameMembers.matchEntire(after.substring(quoted.length))?.let { members ->
                return change.copy(after = counted(members.groupValues[1], "Frame “{name}” (1 element)", "Frame “{name}” ({count} elements)", t, mapOf("name" to name)))
            }
        }
        val colon = after.indexOf(": ")
        val type = after.substring(0, maxOf(0, colon))
        if (type in shapeTypes) {
            val text = after.substring(colon + 2)
            val empty = text == "(empty)" && name == type
            if (empty || name == shortLabel(text, type)) {
                val line = t.t("{type}: {text}", mapOf("type" to typeName(type, t), "text" to if (empty) t.t("(empty)") else text))
                return change.copy(target = if (empty) target.copy(name = typeName(type, t)) else target, after = line)
            }
        }
        if (after == name && " -> " in after) {
            val pair = endpoints(after, t)
            return change.copy(target = target.copy(name = pair), after = pair)
        }
        val label = " (\"$name\")"
        if (after.endsWith(label) && " -> " in after.dropLast(label.length)) {
            return change.copy(after = endpoints(after.dropLast(label.length), t) + label)
        }
        return change
    }

    /** "文字 · color: x · style: y · size: z" → 写下的文字（没改文字时是 null）和翻译好的整句。 */
    private fun updateSummary(after: String, t: SystemTextTranslator): Pair<String?, String> {
        val parts = after.split(" · ").toMutableList()
        val settings = ArrayDeque<String>()
        fun last() = parts.lastOrNull().orEmpty()
        sizeSegment.matchEntire(last())?.let { size ->
            parts.removeAt(parts.lastIndex)
            settings.addFirst(t.t("Text size: {size}", mapOf("size" to t.t(textSizes.getValue(size.groupValues[1])))))
        }
        styleSegment.matchEntire(last())?.let { style ->
            parts.removeAt(parts.lastIndex)
            settings.addFirst(t.t("Line style: {style}", mapOf("style" to t.t(strokeStyles.getValue(style.groupValues[1])))))
        }
        colorSegment.matchEntire(last())?.let { color ->
            val value = jsSpaces.replace(color.groupValues[1], " ").trim(' ').lowercase()
            val key = if (value.isEmpty()) "Default" else colorNames[value]
            if (key != null || hexColor.matches(value)) {
                parts.removeAt(parts.lastIndex)
                settings.addFirst(t.t("Color: {color}", mapOf("color" to (key?.let { t.t(it) } ?: color.groupValues[1]))))
            }
        }
        val text = if (parts.isEmpty()) null else parts.joinToString(" · ")
        return text to (listOfNotNull(text?.let { placeholder(it, t) }) + settings).joinToString(" · ")
    }

    private fun updated(change: ProposalChange, target: ProposalTarget.Elements, t: SystemTextTranslator): ProposalChange {
        val name = target.name
        var next = change.copy(before = change.before?.let { placeholder(it, t) })
        var written: String? = null
        change.after?.let { after ->
            // 名字和改后的整句对得上：改后就是写下的文字（只改了文字）。
            if (after != "(empty)" && name == shortLabel(after, "")) {
                written = after
            } else {
                val (text, summary) = updateSummary(after, t)
                written = text
                next = next.copy(after = summary)
            }
        }
        val own = written != null && written != "(empty)" && name == shortLabel(written.orEmpty(), "")
        if (name != null && !own) next = next.copy(target = target.copy(name = typeName(name, t)))
        return next
    }

    private fun grouped(change: ProposalChange, t: SystemTextTranslator): ProposalChange {
        val group = groupText.matchEntire(change.after.orEmpty()) ?: return change
        val (one, many) = if (group.groupValues[1] == "Group") "Group 1 element" to "Group {count} elements"
        else "Ungroup 1 element" to "Ungroup {count} elements"
        return change.copy(after = counted(group.groupValues[2], one, many, t))
    }

    private fun moved(change: ProposalChange, target: ProposalTarget.Elements, t: SystemTextTranslator): ProposalChange {
        val into = moveText.matchEntire(change.after.orEmpty())
        val after = when {
            into != null -> t.t("Move into frame “{name}”", mapOf("name" to into.groupValues[1]))
            change.after == "Remove from frame" -> t.t("Remove from frame")
            else -> change.after
        }
        return change.copy(after = after, target = target.name?.let { target.copy(name = typeName(it, t)) } ?: target)
    }

    private fun arranged(change: ProposalChange, t: SystemTextTranslator): ProposalChange {
        val match = arrangeText.matchEntire(change.after.orEmpty()) ?: return change
        val count = match.groupValues[1]
        val vars = mapOf("layout" to t.t(layouts.getValue(match.groupValues[2])))
        val frame = match.groups[3]?.value
        val after = if (frame == null) counted(count, "Arrange 1 element {layout}", "Arrange {count} elements {layout}", t, vars)
        else counted(count, "Arrange 1 element {layout} inside frame “{name}”", "Arrange {count} elements {layout} inside frame “{name}”", t, vars + ("name" to frame))
        return change.copy(after = after)
    }

    private fun deleted(change: ProposalChange, target: ProposalTarget.Elements, t: SystemTextTranslator): ProposalChange {
        target.name?.let { raw ->
            val name = typeName(raw, t)
            return change.copy(target = target.copy(name = name), before = if (change.before == raw) name else change.before)
        }
        // "名字, 名字, …"（最多 6 个，其余是 " (+N)"）：名字里带 ", " 时分不清，个数对得上才翻译。
        val list = deletedList.matchEntire(change.before.orEmpty()) ?: return change
        val names = list.groupValues[1].split(", ")
        if (names.size != minOf(target.count, 6)) return change
        return change.copy(before = names.joinToString(", ") { typeName(it, t) } + list.groupValues[2])
    }

    /** 白板提案的一处改动换成当前语言（只用于 pageKind 是白板的提案）。 */
    fun change(change: ProposalChange, t: SystemTextTranslator): ProposalChange {
        val target = change.target as? ProposalTarget.Elements ?: return change
        return when (change.op) {
            "add" -> added(change, target, t)
            "update" -> if (target.name == null) grouped(change, t) else updated(change, target, t)
            "move" -> moved(change, target, t)
            "reorder" -> arranged(change, t)
            "delete" -> deleted(change, target, t)
            else -> change
        }
    }

    /** 新白板提案的概要（Mermaid 图，或框和元素的清单）换成当前语言。 */
    fun summary(content: String, t: SystemTextTranslator): String {
        diagramText.matchEntire(content)?.let { diagram ->
            diagramKinds[diagram.groupValues[1]]?.let { kind ->
                return counted(diagram.groupValues[2], "Diagram ({kind}, 1 element)", "Diagram ({kind}, {count} elements)", t, mapOf("kind" to t.t(kind)))
            }
        }
        return content.split("\n").joinToString("\n") { line ->
            val frame = frameLine.matchEntire(line)
            val item = itemLine.matchEntire(line)
            when {
                frame != null -> counted(frame.groupValues[2], "Frame “{name}” (1 item)", "Frame “{name}” ({count} items)", t, mapOf("name" to frame.groupValues[1]))
                item != null -> "- " + t.t("{type}: {text}", mapOf("type" to typeName(item.groupValues[1], t), "text" to item.groupValues[2]))
                else -> line
            }
        }
    }
}
