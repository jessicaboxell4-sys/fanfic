import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Gauge, Loader2 } from "lucide-react";
import { api } from "../lib/api";

const SAVE_DEBOUNCE_MS = 500;

const PRESETS = [
  { label: "Slow", wpm: 180 },
  { label: "Average", wpm: 250 },
  { label: "Fast", wpm: 350 },
  { label: "Speed reader", wpm: 500 },
];

/**
 * /account/appearance card for adjusting words-per-minute, which drives
 * every "X min remaining" estimate across the app.
 */
export default function WpmCard() {
  const [wpm, setWpm] = useState(250);
  const [min, setMin] = useState(80);
  const [max, setMax] = useState(1500);
  const [defaultWpm, setDefaultWpm] = useState(250);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Tracks the last value we successfully persisted so the debounced effect
  // skips redundant PUTs (initial load, presets that save immediately).
  const lastSavedRef = useRef(null);

  useEffect(() => {
    api.get("/user/wpm")
      .then(({ data }) => {
        setWpm(data.words_per_minute);
        setMin(data.min);
        setMax(data.max);
        setDefaultWpm(data.default);
        lastSavedRef.current = data.words_per_minute;
      })
      .catch((e) => {
        console.error("wpm load failed", e);
        toast.error("Couldn't load reading speed");
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (value) => {
    if (value === lastSavedRef.current) return;
    setSaving(true);
    try {
      const { data } = await api.put("/user/wpm", { words_per_minute: value });
      lastSavedRef.current = data.words_per_minute;
      setWpm(data.words_per_minute);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSaving(false); }
  };

  // Debounced auto-save: any change to `wpm` (slider drag, keyboard arrows,
  // typing into the number input, preset click) is persisted 500ms after the
  // user stops changing it.  Avoids hammering /user/wpm during a drag.
  useEffect(() => {
    if (loading) return;
    if (wpm === lastSavedRef.current) return;
    const id = setTimeout(() => { save(wpm); }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wpm, loading]);

  if (loading) {
    return (
      <section className="shelf-card p-6 mb-6">
        <p className="text-sm text-[#5B5F4D] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading reading-speed setting…</p>
      </section>
    );
  }

  return (
    <section
      id="wpm"
      data-testid="wpm-card"
      className="shelf-card p-6 mb-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#FBFAF6] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <Gauge className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Reading speed</h2>
          <p className="text-sm text-[#5B5F4D] mt-0.5">
            Used for every &quot;minutes remaining&quot; estimate. Default is {defaultWpm} words per minute.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <input
          type="range"
          min={min}
          max={max}
          step={10}
          value={wpm}
          onChange={(e) => setWpm(parseInt(e.target.value, 10))}
          data-testid="wpm-slider"
          className="flex-1 accent-[#6B46C1]"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={10}
          value={wpm}
          onChange={(e) => setWpm(parseInt(e.target.value, 10))}
          onBlur={(e) => {
            let v = parseInt(e.target.value, 10);
            if (Number.isNaN(v)) v = defaultWpm;
            v = Math.max(min, Math.min(max, v));
            setWpm(v);
          }}
          data-testid="wpm-input"
          className="w-20 px-2 py-1.5 bg-white border border-[#E5DDC5] rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
        />
        <span className="text-xs text-[#5B5F4D]">wpm</span>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="wpm-presets">
        {PRESETS.map((p) => (
          <button
            key={p.wpm}
            data-testid={`wpm-preset-${p.wpm}`}
            onClick={() => { setWpm(p.wpm); }}
            disabled={saving}
            className={`px-3 py-1 rounded-full text-xs border transition ${
              wpm === p.wpm
                ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                : "bg-white text-[#5B5F4D] border-[#E5DDC5] hover:border-[#6B46C1]"
            }`}
          >
            {p.label} · {p.wpm}
          </button>
        ))}
      </div>
      {saving && <p className="text-[10px] text-[#5B5F4D] mt-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</p>}
    </section>
  );
}
