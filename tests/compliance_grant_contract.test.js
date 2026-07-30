// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_grant_contract.test.js — أحدّ سطح في الحزمة.
//
// رمز قويّ · **بصمة فقط** · منتهٍ · قابل للإلغاء · محدود الاستعمال ·
// لا يكشف مسارًا · لا يبلغ وثيقة خارج منحته · يتوقّف مع إلغاء الوثيقة ·
// لا يعطي فهرسة · ⛔ ولا يُرسَل بالبريد.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, read, stripCommentsAndStrings, funcBody, selfTest,
  GRANT_FIELDS, CODE_FILES, DOCS,
} = require("./compliance_helpers.js");

const OPEN = "vcc_grant_open";

test("كلّ حقول المنحة المطلوبة في العقد موجودة", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_document_grants\s*\(([\s\S]*?)\n\);/i.exec(CODE);
  assert.ok(t, "جدول المنح غير مقروء");
  for (const f of GRANT_FIELDS) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(t[1]), `حقل المنحة مفقود: ${f}`);
  }
});

test("★★ الرمز يُخزَّن بصمةً فقط — لا عمود يحمل رمزًا خامًّا", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_document_grants\s*\(([\s\S]*?)\n\);/i.exec(CODE)[1];
  assert.match(t, /token_hash\s+text\s+unique/i, "لا عمود بصمة فريد");
  for (const bad of ["  token ", "raw_token", "token_plain", "secret"]) {
    assert.ok(!t.includes(bad), `عمود يحمل الرمز الخام: ${bad.trim()}`);
  }
  // والبصمة sha256 بستّين حرفًا.
  assert.match(t, /token_hash[^,]*\^\[0-9a-f\]\{64\}\$/i, "البصمة بلا قيد شكل");
});

