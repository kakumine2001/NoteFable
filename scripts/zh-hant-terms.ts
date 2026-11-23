// 简体中文 → 台湾繁体中文的转换，以及产品用语的覆盖表。
// 网页的 zh-hant.ts（scripts/generate-zh-hant.ts）和原生 Android 的 values-b+zh+Hant（scripts/native-zh-hant.ts，iOS 再由它生成）都用这里的 toTraditional。
// OpenCC（cn → twp）按台湾用字和常用词转换，但有些词转出来不是台湾的说法（「幻灯片」会变成「幻燈片」，台湾说「投影片」）。
// 这些词在下面的表里固定：转换前先用私用区的记号换掉，转换后再换成台湾用语（OpenCC 不动私用区字符）。改了表要重新运行两个生成脚本。
import * as OpenCC from "opencc-js";

export const ZH_HANT_TERMS: readonly (readonly [simplified: string, traditional: string])[] = [
  ["幻灯片", "投影片"],
  // 白板（#152）用的词。
  ["思维导图", "心智圖"],
  ["便签", "便利貼"],
  // OpenCC 把「类型」转成程序用语「型別」；界面上的「檔案類型」「頁面類型」用「類型」（#168 的类型筛选）。
  ["类型", "類型"],
];

const convert = OpenCC.Converter({ from: "cn", to: "twp" });
const marker = (index: number) => `${index}`;

export function toTraditional(text: string): string {
  let marked = text;
  ZH_HANT_TERMS.forEach(([simplified], index) => { marked = marked.split(simplified).join(marker(index)); });
  let converted = convert(marked);
  ZH_HANT_TERMS.forEach(([, traditional], index) => { converted = converted.split(marker(index)).join(traditional); });
  return converted;
}
