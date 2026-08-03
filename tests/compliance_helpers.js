// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_helpers.js — مساعدات اختبارات مركز المورّد والامتثال.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
//
// كلّ الفحوص **ساكنة**: تقرأ ملفّات الحزمة من القرص وتتحقّق من عقودها نصًّا.
// لا اتّصال بقاعدة، ولا بيانات إنتاج، ولا شبكة — لأنّ الجداول التي تمسّها هذه
// الحزمة تحمل وثائق شركة حقيقية وسجلّ وصول طرف خارجيّ، واختبار يكتب فيها أسوأ
// من اختبار غائب.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const BASE = "docs/vendor_compliance_center_";
const FILES = {
  PREFLIGHT: `${BASE}PREFLIGHT.sql`,
  RUNME: `${BASE}RUNME.sql`,
  POSTCHECK: `${BASE}POSTCHECK.sql`,
  ROLLBACK: `${BASE}ROLLBACK.sql`,
};

const PREFLIGHT = read(FILES.PREFLIGHT);
const SQL = read(FILES.RUNME);
const POSTCHECK = read(FILES.POSTCHECK);
const ROLLBACK = read(FILES.ROLLBACK);

const DOCS = {
  roles: "docs/VENDOR_COMPLIANCE_ROLE_MATRIX.md",
  golive: "docs/VENDOR_COMPLIANCE_GO_LIVE.md",
  acceptance: "docs/VENDOR_COMPLIANCE_ACCEPTANCE.md",
  grant: "docs/SECURE_DOCUMENT_GRANT_CONTRACT.md",
  readiness: "docs/COMPLIANCE_READINESS_MODEL.md",
  registration: "docs/VENDOR_REGISTRATION_WORKFLOW.md",
};

const CODE_FILES = {
  ts: "lib/portal/compliance.ts",
  route: "app/api/public/secure-document/route.ts",
  publicPage: "app/(ar)/secure-document/page.tsx",
  portalPage: "app/(portal)/client-portal/compliance/page.tsx",
  atoms: "components/portal/compliance/ComplianceAtoms.tsx",
  documents: "components/portal/compliance/ComplianceDocumentsPanel.tsx",
  grants: "components/portal/compliance/SecureGrantsPanel.tsx",
  registration: "components/portal/compliance/VendorRegistrationPanel.tsx",
  company: "components/portal/compliance/CompanyProfilePanel.tsx",
  robots: "app/robots.ts",
};

/**
 * يجرّد المصدر من التعليقات فقط (تبقى السلاسل النصّية).
 * التعليقات هنا عربية ومطوّلة وتذكر أسماء كائنات للشرح، فلولا التجريد لالتبس
 * «شرحُ أنّنا لا نُنشئ سجلًّا ثالثًا» بـ«إنشائه» فعلًا.
 */
function stripComments(src) {
  let out = "", i = 0, inLine = false, inBlock = false, inStr = false, dollar = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } i++; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) { out += c; if (c === "'") { if (n === "'") { out += n; i += 2; continue; } inStr = false; } i++; continue; }
    if (dollar) {
      if (src.startsWith(dollar, i)) { out += dollar; i += dollar.length; dollar = null; continue; }
      out += c; i++; continue;
    }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    if (c === "'") { inStr = true; out += c; i++; continue; }
    const m = /^\$[a-zA-Z_]*\$/.exec(src.slice(i));
    if (m) { dollar = m[0]; out += m[0]; i += m[0].length; continue; }
    out += c; i++;
  }
  return out;
}

/** يجرّد التعليقات **ومحتوى** السلاسل — لفحص «هل يُشار إلى الكائن فعلًا؟». */
function stripCommentsAndStrings(src) {
  let out = "", i = 0, inLine = false, inStr = false, dollar = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } i++; continue; }
    if (inStr) { if (c === "'") { if (n === "'") { i += 2; continue; } inStr = false; } i++; continue; }
    if (dollar) { if (src.startsWith(dollar, i)) { i += dollar.length; dollar = null; continue; } i++; continue; }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "'") { inStr = true; i++; continue; }
    const m = /^\$[a-zA-Z_]*\$/.exec(src.slice(i));
    if (m) { dollar = m[0]; i += m[0].length; continue; }
    out += c; i++;
  }
  return out;
}

const CODE = stripComments(SQL);

