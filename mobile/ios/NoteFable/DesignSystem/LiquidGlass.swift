import SwiftUI
import UIKit

// iOS 26+ Liquid Glass compatibility layer (Issue #195 Phase 1).
//
// Targets iOS 17.0+ while building with Xcode 27 / iOS 27 SDK:
// - iOS 26+: native `.glassEffect(_:in:)`, `GlassEffectContainer`, `.safeAreaBar(edge:)`, and system `.sheet` glass.
// - iOS 17–18: frosted Material surfaces (`.regularMaterial` / `.ultraThinMaterial`) + 1px hairline border + `.safeAreaInset(edge:)`.
// - Reduce Transparency (`accessibilityReduceTransparency` or Debug CI `nfForceSolidChrome`): opaque `Sm.surface` / `Sm.border` fallback;
//   on iOS 26+, toggle off via `Glass.identity` to preserve view identity without non-existent `isEnabled:` parameters.

// MARK: - Environment Override (Reduce Transparency Testing)

private struct NFForceSolidChromeKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Debug / CI override forcing opaque solid chrome fallback alongside `accessibilityReduceTransparency`.
    var nfForceSolidChrome: Bool {
        get { self[NFForceSolidChromeKey.self] }
        set { self[NFForceSolidChromeKey.self] = newValue }
    }
}

// MARK: - Glass Surface & Container

enum NFGlassStyle {
    case regular
    case clear
    case interactive
}

extension View {
    /// Applies iOS 26+ Liquid Glass (`Glass.regular` / `.clear`, optionally `.interactive()`),
    /// frosted material on iOS 17–18, or opaque `solidFill` when Reduce Transparency / `nfForceSolidChrome` is active.
    func nfGlassBackground<S: InsettableShape>(
        _ style: NFGlassStyle = .regular,
        in shape: S,
        solidFill: Color = Sm.surface,
        tint: Color? = nil,
        stroke: Color = Sm.border
    ) -> some View {
        modifier(NFGlassBackgroundModifier(
            style: style,
            shape: shape,
            solidFill: solidFill,
            tint: tint,
            stroke: stroke
        ))
    }

    /// Groups nearby Liquid Glass chrome in a `GlassEffectContainer` on iOS 26+; passthrough on iOS 17–18.
    /// Wrapped view helper is `NFGlassContainer`.
    func nfFloatingBar<Bar: View>(
        edge: VerticalEdge,
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = 0,
        @ViewBuilder content: @escaping () -> Bar
    ) -> some View {
        modifier(NFFloatingBarModifier(edge: edge, alignment: alignment, spacing: spacing, bar: content))
    }

    /// Hides or shows the bottom tab bar across iOS 17+, including the iOS 26 Reduce Transparency workaround (FORUM 828566).
    func nfTabBarHidden(_ hidden: Bool) -> some View {
        modifier(NFTabBarHiddenModifier(hidden: hidden))
    }

    /// Presents a native `.sheet` styled with Liquid Glass on iOS 26+, Material on iOS 17–18, or opaque surface under Reduce Transparency.
    func nfSheet<SheetContent: View>(
        isPresented: Binding<Bool>,
        detents: NFSheetDetents = .fitted,
        showsDragIndicator: Bool = true,
        dismissDisabled: Bool = false,
        contentInsets: EdgeInsets = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16),
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> SheetContent
    ) -> some View {
        modifier(NFSheetModifier(
            isPresented: isPresented,
            detents: detents,
            showsDragIndicator: showsDragIndicator,
            dismissDisabled: dismissDisabled,
            contentInsets: contentInsets,
            onDismiss: onDismiss,
            sheetContent: content
        ))
    }
}

/// Groups nearby Liquid Glass controls in `GlassEffectContainer` on iOS 26+.
struct NFGlassContainer<Content: View>: View {
    private let spacing: CGFloat?
    private let content: Content

    init(spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content
            }
        } else {
            content
        }
    }
}

