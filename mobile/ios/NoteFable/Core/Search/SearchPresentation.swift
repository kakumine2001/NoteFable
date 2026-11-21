import Foundation

// 检索画面里不画界面的规则（Android ui/SearchScreen.kt；网页 search-dialog.tsx）。

/// 结果区显示什么。
enum SearchContent: Equatable, Sendable {
    /// 还没输入：标题 search_idle_title + 说明 search_idle_body。
    case idle
    /// 检索失败：search_unavailable_title / search_unavailable_body + "重试"（search_try_again）。
    case failed
    /// 第一次检索、还没有可以先显示的旧结果：转圈 + search_searching。
    case searching
    /// 没有结果：search_no_results（带检索词）+ search_no_results_body。
    case noResults(query: String)
    /// 结果列表（[SearchView.groups]）；[SearchView.loading] 时是上一次的结果，淡到 0.5。
    case results
}

extension SearchView {
    var content: SearchContent {
        if idle { return .idle }
        if failed { return .failed }
        let empty = rows.isEmpty
        if loading && empty { return .searching }
        if empty { return .noResults(query: data?.query ?? query) }
        return .results
    }

    /// 高亮的行在 [rows] 里的位置（夹在范围内）。
    func activeIndex(_ active: Int) -> Int {
        min(max(active, 0), max(rows.count - 1, 0))
    }

    /// 键盘的"搜索"键（网页的 Enter）：结果是当前条件的才打开高亮的那一行。
    func submitTarget(_ active: Int) -> SearchHit? {
        let all = rows
        guard !loading, !failed, !all.isEmpty else { return nil }
        return all[activeIndex(active)]
    }
}

/// 摘录前面的说明：命中附件正文时显示文件名（不显示说话人），否则是说话人。
enum SearchSnippetLead: Equatable, Sendable {
    case none
    /// 回形针 + "in 文件名"（search_in_file）。
    case file(String)
    /// search_speaker_you
    case you
    /// search_speaker_notefable
    case notefable
}

extension SearchHit {
    var snippetLead: SearchSnippetLead {
        guard case .chat(let chat) = self else { return .none }
        if let name = chat.attachmentName { return .file(name) }
        guard let role = chat.role else { return .none }
        return role == "USER" ? .you : .notefable
    }

    /// 聊天所在项目的名字（标题后面的浅灰小字）；笔记、没项目、项目已不在时没有。
    func projectName(_ names: [String: String]) -> String? {
        guard case .chat(let chat) = self, let projectId = chat.projectId else { return nil }
        return names[projectId]
    }
}

/// 服务端的时间（ISO 8601，带不带毫秒都收）；读不懂是 nil。
func parseIsoInstant(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

/// 按 [locale] 的习惯写日期（Unicode 的日期模板，如 "MMMd"、"yMMMd"）。
func formatDateTemplate(_ date: Date, _ template: String, locale: Locale, timeZone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = timeZone
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: date)
}

/// 网页 formatDate：今年的只写月日（"Nov 14" / "11月14日"），往年的加年份。读不懂的日期不显示。
/// [locale] 是界面语言（`Locale(identifier: uiLocale)`）。
func formatSearchDate(_ value: String, locale: Locale, now: Date = Date(), timeZone: TimeZone = .current) -> String {
    guard let date = parseIsoInstant(value) else { return "" }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
    return formatDateTemplate(date, sameYear ? "MMMd" : "yMMMd", locale: locale, timeZone: timeZone)
}
