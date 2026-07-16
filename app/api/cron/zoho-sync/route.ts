// ════════════════════════════════════════════════════════════════════════
// GET/POST /api/cron/zoho-sync — معالج طابور Zoho Books (SERVER-ONLY, CRON_SECRET).
//
// يقرأ zoho_sync_jobs (pending) وينفّذ حسب ZOHO_BOOKS_SYNC_MODE:
//   disabled → لا يلمس شيئًا (يُحدّث heartbeat فقط).
//   dry_run  → يبني Payload ويتحقق من الخرائط ويعلّم dry_run_ok / needs_review — لا إرسال.
//   live     → dedup (خرائط محلية ← بحث Zoho بالمرجع) ثم إنشاء القيد وربطه.
// لا Draft يُرحَّل (الـTriggers أصلًا لا تُدرج إلا approved/paid/invoiced).
// خريطة ناقصة ⇒ needs_review برسالة واضحة — لا Account عشوائي أبدًا.
// لا DELETE لقيود منشورة. لا أسرار في السجلات. «synced» فقط برد Zoho حقيقي.
// الجدولة يومية (Hobby-safe)؛ لتكرار أعلى شغّله خارجيًا بالسر (n8n).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { selectAsService, patchAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import {
  zohoSyncMode, booksSyncConfigured, booksFetch, findByReference, ensureContact, testConnection,
} from "@/lib/server/zohoBooksSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

type Job = {
  id: string; operation: string; local_entity_type: string; local_entity_id: string;
  project_id: string | null; payload: Record<string, unknown>; attempts: number; idempotency_key: string | null;
};
type Mapping = { kind: string; local_key: string; zoho_id: string };

async function mappings(): Promise<Record<string, Record<string, string>>> {
  const r = await selectAsService<Mapping[]>(`zoho_account_mappings?select=kind,local_key,zoho_id`);
  const out: Record<string, Record<string, string>> = {};
  if (r.ok && Array.isArray(r.data)) for (const m of r.data) { (out[m.kind] ??= {})[m.local_key] = m.zoho_id; }
  return out;
}
async function markJob(id: string, patch: Record<string, unknown>) {
  await patchAsService(`zoho_sync_jobs?id=eq.${id}`, { ...patch, updated_at: new Date().toISOString() });
}
async function upsertMapping(ltype: string, lid: string, ztype: string, zid: string, org: string | null, status = "synced", meta: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string }> {
  // upsert عبر PostgREST: on_conflict على القيد الفريد المحلي.
  const { postAsService } = await import("@/lib/server/zohoUpsert");
  return postAsService(
    `zoho_entity_mappings?on_conflict=local_entity_type,local_entity_id`,
    {
      local_entity_type: ltype, local_entity_id: lid, zoho_entity_type: ztype, zoho_entity_id: zid,
      organization_id: org, sync_status: status, last_synced_at: new Date().toISOString(),
      metadata: meta, updated_at: new Date().toISOString(),
    },
    { Prefer: "resolution=merge-duplicates,return=minimal" },
  );
}

type Expense = {
  id: string; description: string | null; category: string; supplier: string | null;
  amount_excl_vat: number; vat_amount: number; amount_incl_vat: number; recoverable_vat: boolean;
  expense_date: string; paid_date: string | null; payment_status?: string; receipt_url: string | null; currency: string;
};
type Revenue = {
  id: string; name: string; amount_excl_vat: number; vat_amount: number; amount_incl_vat: number;
  due_date: string | null; collected_date: string | null; collected_amount: number; status: string;
  reference_number?: string | null; payment_method?: string | null; project_id?: string;
};

async function clientForProject(projectId: string | null): Promise<{ name: string; email: string | null } | null> {
  if (!projectId) return null;
  const r = await selectAsService<Array<{ clients: { full_name: string | null; company: string | null; email?: string | null; email_is_placeholder?: boolean } | null }>>(
    `projects?id=eq.${projectId}&select=clients(full_name,company,email,email_is_placeholder)`);
  const c = r.ok && Array.isArray(r.data) ? r.data[0]?.clients : null;
  if (!c) return null;
  // بريد Placeholder داخلي لا يصل إلى دفاتر Zoho الرسمية أبدًا.
  const email = c.email_is_placeholder ? null : (c.email ?? null);
  return { name: c.company || c.full_name || "عميل كيان", email };
}

