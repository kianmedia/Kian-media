// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_calendar_token_mutation.test.js
//
// Wave 3 · §7 من أمر التشغيل — **مراجعة أمنية معادة** لحزمة رموز التقويم،
// لأنّها أعلى حزمة خطورة في الموجة: تمنح `anon` تنفيذ دالّة.
//
// ★ لماذا فحص طفريّ وليس فحص وجود ★
// اختبار يقول «الحارس موجود» يمرّ أيضًا لو كان الحارس معطَّلًا أو في المكان
// الخطأ. الفحص الطفريّ يكسر كلّ حارس على حدة ويشترط أن **يفشل** الفحص المقابل.
// حارسٌ حذفه لا يُسقط الاختبار ليس حارسًا.
//
// ⛔ لا تشغيل SQL · لا قاعدة · لا شبكة. تحليل نصّيّ بحت.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const SQL = () => read("docs/wave3_calendar_tokens_RUNME.sql");
/** بلا تعليقات — ترويسة الحزمة تشرح "SECURITY DEFINER" نصًّا، فتُفسد أيّ عدّ. */
const noComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const ROUTE = () => read("app/api/calendar/[token]/route.ts");

/** جسم دالّة التغذية وحده — الحارس الحقيقيّ يعيش هنا. */
const feedFn = (s = SQL()) => {
  const i = s.indexOf("function public.prodops_calendar_feed");
  return s.slice(i, s.indexOf("$$;", i));
};
/** ما قبل أوّل SELECT داخل التغذية — كلّ فحص يجب أن يقع هنا. */
const preSelect = (s = SQL()) => {
  const f = feedFn(s);
  return f.slice(0, f.indexOf("select * into r"));
};

/** يؤكّد أنّ `check` يفشل على النصّ المطفَّر. */
const catches = (label, mutate, check) => {
  const mutated = mutate(SQL());
  assert.notEqual(mutated, SQL(), `الطفرة لم تغيّر شيئًا (نمط قديم؟): ${label}`);
  let threw = false;
  try { check(mutated); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

// ─── ١ · الوصول والصلاحيات ─────────────────────────────────────────────────

test("(X-1) ★★★ REVOKE قبل GRANT — والترتيب نفسه مُختبَر ★★★", () => {
  const s = SQL();
  const iRevoke = s.indexOf("revoke all on function public.prodops_calendar_feed(text) from public, authenticated;");
  const iGrant = s.indexOf("grant execute on function public.prodops_calendar_feed(text) to anon");
  assert.ok(iRevoke > -1, "لا REVOKE على التغذية");
  assert.ok(iGrant > -1, "لا GRANT للتغذية");
  // 🔴 الترتيب: منحٌ قبل سحب يترك صلاحية موروثة قائمة.
  assert.ok(iRevoke < iGrant, "🔴 GRANT قبل REVOKE — صلاحية موروثة قد تبقى");

  catches("حذف REVOKE", (m) => m.replace("revoke all on function public.prodops_calendar_feed(text) from public, authenticated;", ""),
    (m) => assert.ok(m.includes("revoke all on function public.prodops_calendar_feed(text) from public, authenticated;")));
});

test("(X-2) ★★★ anon يملك التغذية وحدها — لا دالّة أخرى ولا جدول ★★★", () => {
  const s = SQL();
  const granted = [...s.matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\)\s+to\s+([^;]+);/gi)]
    .filter((m) => /\banon\b/.test(m[2])).map((m) => m[1]);
  assert.deepEqual(granted, ["prodops_calendar_feed"],
    `🔴 anon يملك: ${granted.join(", ") || "لا شيء"} — يجب أن تكون التغذية وحدها`);
  assert.match(s, /revoke all on public\.ops_calendar_tokens from anon, public;/,
    "🔴 لا REVOKE على الجدول — قراءة مباشرة تلتفّ على الدالّة كلّها");
  // ولا منح شامل في أيّ مكان.
  assert.doesNotMatch(s, /grant\s+all\b/i, "🔴 منح شامل");
  assert.doesNotMatch(s, /to\s+public\s*;/i, "🔴 منح لـpublic");

  catches("منح الإصدار لـanon",
    (m) => m.replace("grant execute on function public.prodops_calendar_token_issue(text,text,integer,integer) to authenticated;",
                     "grant execute on function public.prodops_calendar_token_issue(text,text,integer,integer) to authenticated, anon;"),
    (m) => {
      const g = [...m.matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\)\s+to\s+([^;]+);/gi)]
        .filter((x) => /\banon\b/.test(x[2])).map((x) => x[1]);
      assert.deepEqual(g, ["prodops_calendar_feed"]);
    });
});

