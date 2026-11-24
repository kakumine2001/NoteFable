import SwiftUI

/// 侧栏的 Search 行（网页 `.notion-sidebar-action.sidebar-search-trigger`，手机；Android `SidebarSearchRow`）：
/// 紧接在“新建”按钮下面，左右 10、高 42、圆角 8、微沉底色 + 1pt 细框、搜索图标 15 + 间距 8.8 + 15 / 500 灰字。右侧的 Ctrl K 提示在触屏上不显示。
struct SidebarSearchRow: View {
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        let bg = Color(light: 0x081C202A, dark: 0x0AFFFFFF)
        Button(action: action) {
            HStack(spacing: 8.8) {
                LucideIcon(Lucide.search, size: 15, color: Sm.muted)
                Text(L("search"))
                    .font(.nf(15, weight: 500))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
        }
        .buttonStyle(.pressable(background: bg, cornerRadius: 8, scale: 0.98))
        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .padding(.horizontal, 10)
    }
}
