// iOS 端 7 个预设 AI 角色的数据文件（mobile/ios/NoteFable/Core/Support/CharactersData.generated.swift）的内容。
// 和 Android 的 scripts/gen-native-characters.ts 一样从 src/lib/characters.ts 生成：CharacterId、各角色的图层路径、
// 眼睛、动作参数和两个 viewBox。模型类型、状态机和姿态计算手写在 Core/Support/Characters.swift。
// 生成：npx tsx scripts/gen-ios-characters.ts；src/lib/ios-characters.test.ts 在文件过期时让测试失败。
import {
  CHARACTER_DEFINITIONS,
  CHARACTER_HERO_VIEWBOX,
  CHARACTER_ICON_VIEWBOX,
  DEFAULT_CHARACTER_ID,
  type CharacterEye,
  type CharacterLayerPath,
} from "../src/lib/characters";

export const IOS_CHARACTERS_SWIFT = "mobile/ios/NoteFable/Core/Support/CharactersData.generated.swift";

// 角色 id 直接当 Swift 的枚举 case 名，所以只接受普通的小写标识符。
const SWIFT_KEYWORDS = new Set([
  "as", "break", "case", "catch", "class", "continue", "default", "defer", "do", "else", "enum", "extension",
  "fallthrough", "false", "for", "func", "guard", "if", "import", "in", "init", "internal", "is", "let", "nil",
  "operator", "private", "protocol", "public", "repeat", "return", "self", "static", "struct", "subscript", "super",
  "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while",
]);

function caseName(id: string): string {
  if (!/^[a-z][A-Za-z0-9]*$/.test(id) || SWIFT_KEYWORDS.has(id)) {
    throw new Error(`Character id cannot be used as a Swift enum case: ${id}`);
  }
  return id;
}

function swiftString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === '"') out += `\\${char}`;
    else if (code < 0x20 || code === 0x7f) out += `\\u{${code.toString(16)}}`;
    else out += char;
  }
  return `${out}"`;
}

