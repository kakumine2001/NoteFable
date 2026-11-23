import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

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
    /// 投放区：键 → 区域。键是容器 id；空白键（""、" "）都表示无项目，[zoneContainers] 里登记的键按登记的容器。
    var zones: [String: CGRect] = [:]
    /// 键不是容器 id 的投放区（工作区的分区标题：键 "section:note" 等 → nil = 无项目）。
    var zoneContainers: [String: String?] = [:]
    /// 只接受某一类行的投放区 / 行（键 → 类别；网页 data-drop-kind）：工作区的分区标题和分区里最上层的行只接受同一分区的页面
    /// （[draggingTag]，网页行的 data-page-kind）。没登记的投放区和行什么都接受。
    var zoneAccepts: [String: String] = [:]
    var rowAccepts: [String: String] = [:]
    var draggingTag: String?

    init() {}

    /// 长按生效：开始拖 [id]，手指在 [point]。[tag] 是它放得进的分区（Android `draggingTag`）。
    mutating func start(_ id: String, at point: CGPoint, tag: String? = nil) {
        dragging = id
        draggingTag = tag
        update(point)
    }

    mutating func update(_ point: CGPoint) {
        pointer = point
        guard let id = dragging else { return }
        target = dropTargetAt(point, dragging: id, zones: zones, rows: rows, zoneContainers: zoneContainers,
                              zoneAccepts: zoneAccepts, rowAccepts: rowAccepts, tag: draggingTag)
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
        draggingTag = nil
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

/// 拖动的投放规则（网页 data-drop-kind / data-page-kind，Android `DragState.zoneAccepts` 等）：拖动开始时向列表要一次。
/// [zoneContainers] 是键不是容器 id 的投放区（分区标题 → nil = 无项目），[zoneAccepts] / [rowAccepts] 只接受同一分区的页面，
/// [tag] 给出被拖的那一篇放得进哪个分区。默认什么都接受（聊天侧栏）。
struct ReorderDropRules {
    var zoneContainers: [String: String?] = [:]
    var zoneAccepts: [String: String] = [:]
    var rowAccepts: [String: String] = [:]
    var tag: (String) -> String? = { _ in nil }

    init() {}
}

/// 分区的投放区的键（Android `sectionZone`）。
func noteSectionZone(_ kind: PageKind) -> String { "section:" + kind.wire }

/// 工作区的笔记列表（侧栏、首页）的投放规则：分区标题和分区里最上层的行只接受同一分区的页面（别的类型不能放进来，网页 canDropIn）。
func noteDropRules(_ state: NotesUiState) -> ReorderDropRules {
    var rules = ReorderDropRules()
    for section in state.sections {
        let zone = noteSectionZone(section.kind)
        rules.zoneContainers.updateValue(nil, forKey: zone)
        rules.zoneAccepts[zone] = section.kind.wire
        for page in section.roots { rules.rowAccepts[page.id] = section.kind.wire }
    }
    var tags: [String: String] = [:]
    for page in state.pages { tags[page.id] = state.sectionKind(of: page).wire }
    rules.tag = { tags[$0] }
    return rules
}

/// 笔记行能不能拖（网页 ReorderRowButton 的 disabled={busy}；正在移动的这一篇也不能拖）。
func noteReorderLocked(_ state: NotesUiState, pageId: String) -> Bool {
    state.busy || state.moveBusy.contains(pageId)
}
