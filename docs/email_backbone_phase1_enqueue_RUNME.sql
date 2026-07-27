-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P1.1 · إغلاق ثغرة حقن طابور البريد + جعل المُساعِد المشترك Idempotent
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الثغرة (مؤكَّدة على الإنتاج) ★
--
--   docs/review_thread_email_RUNME.sql:40 يمنح:
--       grant execute on function public.nt_enqueue_email(text,text,text,text)
--         to authenticated, service_role;
--
--   والدالّة `security definer` وتأخذ المستلِم والموضوع والنصّ **كمعاملات يتحكّم
--   بها المتصل بالكامل**، ثم تُدرجها مباشرة في طابور الإرسال `email_deliveries`.
--
--   الأثر: أيّ حساب مُسجَّل دخول (عميل، موظف، مستأجر، أو أيّ شخص ينشئ حسابًا —
--   والتسجيل العام مفتوح) يستطيع:
--     (1) إرسال بريد عشوائي إلى أيّ عنوان **من هوية كيان الابتكار** — مُرحِّل
--         تصيّد جاهز يحمل اسم الشركة وسمعتها؛
--     (2) استنفاد حصّة Gmail (~100 رسالة/يوم) فيُظلم كامل نظام إشعارات البوابة.
--
--   تحقُّق حيّ قبل الإصلاح:
--     anon → 42501 (محجوب بشكل صحيح — `revoke ... from public, anon` مُطبَّق)
--     authenticated → **يملك EXECUTE** ⇐ هذا ما يُغلقه هذا الملف.
--
-- ★ لماذا لا نستخدم معاملًا اختياريًا (تفادي 42725) ★
--
--   الحلّ البديهي «أضِف معاملًا خامسًا بقيمة افتراضية» **يكسر الإنتاج**: تبقى
--   الصيغتان (4 معاملات) و(5 بقيمة افتراضية) قابلتَين للمطابقة معًا، فيرفع
--   PostgreSQL الخطأ 42725 `function is not unique` عند كلّ استدعاء من المُنتِجات
--   السبعة القائمة. لذلك المُساعِد الجديد **باسم مختلف وبكلّ معاملاته إلزامية**.
--
-- ★ السلامة ★
--   • إضافي و idempotent بالكامل · لا `DROP` · لا حذف بيانات · لا تغيير مخطط.
--   • الصيغة القديمة (4 معاملات) **تبقى كما هي** فلا يتغيّر أيّ مُنتِج قائم.
--   • تحقّقتُ أن جميع مواضع الاستدعاء السبعة داخل دوال `security definer`
--     (civ_notify ×2، nt_review_comment_insert ×2، nt_review_comment_resolve،
--     nt_review_decision_insert، nt_task_assigned) — أي أنها تُنفَّذ بصلاحية
--     مالك الدالّة لا بصلاحية المستخدم، فسحب المنحة من `authenticated` لا يكسرها.
--   • لا مستدعي من TypeScript إطلاقًا (فحصتُ app/ و lib/ و components/).
--
-- ⚠️ ملاحظة جوهرية: `CREATE OR REPLACE FUNCTION` **لا يُصفّر الصلاحيات**. لذلك
--    السحب أدناه صريح وإلزامي — إعادة تعريف الدالّة وحدها لا تُغلق الثغرة.
-- ⚠️ وملاحظة ثانية: PostgreSQL يمنح EXECUTE إلى PUBLIC افتراضيًا لكلّ دالّة
--    جديدة — لذلك نسحب من PUBLIC صراحةً قبل المنح لـ service_role.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · فحص أوّلي — لا نُكمل إن كان الطابور غير مُثبَّت
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.email_deliveries') is null then
    raise exception 'email_deliveries غير موجود — شغّل project_core_ABSOLUTE_FINAL_RUNME.sql أولًا';
  end if;
end $$;

-- الفهرس الفريد الجزئي هو أساس منع الازدواج. كلا السطرين idempotent بذاتهما،
-- ومطابقان لما في batch9g/batch10، فتشغيلهما مرّة أخرى بلا أثر.
alter table public.email_deliveries add column if not exists idempotency_key text;
create unique index if not exists uq_edel_idem
  on public.email_deliveries(idempotency_key) where idempotency_key is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · المُساعِد الجديد — كلّ المعاملات إلزامية (لا تعارض صيغ ⇒ لا 42725)
