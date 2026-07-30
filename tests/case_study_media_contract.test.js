// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_media_contract.test.js — CASE STUDIES · PUBLIC MEDIA
//
// The audit's highest-risk finding was a document row whose bucket/path were
// unconstrained free text. This module must not repeat it: every public media
// source is shape-constrained, private buckets are named and refused, and the
// virus-scan story stays an honest placeholder instead of a claim.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/case_studies_platform_RUNME.sql");
const POST = R("docs/case_studies_platform_POSTCHECK.sql");
const SERVER = R("lib/server/publicCaseStudies.ts");
const CONTRACT = R("docs/PUBLIC_MEDIA_SECURITY_CONTRACT.md");
const BUILDER = R("components/portal/CaseStudyBuilder.tsx");

const MEDIA_TABLE = RUNME.slice(
  RUNME.indexOf("create table if not exists public.cs_media ("),
  RUNME.indexOf("create index if not exists cs_media_study_idx"),
);

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start > -1, `${name} is defined`);
  const end = sql.indexOf("end $$;", start);
  return sql.slice(start, end > -1 ? end + 7 : sql.length);
}

test("every private bucket in the system is named and refused by a table CHECK", () => {
  const buckets = [
    "hr-files", "hr-docs", "custody-evidence", "custody-inventory-assets",
    "custody-inventory-evidence", "custody-inventory-signatures", "rental-evidence",
    "rental-contracts", "rental-private-documents", "project-deliverables",
  ];
  assert.ok(/constraint cs_media_no_private_source check/.test(MEDIA_TABLE), "the CHECK exists");
  for (const b of buckets) {
    assert.ok(MEDIA_TABLE.includes(b), `${b} is explicitly refused`);
  }
});

test("signed URLs, tokens, internal preview paths and dangerous schemes are refused", () => {
  assert.ok(/\/storage\/v1\/object\/\(sign\|authenticated\)/.test(MEDIA_TABLE), "signed/authenticated object URLs");
  assert.ok(/\[\?&\]token=/.test(MEDIA_TABLE), "any token query parameter");
  assert.ok(/\^\(data:\|javascript:\|vbscript:\|file:\)/.test(MEDIA_TABLE), "dangerous URL schemes");
  assert.ok(/\/client-portal\//.test(MEDIA_TABLE) && /\/api\/portal\//.test(MEDIA_TABLE), "internal preview paths");
});

test("the same refusal is repeated in the RPC with a message an editor can act on", () => {
  const up = fnBody(RUNME, "cs_media_upsert");
  assert.ok(/rental-private-documents/.test(up) && /project-deliverables/.test(up),
    "the RPC repeats the private-bucket refusal");
  assert.ok(/validation: .*رابط تخزين خاصّ أو رابط معاينة داخليّ/.test(up),
    "the editor is told exactly what is wrong, not just 'constraint violation'");
});

test("a media row has exactly one source: an image URL or an identified video", () => {
  assert.ok(/constraint cs_media_source_exact check/.test(MEDIA_TABLE));
  assert.ok(/asset_kind = 'video'\s+and video_provider is not null and video_id is not null and public_url is null/.test(MEDIA_TABLE));
  assert.ok(/video_provider is null or video_provider in \('youtube','vimeo'\)/.test(MEDIA_TABLE),
    "only two embed providers, no free-form iframe host");
  assert.ok(/video_id\s+text check \(video_id is null or video_id ~ '\^\[A-Za-z0-9_-\]\{5,64\}\$'\)/.test(MEDIA_TABLE));
});

test("content type, filename and size are constrained, not trusted", () => {
  assert.ok(/content_type in \('image\/jpeg','image\/png','image\/webp','image\/avif'\)/.test(MEDIA_TABLE),
    "public derivatives only — no camera formats are even representable");
  assert.ok(/safe_filename is null or safe_filename ~ '\^\[a-z0-9\]\[a-z0-9\._-\]\{0,120\}\$'/.test(MEDIA_TABLE),
    "safe filenames: no spaces, no traversal, no unicode surprises");
  assert.ok(/bytes\s+int check \(bytes is null or bytes between 1 and 52428800\)/.test(MEDIA_TABLE));
  const up = fnBody(RUNME, "cs_media_upsert");
  assert.ok(/max_media_bytes/.test(up), "the configured limit is enforced on write");
  assert.ok(/'code','media_too_large','severity','blocker'/.test(RUNME), "and again before publication");
});

test("alt text in both languages is a hard blocker, not a nice-to-have", () => {
  assert.ok(/'code','media_missing_alt','severity','blocker'/.test(RUNME));
  const blockers = fnBody(RUNME, "cs_publish_blockers");
  assert.ok(/alt_ar\), ''\) = '' or coalesce\(btrim\(alt_en\), ''\) = ''/.test(blockers),
    "both languages are required");
});

