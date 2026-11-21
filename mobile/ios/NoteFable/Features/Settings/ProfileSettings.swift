import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// 设置里的个人资料（网页 ProfileSettings + globals.css 的 .profile-* / settings-dialog.css 的 .settings-profile，手机宽度的值；
// Android AccountUi.kt 的 ProfileSettings）：
// - 头部：头像 56（按钮，右下 −2 处 20 的深色圆形角标，2px 白边，铅笔 11 白色）、间距 16、"名字"12 灰 + 输入框（高 44、16 字、
//   左右 10、1px 深描边、圆角 8；聚焦时蓝边 + 2px rgba(35,131,226,.2) 外圈；最多 40 字），输入框下面是邮箱 13 灰（上 6）。
// - 点头像打开编辑区（再点关上）：上 14、1px 描边、圆角 10 的框；"照片 / 表情"两个标签（.notes-picker-tabs），
//   照片页（.profile-photo-pane）或裁剪（AvatarCropper.swift），表情页（EmojiPickerBody，高 min(320, 屏高 − 220)）。
// - 改过名字或头像、且有 Google 资料时，"使用我的 Google 名称和头像"（.settings-chip，上 14，RotateCcw）。
// 名字和头像都是改了就存（排队保存）；输入中的名字在失焦、回车和关设置时存。

/// 选好、等着裁剪的照片。`id` 每选一次加一：裁剪界面按它重新开始。
private struct PickedAvatarPhoto {
    let id: Int
    let data: Data
}

struct ProfileSettings: View {
    let model: SettingsDialogModel
    let user: AccountUser

    @Environment(AppEnvironment.self) private var app
    @FocusState private var nameFocused: Bool
    @State private var pickerShown = false
    @State private var pickedItem: PhotosPickerItem?
    @State private var photo: PickedAvatarPhoto?
    @State private var pickCount = 0

    var body: some View {
        let state = model.state
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                avatarButton(expanded: state.editor != .closed)
                nameColumn(state)
            }
            if state.editor != .closed {
                editorBox(state)
                    .padding(.top, 14)
            }
            if model.showResetToGoogle {
                SettingsChip(L("use_google_profile"), icon: Lucide.rotateCcw) { model.resetToGoogle() }
                    .padding(.top, 14)
            }
        }
        // 系统的照片选择器（网页 <input type=file accept=image/*>）。
        .photosPicker(isPresented: $pickerShown, selection: $pickedItem, matching: .images)
        .onChange(of: pickerShown) { _, shown in
            // 选择器关了、什么都没选。
            if !shown, pickedItem == nil { model.pickerCancelled() }
        }
        .onChange(of: pickedItem) { _, item in
            guard let item else { return }
            Task { @MainActor in await load(item) }
        }
        .onChange(of: state.picked) { _, picked in
            // 取消裁剪、换了标签、上传成功：手上的照片不要了。
            if !picked {
                photo = nil
                pickedItem = nil
            }
        }
        .onChange(of: nameFocused) { _, focused in model.nameFocusChanged(focused) }
    }

    /// 读选好的照片：不是图片、超过 10 MB 的直接提示（`checkPickedPhoto`），可以的话进入裁剪。
    private func load(_ item: PhotosPickerItem) async {
        let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
        let mimeType = type.map { $0.preferredMIMEType ?? "image/*" }
        let data = try? await item.loadTransferable(type: Data.self)
        guard pickedItem == item else { return }
        guard let data else {
            // 读不出来：按"不是图片"提示。
            model.photoPicked(mimeType: nil, size: nil)
            pickedItem = nil
            return
        }
        if model.photoPicked(mimeType: mimeType, size: Int64(data.count)) {
            pickCount += 1
            photo = PickedAvatarPhoto(id: pickCount, data: data)
        } else {
            pickedItem = nil
        }
    }

    // MARK: 头部

    /// 头像按钮（.profile-avatar-button）：头像 56，右下角 −2 处 20 的铅笔角标（2px 白边、--notion-text 底）。
    private func avatarButton(expanded: Bool) -> some View {
        Button {
            model.toggleEditor()
        } label: {
            UserAvatar(user: user, size: 56)
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 28, scale: 0.97))
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill(Sm.text)
                .frame(width: 16, height: 16)
                .overlay { LucideIcon(Lucide.pencil, size: 11, color: .white) }
                .padding(2)
                .background(Color.white, in: Circle())
                .padding(.trailing, -2)
                .padding(.bottom, -2)
                .allowsHitTesting(false)
        }
        .accessibilityLabel(L("acct_change_avatar"))
        .accessibilityAddTraits(expanded ? .isSelected : [])
    }

    private func nameColumn(_ state: SettingsDialogState) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        return VStack(alignment: .leading, spacing: 0) {
            Text(L("profile_name"))
                .font(.nf(12))
                .foregroundStyle(Sm.muted)
                .padding(.bottom, 2)
            TextField(
                "",
                text: Binding(get: { model.state.nameDraft }, set: { model.setNameDraft($0) }),
                prompt: Text(user.googleName ?? L("your_name")).foregroundStyle(Sm.faint)
            )
            .textFieldStyle(.plain)
            .font(.nf(16))
            .foregroundStyle(Sm.text)
            .tint(Sm.ink)
            .lineLimit(1)
            .submitLabel(.done)
            .focused($nameFocused)
            .onSubmit { model.submitName() }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(nameFocused ? Sm.blue : Sm.borderStrong, lineWidth: 1) }
            // :focus 的 outline 2px rgba(35,131,226,.2)，画在描边外侧。
            .background {
                RoundedRectangle(cornerRadius: 10)
                    .fill(nameFocused ? Color(argb: 0x332383E2) : Color.clear)
                    .padding(-2)
            }
            .contentShape(shape)
            .onTapGesture { nameFocused = true }
            .accessibilityLabel(L("profile_name"))
            if let email = user.email {
                Text(email)
                    .font(.nf(13))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 头像编辑区

    private func editorBox(_ state: SettingsDialogState) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        let account = app.account.state
        let photoError = account.photoError.map { photoErrorText($0, app.systemText) }
        return VStack(alignment: .leading, spacing: 0) {
            ProfileEditorTabs(editor: state.editor) { model.setEditor($0) }
            if state.editor == .photo {
                if state.picked, let photo {
                    AvatarCropper(
                        data: photo.data,
                        saving: account.uploading,
                        error: photoError,
                        onCancel: { model.cancelCrop() },
                        onSave: { bytes in model.uploadPhoto(bytes) }
                    )
                    .id(photo.id)
                } else {
                    ProfilePhotoPane(
                        hasPhoto: user.avatarUrl != nil,
                        error: photoError,
                        onUpload: {
                            model.pickPhoto()
                            pickerShown = true
                        },
                        onRemove: { model.removePhoto() }
                    )
                }
            } else {
                // 高 min(320, 屏高 − 220)：iPhone 上总是 320。
                EmojiPickerBody(
                    current: user.icon,
                    height: 320,
                    removeLabel: model.emojiRemoveLabelKey.map { L($0) },
                    onClose: { model.setEditor(.closed) },
                    onPick: { icon in app.account.setIcon(icon) }
                )
            }
        }
        .frame(maxWidth: .infinity)
        .clipShape(shape)
        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1) }
    }
}

