// ════════════════════════════════════════════════════════════════════════
// Kian Portal — lead-tier domain: quotes, support messages, file links, offers.
// Quotes write to the DB and mirror to the existing Google Sheet during the
// transition (roadmap decision §7.2); the mirror is best-effort and never
// fails the portal submission.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppost, ppatch, enc, currentUserId, type Result } from "@/lib/portal/client";
import { makeRef, submitToSheets, SHEETS_ENDPOINT } from "@/lib/submitForm";
import type { FileLink, MessageRow, Offer, QuoteRequest } from "@/lib/portal/types";

// ─── Quotes ───
export interface NewQuoteInput {
  services: string[];
  description?: string;
  budget_range?: string;
  city?: string;
  preferred_date?: string;       // ISO date
  /** Contact info from the logged-in profile — forwarded to the Apps Script so
   *  the email notification matches the main-site hero form's payload shape. */
  contact?: { fullName?: string; company?: string; mobile?: string; email?: string; preferredContact?: string };
  language?: "AR" | "EN";
  /** extra fields forwarded only to the Google Sheet mirror */
  sheetExtras?: Record<string, string>;
}

/** Supabase is the source of truth; the Sheet is an optional temporary backup. */
export interface CreateQuoteResult {
  row: QuoteRequest;
  /** "ok" = backup mirror request left the browser (no-cors opaque) · "failed" = threw/skipped */
  sheetMirror: "ok" | "failed";
  /** Hard local proof of the mirror attempt — surfaced on the success card on localhost only. */
  debug: {
    endpointPresent: boolean;
    submitCalled: boolean;
    reference: string;
    source: string;
    resultType: string;   // "sent (opaque/no-cors)" | "error:…" | "throw:…"
  };
}

export function listMyQuotes(): Promise<Result<QuoteRequest[]>> {
  return pget<QuoteRequest[]>(`quote_requests?select=*&order=created_at.desc`);
}

export async function createQuote(input: NewQuoteInput): Promise<Result<CreateQuoteResult>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };

  const reference = makeRef("quote");

  // 1) Source of truth: insert into Supabase first. If THIS fails, the whole
  //    submission fails — the Sheet mirror can never make a submission "succeed".
  const r = await ppost<QuoteRequest[]>(`quote_requests`, {
    user_id: uid,
    reference,
    services: input.services,
    description: input.description ?? null,
    budget_range: input.budget_range ?? null,
    city: input.city ?? null,
    preferred_date: input.preferred_date ?? null,
    // Persist the requester's contact ON the row so notifications can reach the
    // client (the WhatsApp/email confirmation reads quote_requests.phone/email).
    // Without this the row had no phone → the delivery row was "no_phone".
    full_name: input.contact?.fullName?.trim() || null,
    company: input.contact?.company?.trim() || null,
    phone: input.contact?.mobile?.trim() || null,
    email: input.contact?.email?.trim() || null,
    preferred_contact: input.contact?.preferredContact || null,
    source: "portal_client_quote",
    sheet_mirrored: false,
  });
  if (!r.ok) return r;
  const row = r.data[0];
  if (!row) return { ok: false, error: "insert returned no row" };

  // 2) Optional backup + email notification → existing Apps Script (the SAME
  //    flow the main-site hero quote form uses). The Apps Script builds Kian's
  //    email from the contact fields, so the payload MUST mirror the hero form's
  //    key shape (Full Name / Company / Mobile / Email / …). Best-effort:
  //    a failure here NEVER fails the submission; we just report it to the UI.
  const endpointPresent = typeof SHEETS_ENDPOINT === "string" && SHEETS_ENDPOINT.startsWith("https://");
  let submitCalled = false;
  let resultType = "not-attempted";
  let sheetMirror: "ok" | "failed" = "failed";
  try {
    const c = input.contact ?? {};
    submitCalled = true;
    // EXACT same key set as the main-site hero quote form (app/quote-request),
    // so the Apps Script's email handler sees an identical payload shape.
    // Fields the portal doesn't collect are sent empty (not omitted) to keep
    // the shape identical. "Source" is an extra trailing key for traceability.
    const m = await submitToSheets("quote", {
      "Reference": reference,
      "Full Name": c.fullName ?? "",
      "Company": c.company ?? "",
      "Mobile": c.mobile ?? "",
      "Email": c.email ?? "",
      "City": input.city ?? "",
      "Service Type": input.services.join(", "),
      "Shooting Days": "",
      "Crew": "",
      "Drone": "",
      "Editing": "",
      "Voice Over": "",
      "Motion Graphics": "",
      "Description": input.description ?? "",
      "Budget": input.budget_range ?? "",
      "Delivery Date": input.preferred_date ?? "",
      "How did you hear about us": "",
      "Lead Source": "",
      "Priority": "",
      "Language": input.language ?? "AR",
      "Source": "client-portal",
      ...(input.sheetExtras ?? {}),
    });
    sheetMirror = m.ok ? "ok" : "failed";
    resultType = m.ok ? "sent (opaque/no-cors)" : ("error:" + (m.error || "unknown"));
  } catch (e) { sheetMirror = "failed"; resultType = "throw:" + String(e); }

  // 3) Reflect mirror success on the row (best-effort; failure is ignored).
  if (sheetMirror === "ok") {
    try { await ppatch<QuoteRequest[]>(`quote_requests?id=eq.${enc(row.id)}`, { sheet_mirrored: true }); } catch { /* non-fatal */ }
  }

  return {
    ok: true,
    data: {
      row,
      sheetMirror,
      debug: { endpointPresent, submitCalled, reference, source: "client-portal", resultType },
    },
  };
}

// ─── Support messages (one thread per user) ───
export function listMyMessages(): Promise<Result<MessageRow[]>> {
  return pget<MessageRow[]>(`messages?select=*&order=created_at.asc`);
}

export async function sendMessage(body: string): Promise<Result<MessageRow>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<MessageRow[]>(`messages`, { user_id: uid, sender: "user", body });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── File / link submissions ───
export function listMyFiles(): Promise<Result<FileLink[]>> {
  return pget<FileLink[]>(`file_links?select=*&order=created_at.desc`);
}

export async function addFileLink(url: string, label?: string, projectId?: string): Promise<Result<FileLink>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<FileLink[]>(`file_links`, {
    user_id: uid,
    url,
    label: label ?? null,
    project_id: projectId ?? null,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Offers (RLS filters by audience + published; empty at launch) ───
export function listOffers(): Promise<Result<Offer[]>> {
  return pget<Offer[]>(`offers?select=*&order=created_at.desc`);
}
