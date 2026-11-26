import SwiftUI
import UIKit

// Shared floating chrome for Issue #195 Phase 2/3: the rendering-path resolver, iOS 26 toolbar metrics,
// floating bar backdrops, grouped glass capsules, and the per-tab bottom obstruction used to place toasts.
//
// Three rendering paths, one resolver (`NFChromePath.resolve`):
// - native (iOS 26+): Liquid Glass. Floating bars use `safeAreaBar`, whose system scroll edge effect is the backdrop.
// - material (iOS 17–18): `.regularMaterial` controls over a `Material.bar` strip with a hairline.
// - solid (Reduce Transparency or Debug/CI `nfForceSolidChrome`): today's flat `Sm.background` strips and
//   `Sm.surface` controls with `Sm.border` / `Sm.borderStrong` strokes.
// A path switch only changes values (fill, `Glass.identity`, shadow colour), never view structure, except inside
// `.background {}` backdrops, so toggling Reduce Transparency keeps text views, fields and open pickers alive.

// MARK: - Rendering Path

/// Rendering path for floating chrome. Single source of truth for primitives, views and the fixture READY line.
enum NFChromePath: String, Sendable {
    case native, material, solid

    static func resolve(reduceTransparency: Bool, forceSolid: Bool) -> NFChromePath {
        if reduceTransparency || forceSolid { return .solid }
        if #available(iOS 26.0, *) { return .native }
        return .material
    }
}

extension NFChromePath {
    /// Default glyph / text colour on small glass (circles, capsules, groups): system primary on native glass
    /// (glass gives it an adaptive vibrant colour that flips over dark content), brand `Sm.text` otherwise.
    var primaryInk: Color { self == .native ? Color.primary : Sm.text }

    /// Secondary glyph / text colour on small glass: system secondary on native glass, brand `Sm.muted` otherwise.
    var secondaryInk: Color { self == .native ? Color.secondary : Sm.muted }
}

extension EnvironmentValues {
    /// The chrome path for this environment: `NFChromePath.resolve` over `accessibilityReduceTransparency`
    /// and `nfForceSolidChrome`. Read it with `@Environment(\.nfChromePath) private var chromePath`.
    var nfChromePath: NFChromePath {
        NFChromePath.resolve(reduceTransparency: accessibilityReduceTransparency, forceSolid: nfForceSolidChrome)
    }

    /// The app window's full frame in the root SwiftUI coordinate space, including container safe areas.
    var nfWindowFrame: CGRect? {
        get { self[NFWindowFrameKey.self] }
        set { self[NFWindowFrameKey.self] = newValue }
    }
}

private struct NFWindowFrameKey: EnvironmentKey {
    static let defaultValue: CGRect? = nil
}

/// Height of the app window for layout caps (dialog lists, sheets): the measured root frame (`nfWindowFrame`), or the
/// foreground window before the first measurement. Never the screen: iPad multitasking and iPhone Duo windows are smaller.
@MainActor
func nfWindowHeight(_ frame: CGRect?) -> CGFloat {
    if let frame, frame.height > 0 { return frame.height }
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    return window?.bounds.height ?? 600
}

// MARK: - Metrics

/// iOS 26 toolbar metrics for floating chrome.
enum NFChromeMetrics {
    /// Height of a floating top / bottom bar.
    static let barHeight: CGFloat = 56
    /// Height of a glass circle, group or capsule (keep every glass control at or under 50pt, FORUM 824376).
    static let control: CGFloat = 44
    static let sideInset: CGFloat = 16
    /// Editor bar only.
    static let compactSideInset: CGFloat = 12
    /// Gap between separate glass shapes.
    static let gap: CGFloat = 8
    /// `GlassEffectContainer` spacing; equal to `gap`, so shapes stay separate at rest (WWDC25-323).
    static let containerSpacing: CGFloat = 8
    /// Width of one item inside an `NFGlassGroup`.
    static let groupItemWidth: CGFloat = 40
    /// Shadow under glass controls off the native path (same value `NFGlassIconButton` used in Phase 1).
    static let controlShadow = Color(light: 0x140F172A, dark: 0x4D000000)
}

// MARK: - Tab Bar Minimize

/// Deploy-target-safe mirror of `TabBarMinimizeBehavior` (iOS 26+).
enum NFTabBarMinimize: Sendable {
    case never, onScrollUp, onScrollDown
}

// MARK: - View Helpers

extension View {
    /// Backdrop for a floating bar's own region (put it on the bar content).
    /// - solid: `solidFill` strip extended into the safe area of `edge`, plus an `NFDivider` on the inner edge if `divider`.
    /// - native: `Color.clear` (the system scroll edge effect of `safeAreaBar` does the work).
    /// - material: `Material.bar` strip extended the same way, plus the hairline if `divider`.
    func nfBarBackdrop(_ edge: VerticalEdge, solidFill: Color = Sm.background, divider: Bool = true) -> some View {
        modifier(NFBarBackdropModifier(edge: edge, solidFill: solidFill, divider: divider))
    }

