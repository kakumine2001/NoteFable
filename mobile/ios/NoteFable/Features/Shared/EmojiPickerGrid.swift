import SwiftUI

// 表情区（emoji-picker-react 的主体，Android EmojiPicker.kt 的 EmojiGrid）。数值：
// - 头部上下 15、左右 10：搜索框高 40、#F6F6F6、圆角 8、左右内边距 30、16 字，行首 10 处放大镜 20，有字时行尾 10 处 30 的圆形清除键；
//   右边 28 宽的肤色色块（15、圆角 4、1px #555 边），点开向行首展开 6 个（每个 28），选中的放大 1.3、蓝边。
// - 分类导航高 60（上下 15、左右 10），9 个 30 的图标 space-around 分布，当前分类 #3371B7，其余 #868686；
//   搜索框有字时整条变淡（.3）且不能点。
// - 表情区：分类标题高 40、左右 10、16 粗体灰字、白底 .9、吸顶；表情 34×34（字 24、圆角 8），
//   每行 floor((宽 − 20) / 34) 个，两端对齐，左右 10。有肤色变体的表情右下角有浅灰小三角，长按 0.5 秒出变体条。

private let emojiCellSize: CGFloat = 34
private let emojiToneItem: CGFloat = 28
private let emojiHeaderHeight: CGFloat = 40
private let emojiBodySpace = "nf-emoji-body"
private let emojiListSpace = "nf-emoji-list"
private let emojiTopID = "nf-emoji-top"

struct EmojiGrid: View {
    let catalog: EmojiCatalog
    let height: CGFloat
    let onPick: (String) -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var recent: [String] = []
    @State private var query = ""
    @State private var tone: SkinTone = .neutral
    @State private var toneOpen = false
    @State private var sections: [EmojiGridSection] = []
    @State private var activeCategory: String?
    @State private var variations: EmojiVariationTarget?
    @FocusState private var searchFocused: Bool

    init(catalog: EmojiCatalog, height: CGFloat, onPick: @escaping (String) -> Void) {
        self.catalog = catalog
        self.height = height
        self.onPick = onPick
    }

    /// 搜索头部 70（15 + 40 + 15）+ 分类导航 60。
    private var listHeight: CGFloat { max(0, height - 130) }

    var body: some View {
        GeometryReader { proxy in
            // grid auto-fill：左右各 10 之间放得下几个 34 就几个（412 宽的手机上是 10 个）。
            let columns = emojiColumns(width: proxy.size.width)
            ScrollViewReader { scroller in
                VStack(spacing: 0) {
                    header(scroller)
                    EmojiCategoryNav(
                        catalog: catalog,
                        active: activeCategory ?? sections.first?.category,
                        available: Set(sections.map(\.category)),
                        searching: !query.isEmpty
                    ) { category in
                        jump(to: category, scroller)
                    }
                    list(columns: columns)
                }
                .onChange(of: query) { _, _ in
                    variations = nil
                    scroller.scrollTo(emojiTopID, anchor: .top)
                }
            }
        }
        .frame(height: height)
        .onAppear {
            recent = app.recentEmoji.load()
            rebuild()
        }
        .onChange(of: EmojiSectionsKey(query: query, tone: tone, recent: recent)) { _, _ in rebuild() }
    }

    private func rebuild() {
        sections = emojiGridSections(catalog: catalog, recent: recent, tone: tone, query: query)
        if let activeCategory, !sections.contains(where: { $0.category == activeCategory }) {
            self.activeCategory = nil
        }
    }

    private func pick(_ unified: String) {
        searchFocused = false
        variations = nil
        let next = pushRecentEmoji(recent, unified)
        app.recentEmoji.save(next)
        recent = next
        onPick(unifiedToEmoji(unified))
    }

    /// 点分类图标：那个分类的标题顶到最上面。标题是吸顶的，所以滚到它的第一行、让这一行正好在标题下面。
    private func jump(to category: String, _ scroller: ScrollViewProxy) {
        variations = nil
        let span = listHeight - emojiCellSize
        let anchor = span > 0 ? UnitPoint(x: 0.5, y: min(1, emojiHeaderHeight / span)) : UnitPoint.top
        scroller.scrollTo("\(category)-0", anchor: anchor)
        activeCategory = category
    }

    // MARK: 头部：搜索框 + 肤色

