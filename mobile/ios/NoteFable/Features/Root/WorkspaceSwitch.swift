import SwiftUI

/// Chat / Note 切换（网页 `.notion-segmented`，Android `WorkspaceSwitch`）：高 48、底色 --notion-active、圆角 8、内边距 2、两键间距 2；
/// 每键高 44、圆角 6.4、16 / 500、图标 16 + 间距 6.4；选中白底、墨色字、蓝色图标、1px 细环 + 浅阴影；按下缩到 .97。
/// 抽屉里在头部下方（左右 8、上距 4），空白聊天页和笔记首页在顶栏下方（左右 24、上距 4）：外边距由用的地方加。
/// 切换前先关抽屉（网页从抽屉里切换时先关）；在笔记里时先保存笔记，存不上就留在笔记里（`NotesViewModel.setWorkspace`）。
struct WorkspaceSwitch: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init() {}

    var body: some View {
        let workspace = app.notes.state.workspace
        HStack(spacing: 2) {
            WorkspaceSegment(title: L("chat_mode"), icon: Lucide.messageSquareText, active: workspace == .chat) {
                select(.chat)
            }
            WorkspaceSegment(title: L("note_mode"), icon: Lucide.fileText, active: workspace == .notes) {
                select(.notes)
            }
        }
        .padding(2)
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .background(Sm.active, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("workspace_mode"))
    }

    private func select(_ target: Workspace) {
        router.closeDrawer()
        app.notes.setWorkspace(target)
    }
}

private struct WorkspaceSegment: View {
    let title: String
    let icon: [String]
    let active: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6.4)
        Button(action: action) {
            HStack(spacing: 6.4) {
                LucideIcon(icon, size: 16, color: active ? Sm.blue : Sm.muted)
                Text(title)
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(active ? Sm.ink : Sm.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                if active {
                    // box-shadow: rgba(15,15,15,.1) 0 0 0 1px, rgba(15,15,15,.08) 0 1px 2px。
                    shape
                        .fill(Color.white)
                        .shadow(color: Color(argb: 0x140F0F0F), radius: 1, x: 0, y: 1)
                        .overlay {
                            RoundedRectangle(cornerRadius: 6.9)
                                .stroke(Color(argb: 0x1A0F0F0F), lineWidth: 1)
                                .padding(-0.5)
                        }
                }
            }
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 6.4, scale: 0.97))
        // transition: background 100ms ease, color 100ms ease。
        .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.1), reduceMotion), value: active)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}
