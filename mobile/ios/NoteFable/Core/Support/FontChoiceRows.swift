import Foundation

/// 笔记"…"菜单的字体按钮分行（网页 `.notes-menu-fonts` 的 flex-wrap，Android `fontChoiceRows`）。
/// `mins` 是每个按钮最窄能到多少（名字里最长的单词）。放得下时并排、尽量等分，长的按钮按自己的宽度；
/// 放不下的换到下一行，单词不从中间断开。返回每一行里各按钮的宽度。
func fontChoiceRows(available: Double, gap: Double, mins: [Double]) -> [[Double]] {
    var rows: [[Double]] = []
    var used = 0.0
    for min in mins {
        if !rows.isEmpty, used + gap + min <= available {
            rows[rows.count - 1].append(min)
            used += gap + min
        } else {
            rows.append([min])
            used = min
        }
    }
    return rows.map { fontChoiceShare(free: Swift.max(0, available - gap * Double($0.count - 1)), mins: $0) }
}

/// 一行里等分；比平均宽的按自己的宽度，其余再分剩下的。单个按钮放不下时占满整行。
private func fontChoiceShare(free: Double, mins: [Double]) -> [Double] {
    if mins.count == 1 { return [free] }
    var fixed = Set<Int>()
    while true {
        let rest = mins.indices.filter { !fixed.contains($0) }
        let left = free - fixed.reduce(0) { $0 + mins[$1] }
        let share = left / Double(rest.count)
        let wider = rest.filter { mins[$0] > share }
        // 全部都比平均宽只会差在舍入上，这时也按平均分。
        if wider.isEmpty || wider.count == rest.count {
            return mins.indices.map { fixed.contains($0) ? mins[$0] : share }
        }
        fixed.formUnion(wider)
    }
}
