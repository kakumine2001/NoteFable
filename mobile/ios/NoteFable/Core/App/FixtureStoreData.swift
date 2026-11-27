#if DEBUG
import Foundation

extension FixtureCatalog {
    /// `-NFFixtureStory`：默认的演示数据，或应用商店截图用的学习场景（[FixtureStoreData]）。
    enum Story: String, Sendable {
        case standard
        case store
    }

    /// 两套数据里能打开编辑页的页面。
    static func editorPage(_ id: String) -> (title: String, icon: String?, kind: PageKind)? {
        editorPages[id] ?? FixtureStoreData.editorPages[id]
    }
}

/// 应用商店截图（`-NFFixtureStory store`，CI 的 `ios-store-screenshots` 任务）用的数据：和 Google Play 商店截图同一套学习内容
/// （光合作用的解释、有丝分裂和减数分裂的表格、JLPT N3 学习计划），侧栏和工作区也是学习用的项目和页面。只换掉有内容的接口，
/// 其余照 [FixtureCatalog] 的默认应答。
/// 白板和幻灯片两页由 CI 在本机网页服务里建好（mobile/ios/app-store/seed/*.json，改成 [IDs.board] / [IDs.deck]），
/// 它们的标题和图标要和种子一致（src/lib/ios-store-seed.test.ts 比对）。
struct FixtureStoreData {
    enum IDs {
        static let photosynthesisSession = "fx-store-session-photosynthesis"
        static let mitosisSession = "fx-store-session-mitosis"
        static let jlptSession = "fx-store-session-jlpt"

        static let board = "fx-store-board"
        static let deck = "fx-store-deck"

        static let biologyProject = "fx-store-project-biology"
        static let japaneseProject = "fx-store-project-japanese"
        static let biologyGroup = "fx-store-group-biology"
        static let japaneseGroup = "fx-store-group-japanese"
    }

    struct Page: Sendable {
        let id: String
        let kind: PageKind
        let title: String
        let icon: String?
        let groupId: String?
        let minutesAgo: Int
        var favorite = false
        var cover: String? = nil
    }

    /// 工作区的页面（列表顺序）。「最近编辑」按 minutesAgo 排：白板、幻灯片、带封面的笔记在前。
    static let pages: [Page] = [
        Page(id: IDs.board, kind: .whiteboard, title: "Photosynthesis Mind Map", icon: nil, groupId: IDs.biologyGroup, minutesAgo: 8),
        Page(id: IDs.deck, kind: .slides, title: "Photosynthesis Review", icon: nil, groupId: IDs.biologyGroup, minutesAgo: 25),
        Page(id: "fx-store-page-exam", kind: .note, title: "Biology Exam Notes", icon: "🔬", groupId: IDs.biologyGroup, minutesAgo: 70, favorite: true, cover: "gradient-mint"),
        Page(id: "fx-store-page-cells", kind: .note, title: "Cell Division Summary", icon: "🧬", groupId: IDs.biologyGroup, minutesAgo: 1560),
        Page(id: "fx-store-page-vocab", kind: .note, title: "JLPT N3 Vocabulary", icon: "🎌", groupId: IDs.japaneseGroup, minutesAgo: 200, favorite: true),
        Page(id: "fx-store-page-grammar", kind: .note, title: "Grammar Patterns", icon: "✏️", groupId: IDs.japaneseGroup, minutesAgo: 3000),
        Page(id: "fx-store-page-schedule", kind: .note, title: "Weekly Study Schedule", icon: "🗓️", groupId: nil, minutesAgo: 1700),
        Page(id: "fx-store-page-reading", kind: .note, title: "Reading List", icon: "📚", groupId: nil, minutesAgo: 4500),
        Page(id: "fx-store-page-history", kind: .slides, title: "World War II Overview", icon: nil, groupId: nil, minutesAgo: 5900),
        Page(id: "fx-store-page-forces", kind: .whiteboard, title: "Forces and Motion", icon: nil, groupId: nil, minutesAgo: 7200),
    ]

    static let editorPages: [String: (title: String, icon: String?, kind: PageKind)] = Dictionary(
        uniqueKeysWithValues: pages.map { page in (page.id, (title: page.title, icon: page.icon, kind: page.kind)) }
    )

    private struct Chat: Sendable {
        let id: String
        let title: String
        var icon: String? = nil
        var projectId: String? = nil
        var pinned = false
        var position = 0
        let minutesAgo: Int
        let seconds: Int
        let thought: String
        let prompt: String
        let answer: String
    }

