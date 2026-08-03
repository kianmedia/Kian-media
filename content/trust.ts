// ════════════════════════════════════════════════════════════════════════════
// content/trust.ts — the /trust page's claims, each with a verification status.
//
// Wave 2 · V2-2.3-A  (MASTER_BRIEF_v2.1.md §4 WAVE 2)
//
// ★ WHY THIS FILE IS SHAPED LIKE THIS ★
// /trust is the page a procurement officer reads before approving a supplier.
// Every line on it is a representation about how this company handles data. The
// brief is explicit: "❌ لا ادّعاء غير متحقق في صفحة مشتريات" — no unverified
// claim on a procurement page.
//
// The naive version of this page lists everything the brief mentions: RLS,
// encryption at rest, BACKUPS, an AUDIT LOG, PDPL, an HSE statement. Two of
// those are not true today:
//
//   • BACKUPS — .github/workflows/db-backup.yml exists but has NEVER RUN. The
//     secrets are unset and no restore drill has been performed. Wave 0's own
//     report says so. Claiming "we back up your data" would be false.
//   • HSE POLICY — ops_job_hse exists as a per-job field. There is no HSE
//     policy document. Claiming one is a fabricated credential.
//
// So a claim is not a string here — it is a string plus a STATUS, and the page
// renders `live` only. A claim that is not yet true is structurally present and
// simply does not appear, so the page can never get ahead of reality. When
// backups genuinely run, one status flips and the section appears.
//
// A test asserts that nothing with status "pending" reaches the page.
// ════════════════════════════════════════════════════════════════════════════

/**
 * `live`    — verifiable in this repository or on production TODAY.
 * `pending` — intended, not yet true. NEVER rendered.
 */
export type ClaimStatus = "live" | "pending";

/**
 * Is the trust page published at all?
 *
 * 🔴 DEFAULT OFF. The page is a set of technical and legal representations that
 * no human has reviewed yet, and unlike the SEO landing pages it is NOT
 * otherwise gated — published, it indexes immediately. So the whole route is
 * held behind this flag until Khaled has read the copy and confirmed the legal
 * identifiers.
 *
 * With the flag off the routes call notFound(), nothing is prerendered, the
 * sitemap omits them, and no text or number from the page can reach public HTML.
 */
export function trustPageEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_TRUST_PAGE === "true";
}

export interface TrustClaim {
  id: string;
  status: ClaimStatus;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  /** Why this is claimable. Not rendered — it exists so the status is auditable. */
  evidence: string;
}

