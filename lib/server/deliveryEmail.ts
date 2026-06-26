// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email provider abstraction for the delivery processor.
// Providers (selected by EMAIL_PROVIDER): resend | smtp | apps_script.
// Resend + Apps Script are fetch-only (no npm dep). SMTP uses nodemailer if it is
// installed (dynamic import); otherwise returns a clear skip. Never throws.
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/deliveryEmail is server-only");

export interface EmailSendResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  provider: string | null;
  messageId: string | null;
  error: string | null;     // skip_reason when status='skipped', else error message
}

export interface EmailMessage { to: string; subject: string; html: string; text: string; idempotencyKey?: string }

const FROM = () => process.env.EMAIL_FROM || "Kian Media <no-reply@kianmedia.com>";
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || "";

/** Which provider is configured (or null). */
export function emailProvider(): "resend" | "smtp" | "apps_script" | null {
  const p = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (p === "resend" && process.env.RESEND_API_KEY) return "resend";
  if (p === "smtp" && process.env.SMTP_HOST) return "smtp";
  if (p === "apps_script" && (process.env.APPS_SCRIPT_NOTIFY_URL || process.env.PORTAL_NOTIFY_ENDPOINT)) return "apps_script";
  // Auto-detect when EMAIL_PROVIDER is blank.
  if (!p) {
    if (process.env.RESEND_API_KEY) return "resend";
    if (process.env.SMTP_HOST) return "smtp";
    if (process.env.APPS_SCRIPT_NOTIFY_URL || process.env.PORTAL_NOTIFY_ENDPOINT) return "apps_script";
  }
  return null;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const provider = emailProvider();
  if (!provider) return { ok: false, status: "skipped", provider: null, messageId: null, error: "email_provider_missing" };
  try {
    if (provider === "resend") return await viaResend(msg);
    if (provider === "smtp") return await viaSmtp(msg);
    return await viaAppsScript(msg);
  } catch (e) {
    return { ok: false, status: "failed", provider, messageId: null, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

async function viaResend(msg: EmailMessage): Promise<EmailSendResult> {
  const body: Record<string, unknown> = { from: FROM(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text };
  if (REPLY_TO()) body.reply_to = REPLY_TO();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
      // Resend de-dupes on this key → a re-claimed row after a crash cannot double-send.
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify(body), cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) return { ok: false, status: "failed", provider: "resend", messageId: null, error: `resend_${res.status}:${j.message || ""}`.slice(0, 300) };
  return { ok: true, status: "sent", provider: "resend", messageId: j.id ?? null, error: null };
}

async function viaSmtp(msg: EmailMessage): Promise<EmailSendResult> {
  // Dynamic, non-statically-resolved import so the build never requires nodemailer.
  // Install it (`npm i nodemailer`) to enable SMTP; otherwise this returns a clean skip.
  let nodemailer: { createTransport: (o: unknown) => { sendMail: (m: unknown) => Promise<{ messageId?: string }> } };
  try { const mod = "nodemailer"; const lib = (await import(mod)) as { default?: unknown }; nodemailer = (lib.default ?? lib) as typeof nodemailer; }
  catch { return { ok: false, status: "skipped", provider: "smtp", messageId: null, error: "smtp_lib_missing" }; }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const info = await transport.sendMail({ from: FROM(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, replyTo: REPLY_TO() || undefined });
  return { ok: true, status: "sent", provider: "smtp", messageId: (info as { messageId?: string }).messageId ?? null, error: null };
}

// Google Apps Script web app (fire-and-forget; opaque response → 'sent' on HTTP ok, no id).
async function viaAppsScript(msg: EmailMessage): Promise<EmailSendResult> {
  const url = process.env.APPS_SCRIPT_NOTIFY_URL || process.env.PORTAL_NOTIFY_ENDPOINT;
  if (!url) return { ok: false, status: "skipped", provider: "apps_script", messageId: null, error: "email_provider_missing" };
  const payload: Record<string, unknown> = { _type: "portal_notify", To: msg.to, Subject: msg.subject, Body: msg.text, Html: msg.html };
  const secret = process.env.APPS_SCRIPT_NOTIFY_SECRET; if (secret) payload.secret = secret;
  await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), cache: "no-store" });
  return { ok: true, status: "sent", provider: "apps_script", messageId: null, error: null };
}