private struct NFGlassBackgroundModifier<S: InsettableShape>: ViewModifier {
    let style: NFGlassStyle
    let shape: S
    let solidFill: Color
    let tint: Color?
    let stroke: Color

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    private var useSolidChrome: Bool {
        reduceTransparency || forceSolidChrome
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            // Keep content in a single structural branch so toggling Reduce Transparency
            // preserves child state (e.g. an open emoji picker's search text and scroll position).
            content
                .background(useSolidChrome ? solidFill : .clear, in: shape)
                .overlay {
                    shape
                        .strokeBorder(useSolidChrome ? stroke : .clear, lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .glassEffect(useSolidChrome ? .identity : resolvedGlass, in: shape)
        } else {
            content
                .background {
                    if useSolidChrome {
                        shape.fill(solidFill)
                    } else {
                        shape
                            .fill(style == .clear ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(.regularMaterial))
                            .overlay {
                                if let tint {
                                    shape.fill(tint)
                                }
                            }
                    }
                }
                .overlay { shape.strokeBorder(stroke, lineWidth: 1).allowsHitTesting(false) }
        }
    }

    @available(iOS 26.0, *)
    private var resolvedGlass: Glass {
        var glass: Glass = (style == .clear) ? .clear : .regular
        if let tint {
            glass = glass.tint(tint)
        }
        if style == .interactive {
            glass = glass.interactive()
        }
        return glass
    }
}

// MARK: - Circular Glass Icon Button

/// Circular floating button rendered with interactive Liquid Glass on iOS 26+, frosted material on iOS 17–18,
/// and solid surface under Reduce Transparency.
struct NFGlassIconButton: View {
    private let icon: [String]
    private let label: String
    private let size: CGFloat
    private let iconSize: CGFloat
    private let strokeWidth: CGFloat
    private let color: Color
    private let solidFill: Color
    private let action: () -> Void

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome
    @Environment(\.isEnabled) private var isEnabled

    init(
        _ icon: [String],
        label: String,
        size: CGFloat = 40,
        iconSize: CGFloat = 18,
        strokeWidth: CGFloat = 2,
        color: Color = Sm.text,
        solidFill: Color = Sm.surface,
        action: @escaping () -> Void
    ) {
        self.icon = icon
        self.label = label
        self.size = size
        self.iconSize = iconSize
        self.strokeWidth = strokeWidth
        self.color = color
        self.solidFill = solidFill
        self.action = action
    }

    private var useSolidChrome: Bool {
        reduceTransparency || forceSolidChrome
    }

    var body: some View {
        Button(action: action) {
            LucideIcon(icon, size: iconSize, strokeWidth: strokeWidth, color: isEnabled ? color : Sm.faint)
                .frame(width: size, height: size)
                .nfGlassBackground(.interactive, in: Circle(), solidFill: solidFill, stroke: Sm.borderStrong)
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: size / 2, scale: 0.96, disabledOpacity: 0.6))
        .shadow(color: shadowColor, radius: 6, x: 0, y: 2)
        .accessibilityLabel(label)
    }

    private var shadowColor: Color {
        if #available(iOS 26.0, *), !useSolidChrome {
            return .clear
        }
        return Color(light: 0x140F172A, dark: 0x4D000000)
    }
}

// MARK: - Floating Safe-Area Bar

private struct NFFloatingBarModifier<Bar: View>: ViewModifier {
    let edge: VerticalEdge
    let alignment: HorizontalAlignment
    let spacing: CGFloat?
    @ViewBuilder let bar: () -> Bar

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.safeAreaBar(edge: edge, alignment: alignment, spacing: spacing, content: bar)
        } else {
            content.safeAreaInset(edge: edge, alignment: alignment, spacing: spacing ?? 0, content: bar)
        }
    }
}

// MARK: - Tab Bar Visibility & Template Icons

private struct NFTabBarHiddenModifier: ViewModifier {
    let hidden: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    private var useSolidChrome: Bool {
        reduceTransparency || forceSolidChrome
    }

    func body(content: Content) -> some View {
        base(content)
            .background {
                TabBarVisibilityBridge(hidden: hidden, solidChrome: useSolidChrome)
                    .frame(width: 0, height: 0)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
    }

    @ViewBuilder
    private func base(_ content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.toolbarVisibility(hidden ? .hidden : .automatic, for: .tabBar)
        } else {
            content.toolbar(hidden ? .hidden : .automatic, for: .tabBar)
        }
    }
}

/// Mitigates DTS-acknowledged iOS 26 bug (FORUM 828566) where hiding a tab bar with Reduce Transparency on
/// leaves an opaque white bar blocking touches. Scoped strictly to iOS 26.x when solid/reduced transparency is active.
private struct TabBarVisibilityBridge: UIViewControllerRepresentable {
    let hidden: Bool
    let solidChrome: Bool

    func makeUIViewController(context: Context) -> BridgeViewController {
        let controller = BridgeViewController()
        controller.targetHidden = hidden
        controller.solidChrome = solidChrome
        return controller
    }

    func updateUIViewController(_ uiViewController: BridgeViewController, context: Context) {
        uiViewController.targetHidden = hidden
        uiViewController.solidChrome = solidChrome
        uiViewController.syncTabBarVisibility()
    }

    final class BridgeViewController: UIViewController {
        var targetHidden = false
        var solidChrome = false

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            syncTabBarVisibility()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            syncTabBarVisibility()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            syncTabBarVisibility()
        }

        func syncTabBarVisibility() {
            if #available(iOS 27.0, *) {
                return
            } else if #available(iOS 26.0, *) {
                guard solidChrome || !targetHidden, let tabBarController else { return }
                if tabBarController.isTabBarHidden != targetHidden {
                    tabBarController.setTabBarHidden(targetHidden, animated: false)
                }
                if tabBarController.tabBar.isHidden != targetHidden {
                    tabBarController.tabBar.isHidden = targetHidden
                }
            }
        }
    }
}