export const TRUST_CLAIMS: TrustClaim[] = [
  {
    id: "rls",
    status: "live",
    titleAr: "عزل البيانات على مستوى الصف",
    titleEn: "Row-level data isolation",
    bodyAr:
      "كل جدول يحمل سياسات وصول تُطبَّق داخل قاعدة البيانات نفسها، لا في الواجهة. أي طلب لا يملك صلاحية الصف يُرفض عند مصدر البيانات حتى لو وصل إليه.",
    bodyEn:
      "Access policies are enforced inside the database itself, not in the interface. A request without row-level permission is refused at the data source, even if it reaches it.",
    evidence: "258 `enable row level security` statements; 271 tables carry policies (docs/EXISTING_CAPABILITIES.md §0).",
  },
  {
    id: "encryption",
    status: "live",
    titleAr: "التشفير أثناء النقل وعند التخزين",
    titleEn: "Encryption in transit and at rest",
    bodyAr:
      "كل اتصال بالمنصة يمرّ عبر HTTPS مع سياسة نقل صارمة، والتخزين مُشفَّر لدى مزوّد قاعدة البيانات.",
    bodyEn:
      "All traffic to the platform runs over HTTPS with a strict transport policy, and storage is encrypted at the database provider.",
    evidence: "HSTS max-age=63072000 shipped in next.config.js (Wave 0 V2-0.6-B), verified served; Supabase/Postgres encrypts at rest by default.",
  },
  {
    id: "mfa",
    status: "live",
    titleAr: "مصادقة ثنائية للحسابات الداخلية",
    titleEn: "Two-factor authentication for internal accounts",
    bodyAr:
      "الحسابات الإدارية تدعم المصادقة الثنائية عبر تطبيق المصادقة (TOTP)، ودورة الدخول بخطوتين مُختبَرة فعليًا.",
    bodyEn:
      "Administrative accounts support app-based two-factor authentication (TOTP), and the two-step sign-in cycle has been tested in practice.",
    evidence: "mfa_* packages; owner two-step sign-in confirmed on production (docs/MANUAL_ACTIONS_QUEUE.md M-010).",
  },
  {
    id: "least-privilege",
    status: "live",
    titleAr: "صلاحيات مفصَّلة ومبدأ أقل امتياز",
    titleEn: "Granular permissions and least privilege",
    bodyAr:
      "الصلاحيات مفصَّلة على مستوى الإجراء لا الدور العام، وتُفرَض في قاعدة البيانات. ورؤية البيانات المالية مفصولة عن بقية الصلاحيات.",
    bodyEn:
      "Permissions are granular per action rather than per broad role, enforced in the database. Visibility of financial data is separated from other permissions.",
    evidence: "124 atomic permissions (docs/permission_catalog_RUNME.sql); can_see_financials() gate; tests/*financial_isolation*.",
  },
  {
    id: "activity-log",
    status: "live",
    titleAr: "تسجيل الإجراءات",
    titleEn: "Activity logging",
    bodyAr:
      "الإجراءات الحسّاسة تُسجَّل مع منفّذها ووقتها، والحذف يتم بالإخفاء مع حفظ السبب بدل الإزالة النهائية.",
    bodyEn:
      "Sensitive actions are recorded with who performed them and when, and deletion is a reversible soft-delete with a recorded reason rather than a permanent removal.",
    // ⚠️ Deliberately says "activity logging", NOT "a comprehensive audit log".
    // Logging is real but SPREAD ACROSS 15 SOURCES (activity_log + 14 per-module
    // audit tables) and a unified viewer does not exist. Claiming one central
    // audit trail would overstate it.
    evidence: "activity_log + log_activity(); is_deleted/deleted_at/delete_reason widely applied. NOT unified — 14 per-module audit tables also exist (PROTECTED_ARCHITECTURE P-12).",
  },
  {
    id: "abuse-controls",
    status: "live",
    titleAr: "ضوابط إساءة الاستخدام على الواجهات العامة",
    titleEn: "Abuse controls on public endpoints",
    bodyAr:
      "النماذج والواجهات العامة محميّة بحدود معدّل وسقوف حجم، وردودها لا تكشف تفاصيل داخلية عن النظام.",
    bodyEn:
      "Public forms and endpoints are protected by rate limits and size caps, and their responses do not disclose internal system detail.",
    evidence: "lib/server/rateLimit.ts + public_rate_limits + rl_consume, applied on production 2026-07-27; uniform opaque failures (Wave 0 V2-0.6-A).",
  },
  {
    id: "pdpl",
    status: "live",
    titleAr: "الالتزام بنظام حماية البيانات الشخصية",
    titleEn: "Commitment to the Personal Data Protection Law",
    bodyAr:
      "نلتزم بمبادئ نظام حماية البيانات الشخصية السعودي: جمع أقل قدر من البيانات، واستخدامها للغرض المصرَّح به، وإتاحة حق الوصول والتصحيح والحذف.",
    bodyEn:
      "We commit to the principles of Saudi Arabia's Personal Data Protection Law: collecting the minimum necessary data, using it only for the stated purpose, and honouring rights of access, correction and deletion.",
    // A stated commitment, phrased as a commitment — not a certification claim.
    evidence: "Stated commitment, consistent with /privacy-policy. Deliberately NOT phrased as a certification or an audit result.",
  },

  // ─── NOT RENDERED — not true today ────────────────────────────────────────
  {
    id: "backups",
    status: "pending",
    titleAr: "نسخ احتياطي واستعادة مُختبَرة",
    titleEn: "Backups with a tested restore",
    bodyAr:
      "نسخ احتياطي دوري لقاعدة البيانات مع إجراء استعادة موثَّق ومُختبَر.",
    bodyEn:
      "Scheduled database backups with a documented, tested restore procedure.",
    // 🔴 The workflow exists and has NEVER RUN. Secrets unset, no restore drill.
    evidence: "BLOCKED: .github/workflows/db-backup.yml exists but has never run; SUPABASE_DB_URL unset; no restore drill performed (WAVE_0_REPORT §0).",
  },
  {
    id: "hse",
    status: "pending",
    titleAr: "بيان السلامة والصحة المهنية",
    titleEn: "Health & safety statement",
    bodyAr: "سياسة سلامة موثَّقة لمواقع التصوير وسجل حوادث قابل للتصدير.",
    bodyEn: "A documented safety policy for filming locations and an exportable incident record.",
    // 🔴 ops_job_hse is a per-job field. There is no HSE policy document.
    evidence: "BLOCKED: ops_job_hse exists as a per-job field only; no HSE policy document exists (Wave 6 V2-6.4-A).",
  },
  {
    id: "monitoring",
    status: "pending",
    titleAr: "رصد الأخطاء والتوفّر",
    titleEn: "Error and uptime monitoring",
    bodyAr: "رصد مركزي للأخطاء ومراقبة توفّر مستمرة.",
    bodyEn: "Centralised error tracking and continuous uptime monitoring.",
    evidence: "BLOCKED: SENTRY_DSN unset and @sentry/nextjs not installed; lib/observability.ts is a no-op seam (WAVE_0_REPORT V2-0.5).",
  },
];

/** Only what is true today ever reaches the page. */
export const liveTrustClaims = (): TrustClaim[] => TRUST_CLAIMS.filter((c) => c.status === "live");

/** Reported, never rendered — so the gap is visible to us and not to a buyer. */
export const pendingTrustClaims = (): TrustClaim[] => TRUST_CLAIMS.filter((c) => c.status === "pending");