test("(X-3) ★★★ SECURITY DEFINER محصَّن: search_path مثبَّت على كلّ دالّة ★★★", () => {
  const s = SQL();
  const code = noComments(s);
  const defs = (code.match(/security\s+definer/gi) || []).length;
  const paths = (code.match(/set\s+search_path\s*=\s*public/gi) || []).length;
  assert.ok(defs >= 3, `عدد الدوالّ ${defs}`);
  assert.equal(defs, paths, `🔴 ${defs - paths} دالّة بلا search_path مثبَّت — قابلة للاختطاف بمخطّط وهميّ`);

  catches("إسقاط search_path من التغذية",
    (m) => m.replace("create or replace function public.prodops_calendar_feed(p_token text)\nreturns jsonb\nlanguage plpgsql volatile security definer set search_path = public, extensions as $$",
                     "create or replace function public.prodops_calendar_feed(p_token text)\nreturns jsonb\nlanguage plpgsql volatile security definer as $$"),
    (m) => {
      const c = noComments(m);
      assert.equal((c.match(/security\s+definer/gi) || []).length,
                   (c.match(/set\s+search_path\s*=\s*public/gi) || []).length);
    });
});

// ─── ٢ · الحارس قبل القراءة (NULL-collapse) ───────────────────────────────

test("(X-4) ★★★ NULL و الطول و الشكل — كلّها قبل أيّ SELECT ★★★", () => {
  const g = preSelect();
  assert.match(g, /p_token is null/, "🔴 لا رفض صريح لـNULL");
  assert.match(g, /length\(p_token\) <> 64/, "🔴 لا فحص طول");
  assert.match(g, /\^\[0-9a-f\]\{64\}\$/, "🔴 لا فحص شكل");

  // 🔴 هذه الطفرة بالذات هي حادثة التسريب السابقة بحرفها.
  catches("حذف فحص NULL",
    (m) => m.replace("  if p_token is null\n     or length(p_token) <> 64",
                     "  if length(p_token) <> 64"),
    (m) => assert.match(preSelect(m), /p_token is null/));

  catches("تحويل المطابقة إلى LIKE",
    (m) => m.replace("where token_hash = v_hash", "where token_hash like v_hash"),
    (m) => {
      assert.match(feedFn(m), /where token_hash = v_hash/);
      assert.doesNotMatch(feedFn(m), /token_hash\s+like/i);
    });
});

test("(X-5) ★★★ الحالات الأربع تُرفض قبل قراءة أيّ مهمّة ★★★", () => {
  const f = feedFn();
  const iJobs = f.indexOf("from public.ops_jobs");
  assert.ok(iJobs > -1, "التغذية لا تقرأ المهامّ أصلًا");
  for (const [k, label] of [["invalid_token", "رمز غير صالح"], ["'revoked'", "ملغى"],
                            ["expires_at <= v_now", "منتهٍ"], ["opens_used >= r.max_opens", "مستنفد"]]) {
    const i = f.indexOf(k);
    assert.ok(i > -1, `فحص مفقود: ${label}`);
    assert.ok(i < iJobs, `🔴 ${label} يُفحص بعد قراءة المهامّ`);
  }
  // الانتهاء إلزاميّ على مستوى المخطّط، لا اختياريّ.
  assert.match(SQL(), /expires_at\s+timestamptz not null/, "🔴 رمز بلا انتهاء ممكن");
  assert.match(SQL(), /constraint ops_cal_token_window check \(expires_at > issued_at\)/,
    "🔴 نافذة صلاحية معكوسة ممكنة");

  catches("نقل فحص الإلغاء إلى ما بعد القراءة",
    (m) => m.replace("  if r.status = 'revoked' then\n    return jsonb_build_object('ok', false, 'reason', 'revoked');\n  end if;\n", ""),
    (m) => {
      const ff = feedFn(m);
      assert.ok(ff.indexOf("'revoked'") > -1 && ff.indexOf("'revoked'") < ff.indexOf("from public.ops_jobs"));
    });
});

