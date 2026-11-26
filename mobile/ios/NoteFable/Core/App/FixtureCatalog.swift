#if DEBUG
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Debug fixture 模式使用的保留域名（RFC 6761 `.invalid` 永远不会解析到任何真实服务器）。
enum FixtureMode {
    static let host = "fixtures.notefable.invalid"
    static let baseURL = "https://fixtures.notefable.invalid"
    static let siteURL = "https://site.notefable.invalid"
}

/// 为 CI 模拟器截图和 Core 集成测试提供贴近真实产品的离线 JSON / 图片 / SSE 应答。
/// 日期统一相对 [now] 计算（UTC ISO-8601 带毫秒），所有 ID 都满足 `ChatLink.isLinkId` 和编辑器 `REVEAL_TARGET` 规则。
struct FixtureCatalog: Sendable {
    enum Account: String, Sendable {
        case signedIn = "signed-in"
        case guest
    }

    enum Prompts {
        static let streaming = "Compare Liquid Glass and earlier blur materials on iOS."
        static let streamed = "Summarize Liquid Glass and blur materials on iOS."
    }

    enum IDs {
        static let kyotoSession = "fx-session-kyoto"
        static let glassSession = "fx-session-glass"
        static let ramenSession = "fx-session-ramen"
        static let meetingSession = "fx-session-meeting"
        static let liveSession = "fx-session-live"

        static let tripPage = "fx-page-trip"
        static let packingPage = "fx-page-packing"
        static let glassPage = "fx-page-glass"
        static let roadmapPage = "fx-page-roadmap"
        static let boardPage = "fx-page-board"
        static let meetingPage = "fx-page-meeting"
        static let draftPage = "fx-page-draft"

        static let appProject = "fx-project-app"
        static let studyProject = "fx-project-study"

        static let travelGroup = "fx-group-travel"
        static let workGroup = "fx-group-work"

        static let routeAttachment = "fx-att-route"
        static let postcardImage = "fx-img-postcard"
    }

    static let editorPages: [String: (title: String, icon: String?, kind: PageKind)] = [
        IDs.tripPage: ("Kyoto trip plan", "🗺️", .note),
        IDs.packingPage: ("Packing list", "🧳", .note),
        IDs.glassPage: ("Liquid Glass checklist", "🫧", .note),
        IDs.boardPage: ("Navigation sketch", nil, .whiteboard),
        IDs.roadmapPage: ("Q4 roadmap", nil, .slides),
    ]

    private static let answerLead = "Liquid Glass "
    private static let answerBody = """
    refracts the content scrolling behind it, while earlier blur materials only frost the backdrop.

    - **iOS 26+:** live refraction and interactive highlights.
    - **iOS 17–18:** frosted system materials.
    - **Reduce Transparency:** solid high-contrast surfaces.
    """

    var account: Account
    var now: Date
    var models: Data?
    var kinds: Data?
    var image: Data
    var streamHoldsOpen: Bool
    /// 传入应用内强制语言（例如 `ar-app` 截图变体）时同步回账号上的 `locale`，避免登录后 `syncWithAccount` 把偏好覆盖回 Auto。
    var appLanguage: String?

    init(
        account: Account = .signedIn,
        now: Date = Date(),
        models: Data? = nil,
        kinds: Data? = nil,
        image: Data,
        streamHoldsOpen: Bool = false,
        appLanguage: String? = nil
    ) {
        self.account = account
        self.now = now
        self.models = models
        self.kinds = kinds
        self.image = image
        self.streamHoldsOpen = streamHoldsOpen
        self.appLanguage = appLanguage
    }

    func reply(to request: HTTPRequest) -> FixtureTransport.Reply? {
        guard request.url.host?.lowercased() == FixtureMode.host,
              let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)
        else { return nil }

        let method = request.method.uppercased()
        let path = components.percentEncodedPath
        let segments = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        let query = components.queryItems ?? []

