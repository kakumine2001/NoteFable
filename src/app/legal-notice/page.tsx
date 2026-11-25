import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_CONTACT_EMAIL, LEGAL_UPDATED_JA, LegalPage } from "@/components/legal-page";
import { PRO_PRICE_JPY, PRO_TRIAL_DAYS, STORAGE_LIMITS, USAGE_DAILY_LIMITS, USAGE_LIMITS, formatStorageSize } from "@/lib/usage-plans";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 – NoteFable",
  description: "NoteFable Pro の販売条件（特定商取引法に基づく表記）。",
};

const PRICE = `月額 ${PRO_PRICE_JPY.toLocaleString("ja-JP")} 円（税込）`;
const { pro, member } = USAGE_LIMITS;
const count = (value: number) => value.toLocaleString("ja-JP");

const DISCLOSE_ON_REQUEST = "ご請求があった場合には、遅滞なく電子メールで開示いたします。";

// 日本の特定商取引法（通信販売）で求められる表示。値段と上限は usage-plans.ts から読む。解約・返金の仕組みを変えたら、利用規約と一緒にここも直す。
// 氏名・住所・電話番号は法 11 条ただし書に基づき「請求があれば遅滞なく開示」としている。
export default function LegalNoticePage() {
  return (
    <LegalPage title="特定商取引法に基づく表記" lang="ja" updatedLabel={`最終更新日：${LEGAL_UPDATED_JA}`}>
      <dl className="divide-y divide-[var(--notion-border)] border-y border-[var(--notion-border)]">
        <Row term="販売事業者">{DISCLOSE_ON_REQUEST}</Row>
        <Row term="運営責任者">{DISCLOSE_ON_REQUEST}</Row>
        <Row term="所在地">{DISCLOSE_ON_REQUEST}</Row>
        <Row term="電話番号">{DISCLOSE_ON_REQUEST}</Row>
        <Row term="メールアドレス">
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
          <br />お問い合わせはメールでお願いします。
        </Row>
        <Row term="サービス名">NoteFable Pro（AI チャットとノートのアプリ NoteFable の有料プラン）</Row>
        <Row term="販売価格">
          {PRICE}。
          <br />Android アプリから Google Play で購入する場合は、購入画面に表示される価格（日本では{PRICE}）となります。
          <br />iOS アプリでは、購入時に App Store に表示される価格が適用されます。
        </Row>
        <Row term="商品代金以外の必要料金">インターネット接続にかかる通信料はお客様のご負担となります。</Row>
        <Row term="支払方法">
          ウェブ版（notefable.com）：クレジットカードなど、決済画面（Stripe）に表示される方法。
          <br />Android アプリ：Google Play に登録されたお支払い方法。
          <br />iOS アプリ：App Store に登録されたお支払い方法。
        </Row>
        <Row term="支払時期">
          お申し込み時に初回の 1 か月分をお支払いいただき、以降は毎月の更新日に自動で請求されます。
          <br />無料トライアルを利用する場合は、トライアル終了日に初回の 1 か月分が請求され、以降は毎月の更新日に自動で請求されます。
        </Row>
        <Row term="無料トライアル">
          初めて Pro に申し込む方は、最初の {PRO_TRIAL_DAYS} 日間を無料でご利用いただけます（1 アカウントにつき 1 回）。開始時にお支払い方法の登録が必要です。
          <br />トライアル終了日までに解約しない場合、自動的に有料（{PRICE}）へ移行し、終了日に初回の料金が請求されます。
          <br />トライアル中に解約した場合、料金は発生せず、トライアル終了日まで Pro をご利用いただけます。
          <br />Android アプリでは、Google Play の購入画面に表示される条件が適用されます。
          <br />iOS アプリで無料トライアルが提供される場合は、App Store の購入画面に表示される条件が適用されます。
        </Row>
        <Row term="提供時期">決済（無料トライアルの場合はお申し込み）の完了後、すぐにご利用いただけます。</Row>
        <Row term="契約期間・自動更新">1 か月ごとの自動更新です。解約しない限り、毎月同じ条件で更新されます。</Row>
        <Row term="解約方法">
          いつでも解約できます。
          <br />ウェブ版で購入した場合：設定 →「サブスクリプションを管理」から解約してください。
          <br />Android アプリで購入した場合：設定 →「Google Play でサブスクリプションを管理」、または Google Play ストアの「定期購入」から解約してください。
          <br />iOS アプリで購入した場合：設定の「プラン」から App Store のサブスクリプション管理を開くか、iPhone の設定からサブスクリプションを解約してください。
          <br />解約後も、支払い済みの期間の終わりまで Pro をご利用いただけます。次回以降の請求は発生しません。
        </Row>
        <Row term="返品・返金">
          デジタルサービスの性質上、お支払い後の返金（期間途中の解約による日割り返金を含む）はお受けしていません。
          ただし、重複して請求された場合など当方の誤りによるものは返金いたします。
          Google Play と App Store での購入は、各ストアの返金ポリシーに従います。
          <br />アカウントを削除すると、ウェブ版で購入したサブスクリプションはその時点で終了し、Google Play のサブスクリプションは次回以降の更新が停止されます。App Store で購入した場合は、別途 App Store で解約してください。
        </Row>
        <Row term="Pro の内容">
          AI メッセージを 1 請求期間あたり {count(pro.chat)} 件、画像生成を {count(pro.image)} 枚（1 日 {count(USAGE_DAILY_LIMITS.pro.image ?? 0)} 枚）まで利用できます。無料プラン（ログイン時）では AI メッセージが 1 日 {count(member.chat)} 件、画像が 1 か月 {count(member.image)} 枚（1 日 {count(USAGE_DAILY_LIMITS.member.image ?? 0)} 枚）までです。ファイルの保存容量は、Pro が {formatStorageSize(STORAGE_LIMITS.pro)}、無料プラン（ログイン時）が {formatStorageSize(STORAGE_LIMITS.member)}、ログインなしが {formatStorageSize(STORAGE_LIMITS.guest)} までです。
          上限や利用できる AI モデルは、サービスの運営上の理由で変更することがあります。
        </Row>
        <Row term="動作環境">
          最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）。Android アプリは Android 8.0 以上。
        </Row>
      </dl>
      <p className="text-sm text-[var(--notion-muted)] [&_a]:text-[var(--notion-blue)] [&_a]:underline">
        ご利用条件は<Link href="/terms">利用規約（英語）</Link>、個人情報の取り扱いは<Link href="/privacy">プライバシーポリシー（英語）</Link>をご覧ください。
      </p>
    </LegalPage>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6 [&_a]:text-[var(--notion-blue)] [&_a]:underline">
      <dt className="font-semibold">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
