// ════════════════════════════════════════════════════════════════════════════
// POST /api/portal/import/preview — READ-ONLY. Parses the uploaded sheet, maps
// it through the chosen profile and returns the complete plan.
//
// This endpoint NEVER writes, so it stays useful in every degraded state:
//   • import SQL not applied yet → the plan is still produced in full; the
//     response says the create/update matching is unavailable and execution is
//     disabled, in Arabic.
//   • lookup RPC missing → same, with everything classified as "new".
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { ImportParseError } from "@/lib/portal/import/parse";
import { ImportProfileError } from "@/lib/portal/import/profile";
import { detectBackend } from "@/lib/portal/import/rpc";
import { bearerOf, createRpcCaller, IMPORT_SERVER_CONFIGURED, planFromInput, readImportRequest } from "@/lib/portal/import/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preview responses stay a sane size; the full plan is rebuilt on execute. */
const MAX_RESPONSE_ROWS = 1000;

export async function POST(req: Request) {
  if (!IMPORT_SERVER_CONFIGURED) {
    return NextResponse.json({ ok: false, error: "الخادم غير مهيّأ للاتصال بقاعدة البيانات." }, { status: 500 });
  }
  const token = bearerOf(req);
  if (!token) return NextResponse.json({ ok: false, error: "الجلسة غير صالحة. سجّل الدخول ثم أعد المحاولة." }, { status: 401 });

  const read = await readImportRequest(req);
  if (!read.ok) return NextResponse.json({ ok: false, error: read.error }, { status: read.status });

  const call = createRpcCaller(token);
  try {
    const [{ plan, profile, lookupReason }, backend] = await Promise.all([planFromInput(read.input, call), detectBackend(call)]);
    const rows = plan.deliverables.slice(0, MAX_RESPONSE_ROWS);
    return NextResponse.json({
      ok: plan.ok,
      plan: { ...plan, deliverables: rows },
      rowsTruncatedInResponse: plan.deliverables.length > rows.length,
      totalRows: plan.deliverables.length,
      profile: { id: profile.id, label: profile.label, version: profile.version, levels: profile.levels.map((l) => ({ key: l.key, label: l.label })) },
      backend,
      // Honest: execution is possible only when the database side actually exists.
      canExecute: plan.ok && backend.available,
      lookupReason,
    });
  } catch (e) {
    if (e instanceof ImportParseError || e instanceof ImportProfileError) {
      return NextResponse.json({ ok: false, error: e.arabic }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: `تعذّرت معالجة الملف: ${String(e)}` }, { status: 400 });
  }
}