    private func header(_ scroller: ScrollViewProxy) -> some View {
        HStack(spacing: 0) {
            EmojiSearchField(icons: catalog.icons, query: $query, focused: $searchFocused)
            EmojiSkinTonePicker(tone: tone, open: toneOpen, reduceMotion: reduceMotion) { picked in
                if toneOpen {
                    tone = picked
                    toneOpen = false
                } else {
                    toneOpen = true
                }
            }
        }
        .frame(height: 40)
        .padding(.horizontal, 10)
        .padding(.vertical, 15)
    }

    // MARK: 表情列表

    private func list(columns: Int) -> some View {
        ZStack(alignment: .top) {
            if sections.isEmpty {
                // emoji-picker-react 的 Empty：搜索没有结果。
                Text(L("em_none_found"))
                    .font(.nf(14))
                    .foregroundStyle(EmojiPickerColors.text)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: emojiCellSize)
                    .padding(10)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Color.clear
                            .frame(height: 0)
                            .id(emojiTopID)
                        ForEach(sections) { section in
                            Section {
                                ForEach(emojiGridRows(section, columns: columns)) { row in
                                    EmojiRowView(
                                        row: row,
                                        columns: columns,
                                        onPick: { cell in pick(cell.unified) },
                                        onVariations: { cell, frame in variations = EmojiVariationTarget(item: cell.item, cell: frame) }
                                    )
                                }
                            } header: {
                                EmojiCategoryLabel(category: section.category)
                            }
                        }
                    }
                }
                .coordinateSpace(name: emojiListSpace)
                // 当前分类 = 列表最上面那一行所在的分类（Android 的 firstVisibleItemIndex）。
                // 闭包里只碰绑定，不碰视图自己（这个闭包不保证在主线程的隔离里）。
                .onPreferenceChange(EmojiRowFrameKey.self) { [active = $activeCategory] frames in
                    guard let top = emojiTopCategory(frames) else { return }
                    if active.wrappedValue != top { active.wrappedValue = top }
                }
            }
            if let variations {
                EmojiVariationBar(target: variations, onPick: { unified in pick(unified) }, onDismiss: { self.variations = nil })
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: listHeight, alignment: .top)
        .clipped()
        .coordinateSpace(name: emojiBodySpace)
    }

}

/// 列表最上面（还没完全滚出去）的那一行所在的分类。
private func emojiTopCategory(_ frames: [EmojiRowFrame]) -> String? {
    frames.filter { $0.maxY > 1 }.min(by: { $0.minY < $1.minY })?.category
}

private struct EmojiSectionsKey: Equatable {
    let query: String
    let tone: SkinTone
    let recent: [String]
}

/// 长按的那个表情和它那一格的位置（表情列表区域里的坐标）。
private struct EmojiVariationTarget: Equatable {
    let item: EmojiItem
    let cell: CGRect
}

// MARK: - 行的位置（用来判断当前分类）

private struct EmojiRowFrame: Equatable {
    let category: String
    let minY: CGFloat
    let maxY: CGFloat
}

private struct EmojiRowFrameKey: PreferenceKey {
    static let defaultValue: [EmojiRowFrame] = []

    static func reduce(value: inout [EmojiRowFrame], nextValue: () -> [EmojiRowFrame]) {
        value.append(contentsOf: nextValue())
    }
}

// MARK: - 搜索框

private struct EmojiSearchField: View {
    let icons: [String: EmojiIcon]
    @Binding var query: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        ZStack {
            TextField("", text: $query, prompt: Text(L("em_search_placeholder")).foregroundStyle(EmojiPickerColors.text))
                .textFieldStyle(.plain)
                .font(.nf(16))
                .foregroundStyle(EmojiPickerColors.text)
                .tint(EmojiPickerColors.text)
                .lineLimit(1)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(focused)
                .padding(.horizontal, 30)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(L("em_search_label"))
            HStack(spacing: 0) {
                EmojiPickerIcon(icon: icons["search"], tint: EmojiPickerColors.categoryInactive, size: 20)
                    .padding(.leading, 10)
                    .allowsHitTesting(false)
                Spacer(minLength: 0)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        EmojiPickerIcon(icon: icons["clear"], tint: EmojiPickerColors.categoryInactive, size: 20)
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.pressable(cornerRadius: 15))
                    .padding(.trailing, 10)
                    .accessibilityLabel(L("em_clear_search"))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 40)
        .background(EmojiPickerColors.searchBackground, in: shape)
        .overlay { shape.strokeBorder(focused.wrappedValue ? EmojiPickerColors.highlight : EmojiPickerColors.searchBackground, lineWidth: 1) }
        .contentShape(shape)
        .onTapGesture { focused.wrappedValue = true }
    }
}

