// ════════════════════════════════════════════════════════════════════════════
// POST /api/portal/import/execute — the ONLY write entry point of the importer.
//
// The browser re-sends the FILE, not the plan: the server re-derives the plan
// from the bytes (the engine is deterministic, so it is the same plan the
// operator approved) and only then calls the database. A plan posted by a
// client is never trusted.
//
// mode=dry_run  → full validation + the exact payload, zero writes.
// mode=commit   → one atomic RPC call; the response is reported per row, and a
//                 result that does not account for every row is reported as
//                 ambiguous rather than as success.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { ImportParseError } from "@/lib/portal/import/parse";
import { ImportProfileError } from "@/lib/portal/import/profile";
import { executeImport } from "@/lib/portal/import/execute";
import { bearerOf, createRpcCaller, IMPORT_SERVER_CONFIGURED, planFromInput, readImportRequest } from "@/lib/portal/import/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const { plan, profile } = await planFromInput(read.input, call);
    const result = await executeImport(
      plan,
      {
        mode: read.input.mode,
        projectId: read.input.projectId,
        sourceFile: read.input.fileName,
        batchLabel: read.input.batchLabel ?? read.input.fileName,
        skipInvalidRows: read.input.skipInvalidRows,
        includeUnchanged: read.input.includeUnchanged,
        // Two SEPARATE confirmations, forwarded exactly as the operator gave
        // them: a blanket "yes" on the main button applies neither.
        applyUpdates: read.input.applyUpdates,
        conflictResolution: read.input.conflictResolution ?? undefined,
        profile,
      },
      call,
    );
    return NextResponse.json({
      ok: result.ok,
      result,
      counts: plan.counts,
      profile: { id: profile.id, version: profile.version },
      projectKey: plan.projectKey,
      // Repeated so the UI can show the same warnings it showed in the preview.
      invalidRows: plan.invalidRows,
      warnings: plan.warnings,
    });
  } catch (e) {
    if (e instanceof ImportParseError || e instanceof ImportProfileError) {
      return NextResponse.json({ ok: false, error: e.arabic }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: `تعذّر تنفيذ الاستيراد: ${String(e)}` }, { status: 400 });
  }
}