test("★★ الإصدار يهشّم ولا يكتب الرمز الخام في أيّ جدول", () => {
  const iss = funcBody("vcc_grant_issue");
  assert.ok(iss, "vcc_grant_issue مفقودة");
  assert.match(iss, /encode\s*\(\s*sha256\s*\(\s*convert_to\s*\(\s*v_token/i, "الرمز لا يُهشَّم بـsha256");
  assert.match(iss, /set\s+token_hash\s*=\s*v_hash/i, "لا تُخزَّن البصمة");
  // ولا يُخزَّن الرمز نفسه.
  assert.doesNotMatch(iss, /token\s*=\s*v_token/i, "الرمز الخام يُكتب في القاعدة");
  assert.doesNotMatch(iss, /token_hint\s*=\s*v_token\b/, "التلميح هو الرمز كاملًا");
  assert.match(iss, /right\s*\(\s*v_token\s*,\s*6\s*\)/i, "التلميح ليس آخر ستّة محارف");
});

test("★ الرمز عشوائيّ قويّ (≥ ٢٤٠ بت)", () => {
  const iss = funcBody("vcc_grant_issue");
  const uuids = (iss.match(/gen_random_uuid\(\)/g) || []).length;
  assert.ok(uuids >= 2, `الرمز مبنيّ على ${uuids} UUID فقط — الإنتروبيا ضعيفة`);
  assert.doesNotMatch(iss, /random\(\)/, "استُعمل random() غير التشفيريّ");
  assert.doesNotMatch(iss, /md5\s*\(/i, "استُعمل md5 لتوليد أو تهشيم الرمز");
});

test("★★ الرمز يظهر مرّة واحدة ولا يُعاد إظهاره", () => {
  const iss = funcBody("vcc_grant_issue");
  assert.match(iss, /token_hash\s+is\s+not\s+null\s+then[\s\S]{0,200}raise\s+exception/i,
    "يمكن إعادة الإصدار ⇒ رمزان صالحان لمنحة واحدة");
  assert.match(iss, /لا يُعاد إظهاره/, "لا تصريح بأنّ الرمز لا يُعاد");
  // والقائمة لا تُعيد البصمة أبدًا.
  const list = funcBody("vcc_grant_list");
  assert.doesNotMatch(list, /'token_hash'/, "قائمة المنح تُسرّب البصمة");
  assert.match(list, /'token_hint'/, "لا تلميح للتمييز البصريّ");
});

test("★ لا إصدار قبل الاعتماد، ولا اعتماد بلا وثائق", () => {
  const iss = funcBody("vcc_grant_issue");
  assert.match(iss, /status\s*<>\s*'approved'[\s\S]{0,200}raise\s+exception/i, "يمكن الإصدار قبل الاعتماد");
  const app = funcBody("vcc_grant_approve");
  assert.match(app, /n\s*=\s*0\s+then\s+raise\s+exception/i, "يمكن اعتماد منحة بلا وثائق");
});

test("★★ الاعتماد للمالك وحده — من يُعدّ الرابط ليس من يأذن به", () => {
  const app = funcBody("vcc_grant_approve");
  assert.match(app, /if\s+not\s+public\.vcc_is_owner\(\)/i, "الاعتماد ليس محصورًا بالمالك");
  assert.doesNotMatch(app, /if\s+not\s+public\.can_issue_secure_document_grants\(\)/i,
    "الاعتماد مبنيّ على صلاحية الإصدار نفسها ⇒ لا فصل");
  // وقيد جدوليّ يمنع منحة نشطة بلا اعتماد ولا رمز.
  assert.match(CODE, /constraint\s+vcc_grant_active_needs_token\s+check\s*\([\s\S]{0,240}approved_by\s+is\s+not\s+null/i,
    "منحة «نشطة» ممكنة بلا اعتماد");
});

test("★★ الحسّاس مربوط بطلب واعتماد — في حارس الجدول لا في الدالّة", () => {
  const g = funcBody("vcc_grant_document_guard");
  assert.ok(g, "حارس وثائق المنحة مفقود");
  assert.match(CODE, /create\s+trigger\s+trg_vcc_grant_document_guard/i, "الحارس غير مركّب");
  assert.match(g, /g\.request_id\s+is\s+null[\s\S]{0,200}raise\s+exception/i, "الحسّاس بلا طلب مربوط");
  assert.match(g, /g\.approved_by\s+is\s+null[\s\S]{0,200}raise\s+exception/i, "الحسّاس بلا اعتماد");
  assert.match(g, /never_public/, "الحارس لا يعتبر الأنواع الممنوعة من النشر");
  // والدالّة تعتمد على الحارس بدل تكرار المنطق (فلا يتباعد التنفيذان).
  const add = funcBody("vcc_grant_add_document");
  assert.match(add, /vcc_grant_document_guard/, "الدالّة لا تحيل إلى الحارس");
});

test("★ لا تُشارَك وثيقة غير موثَّقة أو منتهية أو غير قابلة للتنزيل", () => {
  const g = funcBody("vcc_grant_document_guard");
  assert.match(g, /not\s+d\.verified\s+or\s+d\.doc_status\s*<>\s*'verified'/i, "تُشارَك وثيقة غير موثَّقة");
  assert.match(g, /d\.expires_on\s*<\s*current_date/i, "تُشارَك وثيقة منتهية");
  assert.match(g, /allow_download\s+and\s+not\s+coalesce\(d\.is_downloadable/i,
    "يمكن السماح بتنزيل وثيقة غير قابلة للتنزيل");
});

test("★ لا تُعدَّل قائمة وثائق منحة بعد اعتمادها", () => {
  const g = funcBody("vcc_grant_document_guard");
  assert.match(g, /g\.status\s+not\s+in\s*\(\s*'draft'\s*,\s*'pending_approval'\s*\)/i,
    "يمكن إضافة وثيقة إلى منحة معتمَدة أو نشطة");
});

test("★★ الاسترداد يفحص النافذة والحدود والإلغاء وانتماء الوثيقة", () => {
  const o = funcBody(OPEN);
  assert.ok(o, "vcc_grant_open مفقودة");
  // ⚠️ لا مطابقة باسم السبب وحده: كلمة مثل expired ترد أيضًا داخل
  //    'invalid_or_expired' وداخل سطر تثبيت الحالة، فكان الفحص يمرّ ولو
  //    حُذف الشرط نفسه. كلّ سطر هنا يربط **الشرط** بالسبب الذي يُسنده.
  for (const [rule, cond] of [
    ["revoked",               /g\.status\s*=\s*'revoked'\s+then\s+v_deny\s*:=\s*'revoked'/i],
    ["not_active",            /g\.status\s*<>\s*'active'\s+then\s+v_deny\s*:=\s*'not_active'/i],
    ["not_started",           /now\(\)\s*<\s*g\.starts_at\s+then\s+v_deny\s*:=\s*'not_started'/i],
    ["expired",               /now\(\)\s*>=\s*g\.expires_at\s+then\s+v_deny\s*:=\s*'expired'/i],
    ["open_limit_reached",    /g\.opens_used\s*>=\s*g\.max_opens\s+then\s+v_deny\s*:=\s*'open_limit_reached'/i],
    ["download_not_allowed",  /g\.max_downloads\s*=\s*0\s+then\s+v_deny\s*:=\s*'download_not_allowed'/i],
    ["download_limit_reached",/g\.downloads_used\s*>=\s*g\.max_downloads\s+then\s+v_deny\s*:=\s*'download_limit_reached'/i],
    ["document_not_in_grant", /'document_not_in_grant'/],
    ["document_no_longer_valid", /'document_no_longer_valid'/],
  ]) {
    assert.match(o, cond, `الاسترداد لا يغطّي فعلًا: ${rule}`);
  }
  // ولا يُقفَل أيّ منها خلف فرع «تنزيل» فيصير الفتح بلا حدّ.
  assert.match(o, /if\s+v_deny\s+is\s+not\s+null\s+then/i, "لا فرع رفض موحّد");
});

test("★★ رسالة واحدة لكلّ فشل — لا أوراكل تخمين", () => {
  const o = funcBody(OPEN);
  const invalid = (o.match(/'invalid_or_expired'/g) || []).length;
  assert.ok(invalid >= 3, "الاسترداد يميّز بين «غير موجود» و«منتهٍ» ⇒ يقلّص مساحة بحث المخمّن");
  // ورسالة الرمز المجهول هي نفسها رسالة المنتهي.
  assert.match(o, /unknown_token[\s\S]{0,300}'invalid_or_expired'/i,
    "الرمز المجهول له رسالة مختلفة");
});

test("★★ الوثيقة يجب أن تكون داخل المنحة — لا وصول عرضيّ بمعرّف صحيح", () => {
  const o = funcBody(OPEN);
  assert.match(o, /from\s+public\.vcc_grant_documents\s*\n?\s*where\s+grant_id\s*=\s*g\.id\s+and\s+document_id\s*=\s*p_document/i,
    "لا فحص لانتماء الوثيقة إلى المنحة");
});

test("★★ الوثيقة يُعاد فحصها عند كلّ فتح — الإلغاء بعد الإصدار يوقف الرابط", () => {
  const o = funcBody(OPEN);
  assert.match(o, /select\s+\*\s+into\s+d\s+from\s+public\.tvn_documents\s+where\s+id\s*=\s*p_document/i,
    "الوثيقة لا تُعاد قراءتها عند الفتح");
  assert.match(o, /not\s+d\.verified\s+or\s+d\.doc_status\s*<>\s*'verified'/i,
    "الفتح لا يتحقّق من التوثيق لحظة الفتح");
  assert.match(o, /d\.expires_on\s*<\s*current_date/i, "الفتح لا يتحقّق من الانتهاء");
});

test("★★ لا فهرسة مجلَّد — الاسترداد لا يقرأ التخزين إطلاقًا", () => {
  const o = funcBody(OPEN);
  assert.doesNotMatch(o, /storage\.objects/i, "الاسترداد يقرأ storage.objects");
  assert.doesNotMatch(o, /storage\.buckets/i, "الاسترداد يقرأ storage.buckets");
});

test("★★ الحدود تُحتسب قبل إعادة أيّ مرجع", () => {
  const o = funcBody(OPEN);
  const denyAt = o.search(/if\s+v_deny\s+is\s+not\s+null/i);
  const refAt = o.search(/'storage_bucket'/);
  assert.ok(denyAt >= 0 && refAt >= 0, "أحد الموضعين غير موجود");
  assert.ok(denyAt < refAt, "المرجع يُعاد قبل فحص الحدود");
  // والعدّاد يزيد قبل الإعادة.
  const incAt = o.search(/downloads_used\s*=\s*downloads_used\s*\+\s*1/i);
  assert.ok(incAt >= 0 && incAt < refAt, "عدّاد التنزيل لا يزيد قبل إعادة المرجع");
});

test("★★ الفتح على مستوى المنحة لا يُعيد مسارًا ولا bucket", () => {
  const o = funcBody(OPEN);
  const grantOpen = /if\s+v_action\s*=\s*'open'\s+and\s+p_document\s+is\s+null\s+then([\s\S]*?)end\s+if;/i.exec(o);
  assert.ok(grantOpen, "فرع الفتح على مستوى المنحة غير مقروء");
  assert.doesNotMatch(grantOpen[1], /storage_path/i, "قائمة وثائق المنحة تُسرّب المسار");
  assert.doesNotMatch(grantOpen[1], /storage_bucket/i, "قائمة وثائق المنحة تُسرّب الـbucket");
});

test("★ سجلّ الوصول يحفظ الرفض أيضًا، وبلا IP خام", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_grant_access_log\s*\(([\s\S]*?)\n\);/i.exec(CODE)[1];
  assert.match(t, /'open'\s*,\s*'download'\s*,\s*'denied'/, "السجلّ لا يميّز الرفض");
  assert.match(t, /client_fingerprint[^,]*\^\[0-9a-f\]\{64\}\$/i, "البصمة بلا قيد شكل");
  for (const bad of ["ip_address", "user_agent", "raw_ip"]) {
    assert.ok(!t.includes(bad), `السجلّ يخزّن بيانات شخصية خامّة: ${bad}`);
  }
  const o = funcBody(OPEN);
  const denials = (o.match(/insert\s+into\s+public\.vcc_grant_access_log[^;]*'denied'/gi) || []).length;
  assert.ok(denials >= 5, `الرفض مسجَّل في ${denials} موضع فقط — محاولات التخمين ستبقى غير مرئية`);
});

test("★★ vcc_grant_open لا تُمنَح لـanon ولا authenticated", () => {
  const code = stripCommentsAndStrings(SQL);
  assert.doesNotMatch(code, /grant\s+execute\s+on\s+function\s+public\.vcc_grant_open[^;]*to\s+authenticated/i,
    "authenticated تستطيع الاسترداد مباشرةً");
  assert.doesNotMatch(code, /grant\s+execute\s+on\s+function\s+public\.vcc_grant_open[^;]*to\s+anon/i,
    "anon تستطيع الاسترداد");
  assert.match(SQL, /grant\s+execute\s+on\s+function\s+public\.vcc_grant_open\(text,text,uuid,text\)\s+to\s+service_role/i,
    "الاسترداد بلا صلاحية service_role ⇒ مسار الخادم لن يعمل");
  // والفحص الذاتيّ يثبت ذلك.
  assert.match(selfTest(), /has_function_privilege\('anon'[\s\S]{0,200}vcc_grant_open/i,
    "الفحص الذاتيّ لا يتحقّق من صلاحية anon على الاسترداد");
});

test("★ الإلغاء يشترط سببًا ويوقف الرابط فورًا", () => {
  const r = funcBody("vcc_grant_revoke");
  assert.match(r, /length\(btrim\(coalesce\(p_reason/i, "الإلغاء بلا سبب");
  assert.match(r, /status\s*=\s*'revoked'/, "الإلغاء لا يغيّر الحالة");
  assert.match(CODE, /constraint\s+vcc_grant_revoked_pair\s+check/i, "لا قيد يضمن سبب الإلغاء");
});

test("⛔ لا شيء يُرسَل: لا بريد ولا رسالة في أيّ مسار للمنح", () => {
  for (const fn of ["vcc_grant_issue", "vcc_grant_create", "vcc_grant_approve", "vcc_grant_open"]) {
    const b = funcBody(fn);
    for (const bad of ["send_email", "sendProjectEmail", "whatsapp", "comms_channel_set", "dry_run"]) {
      assert.ok(!b.includes(bad), `${fn} تلمس مسار إرسال: ${bad}`);
    }
  }
  const iss = funcBody("vcc_grant_issue");
  assert.match(iss, /جاهز للمشاركة اليدوية/, "الإصدار لا يعلن أنّ المشاركة يدوية");
  assert.match(iss, /النظام لا يرسل بريدًا/, "الإصدار لا ينفي الإرسال صراحةً");
});

test("★ خريطة القدرات تقول delivery_enabled = false", () => {
  const a = funcBody("vcc_access");
  assert.match(a, /'delivery_enabled'\s*,\s*false/i, "الواجهة قد تَعِد بإرسال لا يحدث");
});

// ─── طبقة الخادم والواجهة ──────────────────────────────────────────────────

test("★★ مسار الخادم يوثّق أوّلًا ثمّ يوقّع ما أعادته الدالّة", () => {
  const route = read(CODE_FILES.route);
  const authAt = route.indexOf("vcc_grant_open");
  const signAt = route.indexOf("signStorage(bucket, path)");
  assert.ok(authAt >= 0, "المسار لا ينادي الدالّة المحميّة");
  assert.ok(signAt > authAt, "التوقيع يسبق التصريح");
  // ★ لا توقيع لمسار من جسم الطلب ★
  assert.match(route, /payload\.storage_bucket/, "الـbucket لا يأتي من نتيجة الدالّة");
  assert.match(route, /payload\.storage_path/, "المسار لا يأتي من نتيجة الدالّة");
  assert.doesNotMatch(route, /b\.(bucket|path)\b/, "المسار يُقرأ من جسم الطلب");
});

test("★★ مسار الخادم لا يُعيد مرجع تخزين إلى المتصفّح", () => {
  const route = read(CODE_FILES.route);
  const responses = [...route.matchAll(/NextResponse\.json\(\s*\{([\s\S]*?)\}\s*,/g)].map((m) => m[1]);
  for (const r of responses) {
    assert.ok(!/storage_path|storage_bucket/.test(r), "استجابة تُعيد مرجع التخزين");
  }
  assert.match(route, /url:\s*signed/, "المسار لا يُعيد رابطًا موقَّعًا أصلًا");
});

test("★ مهلة التوقيع قصيرة، والاستجابة بلا تخزين مؤقّت ولا فهرسة", () => {
  const route = read(CODE_FILES.route);
  const m = /SIGN_TTL\s*=\s*(\d+)/.exec(route);
  assert.ok(m && Number(m[1]) <= 300, `مهلة التوقيع ${m && m[1]} ثانية — طويلة لرابط حامل`);
  assert.match(route, /no-store/, "الاستجابة قابلة للتخزين المؤقّت");
  assert.match(route, /X-Robots-Tag/, "الاستجابة بلا منع فهرسة");
});

test("★★ الرمز لا يمرّ في رابط: GET مرفوض، والصفحة تقرأ الجزء المرجعيّ", () => {
  const route = read(CODE_FILES.route);
  assert.match(route, /export\s+async\s+function\s+GET[\s\S]{0,300}405/,
    "GET مسموح ⇒ الرمز سيظهر في سجلّات الوصول");
  const page = read(CODE_FILES.publicPage);
  assert.match(page, /window\.location\.hash/, "الصفحة لا تقرأ الجزء المرجعيّ");
  assert.doesNotMatch(page, /searchParams|location\.search/, "الصفحة تقرأ الرمز من نصّ الرابط");
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /\/secure-document#/, "بانية الرابط لا تضع الرمز بعد #");
});

test("★ pending_migration لا يُقال عنه «رابط غير صالح»", () => {
  const route = read(CODE_FILES.route);
  assert.match(route, /PGRST202[\s\S]{0,200}pending_migration/i,
    "الترحيلة الناقصة تُقرأ رابطًا خاطئًا ⇒ المتلقّي يلوم من أرسل");
  const page = read(CODE_FILES.publicPage);
  assert.match(page, /pending_migration:\s*"[^"]*لم تُفعَّل/, "الصفحة لا تفرّق بين الحالتين");
});

test("★ الرمز لا يُخزَّن في المتصفّح", () => {
  for (const f of [CODE_FILES.ts, CODE_FILES.grants, CODE_FILES.publicPage]) {
    const src = read(f);
    assert.doesNotMatch(src, /localStorage\.setItem[^\n]*token/i, `${f} يخزّن الرمز محلّيًّا`);
    assert.doesNotMatch(src, /sessionStorage[^\n]*token/i, `${f} يخزّن الرمز في الجلسة`);
  }
});

test("★ الواجهة تحذّر **قبل** الإصدار لا بعده", () => {
  const g = read(CODE_FILES.grants);
  const confirmAt = g.search(/window\.confirm\(\s*\n?\s*"سيظهر الرمز مرّة واحدة/);
  const issueAt = g.search(/await\s+grantIssue\(/);
  assert.ok(confirmAt >= 0, "لا تحذير قبل الإصدار");
  assert.ok(confirmAt < issueAt, "التحذير بعد الإصدار — بلا فائدة");
  // ⚠️ تُجرَّد التعليقات أوّلًا: ديباجة الملفّ تقول «لا زرّ إرسال»، ومطابقة
  //    نصّية ساذجة كانت ستفشل على توثيقها الخاصّ بدل أن تفحص الشيفرة.
  const live = g.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(live, /<button[^>]*>\s*إرسال/, "زرّ إرسال في شاشة المنح");
  assert.doesNotMatch(live, /fetch\([^)]*(mail|whatsapp|notify|send)/i, "نداء إرسال في شاشة المنح");
});

test("عقد المنحة موثَّق ويعترف بحدّ V1", () => {
  const doc = read(DOCS.grant).toLowerCase();
  for (const phrase of [
    "stored only as a hash", "shown exactly once", "never give a directory listing",
    "must not reveal a storage path", "delivery", "known limitation",
  ]) {
    assert.ok(doc.includes(phrase), `عقد المنحة لا يغطّي: ${phrase}`);
  }
  assert.match(doc, /not pixels burned into the PDF/i,
    "العقد لا يعترف بأنّ العلامة المائية هوية معروضة لا محروقة في الملفّ");
});
