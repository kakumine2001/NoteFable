import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

// 列表拖动排序里找目标的规则（Android ui/ReorderDrag.kt；网页 reorder-row-button.tsx）。手势和画线在界面层。

/// 拖动时手指下的目标：某一行的前 / 后，或某个容器（项目；nil = 无项目）。
enum DropTarget: Equatable, Sendable {
    case row(id: String, after: Bool)
    case into(containerId: String?)
}

/// 手指下的投放区在 [zones] 里的键（同一个容器可以有几个投放区，只高亮手指下的那个）。
func dropZoneAt(_ point: CGPoint, _ zones: [String: CGRect]) -> String? {
    zones.keys.sorted().first { zones[$0]?.contains(point) == true }
}

/// 投放区优先，其次是别的行（按手指在行的上半 / 下半决定前 / 后）。
/// [zones] 的键是容器 id；空白键（""、" "）都表示无项目，[zoneContainers] 里登记的键按登记的容器。
/// 手指下的投放区 / 行登记了 [zoneAccepts] / [rowAccepts] 而且和 [tag] 不同时不是目标（别的类型的分区不能放，网页 canDropIn）。
func dropTargetAt(
    _ point: CGPoint, dragging: String, zones: [String: CGRect], rows: [String: CGRect],
    zoneContainers: [String: String?] = [:], zoneAccepts: [String: String] = [:], rowAccepts: [String: String] = [:], tag: String? = nil
) -> DropTarget? {
    if let zone = dropZoneAt(point, zones) {
        if let accepts = zoneAccepts[zone], accepts != tag { return nil }
        if let container = zoneContainers[zone] { return .into(containerId: container) }
        return .into(containerId: ApiText.isBlank(zone) ? nil : zone)
    }
    guard let row = rows.keys.sorted().first(where: { $0 != dragging && rows[$0]?.contains(point) == true }),
          let rect = rows[row] else { return nil }
    if let accepts = rowAccepts[row], accepts != tag { return nil }
    return .row(id: row, after: point.y > rect.midY)
}

/// 自动滚动：手指在列表上下边 30 以内移动时每次移动滚 12（网页 updateTarget；手指不动就不滚）。返回这次要滚的量。
func reorderScrollDelta(pointerY: Double, listTop: Double, listBottom: Double, edge: Double = 30, step: Double = 12) -> Double {
    if pointerY < listTop + edge { return -step }
    if pointerY > listBottom - edge { return step }
    return 0
}

extension SidebarViewModel {
    /// 松手时按目标执行（Android ChatDrawerBody 的 onDrop）：行 → 排序；容器 → 移进去并取消置顶。
    func drop(_ id: String, on target: DropTarget?) {
        switch target {
        case .row(let targetId, let after): reorder(ReorderMove(id: id, targetId: targetId, after: after))
        case .into(let containerId): dropIntoProject(id, containerId)
        case nil: break
        }
    }
}