// ─── ٣ · النطاق وأقلّ امتياز ───────────────────────────────────────────────

test("(X-6) ★★★ النطاق على صاحب الرمز — لا auth.uid() في مسار مجهول ★★★", () => {
  const f = feedFn();
  assert.match(f, /c\.user_id = r\.owner_user_id/, "🔴 النطاق لا يُقيَّم على صاحب الرمز");
  // 🔴 auth.uid() يساوي NULL لقارئ بلا جلسة ⇒ الشرط يصير NULL ⇒ انهيار الحارس.
  assert.doesNotMatch(f, /auth\.uid\(\)/, "🔴 دالّة تُقرأ بلا جلسة تعتمد على auth.uid()");

  catches("تحويل النطاق إلى auth.uid()",
    (m) => m.replace("c.user_id = r.owner_user_id", "c.user_id = auth.uid()"),
    (m) => {
      assert.match(feedFn(m), /c\.user_id = r\.owner_user_id/);
      assert.doesNotMatch(feedFn(m), /auth\.uid\(\)/);
    });

  // أقلّ امتياز عند الإصدار: 'all' للإدارة وحدها.
  const s = SQL();
  const issue = s.slice(s.indexOf("function public.prodops_calendar_token_issue"));
  assert.match(issue, /p_scope = 'all' and not public\.prodops_can_manage\(\)/, "🔴 'all' بلا صلاحية إدارة");
  catches("إسقاط شرط الإدارة عن نطاق all",
    (m) => m.replace("if p_scope = 'all' and not public.prodops_can_manage() then\n    raise exception 'not authorized' using errcode = '42501';\n  end if;", ""),
    (m) => assert.match(m.slice(m.indexOf("function public.prodops_calendar_token_issue")),
                        /p_scope = 'all' and not public\.prodops_can_manage\(\)/));
});

// ─── ٤ · الرمز نفسه ────────────────────────────────────────────────────────

test("(X-7) ★★★ الرمز الخامّ لا يُخزَّن ولا يصل القاعدة ★★★", () => {
  const s = SQL();
  assert.match(s, /token_hash\s+text not null unique/, "البصمة ليست فريدة");
  assert.match(s, /check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, "لا قيد شكل على العمود نفسه");
  assert.match(s, /digest\(v_raw, 'sha256'\)/, "الرمز لا يُهشَّم");
  // ⛔ ولا عمود يحمل الرمز الخامّ.
  assert.doesNotMatch(s, /\btoken_raw\b|\braw_token\b|\btoken_plain\b/, "🔴 عمود للرمز الخامّ");
  // 🔴 والتهشيم يقع **داخل القاعدة**: المسار يمرّر الخامّ ولا يهشّم.
  //    (كان يهشّم ويرسل البصمة، فصارت البصمة المخزَّنة بيان اعتماد صالحًا.)
  assert.match(s, /digest\s*\(\s*p_token\s*,\s*'sha256'\s*\)/,
    "الدالّة لا تحسب البصمة من الرمز الخامّ");
  const r = ROUTE();
  assert.doesNotMatch(r, /createHash|node:crypto/, "🔴 عاد التهشيم إلى المسار");
  assert.match(r, /p_token:\s*raw/, "🔴 المسار لا يُرسل الرمز الخامّ");

  catches("تخزين الرمز الخامّ",
    (m) => m.replace("  token_hash      text not null unique", "  token_raw       text,\n  token_hash      text not null unique"),
    (m) => assert.doesNotMatch(m, /\btoken_raw\b/));
});

