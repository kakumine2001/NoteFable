import Foundation
import Observation

/// 界面文案。键和 Android 的字符串资源名相同（`res/values/strings*.xml` 的 name），
/// 各语言的 `Resources/<语言>.lproj/Localizable.strings` 由 `scripts/gen-ios-strings.ts` 从 Android 资源生成，不手改。
///
/// 占位符保留 Android 的写法（`%1$s`、`%2$d`、`%%`），由 `L10n.format` 自己替换，不走 `String(format:)`：
/// 这样 Linux 上的测试和 App 里的结果相同，也不用把 `%s` 改成 `%@`。
///
/// 用法：`L("send")`、`L("attached_count", 2, 10)`。
/// 在 SwiftUI 的 body 里调用会登记对当前语言的依赖，换语言时用到文案的视图自动重绘，不用重建界面。
func L(_ key: String, _ args: Any...) -> String {
    let template = L10n.shared.template(key)
    return args.isEmpty ? template : L10n.format(template, args)
}

@Observable
final class L10n: @unchecked Sendable {
    static let shared = L10n()

    private let lock = NSLock()
    private var current: Bundle = .main
    /// 当前界面语言的代码（网页 Locale：en、zh、zh-Hant、ja、pt-BR…）。读它也会登记依赖。
    private(set) var locale: String = "en"

    /// 换成某个语言的 lproj 包。`bundle` 传 `Bundle.main` 表示跟随系统。由 App 层的语言控制器调用。
    func use(bundle: Bundle, locale: String) {
        lock.lock()
        current = bundle
        lock.unlock()
        self.locale = locale
    }

    /// 没有译文时返回键本身（单元测试里没有资源，断言用键即可）。
    func template(_ key: String) -> String {
        _ = locale // 登记依赖：语言变了，读过文案的视图要重绘
        lock.lock()
        let bundle = current
        lock.unlock()
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }

    /// 替换 Android 写法的占位符：`%1$s` / `%1$d` 换成第 n 个参数，`%%` 换成 `%`，其它原样保留。
    static func format(_ template: String, _ args: [Any]) -> String {
        var out = ""
        out.reserveCapacity(template.count + 16)
        let chars = Array(template)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            guard c == "%", i + 1 < chars.count else {
                out.append(c)
                i += 1
                continue
            }
            if chars[i + 1] == "%" {
                out.append("%")
                i += 2
                continue
            }
            var j = i + 1
            var digits = ""
            while j < chars.count, chars[j].isASCII, chars[j].isNumber {
                digits.append(chars[j])
                j += 1
            }
            if !digits.isEmpty, j + 1 < chars.count, chars[j] == "$", chars[j + 1] == "s" || chars[j + 1] == "d",
               let index = Int(digits), index >= 1, index <= args.count {
                out.append(describe(args[index - 1]))
                i = j + 2
            } else {
                out.append(c)
                i += 1
            }
        }
        return out
    }

    private static func describe(_ value: Any) -> String {
        switch value {
        case let text as String: return text
        case let number as Int: return String(number)
        case let number as Int64: return String(number)
        case let number as Double:
            return number.rounded() == number && abs(number) < 1e15 ? String(Int64(number)) : String(number)
        default: return String(describing: value)
        }
    }
}
