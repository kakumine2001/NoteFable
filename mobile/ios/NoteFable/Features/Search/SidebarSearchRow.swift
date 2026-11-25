import SwiftUI

/// 侧栏的 Search 行（网页 `.notion-sidebar-action.sidebar-search-trigger`，手机；Android `SidebarSearchRow`）：
/// 紧接在“新建”按钮下面，左右 10、高 42、圆角 8.5、白面（深色浅透底）+ 1pt 强细框、搜索图标 15 + 间距 8.8 + 15 / 500 高对比次级字。右侧的 Ctrl K 提示在触屏上不显示。
struct SidebarSearchRow: View {
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8.5)
        let bg = Color(light: 0xFFFFFFFF, dark: 0x0EFFFFFF)
        Button(action: action) {
            HStack(spacing: 8.8) {
                LucideIcon(Lucide.search, size: 15, color: Sm.tabMuted)
                Text(L("search"))
                    .font(.nf(15, weight: 500))
                    .foregroundStyle(Sm.tabMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
        }
        .buttonStyle(.pressable(background: bg, cornerRadius: 8.5, scale: 0.98))
        .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1).allowsHitTesting(false) }
        .padding(.horizontal, 10)
    }
}