/** جسم دالّة واحدة من الـRUNME (بعد تجريد التعليقات). كلّ الدوالّ تستعمل $fn$. */
function funcBody(name) {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$fn\\$;`,
    "i",
  );
  const m = re.exec(CODE);
  return m ? m[0] : null;
}

/** كتلة SELF-TEST من الـRUNME. */
function selfTest() {
  const m = /do \$st\$([\s\S]*?)end \$st\$;/i.exec(CODE);
  return m ? m[1] : "";
}

function createdTables() {
  return [...CODE.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
}

function createdFunctions() {
  return [...CODE.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
}

/** القيود المضافة على tvn_documents (بالاسم). */
function addedConstraints() {
  return [...CODE.matchAll(/add\s+constraint\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
}

// ─── العقود المسمّاة ───────────────────────────────────────────────────────

/** المُسنَدات الستّة المطلوبة بالاسم في العقد. */
const PREDICATES = [
  "can_view_compliance_center",
  "can_manage_compliance_documents",
  "can_verify_compliance_documents",
  "can_issue_secure_document_grants",
  "can_view_restricted_company_documents",
  "can_manage_vendor_registration",
];

/** مُسنَدان أضيق مضافان فوق الستّة (وليسا بديلًا عنها). */
const EXTRA_PREDICATES = ["vcc_can_view_request_status", "vcc_can_view_operational_documents"];

/** ⛔ بوّابات ممنوعة تمامًا كأساس لأيّ مُسنَد. */
const FORBIDDEN_GATES = ["can_manage_projects", "is_kian_member"];

/** ما أُعيد استخدامه — يُشار إليه ولا يُستنسخ. */
const REUSED = [
  "tvn_documents", "tvn_document_types", "tvn_audit", "tvn_event_log",
  "tvn_doc_valid", "tvn_log", "can_verify_compliance", "comms_enqueue",
  "comms_event_catalog", "opportunity_requests", "permissions",
];

/** ⛔ أسماء سجلّ وثائق ثالث — يجب ألّا تُنشأ إطلاقًا. */
const FORBIDDEN_REGISTRIES = ["vcc_documents", "compliance_documents", "vcc_company_documents"];

/** الجداول الجديدة — ولا شيء غيرها. */
const NEW_TABLES = [
  "vcc_settings", "vcc_company_profile", "vcc_company_contacts", "vcc_certifications",
  "vcc_references", "vcc_industry_experience", "vcc_drone_capability",
  "vcc_readiness_requirements", "vcc_registration_requests", "vcc_registration_checklist",
  "vcc_registration_comments", "vcc_registration_attachments",
  "vcc_document_grants", "vcc_grant_documents", "vcc_grant_access_log",
];

/** الحالات الثماني للوثيقة. */
const DOC_STATES = [
  "draft", "uploaded", "pending_verification", "verified",
  "rejected", "expired", "archived", "revoked",
];

/** الحالات الإحدى عشرة لطلب التسجيل. */
const REGISTRATION_STATES = [
  "received", "under_review", "information_required", "preparing_documents",
  "pending_owner_approval", "ready_for_manual_submission", "submitted_manually",
  "accepted", "rejected", "expired", "closed",
];

/** حالات الجاهزية الخمس. */
const READINESS_STATES = [
  "ready", "ready_with_warnings", "incomplete", "expired_blockers", "not_configured",
];

/** الحقول المطلوبة في المنحة الآمنة. */
const GRANT_FIELDS = [
  "recipient_org", "recipient_name", "recipient_email", "purpose", "approved_by",
  "starts_at", "expires_at", "max_opens", "max_downloads", "watermark_identity",
  "revoked_at", "revoke_reason",
];

/** الحقول المطلوبة في الوثيقة. */
const DOC_FIELDS = [
  "doc_type", "title", "doc_language", "issuer", "issued_on", "expires_on",
  "doc_number_masked", "doc_version", "doc_status", "verified", "verified_by",
  "verified_at", "sensitivity", "is_downloadable", "watermark_required",
  "internal_notes", "storage_bucket", "storage_path", "checksum_sha256",
];

/** القيود البنيوية التي لا يجوز أن تختفي. */
const CRITICAL_CONSTRAINTS = [
  "tvn_doc_bucket_pinned",
  "tvn_doc_path_shape",
  "tvn_doc_verified_iff_status",
  "tvn_doc_company_no_raw_number",
  "tvn_doc_masked_number",
  "tvn_doc_owner_kind_v2",
  "tvn_doc_owner_exact",
  "vcc_reg_manual_submission_proof",
  "vcc_reg_owner_approval_proof",
  "vcc_chk_document_not_manual",
  "vcc_grant_active_needs_token",
];

module.exports = {
  ROOT, read, exists, FILES, DOCS, CODE_FILES,
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, CODE,
  stripComments, stripCommentsAndStrings,
  funcBody, selfTest, createdTables, createdFunctions, addedConstraints,
  PREDICATES, EXTRA_PREDICATES, FORBIDDEN_GATES, REUSED, FORBIDDEN_REGISTRIES,
  NEW_TABLES, DOC_STATES, REGISTRATION_STATES, READINESS_STATES,
  GRANT_FIELDS, DOC_FIELDS, CRITICAL_CONSTRAINTS,
};