// MARK: - 肤色

/// 肤色：收起时只露出当前的色块（28 宽）；点开向行首展开 6 个，再点一个就选它并收起（emoji-picker-react SkinTonePicker）。
/// 每个色块占 28 宽的格子，15 的方块贴在格子的行尾（insetInlineEnd 0）。展开 300ms，淡入 350ms。
private struct EmojiSkinTonePicker: View {
    let tone: SkinTone
    let open: Bool
    let reduceMotion: Bool
    let onTap: (SkinTone) -> Void

    var body: some View {
        let tones = SkinTone.allCases
        ZStack(alignment: .trailing) {
            ForEach(Array(tones.enumerated()), id: \.offset) { index, item in
                let active = item == tone
                let shown = open || active
                Button {
                    onTap(item)
                } label: {
                    EmojiToneSwatch(tone: item, highlighted: open && active)
                        .scaleEffect(open && active ? 1.3 : 1)
                        .opacity(shown ? 1 : 0)
                        .frame(width: emojiToneItem, height: 40, alignment: .trailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!shown)
                .padding(.trailing, open ? emojiToneItem * CGFloat(index) : 0)
                .accessibilityLabel(emojiToneName(item))
                .accessibilityAddTraits(active ? .isSelected : [])
                .accessibilityHidden(!shown)
                // 收起时当前的色块在最上面，点到的总是它。
                .zIndex(active ? 1 : 0)
            }
        }
        .frame(width: open ? emojiToneItem * CGFloat(tones.count) : emojiToneItem, height: 40, alignment: .trailing)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: open)
    }
}

private struct EmojiToneSwatch: View {
    let tone: SkinTone
    let highlighted: Bool

    var body: some View {
        let outer = RoundedRectangle(cornerRadius: 4)
        outer
            .fill(Color(argb: 0xFF00_0000 | tone.color))
            .frame(width: 15, height: 15)
            // 里面一圈 1px 白线，外面 1px 深色边（选中时蓝色）。
            .overlay { RoundedRectangle(cornerRadius: 3).strokeBorder(Color.white, lineWidth: 1).padding(1) }
            .overlay { outer.strokeBorder(highlighted ? EmojiPickerColors.highlight : EmojiPickerColors.toneBorder, lineWidth: 1) }
    }
}

// MARK: - 分类导航

private struct EmojiCategoryNav: View {
    let catalog: EmojiCatalog
    let active: String?
    let available: Set<String>
    let searching: Bool
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(catalog.categories, id: \.self) { category in
                let selected = category == active
                Button {
                    onSelect(category)
                } label: {
                    EmojiPickerIcon(
                        icon: catalog.icons[category],
                        tint: selected ? EmojiPickerColors.categoryActive : EmojiPickerColors.categoryInactive,
                        size: 30
                    )
                }
                .buttonStyle(.pressable(cornerRadius: 4))
                .disabled(searching || !available.contains(category))
                // space-around：每个图标两边留一样的空。
                .frame(maxWidth: .infinity)
                .accessibilityLabel(emojiCategoryName(category))
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 15)
        .frame(height: 60)
        // 搜索框有字时（.epr-search-active）整条变淡到 .3，也不能点。
        .opacity(searching ? 0.3 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("em_categories"))
    }
}

private struct EmojiCategoryLabel: View {
    let category: String

    var body: some View {
        Text(emojiCategoryName(category))
            .font(.nf(16, weight: 700))
            .foregroundStyle(Sm.muted)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: emojiHeaderHeight)
            .background(EmojiPickerColors.categoryLabelBackground)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - 表情行和表情格

private struct EmojiRowView: View {
    let row: EmojiGridRow
    let columns: Int
    let onPick: (EmojiGridCell) -> Void
    let onVariations: (EmojiGridCell, CGRect) -> Void

    var body: some View {
        // grid auto-fill 的 columns 列（每列 34）、justify-content: space-between：最后一行不满时也对齐到同样的列。
        HStack(spacing: 0) {
            ForEach(0..<max(1, columns), id: \.self) { column in
                if column > 0 { Spacer(minLength: 0) }
                if column < row.cells.count {
                    let cell = row.cells[column]
                    EmojiCellButton(
                        unified: cell.unified,
                        label: cell.item.label,
                        hasVariations: !cell.item.variations.isEmpty,
                        onPick: { onPick(cell) },
                        onLongPress: { frame in onVariations(cell, frame) }
                    )
                } else {
                    Color.clear.frame(width: emojiCellSize, height: emojiCellSize)
                }
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity)
        .background {
            GeometryReader { proxy in
                let frame = proxy.frame(in: CoordinateSpace.named(emojiListSpace))
                Color.clear.preference(
                    key: EmojiRowFrameKey.self,
                    value: [EmojiRowFrame(category: row.category, minY: frame.minY, maxY: frame.maxY)]
                )
            }
        }
    }
}

/// 一个表情：34×34、字 24、圆角 8，按下灰底。有肤色变体的右下角（从右到左时左下角）有小三角，长按 0.5 秒出变体条。
private struct EmojiCellButton: View {
    let unified: String
    let label: String
    let hasVariations: Bool
    let onPick: () -> Void
    let onLongPress: (CGRect) -> Void

