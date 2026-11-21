import type { Metadata } from "next";
import Link from "next/link";
import { appHref, splitHosts } from "@/lib/hosts";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Delete your account – NoteFable",
  description: "How to delete your NoteFable account and data.",
};

// ワークスペースの公開 URL（紹介サイトと別ホストなら app.notefable.com）。
const WORKSPACE_URL = splitHosts() ? appHref() : "https://notefable.com/app";

// Google Play の「アカウント削除の URL」。アプリを入れていない人でも、削除の方法と消えるデータが分かるようにする。
export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete your NoteFable account">
      <LegalSection title="Delete it yourself">
        <ol className="list-decimal space-y-1.5 pl-6">
          <li>Open NoteFable — the Android app or <a href={WORKSPACE_URL}>{WORKSPACE_URL.replace(/^https:\/\//, "").replace(/\/$/, "")}</a> — and sign in to the account.</li>
          <li>Tap your name at the bottom of the sidebar to open <strong>Settings</strong>, then <strong>Account</strong>.</li>
          <li>Tap <strong>Delete account</strong>, read the warning, then <strong>Delete permanently</strong>.</li>
        </ol>
        <p>The account is deleted right away and you are signed out on every device.</p>
      </LegalSection>

      <LegalSection title="What is deleted">
        <ul>
          <li>Your account: Google account ID or email address, name, profile photo, display name and icon, language and custom instructions.</li>
          <li>All chats and messages, attached files and their extracted text, and generated images.</li>
          <li>All notes, note history, groups, covers, note files and images, chat projects and note edit proposals.</li>
          <li>Your daily usage counters and any pending email sign-in codes.</li>
          <li>
            Your Pro subscription: one bought on the website ends immediately and your customer record at Stripe is deleted; a Google Play subscription stops
            renewing. The period already paid is not refunded. Stripe and Google keep their payment records (such as invoices and charges) as the law requires.
          </li>
        </ul>
        <p>
          Copies in database backups are overwritten within 30 days. We keep only a one-way hash of the Google account ID and email address for 400 days, so that
          devices that were still signed in cannot re-create the account; you can sign up again at any time. Images from chats you had already deleted are no longer
          linked to your account and are not shown anywhere. Aggregated, cookie-free page-view statistics contain no personal data and are not affected.
        </p>
      </LegalSection>

      <LegalSection title="Can’t sign in?">
        <p>
          Email <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=Delete%20my%20NoteFable%20account`}>{LEGAL_CONTACT_EMAIL}</a> from the address of the account
          (or the Gmail address of the Google account) and we will delete it within 30 days.
        </p>
      </LegalSection>

      <LegalSection title="Used NoteFable without signing in?">
        <p>
          That data is tied only to your browser or to the app on your phone, not to an account. Delete its chats and notes in NoteFable, or clear the app’s storage
          (Android: Settings → Apps → NoteFable → Storage → Clear storage). See the <Link href="/privacy">Privacy Policy</Link> for details.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