test("(X-8) ★★★ ردّ رفض موحَّد — لا مقياس لمن يجرّب الرموز ★★★", () => {
  const r = ROUTE();
  // كلّ رفض يمرّ بمصدر واحد، وبنفس النصّ ونفس الرمز.
  assert.equal((r.match(/const gone = \(\) =>/g) || []).length, 1, "أكثر من مسار رفض");
  assert.ok((r.match(/return gone\(\)/g) || []).length >= 6, "ليست كلّ الرفوض موحَّدة");
  const statuses = [...r.matchAll(/status:\s*(\d{3})/g)].map((m) => m[1]);
  for (const bad of ["401", "403", "410", "429"]) {
    assert.ok(!statuses.includes(bad), `🔴 رمز حالة ${bad} يميّز سبب الرفض`);
  }
  // 🔴 ولا يُعاد سبب الرفض من القاعدة إلى العميل.
  assert.doesNotMatch(r, /payload\.reason/, "🔴 سبب الرفض يُعاد للعميل");

  catches("تمييز الملغى بـ403",
    () => ROUTE().replace('if (!payload?.ok) return gone();',
                          'if (payload?.reason === "revoked") return new Response("revoked", { status: 403 });\n  if (!payload?.ok) return gone();'),
    (m) => {
      const st = [...m.matchAll(/status:\s*(\d{3})/g)].map((x) => x[1]);
      assert.ok(!st.includes("403"));
    });
});

test("(X-9) ★★ لا تخزين وسيط ولا فهرسة ولا تسرّب في Referer ★★", () => {
  const r = ROUTE();
  // نسخة مُخبَّأة تُبقي رمزًا ملغى حيًّا بعد إلغائه.
  assert.match(r, /"cache-control": "no-store, no-cache, must-revalidate, private"/, "🔴 التغذية قابلة للتخزين الوسيط");
  assert.match(r, /"x-robots-tag": "noindex, nofollow"/, "🔴 رابط يحمل بيان اعتماد قابل للفهرسة");
  assert.match(r, /"referrer-policy": "no-referrer"/, "🔴 الرمز قد يتسرّب في Referer");
  // ⛔ ولا Service Key: سيتجاوز الحارس داخل الدالّة بالكامل.
  assert.doesNotMatch(r, /SERVICE_ROLE|SERVICE_KEY/, "🔴 Service Key في مسار عامّ برمز");
  // وخلف علم مطفأ افتراضًا.
  assert.match(r, /NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED === "true"/, "بلا حارس علم");
});

// ─── ٥ · حدّ الاستهلاك ─────────────────────────────────────────────────────

test("(X-10) ★★ سقف الفتحات هو ضابط الاستهلاك، وهو محسوب فعلًا ★★", () => {
  const s = SQL();
  const f = feedFn();
  // الاستراتيجية الموثَّقة: سقف فتحات لكلّ رمز + انتهاء إلزاميّ + إلغاء فوريّ.
  assert.match(s, /max_opens\s+integer check \(max_opens is null or max_opens between 1 and 100000\)/,
    "لا سقف فتحات");
  assert.match(s, /opens_used\s+integer not null default 0/, "لا عدّاد");
  // 🔴 العدّاد يُزاد فعلًا — سقف لا يُحسب ليس سقفًا.
  assert.match(f, /set opens_used = opens_used \+ 1, last_opened_at = v_now/, "🔴 العدّاد لا يُزاد");
  assert.match(f, /'exhausted'/, "لا حالة استنفاد");

  catches("إسقاط زيادة العدّاد",
    (m) => m.replace("  update public.ops_calendar_tokens\n     set opens_used = opens_used + 1, last_opened_at = v_now\n   where id = r.id;\n", ""),
    (m) => assert.match(feedFn(m), /set opens_used = opens_used \+ 1/));
});

test("(X-11) ★★★ لا حقل زائد يخرج في ICS ★★★", () => {
  const f = feedFn();
  // المخرجات قائمة بيضاء صريحة — لا `select *` ولا `row_to_json`.
  assert.doesNotMatch(f, /jsonb_agg\(to_jsonb\(|row_to_json|select\s+j\.\*/i,
    "🔴 تصدير كامل الصفّ إلى تغذية قد تُشارَك");
  for (const leak of ["phone", "rate", "cost", "client", "budget", "salary", "note"]) {
    assert.doesNotMatch(f, new RegExp(`'${leak}'`, "i"), `🔴 حقل حسّاس في التغذية: ${leak}`);
  }
  // والبنّاء لا يضيف ما لم يصله.
  const ics = read("lib/production/ics.ts");
  assert.doesNotMatch(ics, /ATTENDEE|ORGANIZER|CONTACT/, "🔴 حقول iCal تحمل هويّات أشخاص");
});
