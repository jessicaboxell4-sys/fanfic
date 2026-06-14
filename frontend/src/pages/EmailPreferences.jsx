import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import {
  ArrowLeft,
  Mail,
  Sparkles,
  Calendar,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PartyPopper,
} from "lucide-react";
import { toast } from "sonner";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function errMsg(d) {
  if (!d) return "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(d);
}

function ToggleSwitch({ checked, disabled, onChange, testid }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testid}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function ChannelCard({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  enabled,
  onToggle,
  saving,
  testidPrefix,
  children,
  previewBtn,
  lastSent,
}) {
  return (
    <section
      className="bg-white border border-[#E8E6E1] rounded-2xl p-6 mb-5"
      data-testid={`${testidPrefix}-card`}
    >
      <div className="flex items-start gap-3 mb-1">
        <div
          className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center flex-shrink-0`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">{title}</h2>
          <p className="text-sm text-[#6B705C] mt-0.5">{subtitle}</p>
        </div>
      </div>

      {onToggle && (
        <div className="mt-5 flex items-center justify-between gap-3 p-3 rounded-xl border border-[#E8E6E1] bg-[#FBFAF6]">
          <div>
            <p className="text-sm font-semibold text-[#2C2C2C]">
              {enabled ? "On" : "Off"}
            </p>
            {lastSent && (
              <p className="text-xs text-[#6B705C]">
                Last sent {new Date(lastSent).toLocaleString()}
              </p>
            )}
          </div>
          <ToggleSwitch
            checked={enabled}
            disabled={saving}
            onChange={onToggle}
            testid={`${testidPrefix}-toggle`}
          />
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}

      {previewBtn && (
        <div className="mt-5 flex flex-wrap gap-2 items-center border-t border-[#E8E6E1] pt-4">
          {previewBtn}
        </div>
      )}
    </section>
  );
}

export default function EmailPreferences() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingDigest, setSavingDigest] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [sendingDigestPreview, setSendingDigestPreview] = useState(false);
  const [sendingUpdatePreview, setSendingUpdatePreview] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/user/email-overview");
      setOverview(data);
    } catch (e) {
      toast.error("Couldn't load email preferences");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateDigest = async (patch) => {
    setSavingDigest(true);
    try {
      const { data } = await api.put("/user/digest-settings", patch);
      setOverview((o) => ({
        ...o,
        weekly_digest: { ...o.weekly_digest, ...data },
        year_recap: { ...o.year_recap, enabled: data.enabled },
      }));
      toast.success(
        patch.enabled === false ? "Weekly digest paused" : "Saved"
      );
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingDigest(false);
    }
  };

  const updateFicEmail = async (enabled) => {
    setSavingUpdate(true);
    try {
      const { data } = await api.put("/user/update-email-settings", { enabled });
      setOverview((o) => ({
        ...o,
        fic_updates: { ...o.fic_updates, ...data },
      }));
      toast.success(enabled ? "Fic-update emails on" : "Fic-update emails off");
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSavingUpdate(false);
    }
  };

  const sendDigestPreview = async () => {
    setSendingDigestPreview(true);
    try {
      const { data } = await api.post("/user/digest-preview");
      if (data.delivered) {
        toast.success(`Preview sent to ${overview.email}`);
      } else if (data.logged) {
        toast.warning("Email sending isn't configured — preview logged to console.");
      } else {
        toast.error("Couldn't send preview");
      }
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSendingDigestPreview(false);
    }
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      const { data } = await api.post("/user/email-test");
      if (data.delivered) {
        toast.success(`Test email sent to ${data.to}`);
      } else if (data.logged) {
        toast.warning("Email sending isn't configured — test logged to console.");
      } else {
        toast.error("Couldn't send test email");
      }
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSendingTest(false);
    }
  };

  const sendFicPreview = async () => {
    setSendingUpdatePreview(true);    try {
      const { data } = await api.post("/user/update-email-preview");
      if (data.delivered) {
        toast.success(`Preview sent to ${overview.email}`);
      } else if (data.logged) {
        toast.warning("Email sending isn't configured — preview logged to console.");
      } else {
        toast.error(data.error || "Couldn't send preview");
      }
    } catch (e) {
      toast.error(errMsg(e?.response?.data?.detail));
    } finally {
      setSendingUpdatePreview(false);
    }
  };

  if (loading || !overview) {
    return (
      <div className="min-h-screen bg-[#FBF7EE]">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-3 text-[#6E6E6E]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading preferences…
          </div>
        </div>
      </div>
    );
  }

  const {
    email,
    sender_email,
    email_configured,
    weekly_digest,
    fic_updates,
    year_recap,
    from_friends,
  } = overview;

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <button
          onClick={() => navigate("/account")}
          className="inline-flex items-center gap-2 text-sm text-[#6E6E6E] hover:text-[#2C2C2C] mb-6"
          data-testid="emails-back-btn"
        >
          <ArrowLeft className="h-4 w-4" /> Back to account
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-[#FDF3E1] border border-[#B87A00]/30 flex items-center justify-center">
            <Mail className="h-6 w-6 text-[#B87A00]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight" data-testid="emails-title">
              Email preferences
            </h1>
            <p className="text-sm text-[#6E6E6E]">
              All your Shelfsort email channels, in one place.
            </p>
          </div>
        </div>

        {/* Sender info */}
        <div
          className="mb-6 p-4 rounded-2xl bg-white border border-[#E8E6E1] flex flex-col sm:flex-row sm:items-center gap-3"
          data-testid="emails-sender-info"
        >
          <div className="flex-1">
            <p className="text-xs uppercase tracking-widest text-[#6B705C] mb-1">
              Your inbox
            </p>
            <p className="text-sm text-[#2C2C2C] font-semibold">{email}</p>
            <p className="text-xs text-[#6B705C] mt-1">
              Sent from <span className="font-mono">{sender_email}</span>
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            {email_configured && (
              <button
                type="button"
                onClick={sendTestEmail}
                disabled={sendingTest}
                data-testid="emails-send-test-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#6B46C1] text-[#6B46C1] text-xs font-semibold hover:bg-[#EEF3EC] transition-colors disabled:opacity-60"
                title="Send a one-shot test email to confirm delivery"
              >
                {sendingTest ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send test email
              </button>
            )}
            {email_configured ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#EEF3EC] text-[#6B46C1] text-xs font-semibold"
                data-testid="emails-configured-pill"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Delivery configured
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FDF3E1] text-[#B87A00] text-xs font-semibold"
                data-testid="emails-not-configured-pill"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Delivery not configured
              </span>
            )}
          </div>
        </div>

        {/* Weekly digest */}
        <ChannelCard
          icon={<Mail className="w-5 h-5" />}
          iconBg="bg-[#FDF3E1]"
          iconColor="text-[#B87A00]"
          title="Weekly reading digest"
          subtitle="A friendly Sunday recap: what you opened, your top fandom, books still waiting at the bookmark."
          enabled={weekly_digest.enabled}
          onToggle={() => updateDigest({ enabled: !weekly_digest.enabled })}
          saving={savingDigest}
          testidPrefix="weekly-digest"
          lastSent={weekly_digest.last_sent_at}
          previewBtn={
            <>
              <button
                type="button"
                onClick={sendDigestPreview}
                disabled={sendingDigestPreview}
                data-testid="weekly-digest-preview-btn"
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {sendingDigestPreview ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send a sample
              </button>
              <p className="text-xs text-[#6B705C]">
                Preview the layout without waiting for Sunday.
              </p>
            </>
          }
        >
          <div
            className={`grid sm:grid-cols-2 gap-3 transition-opacity ${
              weekly_digest.enabled ? "opacity-100" : "opacity-50 pointer-events-none"
            }`}
          >
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Day of week
              </label>
              <select
                data-testid="weekly-digest-day"
                value={weekly_digest.day_of_week}
                onChange={(e) => updateDigest({ day_of_week: Number(e.target.value) })}
                disabled={!weekly_digest.enabled || savingDigest}
                className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
                Time (UTC)
              </label>
              <select
                data-testid="weekly-digest-hour"
                value={weekly_digest.hour}
                onChange={(e) => updateDigest({ hour: Number(e.target.value) })}
                disabled={!weekly_digest.enabled || savingDigest}
                className="w-full bg-white border border-[#E8E6E1] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
        </ChannelCard>

        {/* Fic updates */}
        <ChannelCard
          icon={<Sparkles className="w-5 h-5" />}
          iconBg="bg-[#EEF3EC]"
          iconColor="text-[#6B46C1]"
          title="Fic-update alerts"
          subtitle="The instant your fanfics refresh, get an email listing what's new with one-click jumps to the changed chapters."
          enabled={fic_updates.enabled}
          onToggle={() => updateFicEmail(!fic_updates.enabled)}
          saving={savingUpdate}
          testidPrefix="fic-updates"
          previewBtn={
            <>
              <button
                type="button"
                onClick={sendFicPreview}
                disabled={sendingUpdatePreview || fic_updates.refreshed_book_count === 0}
                data-testid="fic-updates-preview-btn"
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {sendingUpdatePreview ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send a sample
              </button>
              <p className="text-xs text-[#6B705C]">
                {fic_updates.refreshed_book_count > 0
                  ? `Uses your ${Math.min(fic_updates.refreshed_book_count, 10)} most-recently refreshed fic${fic_updates.refreshed_book_count === 1 ? "" : "s"}.`
                  : "Refresh a fanfic first to enable the sample preview."}
              </p>
            </>
          }
        />

        {/* From-friends digest */}
        <ChannelCard
          icon={<Sparkles className="w-5 h-5" />}
          iconBg="bg-[#EEF3EC]"
          iconColor="text-[#6B46C1]"
          title="From friends — weekly"
          subtitle="What your sharing friends finished this week. The in-app notification always fires; toggle to also receive an email copy."
          enabled={from_friends?.email_enabled || false}
          onToggle={() => updateFromFriendsEmail(!from_friends?.email_enabled)}
          saving={savingDigest}
          testidPrefix="from-friends"
          lastSent={from_friends?.last_email_sent_at}
          previewBtn={
            <>
              <button
                type="button"
                onClick={sendFromFriendsPreview}
                disabled={sendingDigestPreview}
                data-testid="from-friends-preview-btn"
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
              >
                {sendingDigestPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send sample (in-app + email)
              </button>
              <p className="text-xs text-[#6B705C]">{from_friends?.note}</p>
            </>
          }
        />

        {/* Year-in-Books recap */}
        <ChannelCard
          icon={<PartyPopper className="w-5 h-5" />}
          iconBg="bg-[#FDEFE7]"
          iconColor="text-[#E07A5F]"
          title="Year-in-Books recap"
          subtitle="A once-a-year wrap-up of your reading, automatically emailed every January 1st."
          testidPrefix="year-recap"
        >
          <div className="p-4 rounded-xl bg-[#FBFAF6] border border-[#E8E6E1] text-sm text-[#6B705C]">
            <p className="text-[#2C2C2C] mb-2 font-semibold">
              {year_recap.enabled ? "On — tied to your weekly digest" : "Off — turn on the weekly digest to enable"}
            </p>
            <p>{year_recap.note}</p>
            {year_recap.last_year_sent && (
              <p className="mt-2 text-xs text-[#6B705C]">
                Last recap sent for year {year_recap.last_year_sent}.
              </p>
            )}
            <p className="mt-3 text-xs">
              <Link to="/year-in-books" className="text-[#6B46C1] hover:underline font-semibold">
                Preview the in-app version →
              </Link>
            </p>
          </div>
        </ChannelCard>

        {!email_configured && (
          <p
            className="text-xs text-[#B87A00] bg-[#FDF3E1] rounded-lg p-3 mt-2"
            data-testid="emails-warning"
          >
            Email delivery isn't configured on this server yet. Your preferences will save,
            and once the operator adds a Resend API key, your emails will start arriving.
          </p>
        )}
      </div>
    </div>
  );
}