    private static let chats: [Chat] = [
        Chat(
            id: IDs.jlptSession,
            title: "JLPT N3 Grammar Study Plan",
            projectId: IDs.japaneseProject,
            pinned: true,
            minutesAgo: 190,
            seconds: 6,
            thought: "**Planning five weeks**\n\nBuild from core patterns to timed practice.",
            prompt: "Make a 5-week JLPT N3 grammar study plan as a table with week, focus, and practice. Table only.",
            answer: """
            | Week | Focus | Practice |
            |---|---|---|
            | 1 | Core N3 grammar patterns | Learn 15 patterns; write one example for each |
            | 2 | Similar patterns and differences | Compare confusing patterns; do 20 questions |
            | 3 | Grammar in context | Read short passages; identify patterns and meanings |
            | 4 | Timed practice | Complete a grammar question set; review every mistake |
            | 5 | Final review | Revisit weak patterns; take a short timed quiz |
            """
        ),
        Chat(
            id: IDs.photosynthesisSession,
            title: "Photosynthesis Explained",
            icon: "🌿",
            projectId: IDs.biologyProject,
            minutesAgo: 20,
            seconds: 9,
            thought: "**Keeping it exam-ready**\n\nA short intro, the two stages, then one line to remember.",
            prompt: "Explain photosynthesis in simple terms for a high school biology exam. Use a short intro, the two stages with bullet points, and a one-line summary.",
            answer: """
            Photosynthesis is how plants use sunlight to make sugar, which stores energy for growth.

            - **1. Light-dependent reactions:** In the thylakoids of chloroplasts, chlorophyll captures sunlight. Water is split, releasing oxygen, and the energy makes ATP and NADPH.
            - **2. Calvin cycle:** In the stroma, the plant uses carbon dioxide, ATP, and NADPH to build sugar. This stage doesn’t use light directly.

            **Summary:** Light energy helps plants turn water and carbon dioxide into sugar and oxygen.
            """
        ),
        Chat(
            id: IDs.mitosisSession,
            title: "Mitosis vs Meiosis",
            icon: "🧬",
            projectId: IDs.biologyProject,
            position: 1,
            minutesAgo: 95,
            seconds: 5,
            thought: "**Lining up the differences**\n\nOne row for each feature the question asks about.",
            prompt: "Compare mitosis and meiosis in a table: purpose, divisions, daughter cells, chromosome number, genetic similarity, and where it occurs. Table only.",
            answer: """
            | Feature | Mitosis | Meiosis |
            |---|---|---|
            | Purpose | Growth, tissue repair, and cell replacement | Production of gametes for sexual reproduction |
            | Divisions | 1 | 2 |
            | Daughter cells | 2 | 4 |
            | Chromosome number | Same as the parent cell (usually diploid) | Half the parent cell’s number (haploid) |
            | Genetic similarity | Usually genetically identical | Genetically different from each other and the parent |
            | Where it occurs | Most body (somatic) cells | Germ cells in the testes and ovaries |
            """
        ),
        Chat(
            id: "fx-store-session-particles",
            title: "Particle practice: は and が",
            icon: "💬",
            projectId: IDs.japaneseProject,
            minutesAgo: 1500,
            seconds: 4,
            thought: "**Topic or subject**\n\nShow the contrast with one pair of examples.",
            prompt: "When do I use は and when が?",
            answer: "**は** marks the topic you are talking about; **が** picks out the subject, often something new. 象は鼻が長い: as for elephants, their trunks are long."
        ),
        Chat(
            id: "fx-store-session-newton",
            title: "Newton’s laws quiz",
            icon: "🍎",
            minutesAgo: 180,
            seconds: 3,
            thought: "**One question per law**\n\nKeep each answer short.",
            prompt: "Quiz me on Newton’s three laws.",
            answer: "1. What happens to a moving puck when no force acts on it?\n2. How are force, mass and acceleration related?\n3. If you push a wall, what pushes back?"
        ),
        Chat(
            id: "fx-store-session-essay",
            title: "Essay outline: renewable energy",
            icon: "📝",
            position: 1,
            minutesAgo: 1440,
            seconds: 7,
            thought: "**A clear argument**\n\nThesis, three points and a conclusion.",
            prompt: "Outline an essay on renewable energy.",
            answer: "- **Thesis:** Renewables can cut emissions and improve energy security.\n- Solar and wind costs have fallen.\n- Storage and grids are the main challenges.\n- **Conclusion:** Policy decides the speed."
        ),
        Chat(
            id: "fx-store-session-history",
            title: "World War II timeline",
            icon: "🗺️",
            position: 2,
            minutesAgo: 4300,
            seconds: 4,
            thought: "**Key turning points**\n\nA handful of dates are enough for revision.",
            prompt: "Give me a short timeline of World War II.",
            answer: "- **1939:** Germany invades Poland.\n- **1941:** The war becomes global.\n- **1944:** D-Day landings.\n- **1945:** The war ends."
        ),
    ]

    let now: Date
    let signedIn: Bool
    let appLanguage: String?
    /// 打包的 page-kinds.json（和默认数据一样随页面列表发下去）。
    let kinds: Data?

