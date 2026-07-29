// ════════════════════════════════════════════════════════════════════════════
// GET /api/portal/import/profiles — which mapping profiles exist, and whether
// the database side of the importer is actually installed.
//
// The UI calls this before showing the upload box so it can say, up front and in
// Arabic, "المعاينة متاحة والتنفيذ معطّل حتى تشغيل ملف الترحيل" instead of
// discovering it after the operator picked a file.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { detectBackend } from "@/lib/portal/import/rpc";
import { listProfiles } from "@/lib/portal/import/profiles";
import { bearerOf, createRpcCaller, ensureDiskProfiles, IMPORT_SERVER_CONFIGURED } from "@/lib/portal/import/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_PATH = "/docs/templates/project_import_template.csv";

export async function GET(req: Request) {
  const token = bearerOf(req);
  if (!token) return NextResponse.json({ ok: false, error: "الجلسة غير صالحة. سجّل الدخول ثم أعد المحاولة." }, { status: 401 });

  // Mapping profiles are data on disk; a missing/broken one degrades to the
  // built-in generic profile and is reported rather than hidden.
  const discovery = ensureDiskProfiles();
  const profiles = listProfiles();
  const profilesNote = discovery.errors.length
    ? `تعذّر تحميل بعض ملفات التعيين: ${discovery.errors.join(" ؛ ")}`
    : discovery.loaded.length === 0
      ? "لم يُعثر على ملفات تعيين إضافية؛ التعيين العام وحده متاح."
      : null;

  if (!IMPORT_SERVER_CONFIGURED) {
    return NextResponse.json({
      ok: true,
      profiles,
      profilesNote,
      backend: { available: false, version: null, reason: "الخادم غير مهيّأ للاتصال بقاعدة البيانات.", lookupAvailable: false },
      templatePath: TEMPLATE_PATH,
    });
  }
  const backend = await detectBackend(createRpcCaller(token));
  return NextResponse.json({ ok: true, profiles, profilesNote, backend, templatePath: TEMPLATE_PATH });
}
