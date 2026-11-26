import SwiftUI
import UIKit

// 笔记公开分享对话框（网页 note-share-dialog.tsx；Android ui/NoteShareDialog.kt）。
@MainActor
struct NoteShareDialog: View {
    let pageId: String
    /// 幻灯片只公开它自己（公开树的叶子），不显示“包含子页面”。
    var kind: PageKind = .note
    @Binding var busy: Bool
    let close: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.openURL) private var openURL
    @Environment(\.nfChromePath) private var chromePath

    @State private var share: NoteShareState? = nil
    @State private var draftIncludeSubpages = true
    @State private var customMode = false
    @State private var customDate = Date().addingTimeInterval(86400)
    @State private var loading = true
    @State private var error: String? = nil
    @State private var copiedKey: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                LucideIcon(Lucide.globe, size: 17, color: Sm.text)
                Text(L("share_publish_to_web"))
                    .font(.nf(16, weight: 600))
                    .foregroundStyle(Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NFIconButton(Lucide.x, label: L("close"), iconSize: 18) { close() }
            }

            if loading {
                Text(L("sb_loading"))
                    .font(.nf(14))
                    .foregroundStyle(Sm.muted)
            } else if let s = share {
                if let inherited = s.inheritedFrom {
                    VStack(alignment: .leading, spacing: 8) {
                        let title = inherited.title.isEmpty ? L("sb_untitled") : inherited.title
                        Text(s.excludeFromParent ? L("share_excluded_parent", title) : L("share_via_parent", title))
                            .font(.nf(13, weight: 500))
                            .foregroundStyle(Sm.text)
                        if let inheritedUrl = s.inheritedUrl, !inheritedUrl.isEmpty {
                            urlRow(url: inheritedUrl, key: "inherited")
                        }
                        switchRow(
                            label: L("share_exclude_from_parent"),
                            checked: s.excludeFromParent,
                            action: { save(NoteSharePatch(excludeFromParent: !s.excludeFromParent)) }
                        )
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(chromePath == .native ? Color.primary.opacity(0.055) : Sm.sidebar, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(chromePath == .solid ? Sm.border : .clear, lineWidth: 1))
                } else if s.hasParent {
                    switchRow(
                        label: L("share_exclude_from_parent"),
                        checked: s.excludeFromParent,
                        action: { save(NoteSharePatch(excludeFromParent: !s.excludeFromParent)) }
                    )
                }

                if !s.active {
                    if s.expired {
                        Text(L("share_expired"))
                            .font(.nf(13))
                            .foregroundStyle(Color(light: 0xFF9A5209, dark: 0xFFFBBF24))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(argb: 0x1AD9730D), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else {
                        Text(L("share_desc"))
                            .font(.nf(14))
                            .foregroundStyle(Sm.muted)
                    }

                    if kind != .slides {
                        switchRow(
                            label: L("share_include_subpages"),
                            checked: draftIncludeSubpages,
                            action: { draftIncludeSubpages.toggle() }
                        )
                    }

                    Button {
                        save(NoteSharePatch(enabled: true, includeSubpages: draftIncludeSubpages))
                    } label: {
                        Text(s.expired ? L("share_republish") : L("share_publish"))
                            .font(.nf(15, weight: 600))
                            .foregroundStyle(Sm.onInk)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(busy ? Sm.ink.opacity(0.5) : Sm.ink, in: Capsule())
                    }
                    .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 22, scale: 0.97))
                    .disabled(busy)
                } else {
                    if let url = s.url, !url.isEmpty {
                        urlRow(url: url, key: "own")
                    }

                    if kind != .slides {
                        switchRow(
                            label: L("share_include_subpages"),
                            checked: s.includeSubpages,
                            action: { save(NoteSharePatch(includeSubpages: !s.includeSubpages)) }
                        )
                    }

                    NFDivider()

                    VStack(alignment: .leading, spacing: 6) {
                        Text(L("share_link_expires"))
                            .font(.nf(14))
                            .foregroundStyle(Sm.text)
                        expiryPresets(currentExpiresAt: s.expiresAt)
                        if customMode {
                            HStack(spacing: 8) {
                                DatePicker(
                                    "",
                                    selection: $customDate,
                                    in: Date().addingTimeInterval(60)...,
                                    displayedComponents: [.date, .hourAndMinute]
                                )
                                .labelsHidden()
                                Spacer()
                                NotionButton(L("share_set"), kind: .primary) {
                                    customMode = false
                                    let iso = ISO8601DateFormatter().string(from: customDate)
                                    save(NoteSharePatch(setExpiresAt: true, expiresAt: iso))
                                }
                                .disabled(busy)
                            }
                        } else if let expiresAt = s.expiresAt {
                            Text(L("share_expires_time", formatExpiry(expiresAt)))
                                .font(.nf(12))
                                .foregroundStyle(Sm.muted)
                        }
                    }

                    NFDivider()

                    HStack {
                        Spacer()
                        NotionButton(L("share_unpublish"), kind: .danger) {
                            save(NoteSharePatch(enabled: false))
                        }
                        .disabled(busy)
                    }
                }
            }

            if let error {
                Text(error)
                    .font(.nf(13))
                    .foregroundStyle(Sm.danger)
            }
        }
        .task(id: pageId) {
            await load()
        }
    }

    private func urlRow(url: String, key: String) -> some View {
        let boxShape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let boxFill = chromePath == .native ? Color.primary.opacity(0.065) : Sm.surface
        let pillFill = chromePath == .native ? Color.primary.opacity(0.075) : Sm.surface
        let stroke = chromePath == .solid ? Sm.borderStrong : .clear
        return HStack(spacing: 6) {
            Text(url)
                .font(.nf(12))
                .foregroundStyle(Sm.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                .background(boxFill, in: boxShape)
                .overlay(boxShape.strokeBorder(stroke, lineWidth: 1))

            Button {
                Haptics.light()
                copyUrl(url, key: key)
            } label: {
                HStack(spacing: 4) {
                    LucideIcon(copiedKey == key ? Lucide.check : Lucide.copy, size: 14, color: Sm.text)
                    Text(copiedKey == key ? L("answer_copied") : L("share_copy_link"))
                        .font(.nf(12, weight: 600))
                        .foregroundStyle(Sm.text)
                }
                .padding(.horizontal, 12)
                .frame(height: 36)
                .overlay(Capsule().strokeBorder(stroke, lineWidth: 1))
            }
            .buttonStyle(.pressable(background: pillFill, pressedBackground: Sm.active, cornerRadius: 18, scale: 0.97))

            Button {
                if let parsed = URL(string: url) { openURL(parsed) }
            } label: {
                LucideIcon(Lucide.externalLink, size: 15, color: Sm.muted)
                    .frame(width: 36, height: 36)
                    .overlay(Circle().strokeBorder(stroke, lineWidth: 1))
            }
            .buttonStyle(.pressable(background: pillFill, pressedBackground: Sm.active, cornerRadius: 18, scale: 0.97))
            .accessibilityLabel(L("share_open_link"))
        }
    }

    private func switchRow(label: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Toggle(isOn: Binding(
            get: { checked },
            set: { _ in
                Haptics.selection()
                action()
            }
        )) {
            Text(label)
                .font(.nf(14))
                .foregroundStyle(Sm.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tint(Sm.blue)
        .frame(minHeight: 38)
        .padding(.horizontal, 4)
        .disabled(busy)
    }

    private func expiryPresets(currentExpiresAt: String?) -> some View {
        let presets: [(String, TimeInterval?)] = [
            (L("share_never"), nil),
            (L("share_1h"), 3600),
            (L("share_1d"), 86400),
            (L("share_7d"), 7 * 86400),
            (L("share_30d"), 30 * 86400),
        ]
        let defaultBg = chromePath == .native ? Color.primary.opacity(0.065) : Sm.surface
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(presets.enumerated()), id: \.offset) { _, preset in
                    let selected = preset.1 == nil && currentExpiresAt == nil
                    Button {
                        Haptics.selection()
                        customMode = false
                        let nextIso = preset.1.map { seconds in
                            ISO8601DateFormatter().string(from: Date().addingTimeInterval(seconds))
                        }
                        save(NoteSharePatch(setExpiresAt: true, expiresAt: nextIso))
                    } label: {
                        Text(preset.0)
                            .font(.nf(12.5, weight: selected ? 600 : 500))
                            .foregroundStyle(selected ? Sm.blue : Sm.text)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .overlay {
                                if chromePath == .solid || selected {
                                    Capsule().strokeBorder(selected ? Sm.blue : Sm.borderStrong, lineWidth: 1)
                                }
                            }
                    }
                    .buttonStyle(.pressable(background: selected ? Sm.accentSoft : defaultBg, cornerRadius: 16, scale: 0.97))
                    .disabled(busy)
                }
                Button {
                    Haptics.selection()
                    customDate = Date().addingTimeInterval(86400)
                    customMode = true
                } label: {
                    Text(L("share_custom_date"))
                        .font(.nf(12.5, weight: customMode ? 600 : 500))
                        .foregroundStyle(customMode ? Sm.blue : Sm.text)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .overlay {
                            if chromePath == .solid || customMode {
                                Capsule().strokeBorder(customMode ? Sm.blue : Sm.borderStrong, lineWidth: 1)
                            }
                        }
                }
                .buttonStyle(.pressable(background: customMode ? Sm.accentSoft : defaultBg, cornerRadius: 16, scale: 0.97))
                .disabled(busy)
            }
        }
    }

    private func load() async {
        loading = true
        error = nil
        do {
            let loaded = try await app.notes.loadShare(pageId)
            share = loaded
            draftIncludeSubpages = loaded.includeSubpages
        } catch {
            self.error = localizedError(error, fallback: L("share_load_failed"))
        }
        loading = false
    }

    private func save(_ patch: NoteSharePatch) {
        if busy { return }
        busy = true
        error = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                let updated = try await app.notes.updateShare(pageId, patch)
                share = updated
                draftIncludeSubpages = updated.includeSubpages
            } catch {
                self.error = localizedError(error, fallback: L("share_update_failed"))
            }
        }
    }

    private func copyUrl(_ url: String, key: String) {
        UIPasteboard.general.string = url
        copiedKey = key
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            if copiedKey == key { copiedKey = nil }
        }
    }

    private func localizedError(_ err: Error, fallback: String) -> String {
        if let api = err as? ApiException, !api.message.isEmpty {
            return app.systemText.localize(api.message)
        }
        return fallback
    }

    private func formatExpiry(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }
}
