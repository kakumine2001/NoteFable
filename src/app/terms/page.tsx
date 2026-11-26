import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal-page";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";
import { MAX_STORED_FILE_BYTES, PRO_PRICE_JPY, PRO_TRIAL_DAYS, STORAGE_LIMITS, USAGE_DAILY_LIMITS, USAGE_LIMITS, formatStorageSize } from "@/lib/usage-plans";

export const metadata: Metadata = {
  title: "Terms of Service – NoteFable",
  description: "The terms for using NoteFable.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <LegalSection title="1. Agreement">
        <p>
          These terms apply to your use of NoteFable at <a href="https://notefable.com">notefable.com</a>
          {" "}and in its Android and iOS apps. By using NoteFable you agree to them and to the <Link href="/privacy">Privacy Policy</Link>. If you do not agree, please do not use it.
        </p>
      </LegalSection>

      <LegalSection title="2. The service">
        <p>
          NoteFable is an AI study assistant: you can chat with AI models, keep notes, slide decks and whiteboards in your Workspace, attach files and generate images. It is a personal project provided
          “as is”. It is free to use within daily and monthly limits and a storage limit for your files; a paid Pro plan raises those limits (section 3). Features, models and limits can change,
          and the service can be interrupted or stopped at any time without notice. Keep your own copy of anything important.
        </p>
      </LegalSection>

      <LegalSection title="3. Pro subscription">
        <ul>
          <li>
            <strong>What you get.</strong> Pro raises your limits to {USAGE_LIMITS.pro.chat.toLocaleString("en-US")} AI messages and {USAGE_LIMITS.pro.image} generated images per billing period (up to {USAGE_DAILY_LIMITS.pro.image} images a day), and your file storage to {formatStorageSize(STORAGE_LIMITS.pro)} (section 4). Limits and the available
            AI models can change for operational reasons. Pro requires signing in.
          </li>
          <li>
            <strong>Price and billing.</strong> On the website, Pro costs ¥{PRO_PRICE_JPY.toLocaleString("en-US")} per month (tax included) and you pay through Stripe. In the Android and iOS apps, you pay through Google Play or the App Store at the price shown before you buy. You are charged when you subscribe and then automatically every month on the renewal date
            until you cancel.
          </li>
          <li>
            <strong>Free trial.</strong> The first time you subscribe, Pro is free for {PRO_TRIAL_DAYS} days. You add a payment method to start the trial. Unless
            you cancel before the trial ends, your first monthly payment is charged on the day it ends and the subscription then renews every month. If you
            cancel during the trial you are not charged, and Pro stays active until the trial ends. The trial is offered once per account; in the Android app
            it follows Google Play’s eligibility rules. On iOS, any trial is shown by the App Store before you buy.
          </li>
          <li>
            <strong>Cancelling.</strong> You can cancel at any time: on the website in <em>Settings → Plan → Manage subscription</em>; for a Google Play purchase in
            {" "}<em>Settings → Plan → Manage subscription on Google Play</em> or in the Google Play Store’s Subscriptions. For an iOS purchase, use <em>Settings → Plan → Manage App Store Subscription</em> or the App Store’s Subscriptions. Pro stays active until the end of the period you
            have paid for, and you are not charged again.
          </li>
          <li>
            <strong>Refunds.</strong> Payments are not refunded, including for the unused part of a billing period, except where the law requires it or we charged
            you by mistake (for example, twice). Google Play and App Store purchases follow their respective store’s refund policies.
          </li>
          <li>
            <strong>Payment problems.</strong> If a renewal payment fails, Pro can continue for a short grace period while the payment is retried; if it still
            fails, your account returns to the free plan.
          </li>
          <li>
            <strong>Price changes.</strong> We will tell you before a price change takes effect, and you can cancel before it applies to you.
          </li>
        </ul>
        <p>
          Japanese commercial disclosures (特定商取引法に基づく表記): <Link href="/legal-notice">notefable.com/legal-notice</Link>.
        </p>
      </LegalSection>

      <LegalSection title="4. Your account and content">
        <p>
          You can use NoteFable without signing in (your data is tied to your browser or app) or sign in with Google, an email code, or Apple on iOS. You are responsible for what happens under your browser or account.
          You keep ownership of the content you create. You allow us to store and process it only as needed to run the service, including sending it to the AI providers
          described in the Privacy Policy.
        </p>
        <p>
          Files you upload or generate (images in chats, generated images, and files, covers and icons in your Workspace) count toward a storage limit:
          {" "}{formatStorageSize(STORAGE_LIMITS.guest)} without signing in, {formatStorageSize(STORAGE_LIMITS.member)} when signed in and {formatStorageSize(STORAGE_LIMITS.pro)} with Pro.
          Each file can be up to {formatStorageSize(MAX_STORED_FILE_BYTES)} ({formatStorageSize(MAX_UPLOAD_FILE_BYTES)} for chat attachments). When the limit is reached, new uploads are refused until you delete files; the files you
          already have stay. Files you delete are removed from storage about a week after nothing uses them any more; files that a note in Trash or a note’s
          version history still uses are kept until those are gone.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>Do not use NoteFable to:</p>
        <ul>
          <li>break the law or infringe anyone’s rights, or upload content you have no right to use;</li>
          <li>create or share malware, or content that harms or harasses others;</li>
          <li>attack, probe or overload the service, bypass its limits, or use it for automated bulk requests;</li>
          <li>submit other people’s sensitive personal data without their permission.</li>
        </ul>
        <p>We may limit or suspend access if the service is misused.</p>
      </LegalSection>

      <LegalSection title="6. AI output">
        <p>
          AI replies can be wrong, incomplete or out of date, and web search results may be inaccurate. They are not professional (medical, legal, financial or other) advice.
          Check anything important before relying on it. You are responsible for how you use the output.
        </p>
      </LegalSection>

      <LegalSection title="7. Third-party services">
        <p>
          NoteFable relies on third parties — OpenAI, Anthropic, DeepSeek, Google (including Google Play), Apple, Stripe, Resend, Vercel and Neon. Their own terms apply to their services, and their outages or changes can affect NoteFable.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimer and liability">
        <p>
          To the extent permitted by law, NoteFable is provided without warranties of any kind, and we are not liable for indirect or incidental damages,
          lost data, or lost profits arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection title="9. Ending use">
        <p>
          You can stop using NoteFable at any time and delete your account in Settings, or ask us to delete your data (see the Privacy Policy). Deleting your
          account ends a subscription bought on the website immediately and stops a Google Play subscription from renewing. To prevent an App Store subscription from renewing, cancel it separately through the App Store. Deletion does not refund the current period.
          We may end or change the service or your access at any time. If we stop the paid service, we will stop charging you, and Pro stays active until the end
          of the period you have paid for or we refund the unused part.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes and governing law">
        <p>
          We may update these terms; continued use after an update means you accept it. These terms are governed by the laws of Japan.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p><a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></p>
      </LegalSection>
    </LegalPage>
  );
}
