// 原生 iOS 的界面文案（mobile/ios/NoteFable/Resources/<语言>.lproj/Localizable.strings）。
// 不另外维护一份：从 Android 的字符串资源（res/values*/strings*.xml，17 种语言）逐条转换。键就是 Android 的资源名，
// 只有 iOS 才需要的少数几条写在下面的 IOS_ONLY_STRINGS 里。
// Swift 端用 L("键", 参数…) 读（mobile/ios/NoteFable/Core/Text/L10n.swift）。
// 值去掉 XML 转义和 Android 转义（\'、\n、"…" 包裹等，规则同 aapt2），占位符（%1$s / %2$d）和 %% 原样保留：
// L10n.format 自己替换它们，不走 String(format:)。遇到没处理过的写法（plurals、数组、内嵌标签、不认识的转义）直接报错。
// 生成：npx tsx scripts/gen-ios-strings.ts；src/lib/ios-strings.test.ts 在文件过期时失败。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOCALES, type Locale } from "../src/lib/i18n/locale";
import { defaultStringXmlFileNames, NATIVE_LOCALE_RES_DIRS, NATIVE_RES_DIR, unescapeAndroidString } from "./native-strings";

const root = path.resolve(import.meta.dirname, "..");
export const IOS_RESOURCES_DIR = path.join(root, "mobile", "ios", "NoteFable", "Resources");
export const IOS_STRINGS_FILE = "Localizable.strings";

// 网页 Locale → iOS 的 lproj 名（和 mobile/ios/Support/Info.plist 的 CFBundleLocalizations、AppLanguage.swift 一致）。
export const IOS_LPROJ: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  "zh-Hant": "zh-Hant",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  "pt-BR": "pt-BR",
  it: "it",
  id: "id",
  vi: "vi",
  th: "th",
  hi: "hi",
  ar: "ar",
  tr: "tr",
  ru: "ru",
};

export function iosStringsPath(locale: Locale): string {
  return path.join(IOS_RESOURCES_DIR, `${IOS_LPROJ[locale]}.lproj`, IOS_STRINGS_FILE);
}

export type AndroidStringEntry = { name: string; raw: string; translatable: boolean };

/** 一个 strings*.xml 里的全部 <string>，按出现顺序。<string> 以外的元素（plurals、string-array…）报错。 */
export function parseAndroidStringsXml(xml: string, label: string): AndroidStringEntry[] {
  const body = xml.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const wrapper = /^\s*<\?xml[^>]*\?>\s*<resources(?:\s[^>]*)?>([\s\S]*)<\/resources>\s*$/.exec(body);
  if (!wrapper) throw new Error(`${label}: expected an XML declaration and one <resources> element`);
  const entries: AndroidStringEntry[] = [];
  const names = new Set<string>();
  const rest = wrapper[1].replace(/<string(\s[^>]*)?>([\s\S]*?)<\/string>/g, (_, attrs: string | undefined, raw: string) => {
    const attributes = new Map<string, string>();
    const leftover = (attrs ?? "").replace(/\s+([\w:.-]+)\s*=\s*"([^"]*)"/g, (__, key: string, value: string) => {
      attributes.set(key, value);
      return "";
    });
    if (leftover.trim()) throw new Error(`${label}: cannot read the attributes of <string${attrs}>`);
    const name = attributes.get("name");
    if (!name || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) throw new Error(`${label}: <string> without a usable name (${name ?? ""})`);
    for (const key of attributes.keys()) {
      if (key !== "name" && key !== "translatable") throw new Error(`${label}:${name}: unsupported attribute ${key}`);
    }
    const translatable = attributes.get("translatable") ?? "true";
    if (translatable !== "true" && translatable !== "false") throw new Error(`${label}:${name}: translatable="${translatable}"`);
    if (names.has(name)) throw new Error(`${label}: duplicate string ${name}`);
    names.add(name);
    entries.push({ name, raw, translatable: translatable === "true" });
    return "";
  });
  if (rest.trim()) throw new Error(`${label}: unsupported content: ${rest.trim().slice(0, 80)}`);
  return entries;
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML 解析器交给 aapt2 的文字：实体换成字符。标签（<b>、<xliff:g>、CDATA）不支持。 */
function decodeXmlText(raw: string, label: string): string {
  if (raw.includes("<")) throw new Error(`${label}: markup inside a string is not supported`);
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (whole: string, ref: string | undefined) => {
    if (ref === undefined) throw new Error(`${label}: bare "&"`);
    if (ref.startsWith("#x")) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    if (!Object.hasOwn(XML_ENTITIES, ref)) throw new Error(`${label}: unknown entity ${whole}`);
    return XML_ENTITIES[ref];
  });
}

