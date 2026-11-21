import SwiftUI

// 笔记工作区（Android NoteFableRoot.kt 里 workspace == Notes 的那一支）：打开着笔记时是编辑页（原生顶栏 + 网页编辑器），
// 否则是笔记列表的顶栏 + 首页（列表或空状态）。笔记的对话框和回收站面板也挂在这里。

/// 笔记首页或编辑页（含各自的顶栏）。
@MainActor
struct NotesWorkspace: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var dialog: NotesDialogState?

    init() {}

    var body: some View {
        let state = app.notes.state
        Group {
            if let open = state.open {
                // 按编辑器分，不按页面 id：冲突后“另存为新笔记”换到副本时，WebView 留着不重新加载。
                NoteEditorScreen(open: open, dialog: $dialog)
                    .id(open.editor)
            } else {
                VStack(spacing: 0) {
                    listTopBar
                    NotesHomeView(dialog: $dialog)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Sm.surface)
        .notesDialogs($dialog)
        .noteTrashSheet()
        // 登录 / 退出后：旧身份的笔记对话框关掉（网页换身份会重新加载页面）。
        .onChange(of: app.identityGeneration) { _, _ in dialog = nil }
    }

    /// 笔记列表的顶栏（高 56、左右 10.4）：网页手机版是左边菜单、右边搜索。
    private var listTopBar: some View {
        HStack(spacing: 0) {
            NFIconButton(Lucide.menu, label: L("open_menu")) { router.openDrawer() }
            Spacer(minLength: 0)
            NFIconButton(Lucide.search, label: L("search_chats_and_notes")) { router.openSearch() }
        }
        .padding(.horizontal, 10.4)
        .frame(height: 56)
    }
}
