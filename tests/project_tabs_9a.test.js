// ════════════════════════════════════════════════════════════════════════════
// tests/project_tabs_9a.test.js — Batch 9 Part 1: تنظيم تبويبات المشروع حسب دورة
// العمل. الثابت الحاكم: **المفاتيح والروابط والصلاحيات ومكوّنات التبويبات لا تتغيّر**؛
// الترتيب والاسم الظاهر والتجميع فقط.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");

const tabsBlock = OPS.match(/const TABS[\s\S]*?\n\];/)[0];
const tabs = [...tabsBlock.matchAll(/\{ k: "([a-z_]+)", ar: "([^"]+)", en: "([^"]+)", group: "([a-z]+)" \}/g)]
  .map((m) => ({ k: m[1], ar: m[2], en: m[3], group: m[4] }));

// المفاتيح الـ27 (الـ26 المعتمدة + quick للمسار السريع) — المجموعة الثابتة الأصلية.
const EXPECTED_KEYS = ["quick", "execution", "reports", "planning", "resources", "governance", "subprojects",
  "program", "program_sla", "closure", "schedule", "tasks", "gantt", "calendar", "team", "deliverables",
  "approvals", "finance", "costs", "risks", "meetings", "shoots", "locations", "tags", "timeline", "activity", "trash"];

test("كل المفاتيح الأصلية موجودة ولم يتغيّر مفتاح ولا زاد/نقص", () => {
  const keys = tabs.map((x) => x.k);
  assert.equal(keys.length, EXPECTED_KEYS.length, `عدد التبويبات ${keys.length}`);
  assert.deepEqual([...new Set(keys)].sort(), [...EXPECTED_KEYS].sort(), "مجموعة المفاتيح تغيّرت");
  assert.equal(keys.length, new Set(keys).size, "مفتاح مكرَّر");
});

test("الترتيب النهائي المعتمد (بالمفاتيح) حسب دورة العمل", () => {
  const order = tabs.map((x) => x.k);
  const expectedOrder = ["quick",
    "execution", "program", "subprojects", "team",                                  // أ
    "locations", "meetings", "schedule", "calendar", "planning", "gantt", "resources", // ب
    "tasks", "shoots", "deliverables", "approvals", "program_sla",                   // ج
    "risks", "governance", "costs", "finance", "reports",                            // د
    "timeline", "activity", "tags", "closure", "trash"];                             // هـ
  assert.deepEqual(order, expectedOrder, "الترتيب لا يطابق التسلسل المعتمد");
});

test("الأسماء الظاهرة المصحَّحة: planning=«مخطط جانت»، gantt ليس Kanban", () => {
  const planning = tabs.find((x) => x.k === "planning");
  assert.equal(planning.ar, "مخطط جانت", "planning (محرّك Gantt V2) لم يُعَد تسميته «مخطط جانت»");
  const gantt = tabs.find((x) => x.k === "gantt");
  // gantt = PreProductionCenter + المخطّط الموحّد (ليس Kanban) ⇒ لا يُسمّى «لوحة المهام»
  assert.notEqual(gantt.ar, "لوحة المهام", "gantt (وهو Gantt لا Kanban) سُمِّي «لوحة المهام» خطأً");
  assert.equal(gantt.ar, "الخطة والتحضير", "gantt لم يُعطَ اسمًا دقيقًا مميَّزًا عن جانت");
  // tasks يبقى «المهام» (يحوي القائمة ولوحة Kanban معًا)
  assert.equal(tabs.find((x) => x.k === "tasks").ar, "المهام", "اسم المهام تغيّر");
  // المكوّن الفعليّ لكلٍّ لم يتغيّر
  assert.match(OPS, /tab === "planning" && <ProjectGantt/, "planning لم يعد يعرض ProjectGantt");
  assert.match(OPS, /tab === "gantt" && \(/, "gantt لم يعد يعرض مكوّنه");
  assert.match(OPS, /<PreProductionCenter projectId=\{projectId\}/, "gantt فقد PreProductionCenter");
});

test("خمس مجموعات بصرية بالترتيب، وكل تبويب ينتمي لمجموعة معلنة", () => {
  const groups = ["overview", "planning", "delivery", "control", "records"];
  assert.match(OPS, /const GROUP_ORDER: TabGroup\[\] = \["overview", "planning", "delivery", "control", "records"\]/, "ترتيب المجموعات تغيّر");
  for (const tb of tabs) assert.ok(groups.includes(tb.group), `${tb.k} بمجموعة غير معلنة: ${tb.group}`);
  // كل مجموعة لها عنوان عربيّ (ليست تبويبًا وهميًّا)
  for (const g of groups) assert.match(OPS, new RegExp(`${g}: \\{ ar: "[^"]+`), `المجموعة ${g} بلا عنوان`);
  // المجموعات المطلوبة تحوي مفاتيحها الصحيحة
  const byGroup = (g) => tabs.filter((x) => x.group === g).map((x) => x.k);
  assert.deepEqual(byGroup("overview"), ["quick", "execution", "program", "subprojects", "team"]);
  assert.deepEqual(byGroup("delivery"), ["tasks", "shoots", "deliverables", "approvals", "program_sla"]);
  assert.deepEqual(byGroup("records"), ["timeline", "activity", "tags", "closure", "trash"]);
});

test("شروط الظهور والصلاحيات لم تتغيّر (لا صلاحية تُفتح بإعادة الترتيب)", () => {
  // نفس فلترة الظهور القائمة قبل الدفعة
  assert.match(OPS, /tb\.k !== "costs" \|\| caps\.canSeeFinancials/, "فلتر التكاليف المالية تغيّر");
  assert.match(OPS, /tb\.k !== "finance" \|\| isFinance/, "عزل الحسابات تغيّر");
  assert.match(OPS, /tb\.k !== "trash" \|\| canManage/, "فلتر المحذوفات تغيّر");
  assert.match(OPS, /tb\.k !== "subprojects" \|\| isMaster/, "المشاريع الفرعية للرئيسي فقط تغيّر");
  assert.match(OPS, /tb\.k !== "program" \|\| isMaster/, "إدارة البرنامج للرئيسي فقط تغيّر");
  assert.match(OPS, /tb\.k !== "program_sla" \|\| isMaster/, "الالتزامات للرئيسي فقط تغيّر");
  assert.match(OPS, /tb\.k !== "quick" \|\| isSimple/, "نظرة سريعة للمبسّط فقط تغيّر");
});

test("لا توجيه معتمد على index رقميّ — الهوية بالـkey", () => {
  // لا فهرسة رقمية على TABS/shownTabs/visibleTabs لتحديد التبويب النشط
  assert.doesNotMatch(OPS, /TABS\[\d+\]/, "فهرسة رقمية على TABS");
  assert.doesNotMatch(OPS, /shownTabs\[\d+\]/, "فهرسة رقمية على shownTabs");
  assert.doesNotMatch(OPS, /visibleTabs\[\d+\]/, "فهرسة رقمية على visibleTabs");
  // التبويب النشط والافتراضي بالـkey
  assert.match(OPS, /useState<TabKey>\(\(visibleTabs\.some\(\(x\) => x\.k === initialTab\) \? initialTab : "tasks"\)/, "الافتراضي ليس بالـkey");
});

test("الروابط العميقة (initialTab) لكل التبويبات الخاصّة تُحسم بالـkey", () => {
  for (const k of ["subprojects", "program", "program_sla"]) {
    assert.match(OPS, new RegExp(`initialTab === "${k}" && isMaster\\) setTab\\("${k}"\\)`), `رابط عميق ${k} مكسور`);
  }
  // السقوط عند فقدان الصفة يبقى بالـkey
  assert.match(OPS, /\(tab === "subprojects" \|\| tab === "program" \|\| tab === "program_sla"\) && !isMaster\) setTab\("tasks"\)/, "سقوط الرئيسي مكسور");
});

test("تجربة «سريع»: الأساسيات التشغيلية أوّلًا خلفها «إدارة متقدمة» (لا تبويب يُحذف)", () => {
  const simple = OPS.match(/const SIMPLE_TABS: TabKey\[\] = \[([^\]]+)\]/)[1];
  const keys = [...simple.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["quick", "execution", "team", "tasks", "shoots", "deliverables", "approvals", "program_sla"],
    "قائمة «سريع» لا تطابق الأساسيات التشغيلية");
  // shownTabs مشتقّة من visibleTabs (طيّ لا حذف)
  assert.match(OPS, /const shownTabs = collapseAdvanced \? visibleTabs\.filter\(\(tb\) => SIMPLE_TABS\.includes\(tb\.k\)\) : visibleTabs/, "الطيّ يحذف بدل أن يطوي");
  assert.match(OPS, /إدارة متقدمة/, "لا زرّ «إدارة متقدمة»");
});

