import SwiftUI
import UIKit

// 笔记公开分享对话框（网页 note-share-dialog.tsx；Android ui/NoteShareDialog.kt）。
@MainActor
struct NoteShareDialog: View {
    let pageId: String
    @Binding var busy: Bool
    let close: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.openURL) private var openURL

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
                    .font(.nf(16, weight: .semibold))
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
                            .font(.nf(13, weight: .medium))
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
                    .background(Sm.sidebar, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Sm.border, lineWidth: 1))
                }

                if !s.active {
                    if s.expired {
                        Text(L("share_expired"))
                            .font(.nf(13))
                            .foregroundStyle(Color(argb: 0xFF9A5209))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(argb: 0x1AD9730D), in: RoundedRectangle(cornerRadius: 6))
                    } else {
                        Text(L("share_desc"))
                            .font(.nf(14))
                            .foregroundStyle(Sm.muted)
                    }

                    switchRow(
                        label: L("share_include_subpages"),
                        checked: draftIncludeSubpages,
                        action: { draftIncludeSubpages.toggle() }
                    )

                    Button {
                        save(NoteSharePatch(enabled: true, includeSubpages: draftIncludeSubpages))
                    } label: {
                        Text(s.expired ? L("share_republish") : L("share_publish"))
                            .font(.nf(14, weight: .medium))
                            .foregroundStyle(Color.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                            .background(busy ? Sm.text.opacity(0.5) : Sm.text, in: RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                } else {
                    if let url = s.url, !url.isEmpty {
                        urlRow(url: url, key: "own")
                    }

                    switchRow(
                        label: L("share_include_subpages"),
                        checked: s.includeSubpages,
                        action: { save(NoteSharePatch(includeSubpages: !s.includeSubpages)) }
                    )

                    Rectangle().fill(Sm.border).frame(height: 1)

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
                                Button {
                                    customMode = false
                                    let iso = ISO8601DateFormatter().string(from: customDate)
                                    save(NoteSharePatch(setExpiresAt: true, expiresAt: iso))
                                } label: {
                                    Text(L("share_set"))
                                        .font(.nf(12, weight: .medium))
                                        .foregroundStyle(Color.white)
                                        .padding(.horizontal, 12)
                                        .frame(height: 30)
                                        .background(Sm.text, in: RoundedRectangle(cornerRadius: 6))
                                }
                                .buttonStyle(.plain)
                                .disabled(busy)
                            }
                        } else if let expiresAt = s.expiresAt {
                            Text(L("share_expires_time", formatExpiry(expiresAt)))
                                .font(.nf(12))
                                .foregroundStyle(Sm.muted)
                        }
                    }

                    Rectangle().fill(Sm.border).frame(height: 1)

                    HStack {
                        Spacer()
                        Button {
                            save(NoteSharePatch(enabled: false))
                        } label: {
                            Text(L("share_unpublish"))
                                .font(.nf(13, weight: .medium))
                                .foregroundStyle(Color(argb: 0xFFB91C1C))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 34)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Sm.borderStrong, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                    }
                }
            }

            if let error {
                Text(error)
                    .font(.nf(13))
                    .foregroundStyle(Color(argb: 0xFFB91C1C))
            }
        }
        .task(id: pageId) {
            await load()
        }
    }

    private func urlRow(url: String, key: String) -> some View {
        HStack(spacing: 6) {
            Text(url)
                .font(.nf(12))
                .foregroundStyle(Sm.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Sm.borderStrong, lineWidth: 1))

            Button {
                copyUrl(url, key: key)
            } label: {
                HStack(spacing: 4) {
                    LucideIcon(copiedKey == key ? Lucide.check : Lucide.copy, size: 14, color: Sm.text)
                    Text(copiedKey == key ? L("answer_copied") : L("share_copy_link"))
                        .font(.nf(12, weight: .medium))
                        .foregroundStyle(Sm.text)
                }
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Sm.borderStrong, lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button {
                if let parsed = URL(string: url) { openURL(parsed) }
            } label: {
                LucideIcon(Lucide.externalLink, size: 15, color: Sm.muted)
                    .frame(width: 34, height: 34)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Sm.borderStrong, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("share_open_link"))
        }
    }

    private func switchRow(label: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label)
                    .font(.nf(14))
                    .foregroundStyle(Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ZStack(alignment: checked ? .trailing : .leading) {
                    Capsule()
                        .fill(checked ? Sm.blue : Color(argb: 0x3337352F))
                        .frame(width: 26, height: 14)
                    Circle()
                        .fill(Color.white)
                        .frame(width: 10, height: 10)
                        .padding(2)
                }
            }
            .frame(minHeight: 36)
            .padding(.horizontal, 4)
        }
        .buttonStyle(.plain)
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
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(presets.enumerated()), id: \.offset) { _, preset in
                    let selected = preset.1 == nil && currentExpiresAt == nil
                    Button {
                        customMode = false
                        let nextIso = preset.1.map { seconds in
                            ISO8601DateFormatter().string(from: Date().addingTimeInterval(seconds))
                        }
                        save(NoteSharePatch(setExpiresAt: true, expiresAt: nextIso))
                    } label: {
                        Text(preset.0)
                            .font(.nf(12, weight: selected ? .semibold : .regular))
                            .foregroundStyle(Sm.text)
                            .padding(.horizontal, 10)
                            .frame(height: 30)
                            .background(selected ? Sm.hover : Color.white, in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? Sm.text : Sm.borderStrong, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                }
                Button {
                    customDate = Date().addingTimeInterval(86400)
                    customMode = true
                } label: {
                    Text(L("share_custom_date"))
                        .font(.nf(12, weight: customMode ? .semibold : .regular))
                        .foregroundStyle(Sm.text)
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(customMode ? Sm.hover : Color.white, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(customMode ? Sm.text : Sm.borderStrong, lineWidth: 1))
                }
                .buttonStyle(.plain)
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
                share = try await app.notes.updateShare(pageId, patch)
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
            return app.systemText.translator(app.language.uiLocale).localize(api.message)
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
