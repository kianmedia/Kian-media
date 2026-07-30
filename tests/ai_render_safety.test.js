// ════════════════════════════════════════════════════════════════════════════
// tests/ai_render_safety.test.js — THE LAST METRE: PUTTING SOURCE TEXT ON A
//                                  SCREEN WITHOUT HANDING OVER THE SCREEN.
//
// A knowledge source is human-written text that ends up rendered inside a
// STAFF session. If that text can become markup, or a clickable link to a
// signed storage object, then "approve a source" quietly becomes "run code in
// an owner's browser" and "make a private file reachable". Both are leaks, not
// styling problems.
//
// Four properties, all pinned:
//   1. no dangerouslySetInnerHTML anywhere in the module;
//   2. excerpts pass a SECOND sanitiser on the render side (the database
//      neutralises too — a UI must not assume that about text it did not
//      produce);
//   3. a markdown link to a signed URL loses its href;
//   4. the four honest states (pending migration / denied / offline / error)
//      stay four states and are never collapsed.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { loadTs, TS_AVAILABLE } = require("./import_engine_loader");
const { R, FILES, stripComments } = require("./ai_helpers");

const LIB = R(FILES.LIB);
const CENTER = R(FILES.CENTER);
const ATOMS = R(FILES.ATOMS);
const PAGE = R(FILES.PUBLIC_PAGE);
const PORTAL_PAGE = R(FILES.PORTAL_PAGE);
const NAV = R(FILES.NAV);

// ─── 1) NO RAW HTML, ANYWHERE ──────────────────────────────────────────────

test("★ not one file in this module uses dangerouslySetInnerHTML", () => {
  // Scan CODE, not prose: the components' headers legitimately NAME the API in
  // order to state that it is absent. Matching a comment would make this test
  // fail on the very documentation that records the rule.
  for (const [name, src] of [["center", CENTER], ["atoms", ATOMS], ["public page", PAGE], ["portal page", PORTAL_PAGE]]) {
    const code = stripComments(src);
    assert.ok(!code.includes("dangerouslySetInnerHTML"), `${name} must never inject HTML`);
    assert.ok(!code.includes("innerHTML"), `${name} must not touch innerHTML at all`);
  }
  // And the rule is written down where a future editor will see it.
  assert.match(CENTER, /لا dangerouslySetInnerHTML/, "the component records the rule in its header");
});

test("★ no component builds a link href out of source text", () => {
  for (const [name, src] of [["center", CENTER], ["atoms", ATOMS], ["public page", PAGE]]) {
    const code = stripComments(src);
    // An <a> tag at all would be the first step; there is none in the evidence path.
    assert.ok(!/<a\s/.test(code), `${name} renders no anchor tags — a citation is text, not a route`);
    assert.ok(!/href=\{/.test(code), `${name} builds no dynamic href`);
    assert.ok(!/window\.open\(/.test(code), `${name} opens no window`);
  }
});

test("the excerpt is rendered as plain text inside a normal element", () => {
  assert.match(ATOMS, /const safe = aiSanitizeForDisplay\(e\.excerpt\)/, "the atom sanitises first");
  assert.match(ATOMS, /whiteSpace: "pre-wrap"[\s\S]{0,120}?\{safe\}/,
    "and renders the sanitised string as text — formatting via CSS, never via markup");
  assert.match(ATOMS, /مصدر معلومات لا تعليمات/,
    "★ and labels the excerpt as a source, so a staff reader is told it is data, not an instruction");
});

// ─── 2) THE SANITISER, EXECUTED ────────────────────────────────────────────

test("★ the sanitiser strips markup, invisible characters and signed links", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  const s = m.aiSanitizeForDisplay;

  assert.ok(!s("<script>alert(1)</script>").includes("<script>"), "script tags are gone");
  assert.ok(!s("<img src=x onerror=alert(1)>").includes("<img"), "image tags are gone");
  assert.ok(!s("hello <b>bold</b>").includes("<b>"), "even harmless markup is removed — markup is not content here");

  const zw = "hi​there‮reversed﻿";
  const clean = s(zw);
  for (const ch of ["​", "‮", "﻿"]) {
    assert.ok(!clean.includes(ch), "zero-width and bidi-override characters are removed");
  }
});

test("★ a markdown link to a SIGNED url loses its href but keeps its label", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  const out = m.aiSanitizeForDisplay("راجع [العقد](https://x.supabase.co/storage/v1/object/sign/private/a.pdf?token=eyJhbGciOi) اليوم");
  assert.ok(!out.includes("token="), "the token cannot reach the screen");
  assert.ok(!out.includes("object/sign"), "nor the signed path");
  assert.ok(out.includes("العقد"), "the human label survives, so the sentence still reads");
  assert.ok(out.includes("رابط-موقَّع-محذوف"), "and the removal is visible, not silent");
});

test("bare signed URLs and javascript: URLs are removed too", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  assert.ok(!m.aiSanitizeForDisplay("see https://s3.amazonaws.com/f.pdf?X-Amz-Signature=abc now").includes("X-Amz-Signature"),
    "presigned S3 links are removed");
  assert.ok(!m.aiSanitizeForDisplay("[click](javascript:alert(1))").includes("javascript:"),
    "javascript: markdown links are defanged");
  assert.ok(!m.aiSanitizeForDisplay("go to data:text/html;base64,PHNjcmlwdD4=").includes("data:text/html"),
    "data: URLs are removed");
});

test("the sanitiser never throws and never returns null", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  for (const v of [null, undefined, "", 0, 12345, {}, []]) {
    const out = m.aiSanitizeForDisplay(v);
    assert.strictEqual(typeof out, "string", `must return a string for ${JSON.stringify(v)}`);
  }
});

