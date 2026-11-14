import type { Metadata } from "next";
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
          NoteFable is a personal AI study assistant with chat and Notes, available at
          {" "}<a href="https://notefable.com">notefable.com</a>. It is run by an individual developer.
          This policy explains what data NoteFable handles and why. Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect">
        <ul>
          <li>
            <strong>A device identifier.</strong> When you use the workspace, we create a random identifier and store it in a signed,
            HTTP-only cookie named <code>notefable_device</code> (valid for one year). Your chats and Notes are saved under this identifier.
            If you clear your cookies, you lose access to that data in that browser unless you signed in with Google.
            When you sign in with Google, the sign-in also sets an HTTP-only session cookie (about 30 days) that holds your Google account ID, email,
            name and profile-picture link, plus a few short-lived cookies used only to complete the sign-in. The Android app uses one more HTTP-only
            cookie, valid for 5 minutes, while it signs you in.
          </li>
          <li>
            <strong>Google sign-in (optional).</strong> If you choose “Sign in with Google”, Google gives us your Google account ID,
            email address, name and profile picture (the basic <code>openid</code>, <code>email</code> and <code>profile</code> scopes). We store them with your
            account so your chats and Notes follow you to other devices, and to show your name in the sidebar. If you choose your own display name, emoji icon or
            profile photo, we store those too and show them instead.
            We do not request access to your Gmail, Drive, Calendar, contacts or any other Google data.
          </li>
          <li>
            <strong>Content you create.</strong> The messages you send, the AI’s replies (with the short reasoning summary and web-search steps shown
            alongside them), files and images you attach or generate, your Notes (pages, covers, images, files and groups), and any instructions you write for the AI (custom instructions in Settings and
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
          To run the service: show your chats and Notes, generate AI replies, sign you in, and keep your data available across devices.
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
            When the assistant looks at your notes, the note text it reads goes to that same provider. If you use web search, the search runs at OpenAI or Anthropic
            (DeepSeek does not search the web). Image generation and image editing always go to OpenAI, whichever chat model is selected.
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
            Authorities, if we are legally required to disclose data.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Google user data">
        <p>
          NoteFable’s use and transfer to any other app of information received from Google APIs will adhere to the
          {" "}<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
          We use the Google profile information only to sign you in and to link your account. It is stored in our database and in the sign-in cookie.
          We do not send it to the AI providers, use it for advertising, or transfer it to anyone else except the hosting and storage providers listed above as needed to run the service.
        </p>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>
          We keep your data until you delete it. You can delete a chat or a note in NoteFable. That removes it from your account in our database, including the
          messages and note edit proposals tied to that chat. Copies of uploaded images, generated images, note files and cover images can remain in file storage
          until we remove them. There is no delete-account button, and signing out does not delete anything. To delete your account, email
          {" "}<a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and within 30 days we will delete your account record, its database rows and the stored files we can still link to you.
        </p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Data is sent over HTTPS, the device cookie is signed, and each chat and note can be read only through the browser or Google account that created it.
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
