import Foundation

/// Core/Chat 里共用的文字小工具：空白的判断、去首尾空白、按行分开，语义对齐 Kotlin（`isWhitespace`、`trim`、`lines`）和网页的 JS。
/// 放在一个命名空间里而不是给 String 加扩展，免得和别的模块的同名扩展冲突。
enum ChatText {
    static func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.isWhitespace
    }

    /// Kotlin 的 `Char.isLetter()`（Unicode 的 L 类）。
    static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.isASCII {
            let v = scalar.value
            return (v >= 65 && v <= 90) || (v >= 97 && v <= 122)
        }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    /// Kotlin 的 `Char.isDigit()`（Unicode 的 Nd 类）。
    static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.isASCII { return scalar.value >= 48 && scalar.value <= 57 }
        return scalar.properties.generalCategory == .decimalNumber
    }

    static func isLetterOrDigit(_ scalar: Unicode.Scalar) -> Bool {
        isLetter(scalar) || isDigit(scalar)
    }

    static func isASCIIDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value >= 48 && scalar.value <= 57
    }

    static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        return (v >= 65 && v <= 90) || (v >= 97 && v <= 122)
    }

    static func isASCIIAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
        isASCIILetter(scalar) || isASCIIDigit(scalar)
    }

    static func trim(_ text: String) -> String {
        let scalars = text.unicodeScalars
        var start = scalars.startIndex
        var end = scalars.endIndex
        while start < end, isWhitespace(scalars[start]) { start = scalars.index(after: start) }
        while end > start {
            let previous = scalars.index(before: end)
            guard isWhitespace(scalars[previous]) else { break }
            end = previous
        }
        return String(scalars[start..<end])
    }

    static func trimEnd(_ text: String) -> String {
        let scalars = text.unicodeScalars
        var end = scalars.endIndex
        while end > scalars.startIndex {
            let previous = scalars.index(before: end)
            guard isWhitespace(scalars[previous]) else { break }
            end = previous
        }
        return String(scalars[scalars.startIndex..<end])
    }

    /// 全是空白（或空）。
    static func isBlank(_ text: String) -> Bool {
        text.unicodeScalars.allSatisfy(isWhitespace)
    }

    /// 把 `\r\n`、`\r` 统一成 `\n` 再按行分开。按码位处理：Swift 把 `\r\n` 当成一个 Character，直接 split 分不开。
    static func lines(_ text: String) -> [String] {
        var lines: [String] = []
        var current = String.UnicodeScalarView()
        var afterCR = false
        for scalar in text.unicodeScalars {
            if scalar == "\r" {
                lines.append(String(current))
                current = String.UnicodeScalarView()
                afterCR = true
                continue
            }
            if scalar == "\n" {
                if !afterCR {
                    lines.append(String(current))
                    current = String.UnicodeScalarView()
                }
                afterCR = false
                continue
            }
            afterCR = false
            current.append(scalar)
        }
        lines.append(String(current))
        return lines
    }

    /// 只按 `\n` 分开（Kotlin 的 `split('\n')`；`\r` 留在行里）。
    static func splitLines(_ text: String) -> [String] {
        var lines: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if scalar == "\n" {
                lines.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(scalar)
            }
        }
        lines.append(String(current))
        return lines
    }

    /// 最多留 `count` 个 UTF-16 单元（Kotlin 的 `take`、JS 的 `slice(0, n)`），不把代理对切成两半。
    static func take(_ text: String, utf16 count: Int) -> String {
        var used = 0
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            let width = scalar.value > 0xFFFF ? 2 : 1
            if used + width > count { break }
            used += width
            out.append(scalar)
        }
        return String(out)
    }

    /// 解开 `%XX`（按 UTF-8）。写坏的 `%` 原样留着；`plusIsSpace` 用在查询参数上。
    static func percentDecode(_ text: String, plusIsSpace: Bool = false) -> String {
        guard text.utf8.contains(where: { $0 == 0x25 || (plusIsSpace && $0 == 0x2B) }) else { return text }
        let bytes = Array(text.utf8)
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count)
        var i = 0
        while i < bytes.count {
            let byte = bytes[i]
            if byte == 0x25, i + 2 < bytes.count, let high = hexValue(bytes[i + 1]), let low = hexValue(bytes[i + 2]) {
                out.append(high << 4 | low)
                i += 3
                continue
            }
            out.append(plusIsSpace && byte == 0x2B ? 0x20 : byte)
            i += 1
        }
        return String(decoding: out, as: UTF8.self)
    }

    static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 48...57: return byte - 48
        case 65...70: return byte - 55
        case 97...102: return byte - 87
        default: return nil
        }
    }

    /// 把一个码位写成 `%XX`（UTF-8 的每个字节）。
    static func percentEncode(_ scalar: Unicode.Scalar, into out: inout String) {
        let digits = Array("0123456789ABCDEF".unicodeScalars)
        for byte in String(scalar).utf8 {
            out.unicodeScalars.append("%")
            out.unicodeScalars.append(digits[Int(byte >> 4)])
            out.unicodeScalars.append(digits[Int(byte & 0x0F)])
        }
    }
}

/// 预编译的正则（NSRegularExpression，ICU 语法；位置按 UTF-16 计）。
/// 写错的式子不让 App 崩：编译失败时当作"什么都不匹配"，单元测试检查每个式子都能编译（`isValid`）。
final class ChatRegex: @unchecked Sendable {
    private let regex: NSRegularExpression?

    init(_ pattern: String, _ options: NSRegularExpression.Options = []) {
        regex = try? NSRegularExpression(pattern: pattern, options: options)
    }

    var isValid: Bool { regex != nil }

    func test(_ text: String) -> Bool {
        firstMatch(in: text) != nil
    }

    func firstMatch(in text: String) -> NSTextCheckingResult? {
        regex?.firstMatch(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count))
    }

    func matches(in text: String) -> [NSTextCheckingResult] {
        regex?.matches(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count)) ?? []
    }

    /// 所有匹配换成固定的文字（`replacement` 按字面，不解释 `$1`）。
    func replaceAll(in text: String, with replacement: String) -> String {
        guard let regex else { return text }
        let template = NSRegularExpression.escapedTemplate(for: replacement)
        return regex.stringByReplacingMatches(
            in: text, options: [], range: NSRange(location: 0, length: text.utf16.count), withTemplate: template
        )
    }
}
