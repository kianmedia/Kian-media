// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_calendar_ics.test.js
//
// Wave 3 · V2-3.6-A/B — تغذية ICS ورموز التقويم القابلة للإلغاء.
//
// لا شبكة · لا قاعدة · لا Production. المسار الخادميّ يُفحص نصًّا (عقد أمنيّ)،
// وبناء ICS يُنفَّذ فعليًّا.
//
// ★ التركيز على ما يكسر التغذية حقًّا: التهريب وطيّ السطور بالثمانيّات.
//   عنوان مهمّة عربيّ فيه فاصلة يُفسد الملفّ كلّه إن لم يُهرَّب، ويرفضه العميل
//   بصمت — بلا رسالة خطأ يراها أحد.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const loadTs = (rel) => {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};
const ICS = loadTs("lib/production/ics.ts");

const NOW = new Date("2026-08-03T09:00:00Z");
const EV = {
  id: "11111111-1111-1111-1111-111111111111",
  code: "JOB-42", title: "تصوير مؤسسي",
  start: "2026-08-04T05:00:00Z", end: "2026-08-04T13:00:00Z",
  status: "scheduled", location: "استوديو الدمّام", city: "الدمّام",
};

// ─── البنية ────────────────────────────────────────────────────────────────

test("(I-1) ★★ VCALENDAR صالح بنهايات CRLF ★★", () => {
  const out = ICS.buildIcs([EV], { now: NOW });
  assert.ok(out.startsWith("BEGIN:VCALENDAR\r\n"), "لا بداية صحيحة");
  assert.ok(out.endsWith("END:VCALENDAR\r\n"), "لا نهاية صحيحة");
  // 🔴 CRFC 5545 يوجب CRLF؛ بعض العملاء يرفض LF وحده.
  assert.doesNotMatch(out.replace(/\r\n/g, ""), /\n/, "🔴 سطر بـLF مجرَّد");
  assert.match(out, /VERSION:2\.0/);
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((out.match(/END:VEVENT/g) || []).length, 1);
  assert.match(out, /DTSTART:20260804T050000Z/);
  assert.match(out, /DTEND:20260804T130000Z/);
});

test("(I-2) ★★★ UID ثابت — التحديث يعدّل الحدث ولا يُكرّره ★★★", () => {
  const a = ICS.buildIcs([EV], { now: NOW });
  const b = ICS.buildIcs([{ ...EV, title: "عنوان معدَّل" }], { now: new Date("2026-08-05T10:00:00Z") });
  const uid = (s) => s.match(/UID:([^\r\n]+)/)[1];
  assert.equal(uid(a), uid(b), "🔴 UID تغيّر ⇒ يظهر حدثان في تقويم المستخدم");
  assert.match(uid(a), new RegExp(`^${EV.id}@`), "UID غير مشتقّ من هويّة المهمّة");
});

test("(I-3) ★★ حدث بلا بداية صالحة يُسقَط ولا يُخترع له وقت ★★", () => {
  const out = ICS.buildIcs(
    [{ ...EV, start: null }, { ...EV, id: "x", start: "غير-تاريخ" }, { ...EV, id: "", start: EV.start }, EV],
    { now: NOW },
  );
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1, "🔴 حدث بلا بداية صالحة دخل التغذية");
  // ولا تنهار على مدخلات فاسدة تمامًا.
  for (const junk of [null, undefined, [], [null], [{}], [{ id: "a" }]]) {
    assert.doesNotThrow(() => ICS.buildIcs(junk, { now: NOW }), `انهار على ${JSON.stringify(junk)}`);
  }
  assert.match(ICS.emptyIcs({ now: NOW }), /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
});

test("(I-4) ★ بلا نهاية مسجَّلة تُستعمل مدّة معلَنة ★", () => {
  const out = ICS.buildIcs([{ ...EV, end: null }], { now: NOW });
  assert.match(out, /DTEND:20260804T090000Z/, "المدّة الافتراضية ٤ ساعات لم تُطبَّق");
  assert.equal(ICS.DEFAULT_DURATION_HOURS, 4);
});

// ─── التهريب: ما يكسر الملفّ فعليًّا ───────────────────────────────────────