function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Unsupported number: ${n}`);
  const text = String(n);
  if (/e/i.test(text)) throw new Error(`Unsupported number format: ${text}`);
  return text;
}

function argb(hex: string | undefined): string {
  if (!hex || hex === "none") return "nil";
  const clean = hex.replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(clean)) return `0xFF${clean}`;
  // CSS 的 8 位写法是 RRGGBBAA，这里要 AARRGGBB（和 Sm 的 Color(argb:) 一致）。
  if (/^[0-9A-F]{8}$/.test(clean)) return `0x${clean.slice(6)}${clean.slice(0, 6)}`;
  throw new Error(`Unsupported color hex: ${hex}`);
}

function requiredArgb(hex: string): string {
  const value = argb(hex);
  if (value === "nil") throw new Error(`A color is required here: ${hex}`);
  return value;
}

function renderLayerPath(p: CharacterLayerPath): string {
  return (
    `CharacterPath(d: ${swiftString(p.d)}, fillArgb: ${argb(p.fill)}, strokeArgb: ${argb(p.stroke)}, ` +
    `strokeWidth: ${num(p.strokeWidth ?? 0)}, strokeCap: .${p.strokeLinecap ?? "butt"}, ` +
    `strokeJoin: .${p.strokeLinejoin ?? "miter"}, evenOdd: ${p.fillRule === "evenodd"})`
  );
}

function renderEye(e: CharacterEye): string {
  if (e.kind === "capsule") {
    return (
      `.capsule(CharacterEye.Capsule(x: ${num(e.x)}, y: ${num(e.y)}, width: ${num(e.width)}, height: ${num(e.height)}, ` +
      `rx: ${num(e.rx)}, rotation: ${num(e.rotation ?? 0)}, cx: ${num(e.cx)}, cy: ${num(e.cy)}, fillArgb: ${requiredArgb(e.fill)}))`
    );
  }
  return `.polygon(CharacterEye.Polygon(d: ${swiftString(e.d)}, cx: ${num(e.cx)}, cy: ${num(e.cy)}, fillArgb: ${requiredArgb(e.fill)}))`;
}

function renderList(items: readonly string[], indent: string): string {
  if (items.length === 0) return "[]";
  return `[\n${items.map((item) => `${indent}    ${item},`).join("\n")}\n${indent}]`;
}

function renderViewBox(viewBox: string): string {
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4) throw new Error(`Unsupported viewBox: ${viewBox}`);
  const [x, y, width, height] = parts;
  return `CharacterViewBox(x: ${num(x)}, y: ${num(y)}, width: ${num(width)}, height: ${num(height)})`;
}

export function renderIosCharactersSwift(): string {
  const ids = CHARACTER_DEFINITIONS.map((c) => caseName(c.id));

  const cases = ids.map((id) => `    case ${id}`).join("\n");
  const names = CHARACTER_DEFINITIONS.map((c) => `        case .${c.id}: return ${swiftString(c.name)}`).join("\n");
  const defaults = CHARACTER_DEFINITIONS.map((c) => `        case .${c.id}: return ${Boolean(c.isDefault)}`).join("\n");
  const table = ids.map((id) => `        .${id}: ${id}Spec,`).join("\n");

  const specs = CHARACTER_DEFINITIONS.map((c) => {
    const m = c.motion;
    const indent = "        ";
    return `    private static let ${c.id}Spec = CharacterArtSpec(
        id: .${c.id},
        accentPivotX: ${num(c.accentPivot.x)},
        accentPivotY: ${num(c.accentPivot.y)},
        eyeCenterX: ${num(c.eyeCenter.x)},
        eyeCenterY: ${num(c.eyeCenter.y)},
        shadowRx: ${num(c.shadowRx)},
        backAccentPaths: ${renderList(c.backAccentPaths.map(renderLayerPath), indent)},
        bodyPaths: ${renderList(c.bodyPaths.map(renderLayerPath), indent)},
        frontAccentPaths: ${renderList(c.frontAccentPaths.map(renderLayerPath), indent)},
        eyes: ${renderList(c.eyes.map(renderEye), indent)},
        motion: CharacterMotionSpec(
            floatAmplitude: ${num(m.floatAmplitude)},
            floatDurationMs: ${num(m.floatDurationMs)},
            idleAccentDeg: ${num(m.idleAccentDeg)},
            idleBodyTiltDeg: ${num(m.idleBodyTiltDeg)},
            typingTiltDeg: ${num(m.typingTiltDeg)},
            typingAccentDeg: ${num(m.typingAccentDeg)},
            typingGazeY: ${num(m.typingGazeY)},
            thinkingTiltDeg: ${num(m.thinkingTiltDeg)},
            thinkingAccentDeg: ${num(m.thinkingAccentDeg)},
            thinkingGazeX: ${num(m.thinkingGazeX)},
            respondingTiltDeg: ${num(m.respondingTiltDeg)},
            respondingAccentDeg: ${num(m.respondingAccentDeg)},
            completedNodY: ${num(m.completedNodY)},
            completedAccentDeg: ${num(m.completedAccentDeg)},
            errorDropY: ${num(m.errorDropY)},
            errorTiltDeg: ${num(m.errorTiltDeg)},
            errorAccentDeg: ${num(m.errorAccentDeg)}
        )
    )`;
  }).join("\n\n");

  return `// Generated by scripts/gen-ios-characters.ts from src/lib/characters.ts. Do not edit by hand.
import Foundation

enum CharacterId: String, CaseIterable, Sendable {
${cases}

    static let \`default\`: CharacterId = .${caseName(DEFAULT_CHARACTER_ID)}

    var displayName: String {
        switch self {
${names}
        }
    }

    var isDefault: Bool {
        switch self {
${defaults}
        }
    }
}

extension CharacterCatalog {
    static let iconViewBox = ${renderViewBox(CHARACTER_ICON_VIEWBOX)}
    static let heroViewBox = ${renderViewBox(CHARACTER_HERO_VIEWBOX)}

    static let specs: [CharacterId: CharacterArtSpec] = [
${table}
    ]

${specs}
}
`;
}
