import Foundation

/// `/api/chat` 的 SSE 事件。协议见 `src/lib/chat-stream.ts`。
enum ChatStreamEvent: Equatable, Sendable {
    /// 响应头已到。新聊天的会话 ID 在 `X-Session-Id` 里。
    case started(sessionId: String?)

    /// 本文增量。
    case delta(text: String)

    /// 推理摘要、联网搜索、笔记工具的过程事件（`{"activity":{…}}` 里的那个对象，原样保留，由 Activity 解析）。
    case activity(payload: JSONValue)
}

enum ChatStreamParser {
    /// 解析一行 SSE。`data: "文本"` 是正文增量，`data: {"activity":{...}}` 是过程事件，
    /// `[DONE]`、注释行、空行和读不懂的内容都返回 nil（与网页端一致，宁可忽略也不中断回答）。
    static func parseLine(_ line: String) -> ChatStreamEvent? {
        let trimmed = ApiText.trim(line)
        guard trimmed.hasPrefix("data:") else { return nil }
        let payload = ApiText.trim(String(trimmed.dropFirst("data:".count)))
        if payload.isEmpty || payload == "[DONE]" { return nil }

        guard let element = JSONValue.parse(payload) else { return nil }
        switch element {
        case .string(let text):
            return .delta(text: text)
        case .object(let fields):
            guard case .object? = fields["activity"], let activity = fields["activity"] else { return nil }
            return .activity(payload: activity)
        default:
            return nil
        }
    }
}

/// 把收到的字节切成行（按 `\n`，行尾的 `\r` 去掉）。在字节上切：一个汉字或表情可能被网络分成两块，
/// 而且 Swift 把 "\r\n" 当成一个字符，在字符串上找换行会漏。对应 Android 的 `source.readUtf8Line()`。
struct ChatStreamLineBuffer {
    private var pending = Data()

    /// 加进一块数据，返回凑齐了的行。
    mutating func append(_ chunk: Data) -> [String] {
        pending.append(chunk)
        var lines: [String] = []
        var start = pending.startIndex
        while let newline = pending[start...].firstIndex(of: 0x0A) {
            lines.append(Self.decode(pending[start..<newline]))
            start = pending.index(after: newline)
        }
        if start != pending.startIndex { pending = Data(pending[start...]) }
        return lines
    }

    /// 流结束：最后一行没有换行符也算一行。
    mutating func finish() -> String? {
        guard !pending.isEmpty else { return nil }
        defer { pending = Data() }
        return Self.decode(pending[...])
    }

    private static func decode(_ bytes: Data) -> String {
        var bytes = bytes
        if bytes.last == 0x0D { bytes = bytes.dropLast() }
        return String(decoding: bytes, as: UTF8.self)
    }
}