test("(I-5) ★★★ التهريب: فاصلة أو فاصلة منقوطة أو سطر جديد لا يكسر التغذية ★★★", () => {
  assert.equal(ICS.escapeText("أ,ب"), "أ\\,ب");
  assert.equal(ICS.escapeText("أ;ب"), "أ\\;ب");
  assert.equal(ICS.escapeText("أ\nب"), "أ\\nب");
  assert.equal(ICS.escapeText("أ\r\nب"), "أ\\nب", "CRLF لم يُوحَّد");
  // 🔴 العكسيّة أوّلًا وإلّا ضوعف تهريبها: "\," تصير "\\\," لا "\\,".
  assert.equal(ICS.escapeText("أ\\ب"), "أ\\\\ب");
  assert.equal(ICS.escapeText("a\\,b"), "a\\\\\\,b", "🔴 ترتيب التهريب مقلوب");
  assert.equal(ICS.escapeText(null), "");
  assert.equal(ICS.escapeText(undefined), "");

  // وفي ملفّ حقيقي: عنوان فيه فاصلة لا يُنتج سطرًا مكسورًا.
  const out = ICS.buildIcs([{ ...EV, title: "تصوير, تركيب; ومونتاج", location: "شارع الملك\nفهد" }], { now: NOW });
  const summary = out.match(/SUMMARY:([^\r\n]*)/)[1];
  assert.ok(summary.includes("\\,") && summary.includes("\\;"), "لم يُهرَّب العنوان");
  assert.match(out, /LOCATION:[^\r\n]*\\n/, "لم يُهرَّب السطر الجديد في الموقع");
  // ولا سطر خامّ يبدأ بمحتوى غير كلمة مفتاحية (دليل على كسر البنية).
  for (const line of out.split("\r\n").filter(Boolean)) {
    assert.ok(/^[A-Z-]+[;:]/.test(line) || line.startsWith(" "),
      `🔴 سطر مكسور خارج البنية: ${JSON.stringify(line)}`);
  }
});

test("(I-6) ★★★ الطيّ بالثمانيّات لا بالمحارف — والعربية هي الفرق ★★★", () => {
  const enc = new TextEncoder();
  // الحرف العربيّ ثمانيّتان: ٦٠ حرفًا = ١٢٠ ثمانيّة، فالطيّ بعدّ المحارف يفشل.
  const long = "م".repeat(200);
  const folded = ICS.foldLine(`SUMMARY:${long}`);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1, "🔴 لم يُطوَ سطر طوله ٤٠٠+ ثمانيّة");
  for (const [i, p] of parts.entries()) {
    assert.ok(enc.encode(p).length <= 75, `الجزء ${i} = ${enc.encode(p).length} ثمانيّة > 75`);
    if (i > 0) assert.ok(p.startsWith(" "), `الجزء ${i} بلا مسافة استمرار`);
  }
  // ⛔ والأهم: لا محرف معطوب — إعادة التركيب تُطابق الأصل تمامًا.
  const rejoined = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("");
  assert.equal(rejoined, `SUMMARY:${long}`, "🔴 الطيّ قصّ داخل محرف متعدّد الثمانيّات");
  // سطر قصير يمرّ كما هو.
  assert.equal(ICS.foldLine("VERSION:2.0"), "VERSION:2.0");
});

test("(I-7) ★★ الملغاة تُعلَّم CANCELLED لا تختفي ★★", () => {
  const out = ICS.buildIcs([{ ...EV, status: "cancelled" }], { now: NOW });
  assert.match(out, /STATUS:CANCELLED/, "🔴 مهمّة ملغاة تبقى مؤكَّدة في التقويم");
  assert.match(ICS.buildIcs([EV], { now: NOW }), /STATUS:CONFIRMED/);
});

