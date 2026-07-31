// ════════════════════════════════════════════════════════════════════════════
// tests/finance_gate_descent.test.js
//
// موضوع هذا الملفّ: **الانحدار إلى البوّابة الحسّاسة يُفحص بالمشي على رسم
// النداء، لا بمطابقة نصّية**.
//
// الخلفية: تشغيل الإنتاج سقط قبل COMMIT على
//     FIN SELF-TEST: public.finops_can_manage() لا تنحدر من البوّابة الحسّاسة
// وكان التأكيد يطلب ذكرًا **نصّيًّا مباشرًا** لاسم البوّابة داخل جسم الدالّة.
// لكنّ finops_can_manage تفوّض بقفزة:
//     finops_can_manage → finops_can_manage_finance → finops_can_view_finance_sensitive
// فالاسم ليس في جسمها وهي منحدرة فعلًا ⇒ **الفحص** كان معطوبًا لا الدالّة.
//
// ما يفعله هذا الملفّ:
//   (١) يثبت أنّ الدالّة كانت سليمة والتأكيد هو الذي سقط.
//   (٢) يستخرج قوائم المحلّل من RUNME نفسه (مصدر حقيقة واحد) ثم يشغّل مرآةً
//       جافاسكربتية لخوارزمية المحلّل على أجسام الدوالّ الحقيقية.
//   (٣) يثبت بالطفرة أنّ المحلّل ما زال يسقط عند كلّ واحد من ستّة انتهاكات،
//       ثم يعيد الجسم الأصليّ.
//
// ⚠️ ما لا يدّعيه: لا جلسة PostgREST حيّة هنا ولا قاعدة بيانات. لم تُختبر RLS
//    فعليًّا. المُختبَر هو **منطق المحلّل وعقد الـSQL**، وهو ما سقط فعلًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, POSTCHECK } = require("./finance_helpers");

// ─── محلّل الأجسام: لا يستعمل [^)]* (نمطٌ يقف عند أوّل قوس — حادثة سابقة) ───
function parseBodies(src) {
  const out = new Map();
  const head = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = head.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    const openIdx = src.indexOf("$$", m.index);
    if (openIdx < 0) continue;
    const closeIdx = src.indexOf("$$", openIdx + 2);
    if (closeIdx < 0) continue;
    out.set(name, src.slice(openIdx + 2, closeIdx));
  }
  return out;
}

// نزع التعليقات ثم خفض الحالة — بالترتيب نفسه الذي في SQL.
function strip(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").toLowerCase();
}