    /// 商店故事里有自己内容的接口；其它返回 nil，交给 [FixtureCatalog] 的默认应答。
    func payload(method: String, path: String, query: [URLQueryItem]) -> JSONValue? {
        switch (method, path) {
        case ("GET", "/api/sessions"):
            return ["sessions": .array(Self.chats.map { session($0) })]
        case ("GET", "/api/chat-projects"):
            return [
                "projects": [
                    ["id": .string(IDs.biologyProject), "name": "Biology", "noteCount": 0, "hasInstructions": false],
                    ["id": .string(IDs.japaneseProject), "name": "Japanese", "noteCount": 0, "hasInstructions": false],
                ],
            ]
        case ("GET", "/api/pages"):
            return query.contains { $0.name == "recent" && $0.value == "1" } ? recentPages() : pageList()
        case ("GET", "/api/account"):
            return [
                "configured": true,
                "google": true,
                "email": true,
                "apple": true,
                "user": signedIn ? user() : .null,
            ]
        case ("PATCH", "/api/account"):
            return ["user": user()]
        default:
            break
        }

        let segments = path.split(separator: "/").map(String.init)
        guard method == "GET", segments.count >= 3, segments[0] == "api" else { return nil }
        if segments.count == 4, segments[1] == "sessions", segments[3] == "messages" {
            return Self.chats.first { $0.id == segments[2] }.map { messages($0) }
        }
        if segments.count == 3, segments[1] == "chat-projects" {
            let name = segments[2] == IDs.japaneseProject ? "Japanese" : "Biology"
            return ["project": ["id": .string(segments[2]), "name": .string(name), "instructions": "", "notes": []]]
        }
        return nil
    }

    private func user() -> JSONValue {
        [
            "name": "Alex",
            "googleName": "Alex",
            "email": "alex@example.com",
            "image": .null,
            "displayName": .null,
            "icon": "🦉",
            "avatarUrl": .null,
            "locale": appLanguage.map(JSONValue.string) ?? .null,
        ]
    }

    private func session(_ chat: Chat) -> JSONValue {
        [
            "id": .string(chat.id),
            "title": .string(chat.title),
            "icon": chat.icon.map(JSONValue.string) ?? .null,
            "pinned": .bool(chat.pinned),
            "position": .number(Double(chat.position)),
            "projectId": chat.projectId.map(JSONValue.string) ?? .null,
            "noteId": .null,
            "createdAt": .string(iso(minutesAgo: chat.minutesAgo + 5)),
            "updatedAt": .string(iso(minutesAgo: chat.minutesAgo)),
        ]
    }

    private func messages(_ chat: Chat) -> JSONValue {
        let question: JSONValue = [
            "id": .string("\(chat.id)-q"),
            "role": "USER",
            "content": .string(chat.prompt),
            "createdAt": .string(iso(minutesAgo: chat.minutesAgo + 1)),
            "attachments": [],
            "generatedImages": [],
            "pages": [],
        ]
        let answer: JSONValue = [
            "id": .string("\(chat.id)-a"),
            "role": "ASSISTANT",
            "content": .string(chat.answer),
            "model": "gpt-6-luna",
            "reasoningEffort": "medium",
            "thinkingMs": .number(Double(chat.seconds * 1000)),
            "createdAt": .string(iso(minutesAgo: chat.minutesAgo)),
            "activity": [["id": .string("\(chat.id)-t"), "kind": "thought", "text": .string(chat.thought)]],
            "attachments": [],
            "generatedImages": [],
            "proposals": [],
            "pages": [],
        ]
        return ["messages": [question, answer]]
    }

    private func pageList() -> JSONValue {
        let summaries = Self.pages.enumerated().map { index, page -> JSONValue in
            [
                "id": .string(page.id),
                "kind": .string(page.kind.rawValue),
                "position": .number(Double(index)),
                "title": .string(page.title),
                "icon": page.icon.map(JSONValue.string) ?? .null,
                "cover": page.cover.map(JSONValue.string) ?? .null,
                "version": 1,
                "groupId": page.groupId.map(JSONValue.string) ?? .null,
                "parentId": .null,
                "favoritedAt": page.favorite ? .string(iso(minutesAgo: 10_080)) : .null,
                "createdAt": .string(iso(minutesAgo: 20_160)),
                "updatedAt": .string(iso(minutesAgo: page.minutesAgo)),
            ]
        }
        var list: [String: JSONValue] = [
            "pages": .array(summaries),
            "groups": [
                ["id": .string(IDs.biologyGroup), "name": "Biology", "position": 0],
                ["id": .string(IDs.japaneseGroup), "name": "Japanese", "position": 1],
            ],
        ]
        if let table = kinds.flatMap({ JSONValue.parse($0) }) {
            list["kinds"] = table
        }
        return .object(list)
    }

    /// GET /api/pages?recent=1（服务端取最近 4 篇）。
    private func recentPages() -> JSONValue {
        let recent = Self.pages.sorted { $0.minutesAgo < $1.minutesAgo }.prefix(4)
        let cards = recent.map { page -> JSONValue in
            [
                "id": .string(page.id),
                "kind": .string(page.kind.rawValue),
                "title": .string(page.title),
                "icon": page.icon.map(JSONValue.string) ?? .null,
                "cover": page.cover.map(JSONValue.string) ?? .null,
                "updatedAt": .string(iso(minutesAgo: page.minutesAgo)),
            ]
        }
        return ["pages": .array(cards)]
    }

    private func iso(minutesAgo: Int) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(TimeInterval(-60 * minutesAgo)))
    }
}
#endif
