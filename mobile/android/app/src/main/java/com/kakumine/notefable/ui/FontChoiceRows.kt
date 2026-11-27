package com.kakumine.notefable.ui

/**
 * 笔记"…"菜单的字体按钮分行（网页 `.notes-menu-fonts` 的 flex-wrap，iOS `fontChoiceRows`）。
 * [mins] 是每个按钮最窄能到多少（名字里最长的单词）。放得下时并排、尽量等分，长的按钮按自己的宽度；
 * 放不下的换到下一行，单词不从中间断开。返回每一行里各按钮的宽度。
 */
internal fun fontChoiceRows(available: Int, gap: Int, mins: List<Int>): List<List<Int>> {
    val rows = mutableListOf<MutableList<Int>>()
    var used = 0
    mins.forEach { min ->
        if (rows.isEmpty() || used + gap + min > available) {
            rows.add(mutableListOf(min))
            used = min
        } else {
            rows.last().add(min)
            used += gap + min
        }
    }
    return rows.map { row -> shareRow((available - gap * (row.size - 1)).coerceAtLeast(0), row) }
}

// 一行里等分；比平均宽的按自己的宽度，其余再分剩下的（除不尽的像素给后面的）。单个按钮放不下时占满整行。
private fun shareRow(free: Int, mins: List<Int>): List<Int> {
    if (mins.size == 1) return listOf(free)
    val fixed = mutableSetOf<Int>()
    while (true) {
        val rest = mins.indices.filter { it !in fixed }
        val left = free - fixed.sumOf { mins[it] }
        val share = left / rest.size
        val wider = rest.filter { mins[it] > share }
        // 全部都比平均宽只会差在除不尽的几个像素上，这时也按平均分。
        if (wider.isEmpty() || wider.size == rest.size) {
            val larger = rest.takeLast(left - share * rest.size).toSet()
            return mins.indices.map { if (it in fixed) mins[it] else share + if (it in larger) 1 else 0 }
        }
        fixed.addAll(wider)
    }
}
