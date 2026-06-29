import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Smartphone, Loader2, RefreshCw, Copy, Check, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { api, API } from "../lib/api";

/**
 * E-reader sync card — exposes the OPDS catalog endpoint to standalone
 * e-reader apps (KOReader, Moon+ Reader, Marvin, Foliate). Generates a
 * dedicated catalog password (separate from the user's primary login).
 */
export default function CatalogSyncCard() {
  const [status, setStatus] = useState({ opds_enabled: false, has_password: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shownPassword, setShownPassword] = useState("");
  const [shownEmail, setShownEmail] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const catalogUrl = `${API}/opds`;

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/user/catalog-credentials");
      setStatus(data);
    } catch { /* non-blocking */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    if (status.has_password && !window.confirm("Regenerate your catalog password? Any e-readers currently connected will need the new one.")) {
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/user/catalog-credentials/regenerate");
      setShownPassword(data.password);
      setShownEmail(data.username);
      setStatus((s) => ({ ...s, opds_enabled: true, has_password: true }));
      toast.success("New catalog password generated — save it now");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't regenerate");
    } finally { setBusy(false); }
  };

  const toggle = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/user/catalog-credentials", { enabled: !status.opds_enabled });
      setStatus(data);
      toast.success(data.opds_enabled ? "E-reader sync enabled" : "E-reader sync disabled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    } finally { setBusy(false); }
  };

  const copy = async (value, field) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  if (loading) {
    return (
      <section className="shelf-card p-5 mb-5">
        <div className="text-sm text-[#5B5F4D] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading e-reader sync…</div>
      </section>
    );
  }

  return (
    <section className="shelf-card p-5 mb-5" data-testid="opds-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#6B46C1]" />
          <h3 className="font-serif text-lg text-[#2C2C2C]">E-reader sync</h3>
        </div>
        {status.has_password && (
          <button
            type="button"
            data-testid="opds-toggle"
            onClick={toggle}
            disabled={busy}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              status.opds_enabled ? "bg-[#6B46C1]" : "bg-[#E8E6E1]"
            }`}
            title={status.opds_enabled ? "Disable e-reader sync" : "Enable e-reader sync"}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              status.opds_enabled ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
        )}
      </div>

      <p className="text-xs text-[#5B5F4D] mb-3">
        Read your library on KOReader, Moon+ Reader, Marvin or any other OPDS-compatible e-reader app — plus Kindle via email or USB. No React UI needed.
      </p>

      {!status.has_password ? (
        <button
          data-testid="opds-generate-btn"
          onClick={regenerate}
          disabled={busy}
          className="btn-primary text-sm inline-flex items-center gap-2"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Generate catalog password
        </button>
      ) : (
        <>
          {/* Catalog URL */}
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B5F4D] mb-1">Catalog URL</p>
            <div className="flex items-center gap-1">
              <code data-testid="opds-url" className="flex-1 text-xs bg-[#FBFAF6] border border-[#E5DDC5] rounded px-2 py-1.5 break-all">{catalogUrl}</code>
              <button
                data-testid="opds-copy-url"
                onClick={() => copy(catalogUrl, "url")}
                className="p-1.5 hover:bg-[#F5F3EC] rounded"
                title="Copy URL"
              >
                {copiedField === "url" ? <Check className="w-3 h-3 text-[#1F4D2A]" /> : <Copy className="w-3 h-3 text-[#5B5F4D]" />}
              </button>
            </div>
          </div>

          {/* Freshly-issued password — visible only after regenerate */}
          {shownPassword && (
            <div className="mb-3 p-3 bg-[#FDF3E1] border border-[#E5C780] rounded-lg" data-testid="opds-new-password-box">
              <p className="text-xs font-semibold text-[#B87A00] flex items-center gap-1 mb-2">
                <AlertTriangle className="w-3 h-3" /> Save these now — we only show the password once
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <code className="flex-1 text-xs bg-white border border-[#E5DDC5] rounded px-2 py-1.5 break-all">
                    <span className="text-[#5B5F4D]">user:</span> {shownEmail}
                  </code>
                  <button
                    onClick={() => copy(shownEmail, "user")}
                    className="p-1.5 hover:bg-white rounded"
                    title="Copy username"
                  >
                    {copiedField === "user" ? <Check className="w-3 h-3 text-[#1F4D2A]" /> : <Copy className="w-3 h-3 text-[#5B5F4D]" />}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <code data-testid="opds-password" className="flex-1 text-xs bg-white border border-[#E5DDC5] rounded px-2 py-1.5 break-all">
                    <span className="text-[#5B5F4D]">pass:</span> {shownPassword}
                  </code>
                  <button
                    data-testid="opds-copy-password"
                    onClick={() => copy(shownPassword, "pass")}
                    className="p-1.5 hover:bg-white rounded"
                    title="Copy password"
                  >
                    {copiedField === "pass" ? <Check className="w-3 h-3 text-[#1F4D2A]" /> : <Copy className="w-3 h-3 text-[#5B5F4D]" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              data-testid="opds-regen-btn"
              onClick={regenerate}
              disabled={busy}
              className="btn-secondary text-xs inline-flex items-center gap-1"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {status.has_password ? "Regenerate password" : "Generate"}
            </button>
            <button
              data-testid="opds-help-toggle"
              onClick={() => setShowHelp((v) => !v)}
              className="btn-secondary text-xs inline-flex items-center gap-1"
            >
              {showHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Setup instructions
            </button>
          </div>

          {showHelp && (
            <div className="mt-3 text-xs text-[#5B5F4D] space-y-2 bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg p-3" data-testid="opds-help">
              <p><strong className="text-[#2C2C2C]">KOReader</strong>: Top menu → Search → Browse OPDS catalog → New catalog → paste URL + username (email) + password.</p>
              <p><strong className="text-[#2C2C2C]">Moon+ Reader</strong>: Net Library → New net library → OPDS Catalog → paste URL + Basic credentials.</p>
              <p><strong className="text-[#2C2C2C]">Marvin / Foliate / Librera</strong>: Add OPDS / Calibre catalog → use the same URL, username, password.</p>
              <p>
                <strong className="text-[#2C2C2C]">Kindle (stock)</strong>: Kindle doesn&apos;t speak OPDS natively, but you have three options:
              </p>
              <ul className="list-disc pl-5 text-[#5B5F4D] space-y-0.5">
                <li><strong className="text-[#2C2C2C]">Send-to-Kindle email</strong>: download the EPUB from your library, email it to <code className="text-[#6B46C1]">your-name@kindle.com</code> (Amazon&apos;s built-in service). Book appears within ~5 min.</li>
                <li><strong className="text-[#2C2C2C]">Jailbroken Kindle + KOReader</strong>: install KOReader on the Kindle, then follow the KOReader steps above.</li>
                <li><strong className="text-[#2C2C2C]">Calibre + USB</strong>: download EPUB → Calibre → plug Kindle in via USB → send.</li>
              </ul>
              <p>
                <strong className="text-[#2C2C2C]">Amazon Fire (Kindle Fire, HD, Tablet)</strong>: install <em>Moon+ Reader</em> or <em>Librera</em> from the Amazon Appstore (or sideload), then follow the steps above for that reader.
              </p>
              <p className="text-[#5B5F4D] italic">If your reader fails to connect, double-check the password was copied without trailing spaces, and that the toggle above is on.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