    /// `nfFloatingBar` + `nfBarBackdrop` + `.contentShape(Rectangle())` on the bar content, spanning the full width.
    /// The default for every floating bar. Callers wrap the bar's glass in exactly one `NFGlassContainer`.
    func nfFloatingHeader<Bar: View>(
        edge: VerticalEdge = .top,
        solidFill: Color = Sm.background,
        divider: Bool = true,
        spacing: CGFloat? = 0,
        systemBar: Bool = true,
        @ViewBuilder content: @escaping () -> Bar
    ) -> some View {
        nfFloatingBar(edge: edge, spacing: spacing, systemBar: systemBar) {
            content()
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .nfBarBackdrop(edge, solidFill: solidFill, divider: divider)
        }
    }

    /// Capsule glass for labels that are not NFGlass buttons (Menu labels, segment tracks).
    func nfGlassCapsule(
        _ style: NFGlassStyle = .regular,
        solidFill: Color = Sm.surface,
        stroke: Color = Sm.borderStrong
    ) -> some View {
        nfGlassBackground(style, in: Capsule(), solidFill: solidFill, stroke: stroke)
    }

    /// Shadow drawn only off the native path. On native the modifier stays and the colour becomes `.clear`
    /// (a value change only): iOS 26 glass carries its own depth.
    func nfChromeShadow(_ color: Color, radius: CGFloat, x: CGFloat = 0, y: CGFloat = 0) -> some View {
        modifier(NFChromeShadowModifier(color: color, radius: radius, x: x, y: y))
    }

    /// iOS 26+: `.tabBarMinimizeBehavior(_:)` with the mapped behaviour (put it on the `TabView`); below: passthrough.
    func nfTabBarMinimize(_ behavior: NFTabBarMinimize) -> some View {
        modifier(NFTabBarMinimizeModifier(behavior: behavior))
    }

    /// Reports how much of the window bottom is covered by this tab's chrome (tab bar + bottom floating bars + home
    /// indicator) to `NFBottomChrome.shared`. Put it on the content view *inside* the bars.
    func nfReportsBottomChrome(_ tab: AppTab) -> some View {
        modifier(NFReportsBottomChromeModifier(tab: tab))
    }
}

// MARK: - Glass Group

/// Shared capsule of adjacent bar actions (iOS 26 toolbar grouping). Items are `NFGlassBarButton`s (no glass of their own).
///
/// ```swift
/// NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
///     NFGlassGroup(glassID: "chatTrailing", namespace: barGlass) {
///         NFGlassBarButton(Lucide.plus, label: L("new_chat")) { newChat() }
///         NFGlassBarButton(Lucide.moreHorizontal, label: moreLabel) { openMenu() }
///     }
/// }
/// ```
struct NFGlassGroup<Content: View>: View {
    private let glassID: String?
    private let namespace: Namespace.ID?
    private let content: Content

    init(glassID: String? = nil, namespace: Namespace.ID? = nil, @ViewBuilder content: () -> Content) {
        self.glassID = glassID
        self.namespace = namespace
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 0) {
            content
        }
        .padding(.horizontal, 2)
        .frame(height: NFChromeMetrics.control)
        .nfGlassBackground(.interactive, in: Capsule(), solidFill: Sm.surface, stroke: Sm.borderStrong)
        .modifier(NFGlassEffectIDModifier(id: glassID, namespace: namespace))
        .nfChromeShadow(NFChromeMetrics.controlShadow, radius: 6, y: 2)
        .fixedSize()
    }
}

/// Plain item inside an `NFGlassGroup` (no glass of its own: no glass on glass).
/// The glyph defaults to the path's primary ink (rule 1.5); `color` overrides it (brand colours stay brand colours),
/// and `activeFill` draws a 32pt circle behind the glyph for an "on" state (for example share active).
struct NFGlassBarButton: View {
    private let icon: [String]
    private let label: String
    private let width: CGFloat
    private let height: CGFloat
    private let iconSize: CGFloat
    private let strokeWidth: CGFloat
    private let color: Color?
    private let activeFill: Color?
    private let action: () -> Void

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome
    @Environment(\.isEnabled) private var isEnabled

    init(
        _ icon: [String],
        label: String,
        width: CGFloat = NFChromeMetrics.groupItemWidth,
        height: CGFloat = NFChromeMetrics.control,
        iconSize: CGFloat = 20,
        strokeWidth: CGFloat = 2,
        color: Color? = nil,
        activeFill: Color? = nil,
        action: @escaping () -> Void
    ) {
        self.icon = icon
        self.label = label
        self.width = width
        self.height = height
        self.iconSize = iconSize
        self.strokeWidth = strokeWidth
        self.color = color
        self.activeFill = activeFill
        self.action = action
    }

