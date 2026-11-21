import SwiftUI

/// 侧栏的 Search 行（网页 `.notion-sidebar-action`，手机；Android `SidebarSearchRow`）：紧接在“新建”按钮下面，左右 8、高 44、圆角 4.8、
/// 左右内边距 8、搜索图标 16 + 间距 8.8 + 16 / 500 正文色；按下灰底并缩到 .97。右侧的 Ctrl K 提示在触屏上不显示。
/// 聊天和笔记两边的抽屉都用它：`SidebarSearchRow { router.openSearch() }`。
struct SidebarSearchRow: View {
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8.8) {
                LucideIcon(Lucide.search, size: 16, color: Sm.text)
                Text(L("search"))
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 4.8, scale: 0.97))
        .padding(.horizontal, 8)
    }
}