async function processJob(job: Job, maps: Record<string, Record<string, string>>, mode: "dry_run" | "live", orgId: string | null): Promise<void> {
  const missing: string[] = [];
  const need = (kind: string, key: string): string | null => {
    const v = maps[kind]?.[key] ?? maps[kind]?.["*"] ?? null;
    if (!v) missing.push(`${kind}:${key}`);
    return v;
  };

  if (job.operation === "create_expense" || job.operation === "create_bill") {
    const e = job.payload.expense as Expense | undefined;
    if (!e) { await markJob(job.id, { status: "failed", response_note: "payload_missing" }); return; }
    // منع الازدواج Bill/Expense لنفس المصروف.
    const dupType = job.operation === "create_expense" ? "bill" : "expense";
    const dup = await selectAsService<unknown[]>(`zoho_entity_mappings?local_entity_type=eq.${dupType}&local_entity_id=eq.${e.id}&select=id&limit=1`);
    if (dup.ok && Array.isArray(dup.data) && dup.data.length > 0) {
      await markJob(job.id, { status: "needs_review", response_note: `يوجد ${dupType} مرحَّل لنفس المصروف — راجع السياسة المحاسبية` });
      return;
    }
    const account = need("expense_account", e.category);
    const paidThrough = job.operation === "create_expense" ? need("paid_through", "default") : null;
    const tax = e.vat_amount > 0 ? need("tax", "vat15") : null;
    if (missing.length) {
      await markJob(job.id, { status: "needs_review", response_note: `خرائط ناقصة: ${missing.join(", ")}` });
      return;
    }
    const reference = job.idempotency_key ?? `KIAN-${job.operation === "create_bill" ? "BILL" : "EXPENSE"}-${e.id}`;
    const payload = job.operation === "create_bill"
      ? {
          vendor_name: e.supplier, reference_number: reference, date: e.expense_date,
          line_items: [{ account_id: account, rate: e.amount_excl_vat, quantity: 1,
            description: e.description ?? e.category, ...(tax ? { tax_id: tax } : {}) }],
          notes: `Kian expense ${e.id}`,
        }
      : {
          account_id: account, paid_through_account_id: paidThrough, date: e.paid_date ?? e.expense_date,
          amount: e.amount_excl_vat, ...(tax ? { tax_id: tax } : {}),
          is_inclusive_tax: false, reference_number: reference, description: e.description ?? e.category,
          ...(e.supplier ? { vendor_name: e.supplier } : {}),
        };
    if (mode === "dry_run") {
      await markJob(job.id, { status: "dry_run_ok", response_note: JSON.stringify(payload).slice(0, 900) });
      return;
    }
    const entity = job.operation === "create_bill" ? "bills" : "expenses";
    // dedup بالمرجع في Zoho قبل الإنشاء.
    const existing = await findByReference(entity, reference);
    if (existing) {
      await upsertMapping(job.operation === "create_bill" ? "bill" : "expense", e.id, entity.slice(0, -1), existing, orgId);
      await markJob(job.id, { status: "done", provider_id: existing, response_note: "linked_existing" });
      return;
    }
    let body = payload as Record<string, unknown>;
    if (job.operation === "create_bill" && e.supplier) {
      const v = await ensureContact("vendor", e.supplier);
      if (!v.ok) { await markJob(job.id, { status: "failed", response_note: `vendor: ${v.error}` }); return; }
      body = { ...payload, vendor_id: v.data!.contact_id }; delete (body as { vendor_name?: string }).vendor_name;
    }
    const r = await booksFetch<{ expense?: { expense_id: string }; bill?: { bill_id: string } }>(`/${entity}`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { await failJob(job, r.status, r.error); return; }
    const zid = r.data?.expense?.expense_id ?? r.data?.bill?.bill_id ?? "";
    const mp = await upsertMapping(job.operation === "create_bill" ? "bill" : "expense", e.id, entity.slice(0, -1), zid, orgId);
    // فشل كتابة الخريطة = خطر ازدواج لاحق ⇒ مراجعة لا «done» صامتة (القيد أُنشئ في Zoho فعلًا).
    await markJob(job.id, mp.ok
      ? { status: "done", provider_id: zid, response_code: r.status }
      : { status: "needs_review", provider_id: zid, response_note: `أُنشئ في Zoho (${zid}) لكن فشلت كتابة الربط — اربط يدويًا` });
    return;
  }

  if (job.operation === "vendor_payment") {
    const e = job.payload.expense as Expense | undefined;
    if (!e) { await markJob(job.id, { status: "failed", response_note: "payload_missing" }); return; }
    const bill = await selectAsService<Array<{ zoho_entity_id: string }>>(`zoho_entity_mappings?local_entity_type=eq.bill&local_entity_id=eq.${e.id}&select=zoho_entity_id&limit=1`);
    const billId = bill.ok && Array.isArray(bill.data) ? bill.data[0]?.zoho_entity_id : null;
    if (!billId) { await markJob(job.id, { status: "needs_review", response_note: "لا Bill مرتبطة — رحّل الفاتورة أولًا" }); return; }
    const paidThrough = need("paid_through", "default");
    if (missing.length) { await markJob(job.id, { status: "needs_review", response_note: `خرائط ناقصة: ${missing.join(", ")}` }); return; }
    const reference = job.idempotency_key ?? `KIAN-VPAY-${e.id}`;
    const payload = {
      vendor_id: undefined as unknown, amount: e.amount_incl_vat, date: e.paid_date ?? new Date().toISOString().slice(0, 10),
      paid_through_account_id: paidThrough, reference_number: reference,
      bills: [{ bill_id: billId, amount_applied: e.amount_incl_vat }],
    };
    if (mode === "dry_run") { await markJob(job.id, { status: "dry_run_ok", response_note: JSON.stringify(payload).slice(0, 900) }); return; }
    const existing = await findByReference("vendorpayments", reference);
    if (existing) { await markJob(job.id, { status: "done", provider_id: existing, response_note: "linked_existing" }); return; }
    // vendor_id من الـBill.
    const b = await booksFetch<{ bill?: { vendor_id: string } }>(`/bills/${billId}`, { method: "GET" });
    if (!b.ok || !b.data?.bill?.vendor_id) { await failJob(job, b.status, b.error ?? "bill_fetch_failed"); return; }
    payload.vendor_id = b.data.bill.vendor_id;
    const r = await booksFetch<{ payment?: { payment_id: string } }>(`/vendorpayments`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) { await failJob(job, r.status, r.error); return; }
    await upsertMapping("vendor_payment", e.id, "vendorpayment", r.data?.payment?.payment_id ?? "", orgId);
    await markJob(job.id, { status: "done", provider_id: r.data?.payment?.payment_id ?? "", response_code: r.status });
    return;
  }

  if (job.operation === "invoice_upsert" || job.operation === "customer_payment") {
    const rev = job.payload.revenue as Revenue | undefined;
    if (!rev) { await markJob(job.id, { status: "failed", response_note: "payload_missing" }); return; }
    let income: string | null = null, tax: string | null = null;
    if (job.operation === "invoice_upsert") {
      income = need("income_account", "revenue");
      tax = rev.vat_amount > 0 ? need("tax", "vat15") : null;
      if (missing.length) { await markJob(job.id, { status: "needs_review", response_note: `خرائط ناقصة: ${missing.join(", ")}` }); return; }
    }
    const client = await clientForProject(job.project_id);
    if (!client) { await markJob(job.id, { status: "needs_review", response_note: "لا عميل مرتبط بالمشروع" }); return; }

    // Invoice: ربط أو إنشاء.
    const invRef = `KIAN-INVOICE-${rev.id}`;
    let invId: string | null = null;
    const m = await selectAsService<Array<{ zoho_entity_id: string }>>(`zoho_entity_mappings?local_entity_type=eq.invoice&local_entity_id=eq.${rev.id}&select=zoho_entity_id&limit=1`);
    invId = m.ok && Array.isArray(m.data) ? (m.data[0]?.zoho_entity_id ?? null) : null;
    if (!invId && mode === "live") invId = await findByReference("invoices", invRef);

    if (job.operation === "invoice_upsert") {
      const payload = {
        reference_number: invRef, date: new Date().toISOString().slice(0, 10),
        due_date: rev.due_date ?? undefined,
        line_items: [{ name: rev.name, rate: rev.amount_excl_vat, quantity: 1,
          ...(income ? { account_id: income } : {}), ...(tax ? { tax_id: tax } : {}) }],
        notes: `Kian revenue ${rev.id}`,
      };
      if (mode === "dry_run") { await markJob(job.id, { status: "dry_run_ok", response_note: JSON.stringify(payload).slice(0, 900) }); return; }
      if (invId) {
        await upsertMapping("invoice", rev.id, "invoice", invId, orgId);
        await markJob(job.id, { status: "done", provider_id: invId, response_note: "linked_existing" });
        return;
      }
      const c = await ensureContact("customer", client.name, client.email);
      if (!c.ok) { await failJob(job, undefined, `customer: ${c.error}`); return; }
      const r = await booksFetch<{ invoice?: { invoice_id: string } }>(`/invoices`, {
        method: "POST", body: JSON.stringify({ ...payload, customer_id: c.data!.contact_id }),
      });
      if (!r.ok) { await failJob(job, r.status, r.error); return; }
      const zi = r.data?.invoice?.invoice_id ?? "";
      const mp = await upsertMapping("invoice", rev.id, "invoice", zi, orgId);
      await markJob(job.id, mp.ok
        ? { status: "done", provider_id: zi, response_code: r.status }
        : { status: "needs_review", provider_id: zi, response_note: `أُنشئت الفاتورة (${zi}) لكن فشلت كتابة الربط — اربط يدويًا` });
      return;
    }

    // customer_payment — يتطلب Invoice مرتبطة.
    const delta = Number(job.payload.delta ?? rev.collected_amount) || 0;
    if (delta <= 0) { await markJob(job.id, { status: "cancelled", response_note: "delta<=0" }); return; }
    const payRef = job.idempotency_key ?? `KIAN-PAYMENT-${rev.id}`;
    const paidThrough = need("paid_through", rev.payment_method ?? "default") ?? need("paid_through", "default");
    if (!invId) { await failJob(job, undefined, "لا Invoice مرتبطة بعد — ستُعاد المحاولة"); return; }
    const payload = {
      customer_id: undefined as unknown, payment_mode: rev.payment_method ?? "banktransfer",
      amount: delta, date: rev.collected_date ?? new Date().toISOString().slice(0, 10),
      reference_number: payRef, ...(paidThrough ? { account_id: paidThrough } : {}),
      invoices: [{ invoice_id: invId, amount_applied: delta }],
    };
    if (mode === "dry_run") { await markJob(job.id, { status: "dry_run_ok", response_note: JSON.stringify(payload).slice(0, 900) }); return; }
    const existing = await findByReference("customerpayments", payRef);
    if (existing) { await markJob(job.id, { status: "done", provider_id: existing, response_note: "linked_existing" }); return; }
    const inv = await booksFetch<{ invoice?: { customer_id: string } }>(`/invoices/${invId}`, { method: "GET" });
    if (!inv.ok || !inv.data?.invoice?.customer_id) { await failJob(job, inv.status, inv.error ?? "invoice_fetch_failed"); return; }
    payload.customer_id = inv.data.invoice.customer_id;
    const r = await booksFetch<{ payment?: { payment_id: string } }>(`/customerpayments`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) { await failJob(job, r.status, r.error); return; }
    await upsertMapping("customer_payment", rev.id, "customerpayment", r.data?.payment?.payment_id ?? "", orgId, "synced", { reference: payRef });
    await markJob(job.id, { status: "done", provider_id: r.data?.payment?.payment_id ?? "", response_code: r.status });
    return;
  }

  await markJob(job.id, { status: "failed", response_note: `unknown_operation:${job.operation}` });
}

async function failJob(job: Job, status: number | undefined, err: string | undefined) {
  const attempts = (job.attempts ?? 0) + 1;
  await markJob(job.id, {
    status: attempts >= 5 ? "failed" : "pending", attempts,
    response_code: status ?? null, response_note: (err ?? "request_failed").slice(0, 300),
    next_attempt_at: new Date(Date.now() + 10 * Math.pow(2, attempts) * 60_000).toISOString(),
  });
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "cron_secret_not_configured" }, { status: 500 });
  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : url.searchParams.get("secret") ?? "";
  if (provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  const mode = zohoSyncMode();
  const configured = booksSyncConfigured();

  // Heartbeat + فحص اتصال (يُغذي واجهة الإعدادات).
  let orgId: string | null = null;
  if (configured) {
    const tst = await testConnection();
    orgId = tst.ok ? tst.data!.organization_id : null;
    await patchAsService(`zoho_books_settings?id=eq.1`, {
      last_test_at: new Date().toISOString(), last_test_ok: tst.ok,
      last_test_error: tst.ok ? null : (tst.error ?? "").slice(0, 200),
      ...(tst.ok ? { organization_id: tst.data!.organization_id, organization_name: tst.data!.name } : {}),
      updated_at: new Date().toISOString(),
    });
  } else {
    await patchAsService(`zoho_books_settings?id=eq.1`, {
      last_test_at: new Date().toISOString(), last_test_ok: false, last_test_error: "not_configured",
      updated_at: new Date().toISOString(),
    });
  }

  const paused = await selectAsService<Array<{ sync_paused: boolean }>>(`zoho_books_settings?id=eq.1&select=sync_paused`);
  const isPaused = paused.ok && Array.isArray(paused.data) ? !!paused.data[0]?.sync_paused : false;

  const out = { mode, configured, paused: isPaused, processed: 0, done: 0, dry_run_ok: 0, needs_review: 0, failed: 0 };
  if (mode === "disabled" || isPaused || (mode === "live" && !configured)) {
    log("ZOHO_SYNC_SKIPPED", out);
    return NextResponse.json({ ok: true, ...out, note: mode === "disabled" ? "sync_mode_disabled" : isPaused ? "paused" : "not_configured" });
  }

  const nowIso = new Date().toISOString();
  // Reaper: مهام عالقة في processing (انقطاع دورة سابقة) تعود pending بعد ساعة.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  await patchAsService(`zoho_sync_jobs?status=eq.processing&updated_at=lt.${encodeURIComponent(hourAgo)}`, { status: "pending", updated_at: nowIso });
  const jobs = await selectAsService<Job[]>(
    `zoho_sync_jobs?select=id,operation,local_entity_type,local_entity_id,project_id,payload,attempts,idempotency_key` +
    `&status=eq.pending&attempts=lt.5&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)})` +
    `&order=created_at.asc&limit=12`);
  if (jobs.ok && Array.isArray(jobs.data)) {
    const maps = await mappings();
    // أولوية: الفواتير/القيود قبل الدفعات (تحصيل واحد يولّد invoice+payment بنفس اللحظة).
    const prio = (op: string) => (op === "customer_payment" || op === "vendor_payment") ? 1 : 0;
    jobs.data.sort((a, b) => prio(a.operation) - prio(b.operation));
    for (const j of jobs.data) {
      const lock = await patchAsService(`zoho_sync_jobs?id=eq.${j.id}&status=eq.pending`, { status: "processing", updated_at: nowIso });
      if (!lock.ok) continue;
      out.processed++;
      try { await processJob(j, maps, mode === "live" ? "live" : "dry_run", orgId); }
      catch (e) { await failJob(j, undefined, String(e).slice(0, 200)); }
    }
    // عدّادات الدورة.
    const c = await selectAsService<Array<{ status: string }>>(`zoho_sync_jobs?select=status&updated_at=gte.${encodeURIComponent(nowIso)}`);
    if (c.ok && Array.isArray(c.data)) for (const r of c.data) {
      if (r.status === "done") out.done++;
      else if (r.status === "dry_run_ok") out.dry_run_ok++;
      else if (r.status === "needs_review") out.needs_review++;
      else if (r.status === "failed") out.failed++;
    }
  }
  await patchAsService(`zoho_books_settings?id=eq.1`, { last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  log("ZOHO_SYNC_RUN", out);
  return NextResponse.json({ ok: true, ...out });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