        // 1. 固定路径优先，再匹配带 :id 的路径。
        switch (method, path) {
        case ("GET", "/api/models"):
            return modelsReply()

        case ("GET", "/api/sessions"):
            return jsonReply(sessionsPayload())

        case ("POST", "/api/sessions"):
            let projectId = JSONValue.parse(bodyData(request.body))?["projectId"]?.stringValue
            let session: JSONValue = [
                "id": .string(IDs.liveSession),
                "title": "New chat",
                "icon": .null,
                "pinned": false,
                "position": 0,
                "projectId": projectId.map(JSONValue.string) ?? .null,
                "updatedAt": .string(iso(0)),
            ]
            return jsonReply(["session": session], status: 201)

        case ("POST", "/api/sessions/reorder"):
            return jsonReply(["items": []])

        case ("POST", "/api/chat"):
            return chatStreamReply(for: request)

        case ("GET", "/api/account"):
            return jsonReply(accountPayload())

        case ("PATCH", "/api/account"):
            return jsonReply(["user": signedInUserPayload()])

        case ("POST", "/api/account/avatar"):
            return jsonReply(["user": signedInUserPayload()], status: 201)

        case ("DELETE", "/api/account"), ("POST", "/api/auth/signout"):
            return jsonReply(["ok": true])

        case ("GET", "/api/chat-projects"):
            return jsonReply(projectsPayload())

        case ("POST", "/api/chat-projects"):
            let name = JSONValue.parse(bodyData(request.body))?["name"]?.stringValue ?? "New project"
            return jsonReply(["project": ["id": "fx-project-new", "name": .string(name), "noteCount": 0, "hasInstructions": false]], status: 201)

        case ("GET", "/api/pages"):
            let isRecent = query.contains { $0.name == "recent" && $0.value == "1" }
            return jsonReply(isRecent ? recentPagesPayload() : pagesPayload())

        case ("POST", "/api/pages"):
            let req = JSONValue.parse(bodyData(request.body))
            let kind = req?["kind"]?.stringValue ?? "note"
            let title = req?["title"]?.stringValue ?? "Untitled"
            let groupId = req?["groupId"]
            let parentId = req?["parentId"]
            let page: JSONValue = [
                "id": "fx-page-new",
                "kind": .string(kind),
                "position": 99,
                "title": .string(title),
                "icon": .null,
                "version": 1,
                "groupId": groupId ?? .null,
                "parentId": parentId ?? .null,
                "createdAt": .string(iso(0)),
                "updatedAt": .string(iso(0)),
            ]
            return jsonReply(["page": page], status: 201)

        case ("POST", "/api/pages/reorder"):
            return jsonReply(["items": []])

        case ("GET", "/api/pages/trash"), ("DELETE", "/api/pages/trash"):
            return jsonReply(method == "GET" ? trashPayload() : ["ok": true])

        case ("GET", "/api/pages/covers"), ("GET", "/api/account/avatar"):
            return imageReply()

        case ("GET", "/api/search"):
            let q = query.first(where: { $0.name == "q" })?.value ?? ""
            let scope = query.first(where: { $0.name == "scope" })?.value ?? "all"
            return jsonReply(searchPayload(query: q, scope: scope))

        case ("GET", "/api/billing"):
            guard account == .signedIn else {
                return jsonReply(["error": "Sign in to view your plan."], status: 401)
            }
            return jsonReply(billingPayload())

        case ("GET", "/api/custom-instructions"), ("PUT", "/api/custom-instructions"):
            guard account == .signedIn else {
                return jsonReply(["error": "Sign in to edit custom instructions."], status: 401)
            }
            return jsonReply(["instructions": "Keep answers concise. Use metric units."])

        case ("GET", "/api/app-icon"):
            guard account == .signedIn else {
                return jsonReply(["error": "Sign in to manage app icon."], status: 401)
            }
            return jsonReply([
                "icon": .null,
                "updatedAt": .string(iso(-20 * 86400)),
                "account": "fx-account",
            ])

        case ("PUT", "/api/app-icon"):
            return jsonReply([
                "icon": JSONValue.parse(bodyData(request.body))?["icon"] ?? .null,
                "updatedAt": .string(iso(0)),
                "account": "fx-account",
            ])

        case ("GET", "/api/i18n"):
            return jsonReply(["locale": "en"])

        case ("POST", "/api/native-auth/nonce"):
            return jsonReply(["nonce": "fx-nonce"])

        case ("GET", "/api/auth/csrf"):
            return jsonReply(["csrfToken": "fx-csrf"])

        case ("POST", "/api/auth/email/start"),
             ("POST", "/api/auth/email/verify"),
             ("POST", "/api/reports"):
            return jsonReply(["ok": true])

        case ("POST", "/api/uploads"), ("POST", "/api/images"):
            return jsonReply(["error": "Disabled in fixture mode."], status: 503)

        default:
            break
        }

