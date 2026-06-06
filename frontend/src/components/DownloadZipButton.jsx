import React, { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { API } from "../lib/api";
import { toast } from "sonner";

// Streaming-aware "Download ZIP" button.
//
// The backend ships the library zip via stream-zip / chunked transfer, so
// we can read the response body chunk-by-chunk and show MB transferred
// live in a sonner toast — much friendlier than a silent browser progress
// bar for a multi-minute download on a big library. Includes a Cancel
// button on the toast so an accidental click on a 5 GB library is recoverable.
export default function DownloadZipButton() {
  const [downloading, setDownloading] = useState(false);
  const abortRef = useRef(null);

  const fmt = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const start = async () => {
    if (downloading) return;
    setDownloading(true);

    const toastId = `zip-${Date.now()}`;
    const startedAt = Date.now();
    let bytesReceived = 0;

    const controller = new AbortController();
    abortRef.current = controller;
    const cancel = () => {
      controller.abort();
      toast.dismiss(toastId);
    };

    const showProgress = () => {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      toast.loading(
        `Streaming your library… ${fmt(bytesReceived)} so far · ${elapsed}s`,
        {
          id: toastId,
          duration: 60000,
          action: { label: "Cancel", onClick: cancel },
        },
      );
    };

    try {
      showProgress();
      const resp = await fetch(`${API}/books/export/zip`, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${text ? ` — ${text.slice(0, 120)}` : ""}`);
      }
      if (!resp.body) {
        throw new Error("Streaming not supported in this browser");
      }

      const reader = resp.body.getReader();
      const chunks = [];
      let lastTick = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesReceived += value.byteLength;
        // Throttle UI updates to ~3/sec
        const now = Date.now();
        if (now - lastTick > 300) {
          showProgress();
          lastTick = now;
        }
      }

      const blob = new Blob(chunks, { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shelfsort_library.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the download has a chance to attach.
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      toast.success(
        `Downloaded ${fmt(bytesReceived)} · ${Math.floor((Date.now() - startedAt) / 1000)}s`,
        { id: toastId },
      );
    } catch (e) {
      if (e.name === "AbortError" || controller.signal.aborted) {
        // User-cancelled — friendlier message, not an error.
        toast(
          `Download cancelled${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""}`,
          { id: toastId },
        );
      } else {
        // eslint-disable-next-line no-console
        console.error(e);
        toast.error(
          `Download failed${bytesReceived > 0 ? ` after ${fmt(bytesReceived)}` : ""} — ${e.message || "try again"}`,
          { id: toastId },
        );
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={start}
      disabled={downloading}
      data-testid="navbar-download-zip"
      className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-60"
      title="Stream-download organized ZIP of your library"
    >
      {downloading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      <span className="hidden md:inline">
        {downloading ? "Streaming…" : "Download ZIP"}
      </span>
    </button>
  );
}
