#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// scripts/export-case-studies.mjs — يصدّر دراسات حالة **معتمَدة** إلى ملفّات.
//
// Wave 6 · V2-6.8-C
//
// ★★ 🔴 لماذا سكربت ولماذا لا يعمل أبدًا داخل Vercel ★★
// نظام ملفّات Vercel وقت التشغيل **للقراءة**، وما يُكتب فيه يُفقد عند أوّل نشر.
// أي أنّ كتابة ملفّ محتوى من مسار خادميّ **تبدو ناجحة** ثمّ تختفي بصمت — وهو
// أسوأ من الفشل الصريح. فالتصدير خطوة تطوير/CI تُنتج ملفًّا يدخل المستودع عبر
// مراجعة بشرية (Script أو Pull Request)، ثمّ يُنشر باعتماد خالد.
//
// §0 يرفض التشغيل في بيئة نشر صراحةً — الحارس هنا لا في التعليق.
//
// ⛔ ولا يُصدَّر إلّا ما اعتُمد. ⛔ ولا Push ولا PR من هذا السكربت.
//
// الاستعمال:
//   node scripts/export-case-studies.mjs --out ./tmp/case-studies [--format json|md]
//   (يقرأ SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY من البيئة المحلّية،
//    ولا يطبعهما أبدًا. بلا مفاتيح يعمل في وضع --dry-run فقط.)
// ════════════════════════════════════════════════════════════════════════════
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

// ─── §0 · حارس البيئة — يسبق كلّ شيء ────────────────────────────────────────
//
// 🔴 لا يعمل داخل بيئة نشر. `VERCEL` و`VERCEL_ENV` تُضبطان تلقائيًّا هناك،
//    وNEXT_RUNTIME يُضبط داخل تنفيذ الخادم.
export function assertNotDeployedRuntime(env = process.env) {
  if (env.VERCEL || env.VERCEL_ENV || env.NEXT_RUNTIME) {
    throw new Error(
      "EXPORT_FORBIDDEN_IN_DEPLOYED_RUNTIME: the filesystem is read-only there " +
      "and any write is lost on the next deploy. Run this locally or in CI.",
    );
  }
  return true;
}

// ─── تعقيم اسم الملفّ — يمنع الخروج من المجلّد ──────────────────────────────
//
// 🔴 slug يأتي من قاعدة بيانات، و«../../» فيه يكتب خارج الهدف تمامًا.
export function safeFileName(slug) {
  const s = String(slug ?? "").normalize("NFKC");
  // يُبقى على الحروف والأرقام والشرطة فقط — كلّ ما عداها يسقط.
  const cleaned = s.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`UNSAFE_SLUG: ${JSON.stringify(slug)}`);
  }
  return cleaned.slice(0, 80).toLowerCase();
}

/** يتحقّق أنّ المسار الناتج يبقى **داخل** المجلّد الهدف. */
export function resolveInside(outDir, fileName) {
  const base = path.resolve(outDir);
  const full = path.resolve(base, fileName);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`PATH_TRAVERSAL_BLOCKED: ${fileName}`);
  }
  return full;
}

// ─── الحقول المسموح تصديرها ─────────────────────────────────────────────────
//
// 🔴 قائمة بيضاء مطابقة لما تسمح به القاعدة. ⛔ لا ملاحظات داخلية ولا أرقام
//    مالية ولا جهات اتصال ولا أسماء موظّفين ولا مسارات تخزين.
export const EXPORT_FIELDS = [
  "slug", "public_title_ar", "public_title_en", "summary_ar", "summary_en",
  "client_display_name", "client_identity_visibility",
  "anonymized_label_ar", "anonymized_label_en",
  "challenge_ar", "challenge_en", "solution_ar", "solution_en",
  "results_ar", "results_en",
  "seo_title_ar", "seo_title_en", "seo_description_ar", "seo_description_en",
  "canonical_path", "locations", "project_start", "project_end",
];

