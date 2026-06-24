import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Shield, Inbox, Users, HardDrive, AlertOctagon, Database,
  Mail, ShieldAlert, FlaskConical, BarChart3, MessageSquare, Pause,
  Trash2, Sparkles, Eye, Bell, Send, History, LifeBuoy,
} from "lucide-react";
import WhatsNewFeed from "@/components/WhatsNewFeed";

/**
 * /admin/help — Documentation for the admin console.
 *
 * Mirrors the user-facing /help page but covers every admin tool:
 * what each card does, how the math works, when to use which
 * button, and what the gotchas are.  Lives at /admin/help so it's
 * one click away from the console itself.
 */
const SECTIONS = [
  { id: "users",            label: "Users & approvals",       icon: Users },
  { id: "pending",          label: "Pending sign-ups inbox",  icon: Inbox },
  { id: "test-accounts",    label: "Test-account quarantine", icon: FlaskConical },
  { id: "campaign",         label: "Campaign / referral stats", icon: BarChart3 },
  { id: "r2-migration",     label: "R2 storage migration",    icon: HardDrive },
  { id: "orphan-audit",     label: "Orphan audit & cleanup",  icon: AlertOctagon },
  { id: "fallback",         label: "Pause Emergent fallback", icon: Pause },
  { id: "savings",          label: "$ saved this month + tuner", icon: BarChart3 },
  { id: "antivirus",        label: "Antivirus & quarantine",  icon: ShieldAlert },
  { id: "feedback",         label: "Feedback inbox + attachments", icon: MessageSquare },
  { id: "notifications",    label: "Operator digest + cron",  icon: Bell },
  { id: "email-system",     label: "Email system kill switch", icon: Pause },
  { id: "email-logs",       label: "Email logs & retry",      icon: Mail },
  { id: "llm-key-health",   label: "LLM key health & runway", icon: Sparkles },
  { id: "changelog",        label: "Recent changelog",        icon: History },
  { id: "bookclubs",        label: "Book-club moderation",    icon: Users },
  { id: "unknown-sources",  label: "Unknown sources triage",  icon: Eye },
  { id: "av-flag",          label: "AV scan-on-upload toggle", icon: Shield },
  { id: "troubleshooting",  label: "Troubleshooting & slowness", icon: LifeBuoy },
];

function Section({ id, icon: Icon, title, children }) {
  return (
    <section
      id={id}
      data-testid={`admin-help-${id}`}
      className="shelf-card p-6 mb-5 scroll-mt-20"
    >
      <h2 className="font-serif text-2xl text-[#2C2C2C] flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-[#6B46C1]" aria-hidden="true" />
        {title}
      </h2>
      <div className="prose prose-sm max-w-none text-[#2C2C2C] [&>p]:my-2 [&>ul]:my-2 [&>ul]:list-disc [&>ul]:pl-5 [&>code]:bg-[#FBFAF6] [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded [&>code]:text-[#6B46C1]">
        {children}
      </div>
    </section>
  );
}