-- ─────────────────────────────────────────────────────────────────────────────
-- هذا هو **موضع الإدراج الوحيد** في الطابور من هذا المسار. يقبل مفتاح Idempotency
-- ومعرّف المستلِم، فيستطيع المُنتِجون تفعيل منع الازدواج تدريجيًا دون تغيير صيغتهم.
create or replace function public.nt_enqueue_email_idem(
  p_email        text,
  p_subject      text,
  p_body         text,
  p_url          text,
  p_idem         text,     -- مفتاح منع الازدواج؛ NULL = السلوك القديم (بلا حماية)
  p_recipient_id uuid      -- معرّف المستلِم إن عُرف؛ NULL مقبول
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_email is null or position('@' in p_email) = 0 then return; end if;
  if to_regclass('public.email_deliveries') is null then return; end if;
  begin
    -- ⚠️ الفهرس **جزئي**، لذلك يجب إعادة ذكر الشرط `where idempotency_key is not null`
    -- داخل ON CONFLICT وإلّا رفع PostgreSQL الخطأ 42P10 (لا يستطيع استنتاج الفهرس).
    insert into public.email_deliveries
      (recipient_email, subject, body_text, direct_url, status, idempotency_key, recipient_id)
    values
      (p_email, p_subject, p_body, p_url, 'pending', nullif(btrim(coalesce(p_idem, '')), ''), p_recipient_id)
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  exception when others then null;   -- فشل البريد لا يُفشِل العملية الأصلية أبدًا
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · الصيغة القديمة تصبح غلافًا رفيعًا — موضع إدراج واحد للنظام كلّه
-- ─────────────────────────────────────────────────────────────────────────────
-- الصيغة والسلوك الخارجي متطابقان حرفيًا مع السابق، فلا يتغيّر أيّ من المُنتِجات
-- السبعة القائمة. الفارق الوحيد أن الإدراج صار في مكان واحد.
create or replace function public.nt_enqueue_email(
  p_email text, p_subject text, p_body text, p_url text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.nt_enqueue_email_idem(p_email, p_subject, p_body, p_url, null, null);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · ★ إغلاق الثغرة ★ — سحب التنفيذ من `authenticated`
-- ─────────────────────────────────────────────────────────────────────────────
-- نفس النمط المُطبَّق ومُثبَت في docs/custody_notification_matrix_RUNME.sql:99-100
-- لدالّتَي civ_notify / civ_notify_managers.
revoke all    on function public.nt_enqueue_email(text,text,text,text) from public, anon, authenticated;
grant  execute on function public.nt_enqueue_email(text,text,text,text) to service_role;

revoke all    on function public.nt_enqueue_email_idem(text,text,text,text,text,uuid) from public, anon, authenticated;
grant  execute on function public.nt_enqueue_email_idem(text,text,text,text,text,uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · فحص ذاتي — يرفض الالتزام إن لم تُغلق الثغرة فعلًا
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_still_granted boolean;
begin
  if to_regprocedure('public.nt_enqueue_email_idem(text,text,text,text,text,uuid)') is null then
    raise exception 'فشل: nt_enqueue_email_idem لم تُنشأ';
  end if;
  if to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is null then
    raise exception 'فشل: nt_enqueue_email (4 معاملات) اختفت — كان يجب أن تبقى';
  end if;

  -- الفحص الجوهري: هل ما زال أيّ حساب مُسجَّل دخول يستطيع حقن الطابور؟
  select has_function_privilege('authenticated', 'public.nt_enqueue_email(text,text,text,text)', 'execute')
    into v_still_granted;
  if v_still_granted then
    raise exception 'فشل أمني: authenticated ما زال يملك EXECUTE على nt_enqueue_email';
  end if;

  select has_function_privilege('authenticated', 'public.nt_enqueue_email_idem(text,text,text,text,text,uuid)', 'execute')
    into v_still_granted;
  if v_still_granted then
    raise exception 'فشل أمني: authenticated يملك EXECUTE على nt_enqueue_email_idem';
  end if;

  -- ولا يزال المسار الشرعي يعمل: service_role يملك التنفيذ.
  if not has_function_privilege('service_role', 'public.nt_enqueue_email(text,text,text,text)', 'execute') then
    raise exception 'فشل: service_role فقد EXECUTE — هذا يكسر الإرسال المشروع';
  end if;

  raise notice '✓ P1.1 تمّ: الثغرة مُغلقة · الغلاف يعمل · المُنتِجات السبعة سليمة';
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل — تحقّق يدوي اختياري:
--   select has_function_privilege('authenticated',
--          'public.nt_enqueue_email(text,text,text,text)', 'execute');
--   ⇒ يجب أن تكون false
-- ════════════════════════════════════════════════════════════════════════════