test("(I-8) ★★★ لا حقل حسّاس يخرج في التغذية ★★★", () => {
  // حتى لو مرَّرت القاعدة حقولًا زائدة، البنّاء لا يطبع إلّا ما يعرفه.
  const out = ICS.buildIcs(
    [{ ...EV, phone: "0503422999", rate: 5000, client_name: "عميل سرّي", notes: "ملاحظة داخلية" }],
    { now: NOW },
  );
  for (const leak of ["0503422999", "عميل سرّي", "ملاحظة داخلية"]) {
    assert.ok(!out.includes(leak), `🔴 تسرّب في تغذية قد تُشارَك: ${leak}`);
  }
  // ⚠️ الأجر رقم قد يصادف أرقام التوقيت (T050000Z يحوي "5000")، فيُفحص على
  // السطور النصّية وحدها بدل بحث ساذج في الملفّ كلّه.
  for (const line of out.split("\r\n").filter((l) => /^(SUMMARY|DESCRIPTION|LOCATION):/.test(l))) {
    assert.ok(!/5000/.test(line), `🔴 الأجر تسرّب في: ${line}`);
  }
  // ولا مفاتيح غير متوقَّعة إطلاقًا — الحصر أقوى من قائمة ممنوعات.
  const keys = new Set(out.split("\r\n").filter(Boolean).filter((l) => !l.startsWith(" "))
    .map((l) => l.split(/[;:]/)[0]));
  const ALLOWED = new Set(["BEGIN","END","VERSION","PRODID","CALSCALE","METHOD","X-WR-CALNAME",
    "REFRESH-INTERVAL","X-PUBLISHED-TTL","UID","DTSTAMP","DTSTART","DTEND","SUMMARY","LOCATION",
    "DESCRIPTION","STATUS"]);
  for (const k of keys) assert.ok(ALLOWED.has(k), `🔴 حقل غير متوقَّع في التغذية: ${k}`);
});

// ─── عقد المسار والرمز ─────────────────────────────────────────────────────

const ROUTE = () => read("app/api/calendar/[token]/route.ts");

test("(R-1) ★★★ الرمز الخامّ لا يصل القاعدة — تُرسَل بصمته ★★★", () => {
  const r = ROUTE();
  assert.match(r, /createHash\("sha256"\)/, "لا تهشيم للرمز");
  assert.match(r, /p_token_hash: hash/, "🔴 يُرسَل شيء غير البصمة");
  assert.doesNotMatch(r, /p_token_hash:\s*raw|p_token:\s*raw/, "🔴 الرمز الخامّ يُرسَل للقاعدة");
  assert.match(r, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(raw\)/, "لا فحص شكل قبل العمل");
});

test("(R-2) ★★★ ردّ موحَّد: لا يميّز الملغى من غير الموجود ★★★", () => {
  const r = ROUTE();
  // مصدر واحد لكل رفض ⇒ لا مقياس لمن يجرّب الرموز.
  const statuses = [...r.matchAll(/status:\s*(\d{3})/g)].map((m) => m[1]);
  assert.ok(!statuses.includes("403") && !statuses.includes("401"),
    "🔴 رمز حالة يميّز سبب الرفض");
  assert.equal((r.match(/const gone = \(\) =>/g) || []).length, 1, "أكثر من مسار رفض");
  assert.ok((r.match(/return gone\(\)/g) || []).length >= 5, "ليست كلّ الرفوض عبر الردّ الموحَّد");
});