        // 2. 带 :id 的路径。
        if segments.count == 4, segments[0] == "api", segments[1] == "sessions" {
            let sid = segments[2]
            switch (method, segments[3]) {
            case ("GET", "messages"):
                return messagesReply(sessionId: sid)
            case ("POST", "stop"), ("POST", "versions"):
                return jsonReply(["ok": true])
            case ("POST", "page"):
                return jsonReply(["error": "Disabled in fixture mode."], status: 503)
            default:
                break
            }
        }

        if segments.count == 3, segments[0] == "api", segments[1] == "sessions" {
            if method == "PATCH" || method == "DELETE" {
                return jsonReply(["ok": true])
            }
        }

        if segments.count == 3, segments[0] == "api", segments[1] == "chat-projects", method == "GET" {
            return projectDetailReply(id: segments[2])
        }

        if segments.count == 4, segments[0] == "api", segments[1] == "pages", segments[3] == "share", method == "GET" {
            let pageId = segments[2]
            let shared = pageId == IDs.tripPage || pageId == IDs.glassPage
            return jsonReply([
                "share": [
                    "enabled": .bool(shared),
                    "active": .bool(shared),
                    "expired": false,
                    "token": "fx-share-token",
                    "url": .string("\(FixtureMode.siteURL)/s/fx-share-token"),
                    "includeSubpages": true,
                    "expiresAt": .null,
                    "excludeFromParent": false,
                    "hasParent": false,
                ],
            ])
        }

        if segments.count == 3, segments[0] == "api", segments[1] == "pages", method == "DELETE" {
            return jsonReply(["ids": [.string(segments[2])]])
        }

        if segments.count == 4, segments[0] == "api", segments[1] == "attachments", segments[3] == "image", method == "GET" {
            return imageReply()
        }