const ANDROID_SPACE = /[ \t\n\v\f\r]/;

/**
 * Android 运行时 getString() 得到的文字（aapt2 ResourceUtils::StringBuilder 的规则）：
 * 引号外的 ASCII 空白压成一个空格并去掉首尾；没转义的 " 是"原样保留空白"的开关，本身不输出；
 * 反斜杠转义 \n \t \' \" \\ \@ \? \# \uXXXX。引号外没转义的 '、不认识的转义、资源引用（@… / ?…）都报错。
 */
export function androidStringValue(raw: string, label: string): string {
  const text = decodeXmlText(raw, label);
  const first = text.replace(/^[ \t\n\v\f\r]+/, "")[0];
  if (first === "@" || first === "?") throw new Error(`${label}: resource references are not supported (escape a leading ${first} as \\${first})`);

  // soft = 引号外、没转义的空白（要压缩 / 去掉的那种）。
  const pieces: { char: string; soft: boolean }[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      const next = text[index + 1];
      if (next === "n") pieces.push({ char: "\n", soft: false });
      else if (next === "t") pieces.push({ char: "\t", soft: false });
      else if (next !== undefined && "'\"\\@?#".includes(next)) pieces.push({ char: next, soft: false });
      else if (next === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`${label}: bad \\u escape`);
        pieces.push({ char: String.fromCharCode(parseInt(hex, 16)), soft: false });
        index += 4;
      } else throw new Error(`${label}: unknown escape \\${next ?? ""}`);
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === "'") {
      throw new Error(`${label}: unescaped apostrophe`);
    } else {
      pieces.push({ char, soft: !quoted && ANDROID_SPACE.test(char) });
    }
  }
  if (quoted) throw new Error(`${label}: unterminated quote`);

  let value = "";
  let space = false;
  for (const piece of pieces) {
    if (piece.soft) {
      space = value.length > 0;
      continue;
    }
    if (space) value += " ";
    space = false;
    value += piece.char;
  }
  return value;
}

/**
 * 值里的占位符（%1$s / %2$d，按出现顺序）。Swift 端的 L10n.format 只认这两种和 %%：
 * 不带序号的 %s / %d 之类报错；带占位符的句子里单独的 % 也报错（Android 的 String.format 同样会失败）。
 */
export function formatSpecs(value: string, label = "value"): string[] {
  const specs: string[] = [];
  const lone: number[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "%") continue;
    if (value[index + 1] === "%") {
      index++;
      continue;
    }
    const spec = /^%\d+\$[sd]/.exec(value.slice(index, index + 16));
    if (spec) {
      specs.push(spec[0]);
      index += spec[0].length - 1;
    } else lone.push(index);
  }
  for (const index of lone) {
    const next = value[index + 1] ?? "";
    if (specs.length > 0 || /[A-Za-z0-9.,+#(-]/.test(next)) {
      throw new Error(`${label}: unsupported format specifier at "${value.slice(index, index + 6)}" (use %1$s / %1$d, or %% for a literal percent sign)`);
    }
  }
  return specs;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:[^\ud800-\udbff]|^)[\udc00-\udfff]/;