test("(R-3) ★★★ لا Service Key، ولا تخزين وسيط، ولا فهرسة ★★★", () => {
  const r = ROUTE();
  // 🔴 مفتاح خدمة هنا يتجاوز كامل الحارس داخل الدالّة.
  assert.doesNotMatch(r, /SERVICE_ROLE|SERVICE_KEY/, "🔴 Service Key في مسار عامّ برمز");
  assert.match(r, /"cache-control": "no-store/, "🔴 نسخة مُخبَّأة تُبقي رمزًا ملغى حيًّا");
  assert.match(r, /"x-robots-tag": "noindex/, "رابط يحمل بيان اعتماد قابل للفهرسة");
  assert.match(r, /"referrer-policy": "no-referrer"/, "الرمز قد يتسرّب في Referer");
  assert.match(r, /text\/calendar/, "نوع المحتوى ليس تقويمًا");
  // خلف علم مطفأ افتراضًا.
  assert.match(r, /NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED === "true"/, "بلا حارس علم");
});

const SQL = () => read("docs/wave3_calendar_tokens_RUNME.sql");

test("(R-4) ★★★ عقد SQL: anon يملك التغذية وحدها، والحارس قبل أي قراءة ★★★", () => {
  const s = SQL();
  // 🔴 الدرس المستفاد من حادثة تسريب سابقة: REVOKE ثمّ GRANT محدَّد.
  assert.match(s, /revoke all on function public\.prodops_calendar_feed\(text\) from public;/,
    "لا REVOKE قبل المنح");
  assert.match(s, /grant execute on function public\.prodops_calendar_feed\(text\) to anon, authenticated;/,
    "التغذية غير ممنوحة لـanon");
  for (const fn of ["prodops_calendar_token_issue", "prodops_calendar_token_revoke"]) {
    const g = new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated;`);
    assert.match(s, g, `${fn} غير ممنوحة للمُصادَق`);
    assert.doesNotMatch(s, new RegExp(`grant execute on function public\\.${fn}[^;]*anon`),
      `🔴 ${fn} ممنوحة لـanon`);
  }
  assert.match(s, /revoke all on public\.ops_calendar_tokens from anon, public;/,
    "🔴 لا REVOKE على الجدول نفسه");

  // 🔴 NULL-collapse: الحارس يرفض NULL صراحةً قبل أيّ SELECT.
  const feed = s.slice(s.indexOf("function public.prodops_calendar_feed"));
  const guard = feed.slice(0, feed.indexOf("select * into r"));
  assert.match(guard, /p_token_hash is null/, "🔴 لا رفض صريح لـNULL — هذا هو الانهيار السابق بعينه");
  assert.match(guard, /length\(p_token_hash\) <> 64/, "لا فحص طول");
  assert.match(guard, /\^\[0-9a-f\]\{64\}\$/, "لا فحص شكل");
  // مطابقة تامّة لا LIKE.
  assert.match(feed, /where token_hash = p_token_hash/, "المطابقة ليست تامّة");
  assert.doesNotMatch(feed, /token_hash\s+like/i, "🔴 مطابقة LIKE على بصمة");
});

test("(R-5) ★★★ النطاق يُقيَّم على صاحب الرمز لا على المستدعي المجهول ★★★", () => {
  const s = SQL();
  const feed = s.slice(s.indexOf("function public.prodops_calendar_feed"));
  assert.match(feed, /c\.user_id = r\.owner_user_id/,
    "🔴 النطاق يُقيَّم على auth.uid() — وهو NULL لقارئ مجهول ⇒ انهيار الحارس");
  assert.doesNotMatch(feed, /auth\.uid\(\)/,
    "🔴 دالّة تُقرأ بلا جلسة تعتمد على auth.uid()");
  // الحالات الأربع كلّها مرفوضة قبل قراءة أيّ مهمّة.
  for (const k of ["revoked", "expired", "exhausted"]) {
    assert.ok(feed.indexOf(`'${k}'`) < feed.indexOf("from public.ops_jobs"),
      `🔴 ${k} يُفحص بعد قراءة المهامّ`);
  }
  // أقلّ امتياز عند الإصدار.
  const issue = s.slice(s.indexOf("function public.prodops_calendar_token_issue"));
  assert.match(issue, /p_scope = 'all' and not public\.prodops_can_manage\(\)/,
    "🔴 نطاق 'all' يُمنح بلا صلاحية إدارة");
  // والإلغاء يوجب سببًا مكتوبًا.
  assert.match(s, /reason_required/, "الإلغاء بلا سبب");
});

test("(R-6) ★★ الرمز يُخزَّن مهشَّمًا فقط، والتلميح لا يكشفه ★★", () => {
  const s = SQL();
  assert.match(s, /token_hash\s+text not null unique/, "البصمة ليست فريدة");
  assert.match(s, /check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, "لا قيد شكل على البصمة");
  assert.match(s, /digest\(v_raw, 'sha256'\)/, "الرمز لا يُهشَّم عند الإصدار");
  // ⛔ ولا عمود يحمل الرمز الخامّ.
  assert.doesNotMatch(s, /token_raw|raw_token|token\s+text not null/, "🔴 عمود للرمز الخامّ");
  assert.match(s, /right\(v_raw, 6\)/, "التلميح ليس ٦ محارف");
  assert.match(s, /enable row level security/, "الجدول بلا RLS");
});
