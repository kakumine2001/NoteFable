/// 网页用的是 lucide 图标（线条图标，24×24 画布，描边 2，圆头）。这里和 Android 的 `ui/Lucide.kt` 一样直接用同一份路径数据，
/// 由 `LucideIcon` 绘制，和网页的图标一模一样；SF Symbols 的线宽和造型不一样，所以不用。
///
/// 每个图标是一组 SVG 路径（`d` 属性）。名字和网页 import 的 lucide-react 组件相同，首字母小写（`Lucide.menu`、`Lucide.chevronDown`）。
/// 缺新图标时和 Android 一样补：渲染网页用的同名组件，把 circle / rect / line 换成等价的 path，两端同时加，不手画。
///
/// 这个文件只有数据，不依赖 SwiftUI。用法见 `LucideIcon`。
enum Lucide {
    static let menu: [String] = ["M4 5h16", "M4 12h16", "M4 19h16"]
    static let plus: [String] = ["M5 12h14", "M12 5v14"]
    static let arrowUp: [String] = ["m5 12 7-7 7 7", "M12 19V5"]
    static let chevronDown: [String] = ["m6 9 6 6 6-6"]
    static let check: [String] = ["M20 6 9 17l-5-5"]
    static let languages: [String] = ["m5 8 6 6", "m4 14 6-6 2-3", "M2 5h12", "M7 2h1", "m22 22-5-10-5 10", "M14 18h6"]
    static let x: [String] = ["M18 6 6 18", "m6 6 12 12"]
    static let chevronsUpDown: [String] = ["m7 15 5 5 5-5", "m7 9 5-5 5 5"]
    static let imagePlus: [String] = [
        "M16 5h6",
        "M19 2v6",
        "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",
        "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
        "M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    ]
    static let copy: [String] = [
        "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
        "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
    ]
    static let messageSquareText: [String] = [
        "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
        "M7 11h10",
        "M7 15h6",
        "M7 7h8",
    ]
    static let rotateCcw: [String] = ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"]
    static let logOut: [String] = ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"]
    static let creditCard: [String] = ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M2 10h20"]
    static let globe: [String] = ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"]
    static let fileText: [String] = [
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M10 9H8",
        "M16 13H8",
        "M16 17H8",
    ]
    // 「整理成笔记」（网页 page.tsx / create-page-dialog.tsx 的 FilePlus）。
    static let filePlus: [String] = [
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M9 15h6",
        "M12 18v-6",
    ]
    private static let folderOutline: String =
        "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    static let folder: [String] = [folderOutline]
    static let folderPlus: [String] = ["M12 10v6", "M9 13h6", folderOutline]
    static let folderInput: [String] = [
        "M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",
        "M2 13h10",
        "m9 16 3-3-3-3",
    ]
    static let pencil: [String] = [
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
        "m15 5 4 4",
    ]
    static let trash2: [String] = [
        "M10 11v6",
        "M14 11v6",
        "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
        "M3 6h18",
        "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    ]
    static let chevronRight: [String] = ["m9 18 6-6-6-6"]
    static let chevronLeft: [String] = ["m15 18-6-6 6-6"]
    static let history: [String] = ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"]
    static let paperclip: [String] = ["m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"]
    // 侧栏的帮助菜单（help-menu.tsx）。circle 换成等价的 path。
    static let circleHelp: [String] = ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"]
    static let info: [String] = ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 16v-4", "M12 8h.01"]
    static let shield: [String] = ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"]
    static let scale: [String] = ["M12 3v18", "m19 8 3 8a5 5 0 0 1-6 0zV7", "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1", "m5 8 3 8a5 5 0 0 1-6 0zV7", "M7 21h10"]

    // 后续批次（进度条、提案卡片、代码块、搜索、侧栏、设置、拍照等）要用的图标，从 lucide-react 1.16.0 一次性生成：
    // 渲染网页用的同名组件，把 circle / rect / line 换成等价的 path。网页 import 的名字照抄（Code2、MoreHorizontal 等别名也保留）。
    static let arrowDown: [String] = [
        "M12 5v14",
        "m19 12-7 7-7-7",
    ]
    static let arrowLeft: [String] = [
        "m12 19-7-7 7-7",
        "M19 12H5",
    ]
    static let arrowUpRight: [String] = [
        "M7 7h10v10",
        "M7 17 17 7",
    ]
    static let camera: [String] = [
        "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z",
        "M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    ]
    static let code2: [String] = [
        "m18 16 4-4-4-4",
        "m6 8-4 4 4 4",
        "m14.5 4-5 16",
    ]
    static let download: [String] = [
        "M12 15V3",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
        "m7 10 5 5 5-5",
    ]
    static let lock: [String] = [
        "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
        "M7 11V7a5 5 0 0 1 10 0v4",
    ]
    static let star: [String] = [
        "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
    ]
    static let starOff: [String] = [
        "m10.344 4.688 1.181-2.393a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.237 3.152",
        "m17.945 17.945.43 2.505a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a8 8 0 0 0 .4-.099",
        "m2 2 20 20",
    ]
    static let ellipsis: [String] = [
        "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
        "M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
        "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    ]
    static let filePenLine: [String] = [
        "M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z",
        "M14.487 7.858A1 1 0 0 1 14 7V2",
        "M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516",
        "M8 18h1",
    ]
    static let filePlus2: [String] = [
        "M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M14 19h6",
        "M17 16v6",
    ]
    static let fileSearch: [String] = [
        "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "M14 2v5a1 1 0 0 0 1 1h5",
        "M9 14.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0",
        "M13.3 16.3 15 18",
    ]
    static let folderOpen: [String] = [
        "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
    ]
    static let lightbulb: [String] = [
        "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
        "M9 18h6",
        "M10 22h4",
    ]
    static let loaderCircle: [String] = ["M21 12a9 9 0 1 1-6.219-8.56"]
    static let notebookText: [String] = [
        "M2 6h4",
        "M2 10h4",
        "M2 14h4",
        "M2 18h4",
        "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2Z",
        "M9.5 8h5",
        "M9.5 12H16",
        "M9.5 16H14",
    ]
    static let panelLeftClose: [String] = [
        "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2Z",
        "M9 3v18",
        "m16 15-3-3 3-3",
    ]
    static let pin: [String] = [
        "M12 17v5",
        "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    ]
    static let pinOff: [String] = [
        "M12 17v5",
        "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",
        "m2 2 20 20",
        "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
    ]
    static let gitBranch: [String] = [
        "M15 6a9 9 0 0 0-9 9V3",
        "M21 6a3 3 0 1 1-6 0a3 3 0 0 1 6 0",
        "M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0",
    ]
    static let refreshCw: [String] = [
        "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
        "M21 3v5h-5",
        "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
        "M8 16H3v5",
    ]
    static let scrollText: [String] = [
        "M15 12h-5",
        "M15 8h-5",
        "M19 17V5a2 2 0 0 0-2-2H4",
        "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
    ]
    static let search: [String] = [
        "m21 21-4.34-4.34",
        "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0",
    ]
    static let settings: [String] = [
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
        "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    ]
    static let settings2: [String] = [
        "M14 17H5",
        "M19 7h-9",
        "M14 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
        "M4 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    ]
    static let shuffle: [String] = [
        "m18 14 4 4-4 4",
        "m18 2 4 4-4 4",
        "M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22",
        "M2 6h1.972a4 4 0 0 1 3.6 2.2",
        "M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45",
    ]
    static let smile: [String] = [
        "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0",
        "M8 14s1.5 2 4 2 4-2 4-2",
        "M9 9L9.01 9",
        "M15 9L15.01 9",
    ]
    static let sparkles: [String] = [
        "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
        "M20 2v4",
        "M22 4h-4",
        "M2 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    ]
    static let textSearch: [String] = [
        "M21 5H3",
        "M10 12H3",
        "M10 19H3",
        "M14 15a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
        "m21 19-1.9-1.9",
    ]
    static let upload: [String] = [
        "M12 3v12",
        "m17 8-5-5-5 5",
        "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    ]
    static let moreHorizontal: [String] = ellipsis
    static let loader2: [String] = loaderCircle

    /// 有方向的图标：阿拉伯语等从右到左的界面里水平镜像（返回、前进、折叠箭头、收起侧栏、移入文件夹、退出登录）。
    /// 和 Android 的 `Lucide.RtlMirrored` 是同一批。
    static let rtlMirrored: Set<[String]> = [
        arrowLeft,
        chevronLeft,
        chevronRight,
        panelLeftClose,
        logOut,
        folderInput,
    ]
}