test("★ the ask path sanitises every excerpt before it can reach a component", { skip: !TS_AVAILABLE }, () => {
  const code = stripComments(LIB);
  assert.match(code, /excerpt: aiSanitizeForDisplay\(String\(e\.excerpt \?\? ""\)\)/,
    "aiAsk maps every evidence item through the sanitiser — not left to each caller to remember");
});

test("the public page sanitises independently — it does not rely on the internal helper", () => {
  assert.match(PAGE, /function safeText\(input: string\): string/, "the public page has its own sanitiser");
  assert.match(PAGE, /\{safeText\(e\.excerpt\)\}/, "and uses it on every excerpt");
  assert.ok(!/<a\s|href=\{/.test(stripComments(PAGE)), "and renders no links from source text");
});

// ─── 3) THE FOUR STATES STAY FOUR STATES ───────────────────────────────────

test("★ needs_migration, denied, offline and error are distinct — and only one may say «الترحيل»", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  assert.match(m.AI_PENDING_AR, /بانتظار تفعيل قاعدة البيانات/, "the migration message names the migration");
  assert.match(m.AI_PENDING_AR, /kian_ai_assistant_RUNME\.sql/, "and names the exact file to run");
  assert.match(m.AI_PENDING_AR, /لا يوجد خطأ في صلاحياتك/,
    "★ and says explicitly that this is NOT a permission problem — that confusion cost this project a production cycle");
  assert.match(m.AI_DENIED_AR, /لا تملك صلاحية/, "the denial says denial");
  assert.ok(!/ترحيل|migration/i.test(m.AI_DENIED_AR), "and never mentions a migration");
});

test("the component renders a different screen for each state", () => {
  assert.match(CENTER, /if \(s\.state === "needs_migration"\) return <PendingMigration \/>;/, "migration");
  assert.match(CENTER, /if \(s\.state === "denied"\) return <Denied message=\{s\.message\} \/>;/, "denial");
  assert.match(CENTER, /if \(s\.state === "offline"\) return <Offline message=\{s\.message\} \/>;/, "offline");
  assert.match(CENTER, /if \(s\.state === "error"\) return <ErrorBox message=\{s\.message\} \/>;/, "error");
  // And each atom explains its own cause rather than sharing one sentence.
  assert.match(ATOMS, /هذا ليس نقصًا في التطبيق ولا ترحيلة معلّقة/, "the denial atom rules out the migration story");
  assert.match(ATOMS, /لم يصل الطلب إلى قاعدة البيانات/, "the offline atom says the request never arrived");
});

test("★ an empty registry is reported as EMPTY, never as an error and never as a blank screen", () => {
  assert.match(CENTER, /السجلّ فارغ فعلًا/, "an empty registry says so, with the reason");
  assert.match(CENTER, /صفر حقيقيّ/, "and calls it a real zero");
  assert.match(ATOMS, /export function Empty\(\{ what, why \}/, "the empty atom carries a reason field at all");
  // knowledge_state from the database distinguishes the two reasons for zero.
  assert.match(R(FILES.RUNME), /'knowledge_state', case when not coalesce\(public\.ai_can_view_knowledge\(\), false\) then 'not_permitted'\s*\n?\s*when v_approved = 0 then 'empty_registry' else 'ready' end/,
    "★ and the database distinguishes 'you may not see it' from 'there is nothing' — one zero, two very different meanings");
});

// ─── 4) THE INTERNAL SURFACE IS INTERNAL ───────────────────────────────────

test("★ the assistant tab is absent from every client-facing role set", () => {
  const sets = NAV.slice(NAV.indexOf("const SETS:"));
  const clientLine = /client:\s*\[(.*?)\]/s.exec(sets);
  const leadLine = /lead:\s*\[(.*?)\]/s.exec(sets);
  assert.ok(clientLine && leadLine, "the client and lead sets exist");
  assert.ok(!clientLine[1].includes("ai_assistant"), "a client never sees the assistant tab");
  assert.ok(!leadLine[1].includes("ai_assistant"), "nor does a lead");
  // And it IS present for internal roles, otherwise this test proves nothing.
  assert.match(sets, /admin:\s*\[[^\]]*"ai_assistant"/, "the admin set has it");
});

test("the nav entry documents that the tab grants nothing", () => {
  const entry = NAV.slice(NAV.indexOf("مساعد كيان (المرحلة C)"), NAV.indexOf("ai_assistant:") + 200);
  assert.match(entry, /ai_can_use_internal/, "it names the database gate");
  assert.match(entry, /لا يمنح هذا السطر شيئًا/, "and says the tab is not an authorisation");
});

test("the internal page states the provider is off, before any interaction", () => {
  assert.match(PORTAL_PAGE, /لا يوجد نموذج لغويّ مُفعّل في هذه النسخة/, "the page header is honest");
  assert.match(PORTAL_PAGE, /لا نداء خارجيّ، ولا تنفيذ أدوات، ولا إجراء تلقائيّ/, "and enumerates what does not happen");
});

test("the source editor warns about forbidden material BEFORE anything is typed", () => {
  assert.match(CENTER, /لا تُدخل هنا ملفّات عملاء ولا مخرجات مشاريع ولا مستندات بنكية/,
    "the editor's note lists what may never be ingested");
  assert.match(CENTER, /القاعدة تفحص المحتوى وترفض ما يحوي سرًّا/,
    "and points out that the database scans and refuses, so the warning is not the only control");
  assert.match(CENTER, /العميل والزائر لا يبلغان إلّا المصادر العامّة/,
    "and the external-role combination is flagged in the UI before the constraint fires");
});