    var body: some View {
        let path = NFChromePath.resolve(reduceTransparency: reduceTransparency, forceSolid: forceSolidChrome)
        let resolved = color ?? path.primaryInk
        Button(action: action) {
            LucideIcon(icon, size: iconSize, strokeWidth: strokeWidth, color: isEnabled ? resolved : Sm.faint)
                .frame(width: width, height: height)
                .background {
                    if let activeFill {
                        Circle()
                            .fill(activeFill)
                            .frame(width: 32, height: 32)
                    }
                }
        }
        .buttonStyle(.pressable(
            pressedBackground: Sm.active,
            cornerRadius: min(width, height) / 2,
            scale: 1,
            disabledOpacity: 0.6
        ))
        .accessibilityLabel(label)
    }
}

// MARK: - Bottom Obstruction (Toast Placement)

/// Per-tab bottom obstruction for toast placement: how many points from the window bottom each tab's chrome covers
/// (tab bar, bottom floating bars, home indicator). Tabs report through `nfReportsBottomChrome(_:)`; the toast host
/// reads `obstruction(for:)` and passes it to `toastBottomClearance` (Core). A tab that never reported reads nil.
@MainActor
@Observable
final class NFBottomChrome {
    static let shared = NFBottomChrome()

    private(set) var obstructions: [AppTab: CGFloat] = [:]

    private init() {}

    func obstruction(for tab: AppTab) -> CGFloat? {
        obstructions[tab]
    }

    /// Rounds to 1pt (never negative) and ignores changes under 0.5pt, so layout noise does not re-render observers.
    func report(_ value: CGFloat, for tab: AppTab) {
        let rounded = max(0, value.rounded())
        if let current = obstructions[tab], abs(current - rounded) < 0.5 { return }
        obstructions[tab] = rounded
    }
}

// MARK: - Modifiers

private struct NFBarBackdropModifier: ViewModifier {
    let edge: VerticalEdge
    let solidFill: Color
    let divider: Bool

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    func body(content: Content) -> some View {
        let path = NFChromePath.resolve(reduceTransparency: reduceTransparency, forceSolid: forceSolidChrome)
        let innerEdge: Alignment = (edge == .top) ? .bottom : .top
        // The strip also runs under the side safe areas (landscape iPhone / unfolded iPhone Duo), not only the outer edge.
        let outerEdges: Edge.Set = (edge == .top) ? [.top, .horizontal] : [.bottom, .horizontal]
        content
            .background {
                ZStack(alignment: innerEdge) {
                    fill(path)
                    if divider && path != .native {
                        NFDivider()
                    }
                }
                .ignoresSafeArea(.container, edges: outerEdges)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }

    @ViewBuilder
    private func fill(_ path: NFChromePath) -> some View {
        switch path {
        case .native:
            Color.clear
        case .material:
            Rectangle().fill(Material.bar)
        case .solid:
            Rectangle().fill(solidFill)
        }
    }
}

private struct NFChromeShadowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    func body(content: Content) -> some View {
        let path = NFChromePath.resolve(reduceTransparency: reduceTransparency, forceSolid: forceSolidChrome)
        content.shadow(color: path == .native ? Color.clear : color, radius: radius, x: x, y: y)
    }
}

private struct NFTabBarMinimizeModifier: ViewModifier {
    let behavior: NFTabBarMinimize

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(mapped)
        } else {
            content
        }
    }

    @available(iOS 26.0, *)
    private var mapped: TabBarMinimizeBehavior {
        switch behavior {
        case .never:
            return .never
        case .onScrollUp:
            return .onScrollUp
        case .onScrollDown:
            return .onScrollDown
        }
    }
}

/// Fixed per process and call site: the `#available` branch never flips, and the ID is optional polish (glass morph).
private struct NFGlassEffectIDModifier: ViewModifier {
    let id: String?
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if let namespace, let id {
                content.glassEffectID(id, in: namespace)
            } else {
                content
            }
        } else {
            content
        }
    }
}

@MainActor
private struct NFReportsBottomChromeModifier: ViewModifier {
    let tab: AppTab
    @Environment(\.nfWindowFrame) private var windowFrame

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { proxy in
                    // This reader respects the safe area, so its frame already ends where the bottom safe area
                    // (bottom bars, tab bar, keyboard, home indicator) starts; `safeAreaInsets.bottom` only reports
                    // that excluded strip, so subtracting it again would count the bars twice.
                    let unobstructedMaxY = proxy.frame(in: .global).maxY
                    let obstruction = windowFrame.map { ($0.maxY - unobstructedMaxY).rounded() }
                    Color.clear
                        .onChange(of: obstruction, initial: true) { _, value in
                            if let value { NFBottomChrome.shared.report(value, for: tab) }
                        }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }
}
