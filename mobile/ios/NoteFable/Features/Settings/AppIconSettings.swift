import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// 设置 → 通用 → 图标（网页 AppIconSettings + settings-dialog.css 手机宽度；Android ui/AppIconSettings.kt）：
// - 一行：标题 16/500 + 说明 13 灰，右侧 40 的圆形预览（白底、1px 深描边，里面 24 的角色 / 图片）；
// - 两个可换行的小按钮：「选择角色」（展开 7 款预设角色的 3 列网格）与「上传图片」；
// - 选中的角色带蓝色勾标，默认的 Quill 标出"默认"，点选 Quill 即恢复默认。
// 「上传图片」：系统的照片选择器，选好后按 EXIF 摆正、居中裁成正方形、缩到 96×96、存成 PNG 的 data URL（网页 imageFileToIcon）。
// 选了就先存在这台设备上（`app.appIcon`）；登录时再送到账号，打开时重新读账号上的值（`app.appIconSync`）。

/// "图标"一栏的出错提示（网页 app-icon-settings.tsx 的 error）。
private enum AppIconSettingsError {
    /// app_icon_could_not_save
    case notSaved
    /// acct_choose_image
    case notImage
    /// app_icon_could_not_sync
    case notSynced
}

struct AppIconSettings: View {
    let model: SettingsDialogModel

    @Environment(AppEnvironment.self) private var app
    @State private var error: AppIconSettingsError?
    @State private var pickerShown = false
    @State private var pickedItem: PhotosPickerItem?
    /// 每次选角色、选图片加一：图片还在后台处理时又选了别的，处理完的旧图片不再盖掉新的选择。
    @State private var choice = 0

    init(model: SettingsDialogModel) {
        self.model = model
    }

