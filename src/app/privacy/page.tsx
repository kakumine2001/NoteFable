import type { Metadata } from "next";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy – StudyMate",
  description: "How StudyMate handles your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="1. About StudyMate">
        <p>
          StudyMate is a personal AI study assistant with chat and Notes, available at
          {" "}<a href="https://studymate-lab-ai.vercel.app">studymate-lab-ai.vercel.app</a>. It is run by an individual developer.
          This policy explains what data StudyMate handles and why. Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect">
        <ul>
          <li>
            <strong>A device identifier.</strong> When you open StudyMate, we create a random identifier and store it in a signed,
            HTTP-only cookie named <code>studymate_device</code> (valid for one year). Your chats and Notes are saved under this identifier.
            If you clear your cookies, you lose access to that data in that browser unless you signed in with Google.
          </li>
          <li>
            <strong>Google sign-in (optional).</strong> If you choose “Sign in with Google”, Google gives us your Google account ID,
            email address, name and profile picture (the basic <code>openid</code>, <code>email</code> and <code>profile</code> scopes). We store them with your
            account so your chats and Notes follow you to other devices, and to show your name in the sidebar.
            We do not request access to your Gmail, Drive, Calendar, contacts or any other Google data.
          </li>
          <li>
            <strong>Content you create.</strong> The messages you send, the AI’s replies (with the short reasoning summary and web-search steps shown
            alongside them), files and images you attach or generate, and your Notes (pages, covers, images, files and groups).
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
        <p>We share data only with the service providers needed to run StudyMate:</p>
        <ul>
          <li>
            <strong>AI model providers.</strong> To answer you, the text of your message and conversation, any files or images you attach, and (when you ask the
            assistant to look at your notes) the relevant note content are sent to the provider of the model you select —
            {" "}<a href="https://openai.com/policies/privacy-policy">OpenAI</a>,{" "}
            <a href="https://www.anthropic.com/legal/privacy">Anthropic</a> or{" "}
            <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html">DeepSeek</a> (DeepSeek is operated from China).
            Web search and image generation are also performed through these providers. Each provider handles the data under its own policy.
          </li>
          <li>
            <strong>Hosting and storage.</strong> <a href="https://vercel.com/legal/privacy-policy">Vercel</a> hosts the app, stores uploaded files (Vercel Blob)
            and provides analytics; <a href="https://neon.tech/privacy-policy">Neon</a> hosts the PostgreSQL database. Data is stored in the United States.
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
          StudyMate’s use and transfer to any other app of information received from Google APIs will adhere to the
          {" "}<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
          The Google profile information we receive is used only to sign you in and to link your account, never for advertising, and it is not
          transferred to anyone except the providers listed above as needed to run the service.
        </p>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>
          We keep your data until you delete it. You can delete any chat or note inside StudyMate. To delete your account and everything associated with it
          (including the Google profile details we stored), email <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and we will do so within 30 days.
        </p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Data is sent over HTTPS, the device cookie is signed, and each chat and note can be read only through the browser or Google account that created it.
          No online service is perfectly secure, and anyone who can use your browser can use your anonymous data, so avoid using StudyMate without signing in on shared devices.
        </p>
      </LegalSection>

      <LegalSection title="8. Children">
        <p>StudyMate is not directed to children under 13, and we do not knowingly collect their data.</p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>We may update this policy. The date at the top shows the latest version; significant changes will be noted in the app.</p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p><a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></p>
      </LegalSection>
    </LegalPage>
  );
}