// التقاط النداءات: «مُعرِّف يليه قوس»، يعبر الأقواس ولا يقف عندها.
function callees(strippedBody) {
  const out = new Set();
  for (const m of strippedBody.matchAll(/([a-z_][a-z0-9_]*)\s*\(/g)) {
    if (m[1].startsWith("finops_")) out.add(m[1]);
  }
  return out;
}

// ─── القوائم تُقرأ من RUNME نفسه، فلا تنحرف المرآة عن الأصل ───────────────
function sqlArray(varName) {
  const re = new RegExp(varName + "\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\];", "i");
  const m = SQL.match(re);
  assert.ok(m, `تعذّر إيجاد المصفوفة ${varName} في RUNME`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const ROOT_GATE = (SQL.match(/ROOT_GATE\s+constant\s+text\s*:=\s*'([a-z0-9_]+)'/i) || [])[1];
const OWNER_GATES = sqlArray("OWNER_GATES");
const NO_DESCENT = sqlArray("NO_DESCENT");
const BROAD_FNS = sqlArray("BROAD_FNS");
const GRANTABLE_KEYS = sqlArray("GRANTABLE_KEYS");

/**
 * مرآة المحلّل. تعيد {ok, reason, deep, seen}.
 * تتبع نداءات finops_* وحدها وتتوقّف عند الجذر — is_owner/is_staff أوراق.
 */
function analyse(bodies) {
  const rootRaw = bodies.get(ROOT_GATE);
  if (!rootRaw) return { ok: false, reason: "root_missing", deep: -1 };
  const root = strip(rootRaw);
  const word = (t) => new RegExp(`\\b${t}\\b`).test(root);
  if (!word("is_owner")) return { ok: false, reason: "root_not_owner_only", deep: -1 };
  if (!word("is_staff")) return { ok: false, reason: "root_allows_client", deep: -1 };
  if (!word("coalesce")) return { ok: false, reason: "root_null_as_success", deep: -1 };
  if (!word("auth")) return { ok: false, reason: "root_no_session", deep: -1 };
  for (const b of BROAD_FNS) {
    if (new RegExp(`\\b${b}\\b`).test(root)) return { ok: false, reason: `root_opened_by_${b}`, deep: -1 };
  }

  let deep = -1;
  const seenAll = new Set();
  for (const gate of [...OWNER_GATES, ...NO_DESCENT]) {
    const want = !NO_DESCENT.includes(gate);
    let work = [gate];
    const seen = new Set();
    let hit = false;
    let hop = 0;
    while (work.length && hop <= 8) {
      const next = [];
      for (const cur of work) {
        if (seen.has(cur)) continue;
        seen.add(cur);
        seenAll.add(cur);
        if (cur === ROOT_GATE) {
          hit = true;
          if (hop > deep) deep = hop;
          continue; // الجذر طرفيّ
        }
        const raw = bodies.get(cur);
        if (raw === undefined) continue; // اسم finops_* بلا دالّة ⇒ الطريق مقطوع
        const body = strip(raw);
        if (want) {
          if (!/\bcoalesce\b/.test(body)) return { ok: false, reason: `${gate}_via_${cur}_no_coalesce`, deep };
          for (const b of BROAD_FNS) {
            if (new RegExp(`\\b${b}\\b`).test(body)) {
              return { ok: false, reason: `${gate}_via_${cur}_uses_${b}`, deep };
            }
          }
        }
        for (const c of callees(body)) if (c !== cur) next.push(c);
      }
      work = next;
      hop += 1;
    }
    if (want && !hit) return { ok: false, reason: `${gate}_does_not_descend`, deep };
    if (!want && hit) return { ok: false, reason: `${gate}_control_broken`, deep };
    if (seen.size === 0) return { ok: false, reason: `${gate}_analyser_visited_nothing`, deep };
  }
  if (deep < 2) return { ok: false, reason: `analyser_never_crossed_two_edges(${deep})`, deep };
  return { ok: true, reason: "ok", deep, seen: seenAll };
}

const BODIES = parseBodies(SQL);
const clone = () => new Map(BODIES);

// ════════════════════════════════════════════════════════════════════════════
test("الدالّة كانت سليمة والتأكيد هو الذي سقط", async (t) => {
  await t.test("finops_can_manage لا تذكر اسم البوّابة نصًّا — ولهذا سقط الفحص القديم", () => {
    const body = strip(BODIES.get("finops_can_manage"));
    assert.ok(!body.includes("finops_can_view_finance_sensitive"),
      "لو ذكرتها نصًّا لما كان الفحص القديم قد سقط أصلًا — الفرضية نفسها باطلة");
  });

  await t.test("لكنّها تنحدر فعلًا: can_manage → can_manage_finance → البوّابة", () => {
    const a = strip(BODIES.get("finops_can_manage"));
    assert.ok(/\bfinops_can_manage_finance\b/.test(a), "القفزة الأولى مفقودة");
    const b = strip(BODIES.get("finops_can_manage_finance"));
    assert.ok(/\bfinops_can_view_finance_sensitive\b/.test(b), "القفزة الثانية مفقودة");
    const root = strip(BODIES.get("finops_can_view_finance_sensitive"));
    assert.ok(/\bis_owner\b/.test(root) && /\bis_staff\b/.test(root),
      "الجذر ليس للمالك — لو صحّ هذا لكان الفحص القديم مصيبًا والدالّة معطوبة");
  });

  await t.test("لا مُسنَد واسع على الطريق — فالانحدار ليس تفويضًا إلى ثغرة", () => {
    for (const n of ["finops_can_manage", "finops_can_manage_finance", "finops_can_view_finance_sensitive"]) {
      const b = strip(BODIES.get(n));
      for (const broad of BROAD_FNS) {
        assert.ok(!new RegExp(`\\b${broad}\\b`).test(b), `${n} تستعمل ${broad}`);
      }
    }
  });

  await t.test("التأكيد القديم (مطابقة نصّية) لم يعد موجودًا في RUNME", () => {
    assert.ok(!SQL.includes("لا تنحدر من البوّابة الحسّاسة"),
      "نصّ التأكيد الهشّ ما زال في الملفّ");
    assert.ok(SQL.includes("regexp_matches"), "المحلّل الجديد غائب");
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("المحلّل: الحالة السليمة تمرّ (لا-فراغ للطفرات كلّها)", async (t) => {
  const r = analyse(BODIES);
  await t.test("النموذج الحاليّ يمرّ", () => {
    assert.equal(r.ok, true, `المحلّل يسقط على النموذج السليم: ${r.reason}`);
  });
  await t.test("★ لا-فراغ (١) ★ عبر المحلّل ضلعين لا ضلعًا — التفويض غير المباشر فُحص", () => {
    assert.ok(r.deep >= 2, `أقصى عمق ${r.deep} — المحلّل مطابقة نصّية متنكّرة`);
  });
  await t.test("★ لا-فراغ (٢) ★ ضابطا عدم الانحدار يقول عنهما المحلّل «لا يصلان»", () => {
    // لو كان المحلّل يقول «وصل» لكلّ شيء لمرّ هذان أيضًا — وكلّ ما فوقه بلا معنى.
    for (const ctl of NO_DESCENT) {
      const only = clone();
      const probe = analyse(only);
      assert.equal(probe.ok, true);
      assert.ok(NO_DESCENT.includes(ctl));
    }
    const m = clone();
    // اجعل ضابطًا ينحدر عمدًا ⇒ يجب أن يسقط المحلّل
    m.set(NO_DESCENT[0], "\n  select coalesce(public.finops_can_view_finance_sensitive(), false);\n");
    const bad = analyse(m);
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /control_broken/);
  });
  await t.test("★ لا-فراغ (٣) ★ قائمة المُسنَدات الواسعة ليست قائمة أخطاء مطبعية", () => {
    // كلّ اسم فيها يجب أن يكون مُسنَدًا حقيقيًّا في المستودع أو مُسنَدًا للموديول.
    assert.ok(BROAD_FNS.length >= 20, "القائمة قصيرة إلى حدّ الشكّ");
    for (const b of BROAD_FNS) assert.match(b, /^[a-z][a-z0-9_]+$/);
    assert.ok(BROAD_FNS.includes("finops_perm"), "المفتاح المباشر ليس ممنوعًا");
    assert.ok(BROAD_FNS.includes("staff_role"), "الدور الوظيفيّ ليس ممنوعًا");
    assert.ok(BROAD_FNS.includes("can_manage_projects"), "صلاحية المشاريع ليست ممنوعة");
  });
  await t.test("★ لا-فراغ (٤) ★ القوائم مقروءة من RUNME لا مكتوبة هنا", () => {
    assert.equal(ROOT_GATE, "finops_can_view_finance_sensitive");
    assert.equal(OWNER_GATES.length, 8);
    assert.equal(NO_DESCENT.length, 2);
    assert.equal(GRANTABLE_KEYS.length, 4);
    for (const g of OWNER_GATES) assert.ok(BODIES.has(g), `${g} غير معرّفة في RUNME`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ★ الطفرات الستّ المطلوبة ★ — كلّ واحدة تُطبَّق، يُثبَت السقوط، ثم تُستعاد.
// ════════════════════════════════════════════════════════════════════════════
test("المحلّل يسقط عند كلّ انتهاك (إثبات بالطفرة)", async (t) => {
  const mut = (name, body) => {
    const m = clone();
    m.set(name, body);
    return analyse(m);
  };

  await t.test("١) finops_can_manage تُمرّر موظّف تحصيل", () => {
    const r = mut("finops_can_manage",
      "\n  select coalesce(public.finops_can_manage_finance(), false)\n" +
      "      or coalesce(public.finops_can_view_collections(), false);\n");
    assert.equal(r.ok, false);
    assert.match(r.reason, /finops_can_view_collections/);
  });

  await t.test("٢) موظّف مالية غير مالك يبلغ الحسّاس", () => {
    const r = mut("finops_can_manage_finance",
      "\n  select coalesce(\n    (auth.uid() is not null)\n" +
      "    and (coalesce(public.finops_can_view_finance_sensitive(), false)\n" +
      "      or coalesce(public.finops_is_finance_role(), false)),\n  false);\n");
    assert.equal(r.ok, false);
    assert.match(r.reason, /finops_is_finance_role/);
  });

  await t.test("٣) بوّابة المالك مُزالة من الجذر", () => {
    const r = mut(ROOT_GATE,
      "\n  select coalesce((auth.uid() is not null) and coalesce(public.is_staff(), false), false);\n");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "root_not_owner_only");
  });

  await t.test("٤) بوّابة أُعيد توصيلها بمُسنَد صلاحية عامّ", () => {
    const r = mut("finops_can_export", "\n  select coalesce(public.can_manage_projects(), false);\n");
    assert.equal(r.ok, false);
    assert.match(r.reason, /can_manage_projects|does_not_descend/);
  });

  await t.test("٥) NULL يُعامَل نجاحًا (فقدان coalesce)", () => {
    const r = mut("finops_can_manage", "\n  select public.finops_can_manage_finance();\n");
    assert.equal(r.ok, false);
    assert.match(r.reason, /no_coalesce/);
  });

  await t.test("٦) اسم البوّابة يظهر داخل تعليق فقط", () => {
    const r = mut("finops_can_manage",
      "\n  -- public.finops_can_view_finance_sensitive()\n" +
      "  /* public.finops_can_view_finance_sensitive() */\n" +
      "  select coalesce(true, false);\n");
    assert.equal(r.ok, false, "التعليق مرّر الفحص — نزع التعليقات معطوب");
    assert.match(r.reason, /does_not_descend/);

    // ضابط: النصّ نفسه بلا علامات التعليق **يمرّ** ⇒ الفارق هو نزع التعليقات لا شيء آخر.
    const ok = mut("finops_can_manage",
      "\n  select coalesce(public.finops_can_view_finance_sensitive(), false);\n");
    assert.equal(ok.ok, true, "الضابط يسقط — الطفرة ٦ لا تثبت شيئًا عن التعليقات");
  });

  await t.test("الاستعادة: الخريطة الأصلية لم تُمَسّ", () => {
    assert.equal(analyse(BODIES).ok, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("عقد الـSQL: المحلّل مكتوب في RUNME وفي POSTCHECK بالدفاعات نفسها", async (t) => {
  // النطاق محصور بقسم المحلّل وحده — لا «الاسم موجود في الملفّ».
  const from = SQL.indexOf("★★ الانحدار يُفحص بالمشي على رسم النداء");
  const to = SQL.indexOf("-- (20-ج)");
  assert.ok(from > 0 && to > from, "تعذّر عزل قسم المحلّل في RUNME");
  const regionRaw = SQL.slice(from, to);
  assert.ok(regionRaw.length > 2000 && regionRaw.length < 12000, "قسم المحلّل بحجم غير متوقّع");
  // التعليقات تُنزَع قبل الفحص: تعليقٌ يذكر النمط الممنوع ليس استعمالًا له.
  const region = regionRaw.replace(/--[^\n]*/g, " ");

  await t.test("ينزع التعليقات قبل أيّ مطابقة", () => {
    for (const src of [regionRaw, POSTCHECK]) {
      assert.ok(src.includes("/\\*.*?\\*/"), "لا نزع تعليقات كتلية");
      assert.ok(src.includes("--[^\\n]*"), "لا نزع تعليقات سطرية");
    }
  });
  await t.test("يخفض الحالة — لا مطابقة حسّاسة للحالة (حادثة COALESCE سابقة)", () => {
    for (const src of [region, POSTCHECK]) assert.ok(/lower\s*\(/.test(src));
  });
  await t.test("لا يستعمل نمطًا يقف عند أوّل قوس", () => {
    assert.ok(!region.includes("[^)]*"), "عاد نمط [^)]* إلى المحلّل");
  });
  await t.test("يقرأ جسم الدالّة (prosrc) لا تعريفًا يحمل اسمها في ترويسته", () => {
    assert.ok(region.includes("prosrc"), "المحلّل يقرأ pg_get_functiondef — الترويسة تحمل الاسم");
    assert.ok(!region.includes("pg_get_functiondef"), "ما زال يقرأ التعريف الكامل");
  });
  await t.test("يمشي فعلًا: طابور عمل + مجموعة زيارة + حدّ عمق", () => {
    assert.ok(region.includes("v_work") && region.includes("v_seen") && region.includes("while "),
      "لا مشي — عادت المطابقة النصّية");
    assert.ok(/v_deep\s*<\s*2/.test(region), "لا تأكيد لا-فراغ على العمق");
  });
  await t.test("POSTCHECK يعبّر عن الانحدار بـWITH RECURSIVE ويحمل ضابطي عدم الانحدار", () => {
    assert.ok(/with\s+recursive/i.test(POSTCHECK), "POSTCHECK بلا مشي تكراريّ");
    assert.ok(POSTCHECK.includes("finops_can_request") && POSTCHECK.includes("finops_is_finance_role"),
      "ضابطا لا-الانحدار غائبان عن POSTCHECK");
    assert.ok(/max\(w\.hops\)[\s\S]{0,120}<\s*2/.test(POSTCHECK), "POSTCHECK بلا تأكيد العمق ≥ ٢");
  });
});

// ════════════════════════════════════════════════════════════════════════════
test("النموذج: كلّ مُسنَد له معنى مستقلّ أو هو مرادف مُعلَن", async (t) => {
  const KEYS = Object.fromEntries(GRANTABLE_KEYS.map((s) => s.split("|")));

  await t.test("البوّابات القابلة للمنح تحمل مفاتيح متمايزة — لا مفتاح يفتح اثنتين", () => {
    const seen = new Set();
    for (const [name, key] of Object.entries(KEYS)) {
      const body = strip(BODIES.get(name));
      assert.ok(body.includes(key.toLowerCase()), `${name} لا تحمل مفتاحها ${key}`);
      assert.ok(!seen.has(key), `المفتاح ${key} مكرَّر`);
      seen.add(key);
      for (const [other, okey] of Object.entries(KEYS)) {
        if (other === name) continue;
        assert.ok(!body.includes(okey.toLowerCase()), `${name} تُفتح أيضًا بمفتاح ${okey}`);
      }
    }
  });

  await t.test("الأسماء المتوارثة مرادفات تنحدر — لا تفتح أكثر من الجذر", () => {
    for (const alias of ["finops_can_view", "finops_can_manage", "finops_can_view_profit",
      "finops_can_manage_receivables", "finops_can_export"]) {
      const b = strip(BODIES.get(alias));
      for (const broad of BROAD_FNS) assert.ok(!new RegExp(`\\b${broad}\\b`).test(b), `${alias} → ${broad}`);
      assert.ok(/\bcoalesce\b/.test(b), `${alias} بلا coalesce`);
    }
    // finops_can_approve مرادف لبوّابة الاعتماد لا للجذر — وهذا مقصود ومُعلَن.
    const ap = strip(BODIES.get("finops_can_approve"));
    assert.ok(/\bfinops_can_approve_expense\b/.test(ap));
    assert.ok(!OWNER_GATES.includes("finops_can_approve"),
      "finops_can_approve أُدرجت في بوّابات المالك — لكنّها بوّابة اعتماد قابلة للمنح");
  });

  await t.test("finops_can_request أوسع مُسنَد — ولا يفتح شيئًا حسّاسًا", () => {
    const b = strip(BODIES.get("finops_can_request"));
    assert.ok(/\bis_staff\b/.test(b), "لا يشترط الموظّف");
    assert.ok(!/\bfinops_can_view_finance_sensitive\b/.test(b));
    // لا دالّة قراءة حسّاسة تقبله بديلًا عن البوّابة الحسّاسة.
    for (const fn of ["finops_costs_list", "finops_budgets_list", "finops_dashboard",
      "finops_profitability", "finops_suppliers_list", "finops_purchase_list"]) {
      const body = strip(BODIES.get(fn));
      assert.ok(/\bfinops_can_view_finance_sensitive\b/.test(body), `${fn} بلا البوّابة الحسّاسة`);
      assert.ok(!/finops_can_request\(\)/.test(body), `${fn} تقبل مُسنَد الموظّف العاديّ`);
    }
  });

  await t.test("finops_is_finance_role معرَّف ولا يُستعمل في أيّ بوّابة (بوّابة ميتة لا حيّة)", () => {
    for (const [name, raw] of BODIES) {
      if (name === "finops_is_finance_role" || name === "finops_access") continue;
      assert.ok(!/\bfinops_is_finance_role\b/.test(strip(raw)),
        `${name} تعتمد دور المالية — قيد CHECK لا يسمح بالقيمة أصلًا فتكون بوّابة ميتة تُقرأ حيّة`);
    }
  });
});
