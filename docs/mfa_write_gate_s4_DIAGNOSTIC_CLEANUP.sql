-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S4 · حذف مِسبار التشخيص — **وحده، ولا شيء غيره**
-- docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql
-- ════════════════════════════════════════════════════════════════════════════
--
--   يحذف `public.mfa_gate_selftest()` فقط.
--
-- ★ ما لا يلمسه هذا الملفّ — صراحةً ★
--   public.mfa_write_ok() · public.mfa_require_aal2(text) · public.mfa_my_assurance() ·
--   public.mfa_admin_set_mode(text) · public.mfa_settings · public.mfa_audit ·
--   auth.mfa_factors · أيّ دالّة admin_* · أيّ سياسة RLS · أيّ منح أو سحب صلاحية.
--   لا `drop ... cascade` · لا `drop schema` · لا `revoke` · لا كتابة بيانات.
--   §2 يُثبت ذلك بعد الحذف ويُجهض المعاملة إن سقط أيّ منها.
--
-- ★ متى يُشغَّل ★  فور انتهاء نصّ القبول (§4 من ملفّ التشخيص). ترك المِسبار حيًّا
--   ليس ثغرة — لا يكتب ولا يُعيد سرًّا — لكنه سطح إضافي بلا مقابل بعد أن أدّى غرضه.
--
-- ★ إعادة التشغيل آمنة ★  `if exists` ⇒ تشغيله على قاعدة نظيفة لا يفعل شيئًا.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · الحذف — سطر واحد، بصيغة دقيقة (بلا معاملات، فلا يوجد حِمل آخر بالاسم)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.mfa_gate_selftest();

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · إثبات أن شيئًا آخر لم يُمَسّ — يُجهض المعاملة عند أيّ سقوط
-- ─────────────────────────────────────────────────────────────────────────────
do $chk$
declare v_missing text := '';
begin
  if to_regprocedure('public.mfa_gate_selftest()') is not null then
    raise exception 'فشل: المِسبار ما زال موجودًا — قد يكون له حِمل بصيغة مختلفة، راجع يدويًّا';
  end if;

  -- الأساسيات التي **يجب** أن تبقى كما هي
  if to_regprocedure('public.mfa_write_ok()')        is null then v_missing := v_missing || ' mfa_write_ok()'; end if;
  if to_regprocedure('public.mfa_require_aal2(text)') is null then v_missing := v_missing || ' mfa_require_aal2(text)'; end if;
  if to_regclass('public.mfa_settings')               is null then v_missing := v_missing || ' mfa_settings'; end if;
  if v_missing <> '' then
    raise exception 'فشل حرج: هذا الملفّ لا يجوز أن يحذف إلّا المِسبار، والمفقود الآن:%', v_missing;
  end if;

  -- البوّابة ما زالت SECURITY DEFINER وما زالت تقرأ العوامل (لم يمسّها الحذف)
  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.mfa_write_ok()')::oid) then
    raise exception 'فشل حرج: mfa_write_ok لم تعد SECURITY DEFINER';
  end if;
  if pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')) not ilike '%mfa_factors%' then
    raise exception 'فشل حرج: جسم mfa_write_ok لم يعد يقرأ auth.mfa_factors';
  end if;

  -- زرّ الطوارئ ما زال بلا بوّابة
  if to_regprocedure('public.mfa_admin_set_mode(text)') is not null
     and pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%' then
    raise exception 'فشل حرج: mfa_admin_set_mode صارت مبوَّبة — ليست من عمل هذا الملفّ، راجع فورًا';
  end if;

  -- القيد غير القابل للتفاوض لم يتغيّر
  -- (بصيغة oid لا بالاسم النصّي: جدول غير مرئي يُعيد NULL بدل أن يرفع خطأً يُخفي النتيجة)
  if coalesce(has_table_privilege('anon',          to_regclass('auth.mfa_factors')::oid, 'select'), false)
     or coalesce(has_table_privilege('authenticated', to_regclass('auth.mfa_factors')::oid, 'select'), false) then
    raise exception 'فشل أمني: anon أو authenticated يملك SELECT مباشرًا على auth.mfa_factors';
  end if;

  raise notice '✓ حُذف المِسبار وحده · mfa_write_ok و mfa_require_aal2 و mfa_settings سليمة · لا SELECT مباشر على auth.mfa_factors';
end $chk$;

commit;

notify pgrst, 'reload schema';