test("metadata stripping: default false, required by default, and honestly an attestation", () => {
  assert.ok(/metadata_stripped\s+boolean not null default false/.test(MEDIA_TABLE), "not stripped until stated");
  assert.ok(/require_metadata_stripped\s+boolean not null default true/.test(RUNME), "required by default");
  assert.ok(/'code','media_metadata_not_stripped','severity','blocker'/.test(RUNME));
  assert.ok(/لا يجرّد|إقرار بشريّ/.test(CONTRACT),
    "the contract admits the system does not strip metadata itself");
});

test("virus scanning is an honest placeholder, and 'infected' blocks unconditionally", () => {
  assert.ok(/require_virus_scan\s+boolean not null default false/.test(RUNME), "off by default");
  assert.ok(/virus_scan_provider\s+text,/.test(RUNME) && !/default '[a-z]/i.test(
    RUNME.slice(RUNME.indexOf("virus_scan_provider"), RUNME.indexOf("virus_scan_provider") + 80)),
    "no provider is claimed");
  assert.ok(/'code','virus_scan_required_without_provider','severity','blocker'/.test(RUNME),
    "requiring a scan without a provider stops publication rather than pretending");
  const blockers = fnBody(RUNME, "cs_publish_blockers");
  const infectedIdx = blockers.indexOf("media_infected");
  const requireIdx = blockers.indexOf("if coalesce(s.require_virus_scan, false) then");
  assert.ok(infectedIdx > -1 && (requireIdx === -1 || infectedIdx < requireIdx),
    "the infected check sits OUTSIDE the require_virus_scan branch, so no setting can allow it");
  assert.ok(/لا خدمة فحص فيروسات في هذا النظام/.test(CONTRACT), "the contract states there is no scanner");
});

test("external hosts need an allow-list; an empty list means repository paths only", () => {
  assert.ok(/media_allowed_hosts\s+text\[\] not null default '\{\}'/.test(RUNME));
  assert.ok(/'code','media_host_not_allowed','severity','blocker'/.test(RUNME));
  assert.ok(/constraint cs_media_url_shape check/.test(MEDIA_TABLE));
  assert.ok(/\^\/\[A-Za-z0-9\._~%!\$&\*\+,;=:@\/-\]\{1,300\}\$/.test(MEDIA_TABLE), "absolute repo path shape");
  assert.ok(/\^https:\/\//.test(MEDIA_TABLE), "https only for external");
});

test("no bucket is created, listed, signed or made public by this module", () => {
  assert.ok(!/insert into storage\.buckets/.test(RUNME), "creates no bucket");
  assert.ok(!/storage\.objects/.test(RUNME), "touches no storage policy");
  assert.ok(!/public\s*=\s*true/.test(RUNME), "flips no bucket to public");
  assert.ok(!/getPublicUrl|createSignedUrl/.test(SERVER + BUILDER), "builds no storage URL in code");
  assert.ok(/r_no_storage_touch/.test(POST), "POSTCHECK asserts it");
});

test("the browser layer never holds a service-role key and re-filters URLs", () => {
  assert.ok(!/SERVICE_ROLE|service_role/.test(SERVER), "no service-role key in the public read layer");
  assert.ok(/NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(SERVER), "anon key only");
  assert.ok(/export function safeImageUrl/.test(SERVER));
  assert.ok(/\[\?&\]token=\|\\\/storage\\\/v1\\\/object\\\/\(sign\|authenticated\)/.test(SERVER)
    || /token=/.test(SERVER), "a signed URL is dropped even if it ever reached the row");
  assert.ok(/youtube-nocookie\.com/.test(SERVER), "embeds use the no-cookie host");
  assert.ok(/export function safeEmbedUrl/.test(SERVER), "embeds are built from provider+id, never a free URL");
});

test("no case-study surface injects raw HTML", () => {
  for (const f of ["components/CaseStudyDetailClient.tsx", "components/CaseStudiesIndexClient.tsx",
                   "components/CaseStudiesTeaser.tsx", "components/portal/CaseStudyBuilder.tsx",
                   "components/portal/CaseStudiesWorkbench.tsx"]) {
    assert.ok(!/dangerouslySetInnerHTML/.test(R(f)), `${f} must not set inner HTML`);
  }
});

test("the media contract document exists and states the placeholder scanning contract", () => {
  assert.ok(/عقد أمن الوسائط العامّة/.test(CONTRACT));
  for (const must of ["مشتقّ", "تجريد", "فحص الفيروسات", "لا سرد للدلاء"]) {
    assert.ok(CONTRACT.includes(must), `the contract covers: ${must}`);
  }
});
