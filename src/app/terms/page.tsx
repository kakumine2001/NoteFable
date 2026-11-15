import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal-page";

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
          {" "}and its Android app. By using NoteFable you agree to them and to the <Link href="/privacy">Privacy Policy</Link>. If you do not agree, please do not use it.
        </p>
      </LegalSection>

      <LegalSection title="2. The service">
        <p>
          NoteFable is an AI study assistant: you can chat with AI models, keep Notes, attach files and generate images. It is a free personal project provided
          “as is”. Features, models and limits can change, and the service can be interrupted or stopped at any time without notice.
          Keep your own copy of anything important.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account and content">
        <p>
          You can use NoteFable without signing in (your data is tied to your browser or app) or sign in with Google or an email code. You are responsible for what happens under your browser or account.
          You keep ownership of the content you create. You allow us to store and process it only as needed to run the service, including sending it to the AI providers
          described in the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p>Do not use NoteFable to:</p>
        <ul>
          <li>break the law or infringe anyone’s rights, or upload content you have no right to use;</li>
          <li>create or share malware, or content that harms or harasses others;</li>
          <li>attack, probe or overload the service, bypass its limits, or use it for automated bulk requests;</li>
          <li>submit other people’s sensitive personal data without their permission.</li>
        </ul>
        <p>We may limit or suspend access if the service is misused.</p>
      </LegalSection>

      <LegalSection title="5. AI output">
        <p>
          AI replies can be wrong, incomplete or out of date, and web search results may be inaccurate. They are not professional (medical, legal, financial or other) advice.
          Check anything important before relying on it. You are responsible for how you use the output.
        </p>
      </LegalSection>

      <LegalSection title="6. Third-party services">
        <p>
          NoteFable relies on third parties — OpenAI, Anthropic, DeepSeek, Google, Resend, Vercel and Neon. Their own terms apply to their services, and their outages or changes can affect NoteFable.
        </p>
      </LegalSection>

      <LegalSection title="7. Disclaimer and liability">
        <p>
          To the extent permitted by law, NoteFable is provided without warranties of any kind, and we are not liable for indirect or incidental damages,
          lost data, or lost profits arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection title="8. Ending use">
        <p>
          You can stop using NoteFable at any time and delete your account in Settings, or ask us to delete your data (see the Privacy Policy). We may end or change the service or your access at any time.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes and governing law">
        <p>
          We may update these terms; continued use after an update means you accept it. These terms are governed by the laws of Japan.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p><a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></p>
      </LegalSection>
    </LegalPage>
  );
}