    var body: some View {
        let icon = app.appIcon.icon
        let picking = model.state.appIconPicking
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(L("app_icon_title"))
                        .font(.nf(16, weight: 500))
                        .foregroundStyle(Sm.text)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                AppIconView(icon: icon, size: 24, animated: true)
                    .frame(width: 40, height: 40)
                    // .settings-app-icon-preview：--notion-bg。
                    .background(Sm.background, in: Circle())
                    .overlay { Circle().strokeBorder(Sm.borderStrong, lineWidth: 1) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 56)

            // 一行放得下就并排，放不下就各占一行（网页 flex-wrap）。
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { chips(picking: picking) }
                VStack(alignment: .leading, spacing: 8) { chips(picking: picking) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.bottom, 14)

            if let error {
                SettingsErrorLine(errorText(error))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
            if picking {
                AppIconCharacterPicker(
                    selected: selectedCharacter(icon),
                    onSelect: { character in
                        choice += 1
                        save(toCharacterIcon(character))
                    },
                    onClose: { model.setAppIconPicking(false) }
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        // 打开设置时重新读账号上的图标（别的设备换过的话这里也跟着变）。
        .task { await app.appIconSync.pull() }
        .photosPicker(isPresented: $pickerShown, selection: $pickedItem, matching: .images)
        .onChange(of: pickerShown) { _, shown in
            // 选择器开着时设置不关（网页 filePickerOpen）。
            if !shown { model.pickerCancelled() }
        }
        .onChange(of: pickedItem) { _, item in
            guard let item else { return }
            Task { @MainActor in await load(item) }
        }
    }

    @ViewBuilder
    private func chips(picking: Bool) -> some View {
        SettingsChip(L("app_icon_choose_character"), icon: Lucide.sparkles) { model.setAppIconPicking(!picking) }
        SettingsChip(L("app_icon_upload_image"), icon: Lucide.imagePlus) {
            model.pickPhoto()
            pickerShown = true
        }
    }

    /// 现在选着的预设角色；用的是上传的图片时没有。
    private func selectedCharacter(_ icon: AppIconValue?) -> CharacterId? {
        if case .character(let id) = resolveAppIcon(icon) { return id }
        return nil
    }

    private func errorText(_ error: AppIconSettingsError) -> String {
        switch error {
        case .notSaved: return L("app_icon_could_not_save")
        case .notImage: return L("acct_choose_image")
        case .notSynced: return L("app_icon_could_not_sync")
        }
    }

    /// 先存到这台设备、再在登录时送到账号（网页 app-icon-settings.tsx 的 apply）。送不上只提示，本机的选择保留。
    private func save(_ next: AppIconValue?) {
        guard app.appIcon.save(next) else {
            error = .notSaved
            return
        }
        error = nil
        let sync = app.appIconSync
        Task { @MainActor in
            let synced = await sync.push(next)
            if !synced { error = .notSynced }
        }
    }

    private func load(_ item: PhotosPickerItem) async {
        choice += 1
        let mine = choice
        let isImage = item.supportedContentTypes.contains { $0.conforms(to: .image) }
        let data = isImage ? (try? await item.loadTransferable(type: Data.self)) : nil
        // 下次再选同一张也要有反应（这次的结果不用了也要清掉）。
        if pickedItem == item { pickedItem = nil }
        guard choice == mine else { return }
        let icon: AppIconValue?
        if let data {
            icon = await AvatarImageDecoder.renderAppIconInBackground(data)
        } else {
            icon = nil
        }
        guard choice == mine else { return }
        guard let icon else {
            error = .notImage
            return
        }
        save(icon)
        model.setAppIconPicking(false)
    }
}

/// 角色选择网格：圆角 10、1px 深描边的框；标题行（白底，13/600 灰 + 36 的关闭键）、1px 线、灰底上 3 列卡片（间距 8、四周 12）。
/// 卡片最小高 88、圆角 10、白底、1px 深描边（选中 1.5px 蓝边 + 右上 18 的蓝色勾标）：40 的角色、名字 13/600、默认的标"默认"。
private struct AppIconCharacterPicker: View {
    let selected: CharacterId?
    let onSelect: (CharacterId) -> Void
    let onClose: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        let rows = Self.rows
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text(L("app_icon_choose_character"))
                    .font(.nf(13, weight: 600))
                    .foregroundStyle(Sm.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NFIconButton(Lucide.x, label: L("close"), size: 36, iconSize: 15, cornerRadius: 6, action: onClose)
            }
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .padding(.vertical, 8)
            .background(Sm.surface)
            SettingsRowDivider()
            VStack(spacing: 8) {
                ForEach(rows.indices, id: \.self) { index in
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(rows[index]) { character in
                            AppIconCharacterCard(character: character, selected: character == selected) {
                                onSelect(character)
                            }
                        }
                        // 最后一行不满时也对齐到 3 列。
                        ForEach(0..<(3 - rows[index].count), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity).frame(height: 1)
                        }
                    }
                }
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity)
        .background(Sm.sidebar)
        .clipShape(shape)
        .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
    }

    /// 7 个角色按 3 个一行排。
    private static let rows: [[CharacterId]] = {
        let all = CharacterId.allCases
        return stride(from: 0, to: all.count, by: 3).map { Array(all[$0..<min($0 + 3, all.count)]) }
    }()
}

private struct AppIconCharacterCard: View {
    let character: CharacterId
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        let defaultBadge = L("pg_font_default")
        Button(action: action) {
            VStack(spacing: 4) {
                CharacterGraphic(id: character, state: .idle, size: 40, animated: selected)
                Text(character.displayName)
                    .font(.nf(13, weight: 600))
                    .foregroundStyle(Sm.ink)
                    .lineLimit(1)
                if character.isDefault {
                    Text(defaultBadge)
                        .font(.nf(11, weight: 500))
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Sm.hover, in: Capsule())
                }
            }
            .frame(maxWidth: .infinity, minHeight: 68)
            .overlay(alignment: .topTrailing) {
                if selected {
                    Circle()
                        .fill(Sm.blue)
                        .frame(width: 18, height: 18)
                        .overlay { LucideIcon(Lucide.check, size: 11, strokeWidth: 2.6, color: .white) }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 10)
            .overlay { shape.strokeBorder(selected ? Sm.blue : Sm.borderStrong, lineWidth: selected ? 1.5 : 1) }
        }
        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 10))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(character.isDefault ? "\(character.displayName) (\(defaultBadge))" : character.displayName)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
