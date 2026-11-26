import SwiftUI

// 模型与推理强度的底部抽屉里的内容（网页 src/components/model-sheet.tsx 的 .model-sheet，Android ChatScreen.kt 的 `ModelSheet`）。
// 外框（把手、圆角 17.6、遮罩、下拉关闭、超高时在里面滚动）是 DesignSystem 的 `.nfBottomSheet`；这里只排内容：
// 小标题"模型" → 模型列表（行间距 2，选中的灰底、600、行尾 ✓ 20）→ 当前模型有不止一档强度时：小标题"推理强度" →
// 三列的强度按钮（间距 8，最小高 46.4、圆角 10.4、1px 深描边、15 的字；选中蓝底白字 600）→ 一行说明（上距 10.4、左右 4、14 灰）
// → "完成"（整宽、最小高 48、圆角 12，上距 16）。选模型、选强度都不关抽屉，点"完成"、遮罩或下拉把手才关。

/// 推理强度的名字和说明（网页 src/lib/reasoning-labels.ts）。服务端给的是 none / minimal / low / medium / high / xhigh / max。
enum ChatReasoningText {
    static func label(_ effort: String) -> String {
        switch effort {
        case "none": return L("reasoning_none")
        case "minimal": return L("reasoning_minimal")
        case "low": return L("reasoning_low")
        case "medium": return L("reasoning_medium")
        case "high": return L("reasoning_high")
        case "xhigh": return L("reasoning_xhigh")
        case "max": return L("reasoning_max")
        default: return effort
        }
    }

    static func description(_ effort: String) -> String {
        switch effort {
        case "none": return L("reasoning_none_desc")
        case "minimal": return L("reasoning_minimal_desc")
        case "low": return L("reasoning_low_desc")
        case "medium": return L("reasoning_medium_desc")
        case "high": return L("reasoning_high_desc")
        case "xhigh": return L("reasoning_xhigh_desc")
        case "max": return L("reasoning_max_desc")
        default: return ""
        }
    }
}

/// 放在 `.nfBottomSheet` 里的内容。自己读 `app.chat.state`，选了马上反映在抽屉里。
struct ChatModelSheet: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfDismiss) private var dismiss

    init() {}

    var body: some View {
        let state = app.chat.state
        let selected = state.selectedModel
        let current = state.selectedReasoning
        VStack(alignment: .leading, spacing: 0) {
            SheetSectionTitle(L("model"))
            VStack(spacing: 2) {
                ForEach(state.models) { model in
                    NFOptionRow(model.label, isSelected: model.id == selected?.id, style: .sheet) {
                        Haptics.selection()
                        app.chat.selectModel(model.id)
                    }
                }
            }
            if let selected, selected.reasoningEfforts.count > 1 {
                SheetSectionTitle(L("reasoning"))
                ChatReasoningGrid(efforts: selected.reasoningEfforts, current: current) { effort in
                    Haptics.selection()
                    app.chat.selectReasoning(effort)
                }
                if let current {
                    // .model-sheet-hint：margin .65rem .25rem 0。
                    Text(ChatReasoningText.description(current))
                        .font(.nf(14))
                        .foregroundStyle(Sm.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 4)
                        .padding(.top, 10.4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            SheetDoneButton(L("done")) { dismiss() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("model_and_reasoning"))
    }
}

/// 强度按钮排成三列（.model-sheet-efforts：grid 3 列、gap 8）。最后一行不足三个时补空位，列宽保持一致。
private struct ChatReasoningGrid: View {
    let efforts: [String]
    let current: String?
    let onSelect: (String) -> Void

    private static let columns = 3

    var body: some View {
        let rows = Self.rows(efforts)
        VStack(spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 8) {
                    ForEach(row, id: \.self) { effort in
                        ChatReasoningChip(title: ChatReasoningText.label(effort), isSelected: effort == current) {
                            onSelect(effort)
                        }
                    }
                    ForEach(0..<(Self.columns - row.count), id: \.self) { _ in
                        Color.clear
                            .frame(maxWidth: .infinity)
                            .frame(height: 1)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
    }

    private static func rows(_ efforts: [String]) -> [[String]] {
        var rows: [[String]] = []
        var index = 0
        while index < efforts.count {
            let end = min(index + columns, efforts.count)
            rows.append(Array(efforts[index..<end]))
            index = end
        }
        return rows
    }
}

/// `.model-sheet-effort`：最小高 46、全圆角胶囊、15 的字；未选时玻璃弹层内柔底无重描边，选中时蓝底白字 600。
private struct ChatReasoningChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let shape = Capsule()
        let unselectedBg = chromePath == .native ? Color.primary.opacity(0.065) : (chromePath == .material ? Sm.hover : Color.clear)
        let stroke = isSelected ? Sm.blue : (chromePath == .solid ? Sm.borderStrong : .clear)
        Button(action: action) {
            Text(title)
                .font(.nf(15, weight: isSelected ? 600 : 400))
                .foregroundStyle(isSelected ? Color.white : Sm.text)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 46)
                .overlay { shape.strokeBorder(stroke, lineWidth: 1) }
        }
        .buttonStyle(.pressable(
            background: isSelected ? Sm.blue : unselectedBg,
            pressedBackground: isSelected ? nil : Sm.hover,
            cornerRadius: 23,
            scale: 0.97
        ))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
