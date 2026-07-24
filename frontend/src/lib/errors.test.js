/* eslint-env jest */
/* global describe, test, expect */
/**
 * Regression test — humanizeAxiosError must not throw when the
 * upstream (Envoy / Cloudflare / nginx) returns a 5xx with a plain-TEXT
 * body instead of the usual JSON `{detail: "..."}`.
 *
 * Bug seen 2026-08-24 — 27 EPUB uploads failed with the literal
 *   "Cannot create property 'detail' on string 'upstream connect error
 *    or disconnect/reset before headers. reset reason: connection
 *    termination'"
 * appearing in the FailedUploadsList banner.  See api.js for full RCA.
 */
import { humanizeAxiosError } from "./errors";

describe("humanizeAxiosError — non-object 5xx body handling", () => {
  test("string body → coerced to object, .detail humanized, no throw", () => {
    const envoyErr = {
      response: {
        status: 503,
        data: "upstream connect error or disconnect/reset before headers. reset reason: connection termination",
      },
      message: "Request failed with status code 503",
    };
    // Must not throw.
    const out = humanizeAxiosError(envoyErr);
    expect(typeof out.response.data).toBe("object");
    expect(Array.isArray(out.response.data)).toBe(false);
    expect(out.response.data.detail).toMatch(/temporarily busy|try again/i);
    expect(out.message).toMatch(/temporarily busy|try again/i);
    expect(out.response.data.detail).not.toMatch(/upstream connect error/i);
    expect(out.message).not.toMatch(/upstream connect error/i);
  });

  test("array body → coerced to object, no throw", () => {
    const oddErr = {
      response: { status: 500, data: ["oops", "something"] },
      message: "Request failed with status code 500",
    };
    const out = humanizeAxiosError(oddErr);
    expect(typeof out.response.data).toBe("object");
    expect(Array.isArray(out.response.data)).toBe(false);
    expect(out.response.data.detail).toMatch(/something went wrong/i);
  });

  test("proper JSON body with real detail — preserved untouched", () => {
    const backendErr = {
      response: {
        status: 500,
        data: { detail: "Calibre crashed on this EPUB — try a fresh copy." },
      },
      message: "Request failed with status code 500",
    };
    const out = humanizeAxiosError(backendErr);
    expect(out.response.data.detail).toBe(
      "Calibre crashed on this EPUB — try a fresh copy.",
    );
  });

  test("empty/undefined body → coerced, humanized", () => {
    const err = { response: { status: 502, data: undefined }, message: "" };
    const out = humanizeAxiosError(err);
    expect(out.response.data.detail).toMatch(/servers|restarting/i);
  });

  test("network error (no response) → message humanized", () => {
    const netErr = { message: "Network Error" };
    const out = humanizeAxiosError(netErr);
    expect(out.message).toMatch(/couldn.t reach shelfsort/i);
  });

  test("4xx errors — untouched (FastAPI detail must reach caller)", () => {
    const err = {
      response: { status: 422, data: { detail: "email required" } },
      message: "Request failed with status code 422",
    };
    const out = humanizeAxiosError(err);
    expect(out.response.data.detail).toBe("email required");
    expect(out.message).toBe("Request failed with status code 422");
  });
});
