import React, { useEffect, useMemo, useState } from "react";
import { Smartphone, Loader2 } from "lucide-react";
import { api } from "../lib/api";

/**
 * <DevicePicker />
 *
 * Required field on the suggestion submit form.  Surfaces the list
 * of known devices (built-in + previously-typed custom) from
 * GET /api/suggestions/devices, with an "Other (type in)..." mode
 * that lets a user add a brand-new device name which the backend
 * persists so the next user sees it.
 *
 * Behaviour:
 *   - On mount, fetches the list and tries to auto-detect via
 *     navigator.userAgent (cheap signature match, falls back to
 *     localStorage('shelfsort_device_last') so repeat submitters
 *     don't re-pick every time).
 *   - Calls ``onChange(canonicalName | "")`` whenever the selection
 *     resolves to a real device name (built-in match, existing
 *     custom, or filled-in "Other" input ≥1 char).
 *
 * Props:
 *   - ``value`` (string)            current selection (controlled)
 *   - ``onChange`` (fn)             called with new value
 *   - ``disabled`` (bool)           submit-in-flight lockout
 *   - ``testidPrefix`` (string)     so multiple instances on the
 *                                   same page (Suggestions, Dashboard
 *                                   feedback box) don't collide on
 *                                   data-testid.  Default
 *                                   ``"device-picker"``.
 */
const LOCAL_STORAGE_KEY = "shelfsort_device_last";

// Quick UA → display name guess.  We only use this to PRE-FILL the
// dropdown — the user can always change it.  Order matters: more-
// specific signatures (iPad before Mac, iPhone before mobile, Fire
// before Android) come first.
function guessFromUserAgent(ua, candidates) {
  const u = (ua || "").toLowerCase();
  const has = (s) => u.includes(s);
  // Map UA fragments → candidate names we'd expect to see in the list.
  // We match these against ``candidates`` case-insensitively; if the
  // candidate isn't in the list (e.g. backend dropped it), skip.
  const tries = [
    [["ipad"], "iPad"],
    [["iphone"], "iPhone"],
    [["ipod"], "iPhone"],
    [["silk", "kftt", "kfthwi", "kfsuwi", "kfauwi"], "Amazon Fire (Kindle Fire, Fire HD, Fire Tablet)"],
    [["kindle"], "Kindle e-reader"],
    [["android"], has("mobile") ? "Android phone" : "Android tablet"],
    [["cros"], "Chromebook"],
    [["mac os", "macintosh"], "Mac"],
    [["windows"], "Windows PC"],
    [["linux"], "Linux"],
  ];
  const lowerCandidates = new Set(candidates.map((c) => c.toLowerCase()));
  for (const [frags, name] of tries) {
    if (frags.some(has) && lowerCandidates.has(name.toLowerCase())) {
      return name;
    }
  }
  return null;
}

const OTHER_SENTINEL = "__other__";

export default function DevicePicker({
  value,
  onChange,
  disabled = false,
  testidPrefix = "device-picker",
}) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");

  // Load device list + auto-detect on first render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/suggestions/devices");
        if (cancelled) return;
        const list = data?.devices || [];
        setDevices(list);
        // If there's nothing in ``value`` yet, try to pick a default:
        //   1. localStorage last-used (so repeat submitters skip the dance)
        //   2. UA signature
        //   3. leave blank (user has to choose explicitly — required field)
        if (!value && list.length) {
          let pick = null;
          try {
            const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY) || "";
            if (stored && list.find((d) => d.toLowerCase() === stored.toLowerCase())) {
              pick = list.find((d) => d.toLowerCase() === stored.toLowerCase());
            }
          } catch {/* private mode */}
          if (!pick) {
            pick = guessFromUserAgent(navigator.userAgent || "", list);
          }
          if (pick) onChange(pick);
        }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || e?.message || "Couldn't load device list");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // We only want this on mount — the dropdown is otherwise controlled.
  }, []);

  // Persist the most-recent valid selection so the next visit pre-fills.
  useEffect(() => {
    if (!value) return;
    try { window.localStorage.setItem(LOCAL_STORAGE_KEY, value); } catch {/* */}
  }, [value]);

  const selectValue = useMemo(() => {
    if (otherMode) return OTHER_SENTINEL;
    if (value && devices.find((d) => d === value)) return value;
    // Value is set but not in the list (user typed "Steam Deck" and
    // backend hasn't returned the refreshed list yet).  Surface in
    // Other mode so the input stays visible.
    if (value) return OTHER_SENTINEL;
    return "";
  }, [otherMode, value, devices]);

  const onSelectChange = (e) => {
    const v = e.target.value;
    if (v === OTHER_SENTINEL) {
      setOtherMode(true);
      setOtherText(value && !devices.includes(value) ? value : "");
      onChange("");
      return;
    }
    setOtherMode(false);
    onChange(v);
  };

  const onOtherInputChange = (e) => {
    const txt = e.target.value.slice(0, 40);
    setOtherText(txt);
    onChange(txt.trim());
  };

  return (
    <div data-testid={`${testidPrefix}-wrap`} className="mb-2">
      <label
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B705C] mb-1"
        htmlFor={`${testidPrefix}-select`}
      >
        <Smartphone className="w-3 h-3" />
        Device · required
      </label>
      <div className="flex items-center gap-2">
        <select
          id={`${testidPrefix}-select`}
          data-testid={`${testidPrefix}-select`}
          value={selectValue}
          onChange={onSelectChange}
          disabled={disabled || loading}
          required
          className="text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 min-w-[14rem]"
        >
          <option value="" disabled>
            {loading ? "Loading devices…" : "Choose your device"}
          </option>
          {devices.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
          <option value={OTHER_SENTINEL}>Other (type in)…</option>
        </select>
        {otherMode && (
          <input
            type="text"
            value={otherText}
            onChange={onOtherInputChange}
            placeholder="e.g. Steam Deck, BOOX Note, Surface Duo"
            data-testid={`${testidPrefix}-other-input`}
            disabled={disabled}
            maxLength={40}
            className="text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 flex-1 min-w-0"
          />
        )}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6B705C]" />}
      </div>
      {error ? (
        <p className="text-xs text-rose-600 mt-1" data-testid={`${testidPrefix}-error`}>
          {error}
        </p>
      ) : null}
      {otherMode ? (
        <p className="text-[10px] text-[#6B705C] mt-1">
          Your device will be added to the picker so other people can choose it too.
        </p>
      ) : null}
    </div>
  );
}
