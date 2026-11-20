import Foundation

// 列表拖动排序的状态（Android ui/ReorderDrag.kt 的 DragState；网页 reorder-row-button.tsx + globals.css 的 .list-reorder-*、
// [data-order-*]），聊天侧栏和笔记侧栏 / 首页共用。找目标的规则（DropTarget、dropTargetAt、dropZoneAt、reorderScrollDelta）
// 在 Core/Sidebar/ReorderDrop.swift。手势（长按行的主体后拖、点按照常打开）和画线（目标行上 / 下 2px 蓝线 #2383e2、
// 投放区 rgba(35,131,226,.12) 底加 1px 蓝框、被拖的行半透明 .5）在界面层。

/// 拖动状态：被拖的行、手指的位置、当前目标。坐标都在同一个坐标系里（窗口 / 全局）。
/// 行和投放区的位置由界面登记（[rows] / [zones]），离开界面（折叠、删除）时注销，免得命中已经看不见的行。
struct DragState: Equatable, Sendable {
    var dragging: String?
    var pointer: CGPoint = .zero
    var target: DropTarget?
    /// 当前目标是投放区时，它在 [zones] 里的键（同一个容器可以有几个投放区，只高亮手指下的那个）。
    var targetZone: String?
    /// 列表可见区域，自动滚动用。
    var listBounds: CGRect = .zero
    var rows: [String: CGRect] = [:]
    /// 投放区：键 → 区域。键是容器 id；空白键（""、" "）都表示无项目。
    var zones: [String: CGRect] = [:]

    init() {}

    /// 长按生效：开始拖 [id]，手指在 [point]。
    mutating func start(_ id: String, at point: CGPoint) {
        dragging = id
        update(point)
    }

    mutating func update(_ point: CGPoint) {
        pointer = point
        guard let id = dragging else { return }
        target = dropTargetAt(point, dragging: id, zones: zones, rows: rows)
        if case .into = target {
            targetZone = dropZoneAt(point, zones)
        } else {
            targetZone = nil
        }
    }

    /// 手指移动一次：先找目标，再看要不要滚（列表上下边 30 以内每次移动滚 12，网页 updateTarget）。
    /// 返回这次列表要滚的量（0 = 不滚），由界面去滚。
    mutating func move(_ point: CGPoint) -> Double {
        update(point)
        return reorderScrollDelta(pointerY: Double(point.y), listTop: Double(listBounds.minY), listBottom: Double(listBounds.maxY))
    }

    /// 松手或取消：位置登记（[rows] / [zones]）留着。
    mutating func clear() {
        dragging = nil
        target = nil
        targetZone = nil
    }

    /// 这一行上要不要画插入线（[data-order-drop="before|after"]）。
    func dropLine(_ id: String) -> (before: Bool, after: Bool) {
        guard case .row(let target, let after) = target, target == id else { return (false, false) }
        return (!after, after)
    }

    /// 投放区 [key] 要不要高亮（[data-order-drop="into"]）。
    func isDropZoneActive(_ key: String) -> Bool {
        dragging != nil && targetZone == key
    }
}

/// 笔记行能不能拖（网页 ReorderRowButton 的 disabled={busy}；正在移动的这一篇也不能拖）。
func noteReorderLocked(_ state: NotesUiState, pageId: String) -> Bool {
    state.busy || state.moveBusy.contains(pageId)
}