/** .strings 的双引号字符串里的写法。 */
export function escapeStringsValue(value: string, label: string): string {
  if (LONE_SURROGATE.test(value)) throw new Error(`${label}: lone surrogate`);
  let out = "";
  for (const char of value) {
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "\t") out += "\\t";
    else if (char === "\r") out += "\\r";
    else if (char < " " || char === "\x7f") throw new Error(`${label}: control character U+${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    else out += char;
  }
  return out;
}

export type IosStringEntry = { key: string; value: string; file: string };

/** 生成文件里 iOS 专有文案那一段的标题。 */
export const IOS_ONLY_SECTION = "iOS only (scripts/ios-strings.ts)";

/**
 * 只有 iOS 用的文案：Android 交给系统选择器、网页交给浏览器的地方，iOS 要自己列出来。
 * 用的是 iOS 系统自己的说法（Safari 选文件时的那几项），17 种语言都要写。键不能和 Android 的资源名重复。
 */
export const IOS_ONLY_STRINGS: Record<string, Record<Locale, string>> = {
  ios_restore_purchases: {"en":"Restore Purchases","zh":"恢复购买","zh-Hant":"恢復購買","ja":"購入を復元","ko":"구입 복원","es":"Restaurar compras","fr":"Restaurer les achats","de":"Käufe wiederherstellen","pt-BR":"Restaurar compras","it":"Ripristina acquisti","id":"Pulihkan Pembelian","vi":"Khôi phục giao dịch mua","th":"กู้คืนการซื้อ","hi":"खरीदारी बहाल करें","ar":"استعادة المشتريات","tr":"Satın Alımları Geri Yükle","ru":"Восстановить покупки"},
  ios_manage_subscriptions: {"en":"Manage App Store Subscription","zh":"管理 App Store 订阅","zh-Hant":"管理 App Store 訂閱","ja":"App Store のサブスクリプションを管理","ko":"App Store 구독 관리","es":"Gestionar suscripción de App Store","fr":"Gérer l’abonnement App Store","de":"App Store-Abonnement verwalten","pt-BR":"Gerenciar assinatura da App Store","it":"Gestisci l’abbonamento App Store","id":"Kelola Langganan App Store","vi":"Quản lý gói đăng ký App Store","th":"จัดการการสมัครสมาชิก App Store","hi":"App Store सदस्यता प्रबंधित करें","ar":"إدارة اشتراك App Store","tr":"App Store Aboneliğini Yönet","ru":"Управление подпиской App Store"},
  ios_no_purchases: {"en":"No active App Store subscription was found.","zh":"没有找到有效的 App Store 订阅。","zh-Hant":"沒有找到有效的 App Store 訂閱。","ja":"有効な App Store のサブスクリプションが見つかりませんでした。","ko":"활성 App Store 구독을 찾을 수 없습니다.","es":"No se encontró una suscripción activa de App Store.","fr":"Aucun abonnement App Store actif n’a été trouvé.","de":"Kein aktives App Store-Abonnement gefunden.","pt-BR":"Nenhuma assinatura ativa da App Store foi encontrada.","it":"Nessun abbonamento App Store attivo trovato.","id":"Tidak ditemukan langganan App Store aktif.","vi":"Không tìm thấy gói đăng ký App Store đang hoạt động.","th":"ไม่พบการสมัครสมาชิก App Store ที่ใช้งานอยู่","hi":"कोई सक्रिय App Store सदस्यता नहीं मिली।","ar":"لم يتم العثور على اشتراك نشط في App Store.","tr":"Etkin App Store aboneliği bulunamadı.","ru":"Активная подписка App Store не найдена."},
  ios_subscription_conflict: {"en":"You already have Pro. Manage the separate purchase in App Store subscriptions.","zh":"你已经有 Pro。请在 App Store 订阅中管理这笔单独的购买。","zh-Hant":"你已經有 Pro。請在 App Store 訂閱中管理這筆單獨的購買。","ja":"すでに Pro を利用中です。別途購入した分は App Store のサブスクリプションで管理できます。","ko":"이미 Pro를 이용 중입니다. 별도 구매는 App Store 구독에서 관리하세요.","es":"Ya tienes Pro. Gestiona la compra adicional en las suscripciones de App Store.","fr":"Vous avez déjà Pro. Gérez cet achat séparé dans les abonnements App Store.","de":"Du hast bereits Pro. Verwalte den getrennten Kauf in den App Store-Abonnements.","pt-BR":"Você já tem o Pro. Gerencie a compra separada nas assinaturas da App Store.","it":"Hai già Pro. Gestisci l’acquisto separato negli abbonamenti App Store.","id":"Anda sudah memiliki Pro. Kelola pembelian terpisah di langganan App Store.","vi":"Bạn đã có Pro. Quản lý giao dịch mua riêng trong phần đăng ký App Store.","th":"คุณมี Pro อยู่แล้ว จัดการการซื้อแยกในรายการสมัครสมาชิก App Store","hi":"आपके पास पहले से Pro है। अलग खरीदारी को App Store की सदस्यताओं में प्रबंधित करें।","ar":"لديك Pro بالفعل. يمكنك إدارة عملية الشراء المنفصلة في اشتراكات App Store.","tr":"Zaten Pro aboneliğin var. Ayrı satın alımı App Store aboneliklerinden yönet.","ru":"У вас уже есть Pro. Управляйте отдельной покупкой в подписках App Store."},
  ios_delete_subscription_notice: {"en":"Deleting your NoteFable account does not cancel an App Store subscription. Cancel it in the App Store to avoid renewal.","zh":"删除 NoteFable 账号不会取消 App Store 订阅。请在 App Store 取消订阅，以免续费。","zh-Hant":"刪除 NoteFable 帳號不會取消 App Store 訂閱。請在 App Store 取消訂閱，以免續費。","ja":"NoteFable のアカウントを削除しても、App Store のサブスクリプションは解約されません。更新を止めるには App Store で解約してください。","ko":"NoteFable 계정을 삭제해도 App Store 구독은 취소되지 않습니다. 갱신을 막으려면 App Store에서 취소하세요.","es":"Eliminar la cuenta de NoteFable no cancela la suscripción de App Store. Cancélala en App Store para evitar la renovación.","fr":"Supprimer votre compte NoteFable ne résilie pas un abonnement App Store. Résiliez-le dans l’App Store pour éviter le renouvellement.","de":"Das Löschen deines NoteFable-Kontos kündigt kein App Store-Abonnement. Kündige es im App Store, um eine Verlängerung zu vermeiden.","pt-BR":"Excluir a conta NoteFable não cancela uma assinatura da App Store. Cancele na App Store para evitar a renovação.","it":"Eliminare l’account NoteFable non annulla un abbonamento App Store. Annullalo nell’App Store per evitare il rinnovo.","id":"Menghapus akun NoteFable tidak membatalkan langganan App Store. Batalkan di App Store untuk mencegah perpanjangan.","vi":"Xóa tài khoản NoteFable không hủy gói đăng ký App Store. Hãy hủy trong App Store để tránh gia hạn.","th":"การลบบัญชี NoteFable ไม่ได้ยกเลิกการสมัครสมาชิก App Store ยกเลิกใน App Store เพื่อป้องกันการต่ออายุ","hi":"NoteFable खाता मिटाने से App Store सदस्यता रद्द नहीं होती। नवीनीकरण रोकने के लिए उसे App Store में रद्द करें।","ar":"حذف حساب NoteFable لا يلغي اشتراك App Store. ألغِ الاشتراك في App Store لتجنب تجديده.","tr":"NoteFable hesabını silmek App Store aboneliğini iptal etmez. Yenilenmesini önlemek için App Store'dan iptal et.","ru":"Удаление аккаунта NoteFable не отменяет подписку App Store. Чтобы избежать продления, отмените её в App Store."},
  // 点“添加文件或照片”后先选来源（ChatAttachmentPicker.swift）。
  attach_source_photos: {
    en: "Photo Library", zh: "照片图库", "zh-Hant": "照片圖庫", ja: "写真ライブラリ", ko: "사진 보관함", es: "Fototeca",
    fr: "Photothèque", de: "Fotomediathek", "pt-BR": "Fototeca", it: "Libreria foto", id: "Perpustakaan Foto",
    vi: "Thư viện ảnh", th: "คลังรูปภาพ", hi: "फ़ोटो लाइब्रेरी", ar: "مكتبة الصور", tr: "Fotoğraf Arşivi", ru: "Медиатека",
  },
  attach_source_camera: {
    en: "Take Photo", zh: "拍照", "zh-Hant": "拍照", ja: "写真を撮る", ko: "사진 찍기", es: "Hacer foto",
    fr: "Prendre une photo", de: "Foto aufnehmen", "pt-BR": "Tirar Foto", it: "Scatta foto", id: "Ambil Foto",
    vi: "Chụp ảnh", th: "ถ่ายรูป", hi: "फ़ोटो लें", ar: "التقاط صورة", tr: "Fotoğraf Çek", ru: "Снять фото",
  },
  attach_source_files: {
    en: "Choose Files", zh: "选取文件", "zh-Hant": "選擇檔案", ja: "ファイルを選択", ko: "파일 선택", es: "Seleccionar archivos",
    fr: "Choisir des fichiers", de: "Dateien auswählen", "pt-BR": "Escolher Arquivos", it: "Scegli file", id: "Pilih File",
    vi: "Chọn tệp", th: "เลือกไฟล์", hi: "फ़ाइलें चुनें", ar: "اختيار ملفات", tr: "Dosya Seç", ru: "Выбрать файлы",
  },
  // 保存生成的图片时没有“添加照片”的权限（GeneratedImages.swift）。
  photos_access_denied: {
    en: "Allow NoteFable to add to your photo library in Settings, then try again.",
    zh: "请在“设置”中允许 NoteFable 向照片图库添加照片，然后重试。",
    "zh-Hant": "請在「設定」中允許 NoteFable 將照片加入照片圖庫，然後再試一次。",
    ja: "「設定」で NoteFable に写真の追加を許可してから、もう一度お試しください。",
    ko: "설정에서 NoteFable이 사진을 추가하도록 허용한 다음 다시 시도하세요.",
    es: "Permite que NoteFable añada fotos en Ajustes y vuelve a intentarlo.",
    fr: "Autorisez NoteFable à ajouter des photos dans Réglages, puis réessayez.",
    de: "Erlaube NoteFable in den Einstellungen, Fotos hinzuzufügen, und versuche es erneut.",
    "pt-BR": "Permita que o NoteFable adicione fotos nos Ajustes e tente novamente.",
    it: "Consenti a NoteFable di aggiungere foto in Impostazioni, poi riprova.",
    id: "Izinkan NoteFable menambahkan foto di Pengaturan, lalu coba lagi.",
    vi: "Hãy cho phép NoteFable thêm ảnh trong Cài đặt, rồi thử lại.",
    th: "อนุญาตให้ NoteFable เพิ่มรูปภาพในการตั้งค่า แล้วลองอีกครั้ง",
    hi: "सेटिंग्स में NoteFable को फ़ोटो जोड़ने की अनुमति दें, फिर दोबारा कोशिश करें।",
    ar: "اسمح لـ NoteFable بإضافة الصور من الإعدادات، ثم حاول مرة أخرى.",
    tr: "Ayarlar’dan NoteFable’ın fotoğraf eklemesine izin verin, sonra yeniden deneyin.",
    ru: "Разрешите NoteFable добавлять фото в Настройках и повторите попытку.",
  },
};

function readLocaleEntries(locale: Locale): Map<string, Map<string, AndroidStringEntry>> {
  const dirName = NATIVE_LOCALE_RES_DIRS[locale];
  const dir = path.join(NATIVE_RES_DIR, dirName);
  const expected = defaultStringXmlFileNames();
  const actual = readdirSync(dir).filter((name) => name.startsWith("strings") && name.endsWith(".xml")).sort();
  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error(`${dirName}: string files differ from values/: [${actual.join(", ")}] vs [${expected.join(", ")}]`);
  }
  return new Map(expected.map((fileName) => {
    const label = `${dirName}/${fileName}`;
    const entries = parseAndroidStringsXml(readFileSync(path.join(dir, fileName), "utf8"), label);
    return [fileName, new Map(entries.map((entry) => [entry.name, entry]))];
  }));
}

function valueOf(entry: AndroidStringEntry, label: string): string {
  const value = androidStringValue(entry.raw, label);
  formatSpecs(value, label);
  // scripts/native-strings.ts（Android 13 种语言的生成）用的是它自己的 unescapeAndroidString：两边读出的文字必须一样。
  // 它不处理 \n / \t / \u / 数字实体，这几种跳过；它会把带占位符的句子里的 %% 换成 %，比较前照做。
  if (!/\\[ntu#]|&#/.test(entry.raw)) {
    const reference = unescapeAndroidString(entry.raw);
    const comparable = reference.specs.length > 0 ? value.replace(/%%/g, "%") : value;
    if (comparable !== reference.text) {
      throw new Error(`${label}: ${JSON.stringify(value)} differs from unescapeAndroidString ${JSON.stringify(reference.text)}`);
    }
  }
  return value;
}

/**
 * 一种语言的全部文案，顺序是 res/values 的文件名、文件里的出现顺序（17 种语言相同），最后是 iOS 专有的 `IOS_ONLY_STRINGS`。
 * - 键集合以 res/values 为准：某种语言少了或多了键都报错，占位符不一致也报错。
 * - `ui_locale` 必须是这种语言的网页 Locale 代码。
 * - translatable="false" 的条目（只在 res/values 里有）每种语言都写英文原值：Android 靠资源回退读到它，
 *   lproj 之间没有回退，不写的话 L("键") 会返回键本身。
 */
export function iosStringEntries(locale: Locale): IosStringEntry[] {
  const base = readLocaleEntries("en");
  const target = locale === "en" ? base : readLocaleEntries(locale);
  const dirName = NATIVE_LOCALE_RES_DIRS[locale];
  const out: IosStringEntry[] = [];
  const seen = new Set<string>();
  for (const [fileName, baseEntries] of base) {
    const targetEntries = target.get(fileName)!;
    for (const name of targetEntries.keys()) {
      if (!baseEntries.has(name)) throw new Error(`${dirName}/${fileName}:${name} is not in values/${fileName}`);
    }
    for (const [name, baseEntry] of baseEntries) {
      if (seen.has(name)) throw new Error(`values/${fileName}: ${name} is defined in two files`);
      seen.add(name);
      const baseValue = valueOf(baseEntry, `values/${fileName}:${name}`);
      const own = targetEntries.get(name);
      let value: string;
      if (name === "ui_locale") {
        if (!own) throw new Error(`${dirName}/${fileName}: missing ui_locale`);
        value = valueOf(own, `${dirName}/${fileName}:${name}`);
        if (value !== locale) throw new Error(`${dirName}/${fileName}: ui_locale is "${value}", expected "${locale}"`);
      } else if (!baseEntry.translatable) {
        if (own && locale !== "en") throw new Error(`${dirName}/${fileName}:${name} is translatable="false" in values/ but translated here`);
        value = baseValue;
      } else {
        if (!own) throw new Error(`${dirName}/${fileName}: missing ${name}`);
        value = valueOf(own, `${dirName}/${fileName}:${name}`);
        if (formatSpecs(value).sort().join(" ") !== formatSpecs(baseValue).sort().join(" ")) {
          throw new Error(`${dirName}/${fileName}:${name}: placeholders differ from values/ (${JSON.stringify(value)} vs ${JSON.stringify(baseValue)})`);
        }
      }
      if (!value) throw new Error(`${dirName}/${fileName}:${name} is empty`);
      out.push({ key: name, value, file: fileName });
    }
  }
  for (const [key, values] of Object.entries(IOS_ONLY_STRINGS)) {
    if (seen.has(key)) throw new Error(`IOS_ONLY_STRINGS: ${key} is already an Android string`);
    const value = values[locale];
    if (!value) throw new Error(`IOS_ONLY_STRINGS: ${key} has no ${locale} text`);
    if (formatSpecs(value, key).sort().join(" ") !== formatSpecs(values.en, key).sort().join(" ")) {
      throw new Error(`IOS_ONLY_STRINGS:${key}: ${locale} placeholders differ from en`);
    }
    out.push({ key, value, file: IOS_ONLY_SECTION });
  }
  return out;
}

/** 一种语言的 Localizable.strings 的内容（UTF-8、LF）。 */
export function iosStringsFile(locale: Locale): string {
  const dirName = NATIVE_LOCALE_RES_DIRS[locale];
  const lines = [
    `/* Generated by scripts/gen-ios-strings.ts from the Android string resources (mobile/android/app/src/main/res/${dirName}). Do not edit by hand. */`,
  ];
  let file = "";
  for (const entry of iosStringEntries(locale)) {
    if (entry.file !== file) {
      file = entry.file;
      lines.push("", `/* ${file} */`);
    }
    lines.push(`"${entry.key}" = "${escapeStringsValue(entry.value, `${dirName}:${entry.key}`)}";`);
  }
  lines.push("");
  return lines.join("\n");
}

/** 全部 17 种语言：Localizable.strings 的路径 → 内容。 */
export function iosStringsFiles(): Map<string, string> {
  return new Map(LOCALES.map((locale) => [iosStringsPath(locale), iosStringsFile(locale)]));
}

/** Resources 下现有的 <名字>.lproj/Localizable.strings（用来找出已经不在语言表里的旧文件）。 */
export function existingIosStringsPaths(): string[] {
  let names: string[];
  try {
    names = readdirSync(IOS_RESOURCES_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".lproj"))
    .map((name) => path.join(IOS_RESOURCES_DIR, name, IOS_STRINGS_FILE))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}