        return nil
    }

    // MARK: - 响应构造

    private func jsonReply(_ value: JSONValue, status: Int = 200, setCookie: Bool = true) -> FixtureTransport.Reply {
        var headers = ["Content-Type": "application/json; charset=utf-8"]
        if setCookie {
            headers["Set-Cookie"] = "notefable_device=fx-device; Path=/; HttpOnly; SameSite=Lax"
        }
        return FixtureTransport.Reply(status: status, headers: headers, body: Data(value.encodedString().utf8))
    }

    private func imageReply() -> FixtureTransport.Reply {
        FixtureTransport.Reply(
            status: 200,
            headers: ["Content-Type": "image/png"],
            body: image
        )
    }

    private func modelsReply() -> FixtureTransport.Reply {
        if let models, !models.isEmpty {
            return FixtureTransport.Reply(
                status: 200,
                headers: ["Content-Type": "application/json; charset=utf-8"],
                body: models
            )
        }
        let fallback: JSONValue = [
            "defaultModel": "gpt-6-luna",
            "models": [
                [
                    "id": "gpt-6-luna",
                    "label": "Luna",
                    "provider": "openai",
                    "supportsImageInput": true,
                    "supportsWebSearch": true,
                    "reasoningEfforts": ["none", "low", "medium", "high"],
                    "defaultReasoning": "medium",
                ],
                [
                    "id": "claude-sonnet-4-6",
                    "label": "Claude Sonnet",
                    "provider": "anthropic",
                    "supportsImageInput": true,
                    "supportsWebSearch": true,
                    "reasoningEfforts": ["none", "low", "medium", "high"],
                    "defaultReasoning": "medium",
                ],
            ],
        ]
        return jsonReply(fallback, setCookie: false)
    }

    private func sessionsPayload() -> JSONValue {
        [
            "sessions": [
                [
                    "id": .string(IDs.kyotoSession),
                    "title": "Kyoto weekend itinerary",
                    "icon": "🍁",
                    "pinned": true,
                    "position": 0,
                    "projectId": .null,
                    "noteId": .null,
                    "createdAt": .string(iso(-2 * 86400)),
                    "updatedAt": .string(iso(-600)),
                ],
                [
                    "id": .string(IDs.glassSession),
                    "title": "Liquid Glass vs. blur materials",
                    "icon": .null,
                    "pinned": false,
                    "position": 0,
                    "projectId": .string(IDs.appProject),
                    "noteId": .null,
                    "createdAt": .string(iso(-5 * 86400)),
                    "updatedAt": .string(iso(-3 * 3600)),
                ],
                [
                    "id": .string(IDs.ramenSession),
                    "title": "Weeknight miso ramen",
                    "icon": "🍜",
                    "pinned": false,
                    "position": 1,
                    "projectId": .null,
                    "noteId": .null,
                    "createdAt": .string(iso(-3 * 86400)),
                    "updatedAt": .string(iso(-86400)),
                ],
                [
                    "id": .string(IDs.meetingSession),
                    "title": "Summarize meeting notes",
                    "icon": "📝",
                    "pinned": false,
                    "position": 2,
                    "projectId": .null,
                    "noteId": .string(IDs.meetingPage),
                    "createdAt": .string(iso(-10 * 86400)),
                    "updatedAt": .string(iso(-8 * 86400)),
                ],
            ],
        ]
    }

    private func messagesReply(sessionId: String) -> FixtureTransport.Reply {
        switch sessionId {
        case IDs.kyotoSession:
            return jsonReply(kyotoMessagesPayload())
        case IDs.liveSession:
            return jsonReply([
                "messages": [
                    [
                        "id": "fx-msg-live-1",
                        "role": "USER",
                        "content": .string(Prompts.streamed),
                        "createdAt": .string(iso(-120)),
                        "attachments": [],
                        "generatedImages": [],
                        "pages": [],
                    ],
                    [
                        "id": "fx-msg-live-2",
                        "role": "ASSISTANT",
                        "content": .string(Self.answerLead + Self.answerBody),
                        "model": "gpt-6-luna",
                        "reasoningEffort": "medium",
                        "thinkingMs": 2100,
                        "createdAt": .string(iso(-60)),
                        "activity": [
                            [
                                "id": "fx-thought-live",
                                "kind": "thought",
                                "text": "**Comparing materials**\n\nGlass refracts the content behind it while blur only frosts.",
                            ],
                        ],
                        "attachments": [],
                        "generatedImages": [],
                        "proposals": [],
                        "pages": [],
                    ],
                ],
            ])
        case IDs.glassSession, IDs.ramenSession, IDs.meetingSession:
            return jsonReply([
                "messages": [
                    [
                        "id": .string("fx-msg-\(sessionId)-1"),
                        "role": "USER",
                        "content": "Share a quick summary.",
                        "createdAt": .string(iso(-7200)),
                        "attachments": [],
                        "generatedImages": [],
                        "pages": [],
                    ],
                    [
                        "id": .string("fx-msg-\(sessionId)-2"),
                        "role": "ASSISTANT",
                        "content": "Here is a concise outline ready to review.",
                        "model": "gpt-6-luna",
                        "createdAt": .string(iso(-7100)),
                        "attachments": [],
                        "generatedImages": [],
                        "proposals": [],
                        "pages": [],
                    ],
                ],
            ])
        default:
            return jsonReply(["error": "Session not found."], status: 404)
        }
    }

    private func kyotoMessagesPayload() -> JSONValue {
        let day1Markdown = """
        ## Day 1 — Higashiyama

        - **Morning:** Kiyomizu-dera, then Ninenzaka and Sannenzaka.
        - **Afternoon:** Yasaka Shrine and Philosopher's Path before sunset.

        | Time | Stop | Walk |
        |---|---|---|
        | 09:00 | Kiyomizu-dera | — |
        | 12:30 | Yasaka Shrine | 15 min |
        | 15:00 | Nanzen-ji | 25 min |

        ```text
        Total walking: ~9 km
        ```

        Entry fees: $3 \\times 600 = 1{,}800$ yen.
        """
        let day2Markdown = """
        ## Day 2 — Arashiyama

        1. Arrive at the bamboo grove around **07:30** before tour buses.
        2. Visit Tenryu-ji garden and cross Togetsukyo Bridge for coffee along the Katsura River.
        """
        return [
            "messages": [
                [
                    "id": "fx-msg-kyoto-1",
                    "role": "USER",
                    "content": "Plan a relaxed two-day Kyoto weekend in early December. Mostly walking.",
                    "model": .null,
                    "reasoningEffort": .null,
                    "activity": .null,
                    "createdAt": .string(iso(-1800)),
                    "attachments": [
                        [
                            "id": .string(IDs.routeAttachment),
                            "filename": "route-sketch.png",
                            "mimeType": "image/png",
                            "size": 48213,
                            "dataUrl": .string("/api/attachments/\(IDs.routeAttachment)/image"),
                        ],
                    ],
                    "pages": [
                        [
                            "id": .string(IDs.tripPage),
                            "kind": "note",
                            "title": "Kyoto trip plan",
                            "icon": "🗺️",
                        ],
                    ],
                    "generatedImages": [],
                    "proposals": [],
                ],
                [
                    "id": "fx-msg-kyoto-2",
                    "role": "ASSISTANT",
                    "content": .string(day1Markdown),
                    "model": "gpt-6-luna",
                    "reasoningEffort": "medium",
                    "thinkingMs": 5400,
                    "createdAt": .string(iso(-1740)),
                    "activity": [
                        [
                            "id": "fx-thought-1",
                            "kind": "thought",
                            "text": "**Grouping by district**\n\nKeep each half day inside one walkable area.",
                        ],
                        [
                            "id": "fx-web-1",
                            "kind": "web",
                            "action": [
                                "kind": "search",
                                "queries": ["Kyoto December temple hours"],
                                "sources": ["https://example.com/kyoto-temples"],
                            ],
                        ],
                    ],
                    "attachments": [],
                    "generatedImages": [],
                    "proposals": [],
                    "pages": [],
                    "versions": [
                        "index": 2,
                        "total": 2,
                        "prevId": "fx-msg-kyoto-2a",
                        "nextId": .null,
                    ],
                ],
                [
                    "id": "fx-msg-kyoto-3",
                    "role": "USER",
                    "content": "Draw a postcard of Fushimi Inari at dusk.",
                    "createdAt": .string(iso(-1200)),
                    "attachments": [],
                    "generatedImages": [],
                    "proposals": [],
                    "pages": [],
                ],
                [
                    "id": "fx-msg-kyoto-4",
                    "role": "ASSISTANT",
                    "content": "",
                    "model": "gpt-6-luna",
                    "createdAt": .string(iso(-1140)),
                    "attachments": [],
                    "generatedImages": [
                        [
                            "id": .string(IDs.postcardImage),
                            "dataUrl": .string("/api/attachments/\(IDs.postcardImage)/image"),
                            "mimeType": "image/png",
                        ],
                    ],
                    "proposals": [],
                    "pages": [],
                ],
                [
                    "id": "fx-msg-kyoto-5",
                    "role": "USER",
                    "content": "What about Day 2 morning around Arashiyama?",
                    "createdAt": .string(iso(-700)),
                    "attachments": [],
                    "generatedImages": [],
                    "proposals": [],
                    "pages": [],
                ],
                [
                    "id": "fx-msg-kyoto-6",
                    "role": "ASSISTANT",
                    "content": .string(day2Markdown),
                    "model": "gpt-6-luna",
                    "reasoningEffort": "low",
                    "createdAt": .string(iso(-640)),
                    "attachments": [],
                    "generatedImages": [],
                    "proposals": [],
                    "pages": [],
                ],
            ],
        ]
    }

    private func signedInUserPayload() -> JSONValue {
        [
            "name": "Fixture User",
            "googleName": "Fixture User",
            "email": "fixture@example.com",
            "image": .null,
            "displayName": .null,
            "icon": "🦊",
            "avatarUrl": .null,
            "locale": appLanguage.map(JSONValue.string) ?? .null,
        ]
    }

    private func accountPayload() -> JSONValue {
        [
            "configured": true,
            "google": true,
            "email": true,
            "googleClientId": "000000000000-fixture.apps.googleusercontent.com",
            "user": account == .signedIn ? signedInUserPayload() : .null,
        ]
    }

    private func projectsPayload() -> JSONValue {
        [
            "projects": [
                [
                    "id": .string(IDs.appProject),
                    "name": "NoteFable iOS",
                    "noteCount": 2,
                    "hasInstructions": true,
                ],
                [
                    "id": .string(IDs.studyProject),
                    "name": "Study",
                    "noteCount": 0,
                    "hasInstructions": false,
                ],
            ],
        ]
    }

    private func projectDetailReply(id: String) -> FixtureTransport.Reply {
        let name = id == IDs.studyProject ? "Study" : "NoteFable iOS"
        return jsonReply([
            "project": [
                "id": .string(id),
                "name": .string(name),
                "instructions": "Answer as a senior iOS engineer.",
                "notes": [
                    ["id": .string(IDs.glassPage), "title": "Liquid Glass checklist", "icon": "🫧", "kind": "note"],
                    ["id": .string(IDs.boardPage), "title": "Navigation sketch", "icon": .null, "kind": "whiteboard"],
                ],
            ],
        ])
    }

    private func pagesPayload() -> JSONValue {
        let kindsValue = kinds.flatMap { JSONValue.parse($0) } ?? [
            "note": ["editor": true, "markdownExport": true, "typography": true, "publicShare": true, "aiEdit": true],
            "whiteboard": ["editor": true, "markdownExport": false, "typography": false, "publicShare": true, "aiEdit": false],
            "slides": ["editor": true, "markdownExport": false, "typography": false, "publicShare": true, "aiEdit": false],
        ]
        return [
            "pages": [
                [
                    "id": .string(IDs.tripPage),
                    "kind": "note",
                    "position": 0,
                    "title": "Kyoto trip plan",
                    "icon": "🗺️",
                    "version": 12,
                    "groupId": .string(IDs.travelGroup),
                    "parentId": .null,
                    "favoritedAt": .string(iso(-7 * 86400)),
                    "fullWidth": false,
                    "smallText": false,
                    "font": "default",
                    "locked": false,
                    "shareEnabled": true,
                    "shareExpiresAt": .null,
                    "aiUpdatedAt": .string(iso(-570)),
                    "createdAt": .string(iso(-14 * 86400)),
                    "updatedAt": .string(iso(-300)),
                ],
                [
                    "id": .string(IDs.packingPage),
                    "kind": "note",
                    "position": 1,
                    "title": "Packing list",
                    "icon": "🧳",
                    "version": 3,
                    "groupId": .string(IDs.travelGroup),
                    "parentId": .string(IDs.tripPage),
                    "favoritedAt": .null,
                    "fullWidth": false,
                    "smallText": false,
                    "font": "default",
                    "locked": false,
                    "shareEnabled": false,
                    "shareExpiresAt": .null,
                    "aiUpdatedAt": .null,
                    "createdAt": .string(iso(-13 * 86400)),
                    "updatedAt": .string(iso(-2 * 86400)),
                ],
                [
                    "id": .string(IDs.glassPage),
                    "kind": "note",
                    "position": 2,
                    "title": "Liquid Glass checklist",
                    "icon": "🫧",
                    "version": 7,
                    "groupId": .null,
                    "parentId": .null,
                    "favoritedAt": .null,
                    "fullWidth": false,
                    "smallText": false,
                    "font": "default",
                    "locked": true,
                    "shareEnabled": true,
                    "shareExpiresAt": .null,
                    "aiUpdatedAt": .null,
                    "createdAt": .string(iso(-15 * 86400)),
                    "updatedAt": .string(iso(-10800)),
                ],
                [
                    "id": .string(IDs.roadmapPage),
                    "kind": "slides",
                    "position": 3,
                    "title": "Q4 roadmap",
                    "icon": .null,
                    "version": 5,
                    "groupId": .string(IDs.workGroup),
                    "parentId": .null,
                    "createdAt": .string(iso(-24 * 86400)),
                    "updatedAt": .string(iso(-4 * 86400)),
                ],
                [
                    "id": .string(IDs.boardPage),
                    "kind": "whiteboard",
                    "position": 4,
                    "title": "Navigation sketch",
                    "icon": .null,
                    "version": 9,
                    "groupId": .null,
                    "parentId": .null,
                    "createdAt": .string(iso(-23 * 86400)),
                    "updatedAt": .string(iso(-6 * 86400)),
                ],
            ],
            "groups": [
                ["id": .string(IDs.travelGroup), "name": "Travel", "position": 0],
                ["id": .string(IDs.workGroup), "name": "Work", "position": 1],
            ],
            "kinds": kindsValue,
        ]
    }

    private func recentPagesPayload() -> JSONValue {
        [
            "pages": [
                // One page with a cover, so the screenshot shows covered and uncovered cards side by side (#204).
                ["id": .string(IDs.tripPage), "kind": "note", "title": "Kyoto trip plan", "icon": "🗺️", "cover": "gradient-mint", "updatedAt": .string(iso(-300))],
                ["id": .string(IDs.glassPage), "kind": "note", "title": "Liquid Glass checklist", "icon": "🫧", "updatedAt": .string(iso(-10800))],
                ["id": .string(IDs.roadmapPage), "kind": "slides", "title": "Q4 roadmap", "icon": .null, "updatedAt": .string(iso(-4 * 86400))],
                ["id": .string(IDs.boardPage), "kind": "whiteboard", "title": "Navigation sketch", "icon": .null, "updatedAt": .string(iso(-6 * 86400))],
            ],
        ]
    }

    private func trashPayload() -> JSONValue {
        [
            "pages": [
                [
                    "id": .string(IDs.draftPage),
                    "kind": "note",
                    "title": "Old draft",
                    "icon": .null,
                    "deletedAt": .string(iso(-3 * 86400)),
                    "purgeAt": .string(iso(27 * 86400)),
                ],
            ],
        ]
    }

    private func searchPayload(query: String, scope: String) -> JSONValue {
        let notes: [JSONValue] = scope == "chats" ? [] : [
            [
                "kind": "note",
                "id": .string(IDs.tripPage),
                "pageKind": "note",
                "title": "Kyoto trip plan",
                "icon": "🗺️",
                "snippet": "Day 1 in Kyoto: Kiyomizu-dera, then Ninenzaka and Sannenzaka",
                "blockId": "fx-block-day1",
                "updatedAt": .string(iso(-300)),
            ],
            [
                "kind": "note",
                "id": .string(IDs.boardPage),
                "pageKind": "whiteboard",
                "title": "Kyoto transit sketch",
                "icon": .null,
                "snippet": "Subway transfer from Kyoto Station to Karasuma Oike",
                "blockId": "fx-el-station",
                "updatedAt": .string(iso(-6 * 86400)),
            ],
        ]
        let chats: [JSONValue] = scope == "notes" ? [] : [
            [
                "kind": "chat",
                "id": .string(IDs.kyotoSession),
                "title": "Kyoto weekend itinerary",
                "icon": "🍁",
                "snippet": "Plan a relaxed two-day Kyoto weekend in early December",
                "messageId": "fx-msg-kyoto-1",
                "role": "USER",
                "attachmentName": .null,
                "projectId": .null,
                "titleMatch": true,
                "updatedAt": .string(iso(-600)),
            ],
            [
                "kind": "chat",
                "id": .string(IDs.glassSession),
                "title": "Liquid Glass vs. blur materials",
                "icon": .null,
                "snippet": "Compare refraction in Kyoto sample photos",
                "messageId": "fx-msg-fx-session-glass-1",
                "role": "USER",
                "attachmentName": .null,
                "projectId": .string(IDs.appProject),
                "titleMatch": false,
                "updatedAt": .string(iso(-3 * 3600)),
            ],
        ]
        return [
            "query": .string(query),
            "notes": .array(notes),
            "chats": .array(chats),
        ]
    }

    private func billingPayload() -> JSONValue {
        [
            "billing": true,
            "googlePlay": false,
            "productId": .null,
            "accountId": "fx-user-1",
            "provider": .null,
            "priceJpy": 300,
            "trialDays": 30,
            "plan": "free",
            "subscription": .null,
            "canManage": false,
            "manageUrl": .null,
            "usage": [
                "chat": [
                    "used": 12,
                    "limit": 40,
                    "period": "day",
                    "resetsAt": .string(iso(12 * 3600)),
                ],
                "image": [
                    "used": 4,
                    "limit": 20,
                    "period": "month",
                    "resetsAt": .string(iso(5 * 86400)),
                    "daily": [
                        "used": 1,
                        "limit": 5,
                        "resetsAt": .string(iso(12 * 3600)),
                    ],
                ],
            ],
            "storage": [
                "used": 73_400_320,
                "limit": 524_288_000,
            ],
        ]
    }

    private func chatStreamReply(for request: HTTPRequest) -> FixtureTransport.Reply {
        let sessionId = extractMultipartField("sessionId", from: request.body) ?? IDs.liveSession
        let message = extractMultipartField("message", from: request.body)
        let hold = streamHoldsOpen && message != Prompts.streamed
        var chunks: [Data] = [
            Data("data: {\"activity\":{\"type\":\"thought\",\"id\":\"fx-thought-live\",\"delta\":\"**Comparing materials**\\n\\nGlass refracts the content behind it while blur only frosts.\"}}\n\n".utf8),
            Data("data: \(JSONValue.string(Self.answerLead).encodedString())\n\n".utf8),
            Data("data: \(JSONValue.string(Self.answerBody).encodedString())\n\n".utf8),
        ]
        if !hold {
            chunks.append(Data("data: [DONE]\n\n".utf8))
        }
        return FixtureTransport.Reply(
            status: 200,
            headers: [
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Session-Id": sessionId,
                "Set-Cookie": "notefable_device=fx-device; Path=/; HttpOnly; SameSite=Lax",
            ],
            chunks: chunks,
            chunkGap: .milliseconds(80),
            holdOpen: hold
        )
    }

    // MARK: - 小工具

    private func iso(_ offsetSeconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(offsetSeconds))
    }

    private func bodyData(_ body: HTTPBody?) -> Data {
        switch body {
        case .data(let data): return data
        case .file, nil: return Data()
        }
    }

    private func extractMultipartField(_ name: String, from body: HTTPBody?) -> String? {
        let data = bodyData(body)
        guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return nil }
        let marker = "name=\"\(name)\"\r\n\r\n"
        guard let start = text.range(of: marker) else { return nil }
        let rest = text[start.upperBound...]
        guard let end = rest.range(of: "\r\n") else { return nil }
        let value = String(rest[..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
#endif
