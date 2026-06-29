import React, { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, BellOff, Bell, Info } from "lucide-react";
import { api } from "../lib/api";

/**
 * In-app notification mute matrix. Renders the full catalog of known
 * notification kinds grouped by section, with a checkbox per row.
 * Critical (non-mutable) kinds are shown but disabled with a tooltip.
 *
 * Lives on /account/emails as a sibling to the email-channel cards.
 */
export default function NotificationMuteMatrix() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [muted, setMuted] = useState(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/user/notification-mutes");
      setCatalog(data?.catalog || []);
      setMuted(new Set(data?.muted_kinds || []));
    } catch (e) {
      console.error("notification-mutes load failed", e);
      toast.error("Couldn't load notification preferences");
    }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (nextMuted) => {
    setSaving(true);
    try {
      const { data } = await api.put("/user/notification-mutes", {
        muted_kinds: Array.from(nextMuted),
      });
      setMuted(new Set(data?.muted_kinds || []));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
      // Revert by reloading the truth from the server.
      load();
    } finally { setSaving(false); }
  };

  const toggle = (kind) => {
    const next = new Set(muted);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setMuted(next); // optimistic
    save(next);
  };

  // Group rows by `group` while preserving catalog ordering.
  const groups = useMemo(() => {
    const out = new Map();
    for (const row of catalog) {
      if (!out.has(row.group)) out.set(row.group, []);
      out.get(row.group).push(row);
    }
    return Array.from(out.entries());
  }, [catalog]);

  const mutedCount = muted.size;

  if (loading) {
    return (
      <section className="shelf-card p-5 mb-5">
        <div className="text-sm text-[#5B5F4D] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading notification preferences…</div>
      </section>
    );
  }

  return (
    <section className="shelf-card p-5 mb-5" data-testid="notification-mutes-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-serif text-lg text-[#2C2C2C] flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#6B46C1]" />
            In-app notifications
          </h3>
          <p className="text-xs text-[#5B5F4D] mt-0.5">
            All notifications fire by default. Mute any kind you don&apos;t want pinging the bell. Email preferences live above.
          </p>
        </div>
        {mutedCount > 0 && (
          <span
            data-testid="muted-count"
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FBE9E5] text-[#B43F26] inline-flex items-center gap-1"
          >
            <BellOff className="w-3 h-3" />
            {mutedCount} muted
          </span>
        )}
      </div>

      <div className="space-y-4">
        {groups.map(([groupName, rows]) => (
          <div key={groupName} data-testid={`mute-group-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B5F4D] mb-1.5">{groupName}</p>
            <ul className="space-y-1">
              {rows.map((row) => {
                const isMuted = muted.has(row.kind);
                const disabled = !row.mutable;
                return (
                  <li
                    key={row.kind}
                    data-testid={`mute-row-${row.kind}`}
                    className={`flex items-start justify-between gap-3 px-3 py-2 rounded-lg border ${
                      disabled ? "border-[#EFEAE0] bg-[#FBFAF6]" : "border-[#E8E6E1] bg-white hover:border-[#6B46C1] transition-colors"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${disabled ? "text-[#5B5F4D]" : "text-[#2C2C2C]"}`}>
                        {row.label}
                      </p>
                      <p className="text-[11px] text-[#5B5F4D]">{row.description}</p>
                      {disabled && (
                        <p className="text-[10px] text-[#B87A00] mt-0.5 flex items-center gap-1">
                          <Info className="w-3 h-3" />
                          Critical — can&apos;t be muted
                        </p>
                      )}
                    </div>
                    <label className={`flex-shrink-0 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        data-testid={`mute-toggle-${row.kind}`}
                        disabled={disabled || saving}
                        checked={isMuted}
                        onChange={() => !disabled && toggle(row.kind)}
                        className="sr-only peer"
                      />
                      <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isMuted ? "bg-[#B43F26]" : "bg-[#E8E6E1]"
                      }`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          isMuted ? "translate-x-6" : "translate-x-1"
                        }`} />
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {saving && (
        <p className="text-[10px] text-[#5B5F4D] mt-2 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </p>
      )}
    </section>
  );
}