/** يُسقط كلّ ما ليس في القائمة البيضاء، ويُخفي هوية العميل إن طُلب. */
export function redact(row) {
  const out = {};
  for (const k of EXPORT_FIELDS) {
    if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  }
  // 🔴 التجهيل يُطبَّق فعليًّا لا اسمًا: الاسم الحقيقيّ يُحذف من المخرَج.
  if (out.client_identity_visibility !== "named") {
    delete out.client_display_name;
  }
  return out;
}

/** إخراج ثابت: المفاتيح مرتَّبة، فمخرَجان لنفس المدخل متطابقان بايتًا ببايت. */
export function toJson(row) {
  const r = redact(row);
  const ordered = {};
  for (const k of EXPORT_FIELDS) if (k in r) ordered[k] = r[k];
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function toMarkdown(row) {
  const r = redact(row);
  const title = r.public_title_ar || r.public_title_en || r.slug;
  const client = r.client_display_name
    || r.anonymized_label_ar || r.anonymized_label_en || "";
  const lines = [
    "---",
    `slug: ${r.slug}`,
    `title: ${JSON.stringify(title)}`,
    client ? `client: ${JSON.stringify(client)}` : null,
    "---",
    "",
    `# ${title}`,
    "",
    r.summary_ar ? r.summary_ar : null,
    r.challenge_ar ? `\n## التحدّي\n\n${r.challenge_ar}` : null,
    r.solution_ar ? `\n## الحلّ\n\n${r.solution_ar}` : null,
    r.results_ar ? `\n## النتائج\n\n${r.results_ar}` : null,
    "",
  ].filter((l) => l !== null);
  return lines.join("\n");
}

// ─── الكتابة — ⛔ لا استبدال صامت ───────────────────────────────────────────
export async function writeOnce(fullPath, contents, { force = false } = {}) {
  if (!force) {
    try {
      await access(fullPath);
      // ملفّ موجود ⇒ يُترك ويُبلَّغ. الاستبدال الصامت يمحو مراجعة بشرية سابقة.
      return { written: false, reason: "exists" };
    } catch { /* غير موجود — نكتب */ }
  }
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, "utf8");
  return { written: true };
}

/** يصدّر صفوفًا مُمرَّرة. منفصل عن الجلب كي يُختبر بلا شبكة ولا قاعدة. */
export async function exportRows(rows, { outDir, format = "json", force = false }) {
  assertNotDeployedRuntime();
  const results = [];
  for (const row of rows ?? []) {
    // 🔴 المعتمَد وحده. مسوّدة تُصدَّر تعني نصًّا غير مراجَع يصل الموقع.
    if (!["approved", "scheduled", "published"].includes(String(row?.status ?? ""))) {
      results.push({ slug: row?.slug ?? null, written: false, reason: "not_approved" });
      continue;
    }
    const name = safeFileName(row.slug);
    const ext = format === "md" ? "md" : "json";
    const full = resolveInside(outDir, `${name}.${ext}`);
    const body = format === "md" ? toMarkdown(row) : toJson(row);
    const res = await writeOnce(full, body, { force });
    results.push({ slug: row.slug, path: full, ...res });
  }
  return results;
}

// ─── التشغيل المباشر ────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const outDir = get("--out", "./tmp/case-studies");
  const format = get("--format", "json");

  try {
    assertNotDeployedRuntime();
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }

  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    // ⛔ لا يُطبع مفتاح ولا جزء منه — الحالة فقط.
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: Missing. Nothing exported.");
    process.exit(3);
  }

  const res = await fetch(
    `${url}/rest/v1/cs_case_studies?select=*&status=in.(approved,scheduled,published)`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
  );
  if (!res.ok) { console.error(`FETCH_FAILED ${res.status}`); process.exit(4); }

  const rows = await res.json();
  const out = await exportRows(rows, { outDir, format });
  const written = out.filter((r) => r.written).length;
  console.log(`exported ${written}/${out.length} → ${path.resolve(outDir)}`);
  for (const r of out.filter((x) => !x.written)) {
    console.log(`  skipped ${r.slug ?? "?"}: ${r.reason}`);
  }
  // ⛔ لا Push ولا PR: الملفّات تدخل المستودع بمراجعة بشرية.
  console.log("NOTE: files written locally only. No push, no PR, no deploy.");
}
