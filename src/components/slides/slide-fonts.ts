import { DM_Sans, Fraunces, Inter, JetBrains_Mono, Montserrat, Noto_Sans, Noto_Serif, Nunito, Open_Sans, Playfair_Display, Source_Serif_4, Space_Grotesk, Work_Sans } from "next/font/google";

// スライドの主題の書体（Google Fonts、SIL OFL）。next/font がビルド時に取り込んで自前で配る（外部へ読み込みに行かない）。
// preload しないので、ブラウザは実際に使った書体だけを読み込む。CSS 変数は src/lib/slides/themes.ts の SLIDE_FONTS が参照する。
// next/font の設定は字面どおりの値でしか書けない（展開や変数は使えない）。
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-inter" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-playfair" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-source-serif" });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-montserrat" });
const openSans = Open_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-open-sans" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--slide-font-space-grotesk" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-dm-sans" });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-fraunces" });
const workSans = Work_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-work-sans" });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-nunito" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-jetbrains-mono" });
const notoSerif = Noto_Serif({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-noto-serif" });
const notoSans = Noto_Sans({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"], variable: "--slide-font-noto-sans" });

// スライドを描く要素の祖先に付けるクラス（CSS 変数を定義する）。
export const SLIDE_FONT_CLASSES = [inter, playfair, sourceSerif, montserrat, openSans, spaceGrotesk, dmSans, fraunces, workSans, nunito, jetbrainsMono, notoSerif, notoSans]
  .map((font) => font.variable).join(" ");