test("الجوال: قائمة أقسام منظَّمة لا تمرير أفقيّ وحده + التبويب النشط ظاهر", () => {
  assert.match(OPS, /<select id="tab-jump"[\s\S]{0,400}<optgroup/, "لا قائمة أقسام مجمَّعة على الجوال");
  assert.match(OPS, /class(Name)?="sm:hidden"/, "قائمة الجوال ليست مخصَّصة للجوال");
  assert.match(OPS, /class(Name)?="hidden sm:flex/, "شريط الشاشات ليس مخفيًّا على الجوال");
  assert.match(OPS, /activeTabRef\.current\?\.scrollIntoView/, "التبويب النشط لا يُدفَع إلى الرؤية");
});

test("إتاحة الوصول: aria-current + مجموعات role=group + عناوين ليست أزرارًا", () => {
  // الشاشات: أزرار بـaria-current داخل مجموعات role=group (لا tablist مسطَّح مكسور)
  assert.match(OPS, /aria-current=\{tab === tb\.k \? "page" : undefined\}/, "لا aria-current على أزرار الشاشات");
  assert.match(OPS, /role="group" aria-label=\{t\(GROUP_LABELS\[g\]\)\}/, "المجموعة بلا role=group معنون");
  assert.match(OPS, /aria-expanded=\{!collapseAdvanced\}/, "زرّ المتقدمة بلا aria-expanded");
  // عنوان المجموعة نصّ مخفيّ عن القارئ (role=group يحمل الاسم) وليس زرًّا
  assert.match(OPS, /<span aria-hidden="true"[^>]*>\{t\(GROUP_LABELS\[g\]\)\}/, "عنوان المجموعة ليس مخفيًّا/مكرَّرًا");
  assert.doesNotMatch(OPS, /role="tab"/, "tablist مسطَّح مكسور مع التجميع");
  // الجوال: القائمة المنظَّمة هي بنية قارئ الشاشة
  assert.match(OPS, /<optgroup key=\{g\} label=\{t\(GROUP_LABELS\[g\]\)\}/, "قائمة الجوال بلا مجموعات معنونة");
});

test("لا تبويب ميت: كل مفتاح له مكوّن مربوط في الـrender", () => {
  for (const tb of tabs) {
    if (tb.k === "quick") { assert.match(OPS, /tab === "quick" && isSimple/, "quick بلا مكوّن"); continue; }
    assert.match(OPS, new RegExp(`tab === "${tb.k}"`), `التبويب ${tb.k} بلا مكوّن مربوط في الـrender`);
  }
});
