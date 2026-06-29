import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";

/**
 * Privacy Policy — Shelfsort-specific, not generic boilerplate.
 *
 * Last updated: 2026-06-22 (initial publish).
 *
 * Every claim below is verified against the actual data flows in
 * the codebase as of this date.  Headings are stable so we can
 * link to anchors from the footer (`/privacy#third-parties`) etc.
 */
export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy — Shelfsort";
  }, []);

  return (
    <div className="min-h-screen bg-[#FBFAF6] text-[#2C2C2C]" data-testid="privacy-page">
      <header className="border-b border-[#E5DDC5] bg-white">
        <div className="max-w-3xl mx-auto px-6 md:px-8 py-5 flex items-center justify-between">
          <Link
            to="/"
            data-testid="privacy-back-home"
            className="inline-flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Shelfsort
          </Link>
          <span className="text-xs uppercase tracking-[0.18em] text-[#5B5F4D]">
            Last updated: 22 June 2026
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 md:px-8 py-12 leading-relaxed">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EEE9FB] border border-[#6B46C1]/30 text-[#6B46C1] text-[11px] font-semibold uppercase tracking-wider mb-4">
          <ShieldCheck className="w-3.5 h-3.5" />
          Plain-English version
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-3 leading-tight">
          Privacy Policy
        </h1>
        <p className="text-[#5B5F4D] mb-10">
          Shelfsort is a small project. This page is the actual policy — no
          dark-pattern footnotes, no surprise data brokers. If something on
          this page is unclear or you want a specific piece of your data
          removed, email{" "}
          <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] font-semibold underline">
            hello@shelfsort.com
          </a>{" "}
          and a human (the operator) will reply.
        </p>

        <Section id="who-we-are" title="1. Who we are">
          <p>
            Shelfsort is a personal ebook-organization service. It is operated
            by an individual (referred to throughout as &ldquo;we&rdquo; or
            &ldquo;the operator&rdquo;) and accessible at{" "}
            <a href="https://shelfsort.com" className="text-[#6B46C1] underline">shelfsort.com</a>.
            We are the &ldquo;data controller&rdquo; under the GDPR and the
            UK GDPR for the purposes of the information on this page.
          </p>
          <p>
            Contact:{" "}
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
              hello@shelfsort.com
            </a>
          </p>
        </Section>

        <Section id="what-we-collect" title="2. What we actually collect">
          <p>Three categories, that&rsquo;s it:</p>
          <ul>
            <li>
              <strong>Account data</strong> — email address, hashed password
              (bcrypt; we never see the plaintext), display name, and four
              optional onboarding answers (where you heard about us, your
              favorite fandom, what kind of reader you are, and a one-time
              13+ confirmation). If you sign in with Google, we receive your
              Google email + name + Google&rsquo;s opaque user ID, nothing
              else.
            </li>
            <li>
              <strong>Library content you upload</strong> — the EPUB / PDF /
              MOBI files themselves (stored on Cloudflare R2; see &sect;3),
              plus the metadata we extract from each file (title, author,
              series, language, page count, etc.) and the AI&rsquo;s
              categorization (fandom, tags, confidence score). If you ask
              Shelfsort to generate a cover, the AI prompt + the resulting
              image are stored against the book.
            </li>
            <li>
              <strong>Operational logs</strong> — a session cookie token
              (HTTP-only, secure flag set), the device type you select when
              filing a bug report (iPhone, Linux, etc.), email-send status
              rows so we can tell you why a welcome email bounced, and
              non-identifying call counts for the AI provider (token counts
              + cost estimates per call — no prompt content stored in the
              telemetry collection).
            </li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> collect: your IP address beyond the
            request that&rsquo;s actively being served (it&rsquo;s not
            persisted), any analytics or marketing pixel data, browser
            fingerprints, third-party advertising identifiers, or behavioral
            tracking of any kind. There are no third-party trackers on this
            site.
          </p>
        </Section>

        <Section id="why-we-collect" title="3. Why we use it">
          <ul>
            <li>
              <strong>Account data</strong> &mdash; so you can log in,
              receive password-reset emails, and so we can stop you from
              creating multiple accounts on the same email.
            </li>
            <li>
              <strong>Library content</strong> &mdash; so the AI can read
              the file&rsquo;s metadata to categorize it, so we can render
              it back to you in the reader, so we can build smart shelves,
              and so we can generate covers if you ask.
            </li>
            <li>
              <strong>Onboarding answers</strong> &mdash; only used to
              personalize the welcome email (which fandom callout to show,
              which CTA to make primary). Never sold, never shared.
            </li>
            <li>
              <strong>Email-send logs</strong> &mdash; so the operator can
              see if a transactional email bounced and retry it.
            </li>
            <li>
              <strong>AI call telemetry</strong> &mdash; so the operator can
              forecast budget runway. Never tied to your account; it&rsquo;s
              aggregate counts only.
            </li>
          </ul>
        </Section>

        <Section id="third-parties" title="4. Third parties we share with">
          <p>Five services, each with a narrow purpose:</p>
          <ul>
            <li>
              <strong>Cloudflare R2</strong> &mdash; stores your uploaded
              ebook files. Cloudflare cannot decrypt files in transit and
              does not get access to your account metadata.
            </li>
            <li>
              <strong>Resend</strong> &mdash; sends transactional emails
              (welcome, password reset, weekly summary if you opt in). Resend
              receives your email address + the message we&rsquo;re sending,
              nothing else.
            </li>
            <li>
              <strong>Emergent (Universal LLM Key)</strong> &mdash; routes
              the AI calls for fandom classification and cover generation.
              The provider on the other end is either Anthropic
              (Claude Sonnet 4.6) for text classification or Google
              (Gemini Nano-Banana) for image generation. We send them the
              metadata of the book being processed and the cover prompt;
              we do not send your email, your password, or the full text
              of any book.
            </li>
            <li>
              <strong>Google OAuth</strong> &mdash; only if you choose
              Google sign-in. Google receives the fact that you&rsquo;re
              signing in to Shelfsort; Shelfsort receives your name + email
              + Google user ID.
            </li>
            <li>
              <strong>ClamAV + Calibre</strong> &mdash; run inside our own
              infrastructure, not third-party services. ClamAV scans every
              upload for malware; Calibre converts PDF/MOBI to EPUB when
              needed. No data leaves our environment for these.
            </li>
          </ul>
          <p className="mt-3">
            We do not use Google Analytics, Meta Pixel, TikTok Pixel,
            Hotjar, Mixpanel, Segment, or any similar tool. The site has
            zero ad networks and zero tracking pixels.
          </p>
        </Section>

        <Section id="cookies" title="5. Cookies">
          <p>One cookie. One.</p>
          <ul>
            <li>
              <strong>session_token</strong> &mdash; set after you log in,
              HTTP-only, Secure flag set, SameSite=Lax. Lets the backend
              identify you on subsequent requests. Cleared when you log
              out or after 30 days of inactivity.
            </li>
          </ul>
          <p className="mt-3">
            We do not use any analytics, marketing, or tracking cookies. We
            do not show a cookie consent banner because under the e-Privacy
            Directive, banners are only required when non-essential cookies
            are set &mdash; we don&rsquo;t set any.
          </p>
        </Section>

        <Section id="your-rights" title="6. Your rights">
          <p>
            Under GDPR / UK GDPR / CCPA you can ask us to do any of the
            following. Where the action is self-serve, we&rsquo;ve made it a
            button instead of an email thread:
          </p>
          <ul>
            <li>
              <strong>Access your data</strong> &mdash;{" "}
              <Link to="/account" className="text-[#6B46C1] underline">
                Account settings
              </Link>{" "}
              shows your stored fields. Library export is on the same page.
            </li>
            <li>
              <strong>Correct your data</strong> &mdash; edit metadata
              in-place on each book&rsquo;s detail page; edit your name
              and email in Account settings.
            </li>
            <li>
              <strong>Delete your account</strong> &mdash; one button in
              Account settings (&ldquo;Delete account&rdquo;). Hard-deletes
              your books, uploaded files, library, and account row within
              30 days; cover artwork is removed from the public archive at
              the same time.
            </li>
            <li>
              <strong>Export your library</strong> &mdash; same Account
              page, &ldquo;Export everything&rdquo; button. You get a ZIP
              with your EPUBs + a JSON of all metadata.
            </li>
            <li>
              <strong>Restrict / object / portability</strong> &mdash; email{" "}
              <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
                hello@shelfsort.com
              </a>
              ; we&rsquo;ll respond within 30 days.
            </li>
            <li>
              <strong>Complain to a supervisor</strong> &mdash; you can
              also complain to your local data-protection authority (ICO in
              the UK, CNIL in France, your state AG in the US, etc.).
            </li>
          </ul>
        </Section>

        <Section id="retention" title="7. How long we keep things">
          <ul>
            <li>
              <strong>Account + library data</strong> &mdash; until you
              delete the account. We don&rsquo;t auto-prune dormant
              accounts.
            </li>
            <li>
              <strong>Email-send logs</strong> &mdash; 90 days, then
              auto-pruned by a cron job.
            </li>
            <li>
              <strong>AI call telemetry</strong> &mdash; capped at 50,000
              rows (about 5 years at current volume); oldest rows are
              trimmed when the cap is exceeded.
            </li>
            <li>
              <strong>Backups</strong> &mdash; Cloudflare R2 retains
              deleted objects for up to 7 days before final purge, per
              Cloudflare&rsquo;s own policy.
            </li>
          </ul>
        </Section>

        <Section id="security" title="8. How we protect it">
          <ul>
            <li>HTTPS everywhere (HSTS enabled on the public domain).</li>
            <li>Passwords hashed with bcrypt; we never see plaintext.</li>
            <li>
              Session cookies are HTTP-only + Secure; client-side JS cannot
              read the token.
            </li>
            <li>
              Every upload is virus-scanned by ClamAV before it&rsquo;s
              accessible to anyone, including you.
            </li>
            <li>
              Admin actions (approvals, deletions) are audit-logged with
              actor + target + timestamp.
            </li>
          </ul>
          <p className="mt-3">
            No system is perfectly secure. If you discover a vulnerability,
            please email{" "}
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
              hello@shelfsort.com
            </a>{" "}
            before disclosing it publicly &mdash; we&rsquo;ll respond and
            credit you in the changelog if you want.
          </p>
        </Section>

        <Section id="children" title="9. Children">
          <p>
            Shelfsort is for users 13 years of age or older. We ask you to
            confirm your age at sign-up; if we learn that an account belongs
            to a child under 13, we&rsquo;ll delete it.
          </p>
        </Section>

        <Section id="international" title="10. Where your data lives">
          <p>
            Servers and database are hosted in the United States.
            Cloudflare R2 stores object data in regional buckets; for new
            accounts the default region is North America. If you&rsquo;re
            in the EU/UK and need EU-hosted storage, email{" "}
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
              hello@shelfsort.com
            </a>{" "}
            and we&rsquo;ll migrate your bucket. Standard contractual
            clauses are in place with Cloudflare and Resend for any data
            transfers out of the EEA.
          </p>
        </Section>

        <Section id="changes" title="11. Changes to this policy">
          <p>
            When this page changes, we&rsquo;ll bump the &ldquo;Last
            updated&rdquo; date at the top and, for any material change,
            send a one-time notice to your account email. The full
            revision history lives in our public CHANGELOG.
          </p>
        </Section>

        <Section id="contact" title="12. Contact">
          <p className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#6B46C1]" />
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] font-semibold underline">
              hello@shelfsort.com
            </a>
          </p>
          <p className="mt-3 text-sm text-[#5B5F4D]">
            A real human reads every reply. Usually within 48 hours.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-[#E5DDC5] text-sm text-[#5B5F4D]">
          See also: <Link to="/terms" className="text-[#6B46C1] underline">Terms of Service</Link>
          {" · "}
          <Link to="/help" className="text-[#6B46C1] underline">Help &amp; FAQ</Link>
          {" · "}
          <Link to="/suggestions" className="text-[#6B46C1] underline">Suggestions</Link>
        </div>
      </main>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24" data-testid={`privacy-section-${id}`}>
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-3">{title}</h2>
      <div className="prose prose-sm max-w-none text-[#2C2C2C] [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1.5 [&_p]:mb-3">
        {children}
      </div>
    </section>
  );
}