    @State private var pressed = false

    var body: some View {
        if hasVariations {
            glyph
                .background { RoundedRectangle(cornerRadius: 8).fill(pressed ? Sm.hover : Color.clear) }
                .overlay {
                    EmojiVariationCorner()
                        .fill(EmojiPickerColors.variationIndicator)
                        .flipsForRightToLeftLayoutDirection(true)
                        .allowsHitTesting(false)
                }
                .overlay {
                    // 手势放在能读到位置的一层上：长按时把这一格的位置交出去。
                    GeometryReader { proxy in
                        Color.clear
                            .contentShape(Rectangle())
                            // 先放点按再放长按：在滚动区里长按手势不会拦住滚动。
                            .onTapGesture { onPick() }
                            .onLongPressGesture(minimumDuration: 0.5, maximumDistance: 12) {
                                onLongPress(proxy.frame(in: CoordinateSpace.named(emojiBodySpace)))
                            } onPressingChanged: { pressing in
                                pressed = pressing
                            }
                    }
                }
                .accessibilityElement()
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onPick() }
        } else {
            Button(action: onPick) { glyph }
                .buttonStyle(.pressable(cornerRadius: 8))
                .accessibilityLabel(label)
        }
    }

    private var glyph: some View {
        Text(unifiedToEmoji(unified))
            .font(.system(size: 24))
            .foregroundStyle(Color.black)
            .lineLimit(1)
            .fixedSize()
            .frame(width: emojiCellSize, height: emojiCellSize)
    }
}

/// 右下角的小三角（::after，4px 边框旋转 135°）：直角边 5.6，底边离格子底 1。
private struct EmojiVariationCorner: Shape {
    func path(in rect: CGRect) -> Path {
        let leg: CGFloat = 5.6
        let bottom = rect.maxY - 1
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: bottom - leg))
        path.addLine(to: CGPoint(x: rect.maxX, y: bottom))
        path.addLine(to: CGPoint(x: rect.maxX - leg, y: bottom))
        path.closeSubpath()
        return path
    }
}

// MARK: - 肤色变体条

/// 长按出现的肤色变体条（emoji-picker-react EmojiVariationPicker）：左右各缩 15、高 45、内边距 5、平均分布，
/// 白底、1px #E7E7E7 边、圆角 3、阴影 0 2 5 .2；放在那一行上方，上方放不下就放下方。点条以外的地方关闭。
private struct EmojiVariationBar: View {
    let target: EmojiVariationTarget
    let onPick: (String) -> Void
    let onDismiss: () -> Void

    var body: some View {
        let options = Array(([target.item.unified] + target.item.variations).prefix(6))
        let barHeight: CGFloat = 45
        let above = target.cell.minY - barHeight
        let y = above >= 0 ? above : target.cell.maxY
        let shape = RoundedRectangle(cornerRadius: 3)
        ZStack(alignment: .top) {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }
                .accessibilityHidden(true)
            HStack(spacing: 0) {
                ForEach(options, id: \.self) { unified in
                    Button {
                        onPick(unified)
                    } label: {
                        Text(unifiedToEmoji(unified))
                            .font(.system(size: 24))
                            .foregroundStyle(Color.black)
                            .lineLimit(1)
                            .fixedSize()
                            .frame(width: emojiCellSize, height: emojiCellSize)
                    }
                    .buttonStyle(.pressable(cornerRadius: 8))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(target.item.label)
                }
            }
            .padding(5)
            .frame(height: barHeight)
            .background { shape.fill(Color.white).onTapGesture {} }
            .overlay { shape.strokeBorder(EmojiPickerColors.pickerBorder, lineWidth: 1) }
            .shadow(color: Color(argb: 0x33000000), radius: 2.5, x: 0, y: 2)
            .padding(.horizontal, 15)
            .offset(y: y)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