/// Pre-rendered template UIImages derived directly from `Lucide` vector paths so system `TabView` / `UITabBar`
/// renders matching brand icons with automatic Liquid Glass tinting on iOS 17–27.
@MainActor
enum NFGlassTabIcons {
    static let chat: UIImage = render(Lucide.messageSquareText)
    static let workspace: UIImage = render(Lucide.layoutGrid)
    static let search: UIImage = render(Lucide.search)

    private static func render(_ paths: [String], canvasSize: CGFloat = 24, glyphSize: CGFloat = 21, strokeWidth: CGFloat = 1.9) -> UIImage {
        let format = UIGraphicsImageRendererFormat.preferred()
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasSize, height: canvasSize), format: format)
        let cgPath = SVGPath.icon(paths).cgPath
        let image = renderer.image { context in
            let cg = context.cgContext
            let scale = glyphSize / 24.0
            let offset = (canvasSize - glyphSize) / 2.0
            cg.translateBy(x: offset, y: offset)
            cg.scaleBy(x: scale, y: scale)
            cg.addPath(cgPath)
            cg.setStrokeColor(UIColor.black.cgColor)
            cg.setLineWidth(strokeWidth)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            cg.strokePath()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
}

// MARK: - Native System Sheets

enum NFSheetDetents {
    case fitted
    case mediumAndLarge
}

private struct NFSheetModifier<SheetContent: View>: ViewModifier {
    @Binding var isPresented: Bool
    let detents: NFSheetDetents
    let showsDragIndicator: Bool
    let dismissDisabled: Bool
    let contentInsets: EdgeInsets
    let onDismiss: (() -> Void)?
    let sheetContent: () -> SheetContent

    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.locale) private var locale
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented, onDismiss: onDismiss) {
            NFSheetContainer(
                detents: detents,
                showsDragIndicator: showsDragIndicator,
                dismissDisabled: dismissDisabled,
                contentInsets: contentInsets,
                content: sheetContent
            )
            .environment(\.layoutDirection, layoutDirection)
            .environment(\.locale, locale)
            .environment(\.nfForceSolidChrome, forceSolidChrome)
        }
    }
}

private struct NFSheetContainer<SheetContent: View>: View {
    let detents: NFSheetDetents
    let showsDragIndicator: Bool
    let dismissDisabled: Bool
    let contentInsets: EdgeInsets
    let content: () -> SheetContent

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome
    @State private var fittedHeight: CGFloat = 320

    private var useSolidChrome: Bool {
        reduceTransparency || forceSolidChrome
    }

    var body: some View {
        sheetBody
            .environment(\.nfDismiss, NFDismissAction(action: { dismiss() }))
            .nfOverlayHost()
            .presentationDragIndicator(showsDragIndicator ? .visible : .hidden)
            .interactiveDismissDisabled(dismissDisabled)
            .modifier(NFSheetDetentsApplier(detents: detents, fittedHeight: fittedHeight))
            .modifier(NFSheetChromeApplier(useSolidChrome: useSolidChrome))
    }

    @ViewBuilder
    private var sheetBody: some View {
        switch detents {
        case .fitted:
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    content()
                }
                .nfOverlayContentDefaults()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(contentInsets)
                .nfOnSizeChange { size in
                    let height = clampedFittedHeight(size.height)
                    if abs(fittedHeight - height) > 0.5 {
                        fittedHeight = height
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        case .mediumAndLarge:
            VStack(alignment: .leading, spacing: 0) {
                content()
            }
            .nfOverlayContentDefaults()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func clampedFittedHeight(_ raw: CGFloat) -> CGFloat {
        let screenHeight = UIScreen.main.bounds.height
        let maxHeight = max(260, screenHeight * 0.88)
        return min(maxHeight, max(140, raw))
    }
}

private struct NFSheetDetentsApplier: ViewModifier {
    let detents: NFSheetDetents
    let fittedHeight: CGFloat

    func body(content: Content) -> some View {
        switch detents {
        case .fitted:
            content.presentationDetents([.height(fittedHeight)])
        case .mediumAndLarge:
            content.presentationDetents([.medium, .large])
        }
    }
}

private struct NFSheetChromeApplier: ViewModifier {
    let useSolidChrome: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if useSolidChrome {
                content.presentationBackground(Sm.surface)
            } else {
                // Leave presentationBackground unset on iOS 26+ so system Liquid Glass renders naturally.
                content
            }
        } else {
            content.presentationBackground(useSolidChrome ? AnyShapeStyle(Sm.surface) : AnyShapeStyle(.regularMaterial))
        }
    }
}