/// .notes-picker-tabs：照片 / 表情。左右 8、间距 4、下边 1px 线；标签内边距 10 / 6 / 8、14 的字，
/// 当前的是正文色 500，下边 −1 处 2px 墨色线（盖住分隔线），其余 rgba(55,53,47,.65)。
private struct ProfileEditorTabs: View {
    let editor: AvatarEditor
    let onSelect: (AvatarEditor) -> Void

    var body: some View {
        HStack(spacing: 4) {
            tab(.photo, L("acct_photo"))
            tab(.emoji, L("em_emoji"))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .overlay(alignment: .bottom) { NFDivider() }
    }

    private func tab(_ value: AvatarEditor, _ label: String) -> some View {
        let active = editor == value
        return Button {
            onSelect(value)
        } label: {
            Text(label)
                .font(.nf(14, weight: active ? 500 : 400))
                .foregroundStyle(active ? Sm.text : Color(argb: 0xA637352F))
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .overlay(alignment: .bottom) {
                    if active {
                        Rectangle()
                            .fill(Sm.text)
                            .frame(height: 2)
                            .offset(y: 1)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// .profile-photo-pane：上传按钮、说明、移除照片、错误。内边距 12 / 14 / 14，间距 8。
private struct ProfilePhotoPane: View {
    let hasPhoto: Bool
    let error: String?
    let onUpload: () -> Void
    let onRemove: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onUpload) {
                HStack(spacing: 8) {
                    LucideIcon(Lucide.imagePlus, size: 16, color: Sm.text)
                    Text(L("acct_upload_photo"))
                        .font(.nf(15))
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
            }
            .buttonStyle(.pressable(cornerRadius: 6))
            Text(L("acct_photo_hint"))
                .font(.nf(12))
                .nfLineHeight(18, fontSize: 12)
                .foregroundStyle(Sm.muted)
                .fixedSize(horizontal: false, vertical: true)
            if hasPhoto {
                Button(action: onRemove) {
                    HStack(spacing: 6) {
                        LucideIcon(Lucide.trash2, size: 14, color: Sm.danger)
                        Text(L("acct_remove_photo"))
                            .font(.nf(13))
                            .foregroundStyle(Sm.danger)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                }
                .buttonStyle(.pressable(cornerRadius: 4))
            }
            if let error {
                Text(error)
                    .font(.nf(12))
                    .nfLineHeight(18, fontSize: 12)
                    .foregroundStyle(Sm.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }
}