export default function AdminHelp() {
  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <header className="border-b border-[#E5DDC5] bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            to="/admin"
            data-testid="admin-help-back"
            className="inline-flex items-center gap-1.5 text-sm text-[#6B705C] hover:text-[#2C2C2C]"
          >
            <ArrowLeft className="w-4 h-4" />
            Admin console
          </Link>
          <div className="flex-1" />
          <Shield className="w-4 h-4 text-[#6B46C1]" />
          <span className="text-xs uppercase tracking-[0.18em] text-[#6B46C1] font-semibold">
            Admin help
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 grid md:grid-cols-[220px_1fr] gap-8">
        <aside className="md:sticky md:top-6 md:self-start" data-testid="admin-help-toc">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#6B705C] font-bold mb-2">
            On this page
          </p>
          <nav className="text-sm space-y-1.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block text-[#6B705C] hover:text-[#6B46C1] py-0.5"
                data-testid={`admin-help-toc-${s.id}`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <div>
          <h1 className="font-serif text-4xl text-[#2C2C2C] mb-2">
            Admin console — what does what
          </h1>
          <p className="text-[#6B705C] mb-6">
            Every card on <Link to="/admin" className="text-[#6B46C1] underline">/admin</Link> documented in one place. Use the table of contents on the left to jump around.
          </p>

          <WhatsNewFeed />

          <Section id="users" icon={Users} title="Users & approvals">
            <p>The main users list (<code>/admin/users</code>) shows real users only — test-account fixtures live on a separate quarantine page so they don&apos;t clutter your KPIs.</p>
            <ul>
              <li><strong>Who shows up here</strong>: anyone whose email doesn&apos;t match the test-account patterns (`@test.local`, `@example.*`, `@x.com`, `@e.com`, `@t.com`, `@ft.local*`, or local-part prefixes `test_`, `t_`, `sync_`, `linkless_`, `qa_`, `fixture_`, `reg_`, `check_`, `open_user_`, `user_`, `iter`, `admin-smoke`).</li>
              <li><strong>Promote to admin</strong>: open the row, toggle the admin badge. Effective immediately on next request.</li>
              <li><strong>Promote to moderator</strong>: moderator badge enables `/admin/pending` access without granting full admin rights.</li>
            </ul>
          </Section>

          <Section id="pending" icon={Inbox} title="Pending sign-ups inbox">
            <p>Every new sign-up lands in <code>approval_status=&quot;pending&quot;</code> until you approve. The pending inbox shows the count + a row per applicant with their onboarding answers.</p>
            <ul>
              <li><strong>Approve one</strong>: click Approve on the row → the user gets the welcome email and a live session next time they sign in.</li>
              <li><strong>Reject</strong>: rejection reason is included in the email back to them.</li>
              <li><strong>Bulk approve</strong>: <code>POST /admin/pending-users/approve-bulk</code> processes up to 50 at a time, throttled to 4 emails/sec so Resend doesn&apos;t rate-limit.</li>
              <li><strong>Auto-quarantine</strong>: test-account fixtures NEVER land here — they auto-approve at registration time and get stamped <code>is_test_account=true</code>.</li>
            </ul>
          </Section>

          <Section id="test-accounts" icon={FlaskConical} title="Test-account quarantine">
            <p>Visit <Link to="/admin/test-accounts" className="text-[#6B46C1] underline">/admin/test-accounts</Link> for a separate view of every account flagged as a test fixture. Useful for cleaning up after a busy QA run.</p>
            <ul>
              <li><strong>Detection is lexical</strong> — see <code>utils/test_account_filter.py</code>. Change the patterns to catch new fixtures.</li>
              <li><strong>Backfill on boot</strong>: every backend start re-stamps `is_test_account=true` + `approval_status=&quot;approved&quot;` on legacy fixtures matching current patterns.</li>
              <li><strong>Bulk delete</strong>: the page exposes a &quot;Delete all&quot; action that drops the user docs + cascades the cleanup to their books, sessions, and reading activity.</li>
            </ul>
          </Section>

          <Section id="campaign" icon={BarChart3} title="Campaign / referral stats">
            <p>The Campaign Stats card shows your referral funnel — how many users came in via each `?ref=` source, how many converted to a first book upload, how many bounced.</p>
            <ul>
              <li><strong>Sources tracked</strong>: anything passed as <code>?ref=foo</code> on the landing page. Stored on the user doc at registration.</li>
              <li><strong>Conversion</strong>: defined as &quot;uploaded ≥ 1 book within 7 days of signup&quot;.</li>
              <li><strong>No referral</strong>: organic signups are bucketed under &quot;(direct)&quot;.</li>
            </ul>
          </Section>

          <Section id="r2-migration" icon={HardDrive} title="R2 storage migration">
            <p>The R2 Migration Progress card shows what percent of books have moved from Emergent Object Storage to Cloudflare R2. It samples 100 books per refresh + HEAD-checks them against the R2 bucket.</p>
            <ul>
              <li><strong>Migrate next 25</strong>: kicks off a chunk of backfill. Each book is downloaded from Emergent and re-uploaded to R2, then the DB record is updated. Hit it as many times as needed.</li>
              <li><strong>Re-sample</strong>: re-runs the percentage sample without doing any actual migration work.</li>
              <li><strong>Migration complete banner</strong>: once the percent hits 100 a green ribbon unlocks with the &quot;Pause Emergent fallback&quot; button.</li>
              <li><strong>Auto-migration on read</strong>: any time a user opens a book served from Emergent, the file is silently mirrored to R2 in the background.</li>
            </ul>
          </Section>

          <Section id="orphan-audit" icon={AlertOctagon} title="Orphan audit & cleanup">
            <p>HEAD-checks every book with a stored filename against R2 AND the Emergent fallback. A book is &quot;orphaned&quot; only if BOTH backends return 404 — meaning the DB row points at bytes you can no longer serve.</p>
            <ul>
              <li><strong>Run audit</strong>: scans up to 5000 books with 20-wide concurrency. Returns a sortable table with title, owner, filename, size.</li>
              <li><strong>Bulk delete</strong>: select rows → &quot;Delete N selected&quot;. Each row is RE-checked before deletion so a recovered file is never nuked. Capped at 500 per batch.</li>
              <li><strong>When to run</strong>: after the migration gauge plateaus &lt; 100%. Most plateaus mean orphaned DB records, not failed migrations.</li>
            </ul>
          </Section>

          <Section id="fallback" icon={Pause} title="Pause Emergent fallback">
            <p>The &quot;Pause Emergent fallback&quot; toggle (inside the migration-complete banner) tells the storage adapter to STOP probing Emergent on R2 misses. Useful once R2 is fully cut over so you can confirm there&apos;s no traffic still hitting Emergent.</p>
            <ul>
              <li><strong>Pausable, not permanent</strong>: the toggle is reversible. Mongo-persisted in <code>storage_config.emergent_fallback_paused</code>, audit-logged.</li>
              <li><strong>What changes when paused</strong>: <code>restore_to_disk()</code> + <code>remote_exists()</code> short-circuit Emergent. R2 misses return 404 instead of silently lazy-restoring.</li>
              <li><strong>What stays the same</strong>: the Emergent API key is still configured. Pausing does NOT rotate or remove it.</li>
              <li><strong>Recommended timeline</strong>: pause once migration hits 100% → watch storage logs for 1 week → rotate the Emergent key once you see zero fallback hits.</li>
            </ul>
          </Section>

          <Section id="savings" icon={BarChart3} title="$ saved this month + tuner">
            <p>The &quot;Estimated savings this month&quot; line on the migration banner shows the dollar delta between Emergent ($0.20/GB storage + $0.09/GB egress) and R2 ($0.015/GB storage + $0 egress).</p>
            <ul>
              <li><strong>Storage cost</strong>: exact. Sum of `size_bytes` × per-GB rate.</li>
              <li><strong>Egress cost</strong>: estimated. Without per-request access logs we use a multiplier (default 2.0 — typical active library reads each byte ~2× per month).</li>
              <li><strong>Tune the multiplier</strong>: click &quot;tune&quot; next to the egress multiplier → enter your real <code>monthly_egress_GB / total_stored_GB</code> ratio from your latest R2 bill → save. Persisted to Mongo, no redeploy.</li>
              <li><strong>Clear override</strong>: save with the field empty → reverts to the env default.</li>
            </ul>
          </Section>

          <Section id="antivirus" icon={ShieldAlert} title="Antivirus & quarantine">
            <p>Every uploaded EPUB, cover, screenshot, and feedback attachment is scanned by ClamAV before it&apos;s persisted. Infected files are quarantined to a separate collection with full forensics.</p>
            <ul>
              <li><strong>AV daemon status</strong>: the card shows whether ClamAV is healthy + when signatures were last updated.</li>
              <li><strong>Cold-start window</strong>: on a fresh pod boot ClamAV takes ~2-3 min to download fresh signatures. During this window <code>/api/health</code> reports `degraded` and uploads bypass scanning. This is expected, self-healing behavior.</li>
              <li><strong>Quarantine viewer</strong>: shows every flagged file with the user, source endpoint, scan reason, and timestamp. Soft-delete only.</li>
              <li><strong>Per-book badge</strong>: each book card on the user library shows a small AV badge (green = clean, amber = unscanned, red = quarantined).</li>
            </ul>
          </Section>

          <Section id="feedback" icon={MessageSquare} title="Feedback inbox + attachments">
            <p>The Feedback Inbox card aggregates everything from <code>/suggestions</code> (the public board) and <code>/feedback</code> (the Help-page form). Each row carries the submitter, body, status, vote count, attached screenshot, and the <strong>device the report was filed from</strong>.</p>
            <ul>
              <li><strong>Device chip</strong>: as of 2026-06-20 every suggestion is tagged with the submitter&apos;s device (iPhone, Amazon Fire, Mac, etc.). The chip renders next to the submitter line on the public board; in the admin inbox it&apos;s a sorting/triage signal — open `/api/suggestions` and group by `device` to spot platform-specific regressions before they spiral.</li>
              <li><strong>Custom devices</strong>: users who pick &quot;Other&quot; can type in a name (Steam Deck, BOOX Note, etc.) which is persisted to <code>db.custom_devices</code> and shown to the next user with that device. Case-insensitive dedupe via a unique index on <code>name_lc</code>.</li>
              <li><strong>Attachment badges</strong>: rows with a screenshot show a colored 📎 image badge. Hover for the raw MIME.</li>
              <li><strong>Inline preview</strong>: expand a row to see the body + a clickable filename + size chip that opens the screenshot in a new tab.</li>
              <li><strong>Update status</strong>: open → under-review → planned → done → declined. Sends an in-app notification + optional email to the submitter.</li>
              <li><strong>Admin note</strong>: visible to the submitter on the public board. Useful for &quot;thanks, queued for Q3&quot; replies.</li>
              <li><strong>Pictures only</strong>: as of 2026-06-20 the attachment picker on all 3 surfaces only accepts images (PNG/JPEG/WebP). Larger / non-image files should go via support email.</li>
            </ul>
          </Section>

          <Section id="notifications" icon={Bell} title="Operator digest + cron">
            <p>Daily 09:00 UTC the backend assembles a morning digest of last 24h activity: new signups, books uploaded, pending count, AV quarantine deltas, R2 migration progress.</p>
            <ul>
              <li><strong>Preview</strong>: <code>GET /admin/operator-digest</code> renders today&apos;s digest without sending.</li>
              <li><strong>Cron status card</strong>: shows next-run timestamps for every scheduled job (digest, AV rescan sweep, R2 backfill tick, storage backfill tick, account-grace cleanup).</li>
              <li><strong>Cron alerts</strong>: if a job hasn&apos;t run within its expected window, the card flashes an &quot;Overdue&quot; badge.</li>
            </ul>
          </Section>

          <Section id="email-system" icon={Pause} title="Email system kill switch">
            <p>Added 2026-06-20 as a one-click counterpart to the buried <code>outbound_emails_enabled</code> feature flag. Lives on the <Link to="/admin" className="text-[#6B46C1] underline">/admin</Link> console as the <em>Email system</em> card with a big ON/PAUSED pill.</p>
            <ul>
              <li><strong>When to flip OFF</strong>: Resend quota burn (free tier is 100 emails/day), domain mis-config, or noisy QA runs spamming real inboxes. Toggling pauses ALL outbound mail in under 5 seconds.</li>
              <li><strong>What happens while paused</strong>: every queued email (approval, suggestion status, year-in-books, weekly digest, etc.) flips to an in-app notification instead. Users still see the message next time they open Shelfsort.</li>
              <li><strong>Always-on kinds</strong>: security-critical mail (password reset, email-change confirmation) bypasses the switch and still sends — this is intentional so locked-out users can recover.</li>
              <li><strong>Per-user opt-outs are independent</strong>: each user has their own opt-out list at <Link to="/account/emails" className="text-[#6B46C1] underline">/account/emails</Link> → <em>Account updates</em>. Those settings are honoured regardless of the master switch.</li>
              <li><strong>Test-domain suppression</strong>: <code>backend/utils/email_suppression.py</code> ALWAYS blocks Resend calls to test patterns (<code>@test.local</code>, <code>@example.*</code>, <code>@e.com</code>, <code>@t.com</code>, prefixes like <code>test_</code>, <code>qa_</code>, <code>fixture_</code>, etc.). This runs even when the master switch is ON, so QA fixtures can never burn quota.</li>
              <li><strong>Backend endpoint</strong>: <code>PUT /admin/feature-flags</code> with body <code>{`{flag: "outbound_emails_enabled", enabled: false}`}</code>.</li>
            </ul>
          </Section>

          <Section id="email-logs" icon={Mail} title="Email logs & retry">
            <p>Every transactional email (smart welcome, approval, rejection, year-in-books, digest, password reset) is logged to Mongo with status + Resend message ID.</p>
            <ul>
              <li><strong>Smart welcome (2026-06-22)</strong>: replaces the old &ldquo;your account is approved&rdquo; one-liner. Picks copy from a curated bank using the four onboarding answers (reader_type, favorite_fandom, referral, is_13_plus). Logged under <code>welcome_approval</code> (admin-approved) or <code>welcome_auto_approve</code> (signup with gate off).</li>
              <li><strong>Retry failed</strong>: failed sends can be re-fired from the card. We&apos;ve throttled retries to 4/sec.</li>
              <li><strong>Pre-cutover purge</strong>: <code>POST /admin/email-logs/clear-pre-cutover-failures</code> removes log rows older than the Resend domain verification cutover so the failure rate widget stays meaningful.</li>
              <li><strong>Domain check</strong>: the card shows whether your Resend domain is verified. If it&apos;s not, all emails will silently bounce.</li>
            </ul>
          </Section>

          <Section id="llm-key-health" icon={Sparkles} title="LLM key health & runway">
            <p>Universal-Key burn-rate watchdog — added 2026-06-22 after a budget-cap incident silently broke Claude + Nano-Banana for ~20 minutes. Tells you days-of-runway so you top up <em>before</em> the next cliff.</p>
            <ul>
              <li><strong>Why we self-instrument</strong>: Emergent does not expose a programmatic balance API. The card combines two evidence sources: (1) the new <code>llm_usage</code> Mongo collection (every Claude classify + Nano-Banana cover-gen call logs <code>kind, model, tokens_in, tokens_out, images, cost_usd, status</code>); (2) proxy counts via <code>books.classifier=&quot;ai&quot;</code> and <code>books.cover_source=&quot;ai_generated&quot;</code> for instant historical depth before the new collection accrues data.</li>
              <li><strong>How to read the card</strong>: 3 KPIs (instrumented 7d cost, proxy 7d cost, current balance) + a runway banner (<code>critical</code> &lt; 7 days, <code>warning</code> &lt; 14 days, <code>ok</code> &ge; 14 days, <code>unknown</code> if no balance set).</li>
              <li><strong>What you have to do</strong>: open Profile → Universal Key, copy the current USD balance, and paste it into the &ldquo;Update current balance&rdquo; input on the card. Click <strong>Save</strong>. Runway is now live. Repeat after each top-up.</li>
              <li><strong>Auto-recharge</strong>: enable it in Profile → Universal Key → <em>Auto top up</em> so you don&apos;t have to keep coming back.</li>
              <li><strong>Pricing constants</strong> (footer of the card): Claude Sonnet 4.6 list price (in / out per million tokens) + Nano-Banana per-image. These are <em>estimates</em>; Emergent&apos;s actual markup may differ, but the math is conservative (it takes the max of the instrumented and proxy daily averages).</li>
              <li><strong>Backend endpoints</strong>: <code>GET /admin/llm-key-health</code> returns the full payload; <code>PUT /admin/llm-key-health/balance</code> with body <code>{`{usd: 4.85}`}</code> persists the operator-supplied balance to <code>app_config</code>.</li>
            </ul>
          </Section>

          <Section id="changelog" icon={History} title="Recent changelog">
            <p>Surfaces the last 20 dated entries from <code>/app/memory/CHANGELOG.md</code> so you can see what was shipped recently without opening the repo. Each entry is collapsed by default; click to expand the full body (markdown rendered as preformatted text).</p>
            <ul>
              <li><strong>What counts as an entry</strong>: an <code>## YYYY-MM-DD (slug) — Title</code> H2 heading in <code>CHANGELOG.md</code>. The parser slices on H2 boundaries, so make sure you don&apos;t accidentally double-prefix with <code>###</code>.</li>
              <li><strong>Hard cap</strong>: 100 entries server-side regardless of <code>limit=</code> param, so the card stays fast even when the changelog grows to thousands of entries.</li>
              <li><strong>Backend endpoint</strong>: <code>GET /admin/changelog?limit=20</code>. Returns each entry as <code>{`{date, slug, title, body, lines}`}</code>.</li>
              <li><strong>Pairs well with</strong>: the LLM key health card above. When you flip a new feature on, append a dated entry; the next page-load of <code>/admin</code> will surface it here for you to verify the deploy actually shipped what you expect.</li>
            </ul>
          </Section>

          <Section id="bookclubs" icon={Users} title="Book-club moderation">
            <p>Book-clubs are user-created reading groups. The moderation card surfaces:</p>
            <ul>
              <li><strong>Reported rooms</strong>: any club a user flagged for review.</li>
              <li><strong>Lock / unlock</strong>: locks freeze chat without deleting the room.</li>
              <li><strong>Watched rooms</strong>: clubs you&apos;ve added to your personal watch-list for quick re-check.</li>
            </ul>
          </Section>

          <Section id="unknown-sources" icon={Eye} title="Unknown sources triage">
            <p><Link to="/admin/unknown-sources" className="text-[#6B46C1] underline">/admin/unknown-sources</Link> shows every URL host that appeared in user uploads but isn&apos;t in our known list (AO3, FanFiction.net, Wattpad, etc.). Useful for spotting new fanfic sites worth adding to the URL normalizer.</p>
          </Section>

          <Section id="av-flag" icon={Shield} title="AV scan-on-upload toggle">
            <p>
              Environment variable <code>AV_SCAN_ON_UPLOAD</code> controls
              whether ClamAV runs <em>during</em> each upload or whether
              books land as <em>unscanned</em> and get swept later via the
              post-upload &ldquo;Scan now&rdquo; toast or any
              <Link to="/account/safety" className="text-[#6B46C1] underline"> Library safety</Link>{" "}
              rescan.
            </p>
            <ul className="list-disc pl-5 my-2 space-y-1">
              <li>
                <code>AV_SCAN_ON_UPLOAD=true</code> (default) — scans every
                file during upload.  Safe but adds ~3 seconds per file.
              </li>
              <li>
                <code>AV_SCAN_ON_UPLOAD=false</code> — skips the inline
                scan. Books land marked <code>av_status: &quot;unscanned&quot;</code>.
                The auto-scan now triggers when the user applies
                Polish-my-library suggestions (PolishLibraryPage kicks
                <code>/api/account/safety/rescan</code> and polls
                <code>/api/account/safety/rescan-progress</code> every
                1.5s for live X-of-Y feedback). Replaces the older
                post-upload toast prompt — no nagging after every batch.
                Users can also manually rescan from /account/safety.
                Use this when uploads are slow due to upstream LLM
                throttling (the bigger latency hog is Claude
                classification, not AV).
              </li>
            </ul>
            <p>
              <strong>Where to set it</strong>: the project root&apos;s{" "}
              <code>backend/.env</code> file (Emergent platform copies
              this into the deployed container env on redeploy).  Changes
              require a redeploy to take effect on shelfsort.com.
            </p>
            <p>
              <strong>Safety net</strong>: even with the inline scan off,
              ClamAV still catches things via{" "}
              <Link to="/admin/antivirus" className="text-[#6B46C1] underline">/admin/antivirus</Link>{" "}
              (bulk rescan across all users) and the user-initiated{" "}
              <Link to="/account/safety" className="text-[#6B46C1] underline">/account/safety</Link>{" "}
              rescan. Send-to-Kindle also refuses any book with{" "}
              <code>av_status: &quot;infected&quot;</code>, so infected files can&apos;t
              be exfiltrated to a Kindle device even if they sit briefly
              unscanned in someone&apos;s library.
            </p>
            <p>
              <strong>To-do (next sprint)</strong>: when any cross-user
              sharing feature ships (friends, library exchange, etc.) we
              need a <code>ensure_av_clean_for_sharing()</code> guard so
              unscanned books can&apos;t be sent to other users. Already
              scoped in ROADMAP.md as P1.
            </p>
          </Section>

          <Section id="troubleshooting" icon={LifeBuoy} title="Troubleshooting & console slowness">
            <p>
              The admin console pulls from a lot of sources — MongoDB, the
              Emergent universal LLM key (Claude / Gemini upstream),
              Cloudflare R2, ClamAV. When any one of those gets slow, the
              admin page can feel sluggish even though the rest of the app
              is fine for regular users.  Here&apos;s the diagnostic order
              to walk through before assuming a real bug:
            </p>
            <ol className="list-decimal pl-5 my-2 space-y-2">
              <li>
                <strong>Check the Emergent platform banner first.</strong>{" "}
                The Emergent chat UI surfaces a yellow/orange banner when
                their upstream LLM providers (Anthropic for Claude,
                Google for Gemini) are throttled. If that&apos;s up, expect
                5-15 min of admin-side flakiness — specifically any card
                that touches Claude/Gemini (LLM Key Health, recent
                classifications, Welcome-email previews).  These recover
                on their own when Emergent clears the banner.  The user
                app (library / reader / upload) is unaffected because none
                of those flows block on a live LLM call.
              </li>
              <li>
                <strong>Check the <Link to="/admin#llm-key-health" className="text-[#6B46C1] underline">LLM Key Health card</Link> in the admin console.</strong>{" "}
                If error rates are spiking and the &ldquo;status&rdquo; pill is
                amber/red, the root cause is upstream LLM throttling — not
                Shelfsort.  Wait it out.
              </li>
              <li>
                <strong>If neither of the above explains it</strong>: grab a
                screenshot of the red error text + the URL the error
                mentions (e.g. <code>/api/admin/feedback</code>), and bring
                it to the next development session.  Without the actual
                error string the next agent will have to guess.
              </li>
            </ol>
            <p>
              <strong>What to NOT do:</strong> please do not redeploy to
              &ldquo;fix&rdquo; transient slowness — a redeploy doesn&apos;t
              influence anything upstream, and it&rsquo;ll cool the
              browser caches for real users in the middle of reading their
              books.  Wait it out first; redeploy only after confirming the
              issue is in our code.
            </p>
            <p>
              <strong>What about the regular user app?</strong> If users
              report library / reader / upload slowness (not just admin
              console): that&rsquo;s a different category — start by
              checking the production logs for 5xx errors, then test the
              same flow from your own browser, then escalate to support
              via the platform chat with the URL + error text + approximate
              timestamp.
            </p>
            <p>
              <strong>&ldquo;It&rsquo;s broken in Firefox but works in
              Chrome&rdquo; (or vice versa).</strong> When a user (or you)
              reports browser-specific weirdness, check upstream{" "}
              <em>first</em> before assuming a code bug. Different browsers
              have different default timeouts and cookie-partitioning
              behavior, which means upstream throttling can surface as
              &ldquo;works in Chrome, broken in Firefox&rdquo; even when
              the actual root cause is platform-side. Firefox Mobile
              specifically has stricter request timeouts than Chrome
              Mobile, so a slow backend that Chrome rides out will look
              like a hard failure in Firefox. Run through the same three
              diagnostic steps above before chasing a browser-compat fix.
              Most real browser-compat bugs persist after a cache clear
              and across networks &mdash; if the issue is intermittent or
              self-resolves, it&rsquo;s almost certainly upstream.
            </p>
          </Section>

          <p className="text-xs text-[#6B705C] mt-8 mb-4 italic">
            Missing something? Drop a note via the <Link to="/suggestions" className="text-[#6B46C1] underline">Suggestions</Link> board — it&apos;ll show up in your own Feedback inbox.
          </p>
        </div>
      </main>
    </div>
  );
}
