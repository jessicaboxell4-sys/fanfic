import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Sparkles, BookOpen, Smartphone, Tablet, Laptop, MonitorSmartphone } from "lucide-react";

/**
 * <CrossDeviceFinishStrip />
 *
 * The "you finished this on your iPhone — want a similar one?" moment.
 * Appears immediately below the cross-device hint on BookDetail when:
 *   1. progress_fraction >= 0.9 (near-finished or just finished)
 *   2. book.last_device_id is set and different from this device's
 *      shelfsort-device-id (the same logic the cross-device hint uses)
 *   3. last_cursor_updated_at is within 14 days
 *   4. /api/recommendations/similar returns at least one match
 *
 * Compact 3-card horizontal rail — distinct from the bottom-of-page
 * <SimilarBooksStrip /> which is a 6-card grid for browsing.  This
 * one captures the *moment of completion* the user is having right
 * now on their other device.
 *
 * Hides silently when no matches exist (no empty state — the page
 * shouldn't punish someone with a single-fandom library).
 */
function pickDeviceIcon(label) {
  const L = (label || "").toLowerCase();
  if (L.includes("iphone") || L.includes("android")) return Smartphone;
  if (L.includes("ipad")) return Tablet;
  if (L.includes("mac") || L.includes("windows")) return Laptop;
  return MonitorSmartphone;
}

export default function CrossDeviceFinishStrip({ book }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(false);

  // Compute eligibility once per render — cheap, no need to memoize.
  const progress = book?.progress_fraction ?? 0;
  const eligibleByProgress = progress >= 0.9;
  const hasDeviceMeta = !!(book?.last_device_id && book?.last_device_label);
  let isCrossDevice = false;
  if (hasDeviceMeta) {
    let myDevice = "";
    try { myDevice = window.localStorage.getItem("shelfsort-device-id") || ""; } catch {/* private mode */}
    isCrossDevice = !!myDevice && myDevice !== book.last_device_id;
  }
  const updated = book?.last_cursor_updated_at;
  const ageDays = updated ? (Date.now() - new Date(updated).getTime()) / 86_400_000 : 999;
  const fresh = ageDays <= 14;
  const shouldFetch = eligibleByProgress && hasDeviceMeta && isCrossDevice && fresh && !!book?.book_id;

  useEffect(() => {
    if (!shouldFetch) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/recommendations/similar/${book.book_id}`, {
          params: { limit: 3 },
        });
        if (!cancelled) setRecs(data?.recommendations || []);
      } catch {
        // Silent — strip just doesn't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [book?.book_id, shouldFetch]);

  if (!shouldFetch || skip || loading || !recs.length) return null;

  const DeviceIcon = pickDeviceIcon(book.last_device_label);

  return (
    <section
      data-testid="cross-device-finish-strip"
      className="mb-4 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] p-4"
    >
      <header className="flex items-start gap-2 mb-3">
        <DeviceIcon className="w-4 h-4 text-[#6B46C1] mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B46C1] flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            {progress >= 0.95 ? "Finished on your " : "Reading on your "}
            {book.last_device_label}
          </p>
          <h3
            className="font-serif text-base text-[#2C2C2C] mt-0.5"
            data-testid="cross-device-finish-strip-title"
          >
            Want a similar one to read next?
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setSkip(true)}
          className="text-[10px] text-[#6B705C] hover:text-[#2C2C2C] underline self-start"
          data-testid="cross-device-finish-strip-dismiss"
          title="Hide this suggestion until the page is reopened"
        >
          Hide
        </button>
      </header>
      <div
        className="grid grid-cols-3 gap-2"
        data-testid="cross-device-finish-strip-grid"
      >
        {recs.map((r) => (
          <Link
            key={r.book_id}
            to={`/book/${r.book_id}`}
            data-testid={`cross-device-finish-card-${r.book_id}`}
            className="group flex gap-2 rounded-md border border-[#E5DDC5] bg-white hover:border-[#6B46C1] hover:shadow-sm transition-all overflow-hidden p-2"
          >
            <div className="w-10 h-14 flex-shrink-0 bg-[#FBFAF6] rounded flex items-center justify-center overflow-hidden">
              {r.has_cover ? (
                <img
                  src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${r.book_id}/cover`}
                  alt={`Cover of ${r.title}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <BookOpen className="w-4 h-4 text-[#C8C2B0]" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[#2C2C2C] line-clamp-2 leading-tight">
                {r.title}
              </p>
              {r.author && (
                <p className="text-[10px] text-[#6B705C] mt-0.5 line-clamp-1">{r.author}</p>
              )}
              <p
                className="text-[9px] text-[#6B46C1] mt-1 uppercase tracking-wider line-clamp-1"
                data-testid={`cross-device-finish-reason-${r.book_id}`}
              >
                {r.match_reason}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
