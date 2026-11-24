import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy – NoteFable",
  description: "How NoteFable handles your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="1. About NoteFable">
        <p>
          NoteFable is a personal AI study assistant with chat and a Workspace for your notes, available at
          {" "}<a href="https://notefable.com">notefable.com</a>. It is run by an individual developer.
          This policy explains what data NoteFable handles and why. Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect">
        <ul>
          <li>
            <strong>A device identifier.</strong> When you use the app, we create a random identifier and store it in a signed,
            HTTP-only cookie named <code>notefable_device</code> (valid for one year). Your chats and Workspace content are saved under this identifier.
            If you clear your cookies, you lose access to that data in that browser unless you signed in with Google.
            When you sign in with Google, the sign-in also sets an HTTP-only session cookie (about 30 days) that holds your Google account ID, email,
            name and profile-picture link, plus a few short-lived cookies used only to complete the sign-in. The Android app uses one more HTTP-only
            cookie, valid for 5 minutes, while it signs you in.
            The web app (app.notefable.com) also sets a cookie named <code>notefable_app</code> for notefable.com and its subdomains
            (valid for about 13 months). It only records that this browser has used the web app, so notefable.com can take you straight back to it;
            it contains no identifier.
          </li>
          <li>
            <strong>Google sign-in (optional).</strong> If you choose “Sign in with Google”, Google gives us your Google account ID,
            email address, name and profile picture (the basic <code>openid</code>, <code>email</code> and <code>profile</code> scopes). We store them with your
            account so your chats and Workspace content follow you to other devices, and to show your name in the sidebar. If you choose your own display name, emoji icon or
            profile photo, we store those too and show them instead.
            We do not request access to your Gmail, Drive, Calendar, contacts or any other Google data.
          </li>
          <li>
            <strong>Email sign-in (optional).</strong> If you sign in with an email code, we store your email address with your account and send the
            six-digit code to it. We keep only a hash of the code, delete it once it is used or expires, and keep a hash of the requesting network address
            for a short time to limit abuse.
          </li>
          <li>
            <strong>Purchases (Pro).</strong> When you start a Pro purchase on the website, we create a customer record at Stripe and store its ID, even if you
            do not finish paying. If you subscribe, we also store the subscription’s status, plan, renewal and end dates, and the payment provider’s
            identifiers for it: the Stripe customer and subscription IDs for a website purchase, or the Google Play purchase token for an Android purchase. Payments are handled by Stripe or Google Play; we never see or store your card number or other payment details. To match a Google Play
            purchase to your account, the app passes your internal account ID to Google Play when you buy.
          </li>
          <li>
            <strong>Reports.</strong> If you report AI content, the reason you give, the reported content and your internal account ID are emailed to us so
            we can review it: for an answer, the answer and the message before it; for a proposed page change, the page title and the text before and after
            the change; for a page the AI wrote, its title, its current text and the AI changes applied to it; for an AI-made slide image, the description it
            was made from and where it is stored. We keep the email only as long as we need it for the review.
          </li>
          <li>
            <strong>The Android app.</strong> The app stores the same cookies on your phone and sends the same data as the website. It reads only the photos
            and files you pick, and photos you take with your camera app; it does not read your contacts, location or advertising ID, and it contains no ads
            or third-party analytics. Images you save go to your photo gallery.
          </li>
          <li>
            <strong>Content you create.</strong> The messages you send, the AI’s replies (with the short reasoning summary and web-search steps shown
            alongside them), files and images you attach or generate, your Workspace content (notes, covers, images, files and groups), and any instructions you write for the AI (custom instructions in Settings and
            project instructions), which are sent to the AI provider along with your messages.
            Attached documents such as PDFs and text files are kept as extracted text; images are kept as files. If you upload a profile photo, we keep
            the cropped photo (about 512×512) in file storage and delete the old file when you replace or remove it.
          </li>
          <li>
            <strong>AI continuation data.</strong> For chats with OpenAI and Anthropic models we also store the provider’s compressed copy of the conversation
            (it can include encrypted reasoning) and send it back to the same provider on later turns so long chats keep working. It is not shown in the app.
          </li>
          <li>
            <strong>Usage and performance data.</strong> We use Vercel Web Analytics and Speed Insights to count page views and measure loading speed.
            This data is aggregated and does not use cookies.
          </li>
          <li>
            <strong>Browser storage.</strong> Your browser keeps a few interface preferences (for example which note groups are collapsed) and
            unsaved local drafts of notes so they can be restored.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How we use it">
        <p>
          To run the service: show your chats and Workspace content, generate AI replies, sign you in, keep your data available across devices, and provide and bill the
          Pro plan.
          We also use it to keep the service working and to fix problems. We do not sell your data, use it for advertising, or build advertising profiles.
        </p>
      </LegalSection>

      <LegalSection title="4. Who we share it with">
        <p>We share data only with the service providers needed to run NoteFable:</p>
        <ul>
          <li>
            <strong>AI model providers.</strong> To answer you, the text of your message, earlier messages in that chat, and any attached images or extracted file
            text are sent to the provider of the model you select —
            {" "}<a href="https://openai.com/policies/privacy-policy">OpenAI</a>,{" "}
            <a href="https://www.anthropic.com/legal/privacy">Anthropic</a> or{" "}
            <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html">DeepSeek</a> (DeepSeek is operated from China).
            When the assistant looks at your notes, the note text it reads goes to that same provider; if the reply uses web search, that search also runs at
            that provider. Image generation and image editing always go to OpenAI, whichever chat model is selected.
            To power meaning-based note search, note titles, note text and note search queries are also sent to OpenAI to create search vectors (stored in our database and deleted when you delete the note or your account), whichever chat model is selected.
            For OpenAI chats we also send an internal account ID so OpenAI can apply its safety checks. Each provider handles the data under its own policy.
          </li>
          <li>
            <strong>Hosting and storage.</strong> <a href="https://vercel.com/legal/privacy-policy">Vercel</a> hosts the app, stores uploaded files (Vercel Blob)
            and provides analytics; <a href="https://neon.tech/privacy-policy">Neon</a> hosts the PostgreSQL database. The app and the database run in the United States (US East).
          </li>
          <li>
            <strong>Google</strong>, only for signing in, if you choose to.
          </li>
          <li>
            <strong>Payment providers</strong>, if you buy Pro: <a href="https://stripe.com/privacy">Stripe</a> for website purchases (when you start a purchase we
            send your email address and internal account ID, and we receive the subscription status; you enter your payment and billing details directly with Stripe) and Google Play for Android
            purchases (under <a href="https://policies.google.com/privacy">Google’s Privacy Policy</a>). They keep their own payment records as the law requires.
          </li>
          <li>
            <a href="https://resend.com/legal/privacy-policy">Resend</a>, which delivers the sign-in code email (your email address and the code), if you sign in
            with email, and the report emails described under Reports, if you report AI content.
          </li>
          <li>
            Authorities, if we are legally required to disclose data.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Google user data">
        <p>
          NoteFable’s use and transfer to any other app of information received from Google APIs will adhere to the
          {" "}<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
          We use the Google profile information only to sign you in and to link your account. It is stored in our database and in the sign-in cookie.
          We do not send it to the AI providers, use it for advertising, or transfer it to anyone else except the hosting and storage providers listed above as needed to run the service,
          and Stripe, which receives your email address only when you start a Pro purchase on the website so it can bill you and send receipts.
        </p>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>
          We keep your data until you delete it. You can delete a chat or a note in NoteFable. That removes it from your account in our database, including the
          messages and note edit proposals tied to that chat. Copies of uploaded images, generated images, note files and cover images can remain in file storage
          until we remove them. Signing out does not delete anything.
        </p>
        <p>
          <strong>Deleting your account.</strong> When signed in, open <em>Settings → Account → Delete account</em> on the website or in the Android app. This immediately and
          permanently deletes your account and everything in it: chats, messages, notes, note history, projects, uploaded and generated images, files, your profile
          and settings. It also ends a Pro subscription bought on the website immediately, deletes your customer record at Stripe, and stops a Google Play subscription from renewing; Stripe and Google keep their payment records (such as invoices and charges) as the law requires. Database backups that may still contain it are overwritten within 30 days. To keep other signed-in devices from re-creating the account, we keep a one-way hash of its Google account ID and email address (not the ID or address itself) for 400 days. If you cannot sign in, email
          {" "}<a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> from the account’s address and we will delete it within 30 days.
          Data you used without signing in is tied only to your browser or app: delete its chats and notes in NoteFable, or clear the app’s data. See
          {" "}<Link href="/delete-account">notefable.com/delete-account</Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Data is sent over HTTPS, the device cookie is signed, and each private chat and note can be read only through the browser or signed-in account that created it.
          If you explicitly publish a note to the web, anyone with its share link can read that note (and its sub-pages, when included) until you unpublish it, it expires, or you delete it.
          No online service is perfectly secure, and anyone who can use your browser can use your anonymous data, so avoid using NoteFable without signing in on shared devices.
        </p>
      </LegalSection>

      <LegalSection title="8. Children">
        <p>NoteFable is not directed to children under 13, and we do not knowingly collect their data.</p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>We may update this policy. The date at the top shows the latest version.</p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p><a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></p>
      </LegalSection>
    </LegalPage>
  );
}
