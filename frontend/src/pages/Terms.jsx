import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Scale } from "lucide-react";

/**
 * Terms of Service — Shelfsort-specific. Written to be readable
 * end-to-end without a lawyer translating; pairs with the
 * Privacy Policy at /privacy.
 *
 * Last updated: 2026-06-22.
 *
 * The "Acceptable Use" section is the one new users actually
 * read; everything else is the standard legal scaffolding kept
 * intentionally short.
 */
export default function Terms() {
  useEffect(() => {
    document.title = "Terms of Service — Shelfsort";
  }, []);

  return (
    <div className="min-h-screen bg-[#FBFAF6] text-[#2C2C2C]" data-testid="terms-page">
      <header className="border-b border-[#E5DDC5] bg-white">
        <div className="max-w-3xl mx-auto px-6 md:px-8 py-5 flex items-center justify-between">
          <Link
            to="/"
            data-testid="terms-back-home"
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
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FBF6E9] border border-[#B87A00]/30 text-[#B87A00] text-[11px] font-semibold uppercase tracking-wider mb-4">
          <Scale className="w-3.5 h-3.5" />
          Plain-English version
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-3 leading-tight">
          Terms of Service
        </h1>
        <p className="text-[#5B5F4D] mb-10">
          These terms govern your use of Shelfsort
          (<a href="https://shelfsort.com" className="text-[#6B46C1] underline">shelfsort.com</a>).
          They&rsquo;re intentionally short. The most important section is
          &sect;3 (Acceptable Use). If anything below is unclear, email{" "}
          <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] font-semibold underline">
            hello@shelfsort.com
          </a>.
        </p>

        <Section id="agreement" title="1. Acceptance">
          <p>
            By creating an account or using Shelfsort, you agree to these
            Terms and to our{" "}
            <Link to="/privacy" className="text-[#6B46C1] underline">Privacy Policy</Link>.
            If you don&rsquo;t agree, please don&rsquo;t use the service.
          </p>
        </Section>

        <Section id="who-can-use" title="2. Who can use Shelfsort">
          <ul>
            <li>You must be at least 13 years old.</li>
            <li>You must provide an accurate email address that you control.</li>
            <li>One account per person, please.</li>
            <li>
              You&rsquo;re responsible for keeping your password safe; if
              you suspect your account has been accessed by someone else,
              reset your password and email{" "}
              <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
                hello@shelfsort.com
              </a>.
            </li>
          </ul>
        </Section>

        <Section id="acceptable-use" title="3. Acceptable use">
          <p>
            Shelfsort is for organizing your own personal ebook library
            and sharing reading lists with friends. We trust you to act in
            good faith. Specifically:
          </p>

          <p className="mt-4"><strong>You may:</strong></p>
          <ul>
            <li>
              Upload EPUB / PDF / MOBI files of books you legally own,
              fanfiction you wrote or downloaded for personal reading
              (e.g. AO3 downloads), and your own original work.
            </li>
            <li>
              Use the AI to categorize your library by fandom, generate
              cover art for personal use, and build smart shelves.
            </li>
            <li>
              Share book lists with friends inside the in-app book clubs
              and via the public reading-profile pages.
            </li>
            <li>
              Publish AI-generated cover art to the public cover archive,
              where other readers can react to it.
            </li>
          </ul>

          <p className="mt-4"><strong>You may not:</strong></p>
          <ul>
            <li>
              Upload books you don&rsquo;t have a legal right to a personal
              copy of, or use Shelfsort to redistribute commercial ebooks
              to people who haven&rsquo;t bought their own copy.
            </li>
            <li>
              Use Shelfsort to host or distribute material that
              sexualizes minors, incites violence, or violates someone
              else&rsquo;s privacy (e.g. doxxing).
            </li>
            <li>
              Submit AI cover prompts containing real people&rsquo;s names
              + sexual content, real-person harassment material, or
              prompts targeting protected characteristics.
            </li>
            <li>
              Spam suggestion boards, harass other users, brigade
              book-club rooms, or impersonate other people.
            </li>
            <li>
              Scrape or bulk-download other users&rsquo; content (their
              libraries, their public profiles, the cover archive) via
              automated tools.
            </li>
            <li>
              Reverse-engineer the service, attempt to access another
              user&rsquo;s account without permission, or interfere with
              the platform&rsquo;s normal operation.
            </li>
          </ul>

          <p className="mt-4">
            Violations of this section may result in a temporary or
            permanent account suspension. For most cases we&rsquo;ll
            email you first and ask; for sexual content involving minors
            we will not warn first &mdash; the account is removed and the
            matter referred where required by law.
          </p>
        </Section>

        <Section id="content-ownership" title="4. Your content stays yours">
          <p>
            You own everything you upload. By uploading, you grant
            Shelfsort a limited, non-exclusive license to store, process,
            and display your content <strong>back to you and to anyone
            you explicitly share it with</strong> &mdash; for the purpose
            of providing the service.
          </p>
          <p>
            We don&rsquo;t sell your content, train models on it, or
            display ads against it.
          </p>
          <p>
            <strong>AI-generated covers</strong>: the AI cover artwork you
            generate via the in-app tool is yours to use personally.
            Commercial use of AI-generated images is governed by the
            underlying model&rsquo;s terms (Google&rsquo;s for
            Nano-Banana); we suggest checking those if you plan to use a
            generated cover commercially. The cover archive on
            shelfsort.com is curated for community browsing under our
            license, not commercial redistribution.
          </p>
        </Section>

        <Section id="dmca" title="5. Copyright & DMCA">
          <p>
            If you believe content on Shelfsort infringes your copyright,
            please email{" "}
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] underline">
              hello@shelfsort.com
            </a>{" "}
            with:
          </p>
          <ul>
            <li>Identification of the copyrighted work claimed to have been infringed.</li>
            <li>
              The URL or location of the allegedly infringing material on
              Shelfsort (book ID, cover ID, or username + book title).
            </li>
            <li>Your contact information.</li>
            <li>
              A statement, under penalty of perjury, that the information
              is accurate and you are the copyright owner or authorized
              to act on the owner&rsquo;s behalf.
            </li>
            <li>Your physical or electronic signature.</li>
          </ul>
          <p className="mt-3">
            We respond to valid notices within 7 days. Note that most
            Shelfsort uploads are private library content visible only to
            the uploader; DMCA notices for private content can only be
            verified after we ask the uploader to attest to the source.
          </p>
        </Section>

        <Section id="termination" title="6. Termination">
          <p>
            <strong>You can leave at any time.</strong>{" "}
            <Link to="/account" className="text-[#6B46C1] underline">Account</Link> &rarr;
            &ldquo;Delete account&rdquo; removes your library, your
            uploaded files, your public profile, and your account row
            within 30 days.
          </p>
          <p>
            <strong>We can terminate your account</strong> if you
            materially violate &sect;3 (Acceptable Use), if your account
            is dormant for 24 months with zero activity (we&rsquo;ll email
            you first), or if the service is shutting down (we&rsquo;ll
            give 90 days&rsquo; notice and an export link).
          </p>
        </Section>

        <Section id="warranty" title="7. No warranty">
          <p>
            Shelfsort is provided &ldquo;as is.&rdquo; The AI
            classification is best-effort &mdash; sometimes it sorts
            Stargate into Star Wars, that&rsquo;s the price of
            statistical inference. We don&rsquo;t guarantee uptime,
            uninterrupted access, or that the service will be free of
            errors. We don&rsquo;t guarantee that any specific AI feature
            will exist forever &mdash; if a provider changes their
            pricing past sustainability, we may retire that feature with
            notice.
          </p>
        </Section>

        <Section id="liability" title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, Shelfsort and its
            operator are not liable for indirect, incidental, or
            consequential damages arising from your use of the service.
            For direct damages, our total liability is limited to the
            amount you paid us in the 12 months preceding the claim
            &mdash; which, given Shelfsort is currently free, is
            functionally zero.
          </p>
          <p>
            None of the above limits liability for fraud, willful
            misconduct, or anything else that can&rsquo;t legally be
            excluded.
          </p>
        </Section>

        <Section id="changes" title="9. Changes to these terms">
          <p>
            When we update these Terms, we&rsquo;ll bump the &ldquo;Last
            updated&rdquo; date at the top of the page and, for material
            changes, email all active accounts at least 30 days before
            the change takes effect. If you don&rsquo;t agree with the
            change, you can delete your account before it takes effect
            and these old terms continue to apply to your prior use.
          </p>
        </Section>

        <Section id="law" title="10. Governing law">
          <p>
            These Terms are governed by the laws of the State of Indiana,
            United States. Any disputes arising from these Terms or your
            use of Shelfsort will be resolved in the state or federal
            courts located in Indiana. Nothing in this section limits any
            non-waivable consumer rights you have under the law of your
            country of residence.
          </p>
        </Section>

        <Section id="contact" title="11. Contact">
          <p className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#6B46C1]" />
            <a href="mailto:hello@shelfsort.com" className="text-[#6B46C1] font-semibold underline">
              hello@shelfsort.com
            </a>
          </p>
          <p className="mt-3 text-sm text-[#5B5F4D]">
            Reachable for questions about these Terms, accessibility, or
            anything else.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-[#E5DDC5] text-sm text-[#5B5F4D]">
          See also: <Link to="/privacy" className="text-[#6B46C1] underline">Privacy Policy</Link>
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
    <section id={id} className="mb-10 scroll-mt-24" data-testid={`terms-section-${id}`}>
      <h2 className="font-serif text-2xl text-[#2C2C2C] mb-3">{title}</h2>
      <div className="prose prose-sm max-w-none text-[#2C2C2C] [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1.5 [&_p]:mb-3">
        {children}
      </div>
    </section>
  );
}
