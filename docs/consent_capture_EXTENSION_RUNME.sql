-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 0 · V2-0.1-F · تسجيل الموافقة على سياسة الخصوصية
-- docs/consent_capture_EXTENSION_RUNME.sql
--
-- ⚠️ لم يُشغَّل. أُنشئ كملف فقط ضمن Wave 0 (MASTER_BRIEF_v2.1.md §2 G2).
--    التشغيل خطوة يدوية من خالد على Supabase SQL Editor.
--
-- الترتيب: PREFLIGHT مدمج في §0 → هذا الملف → consent_capture_EXTENSION_POSTCHECK.sql
-- التراجع: consent_capture_EXTENSION_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ ما يفعله ★
--   (١) ثلاثة أعمدة **امتداد** على `public.public_intake` القائم — لا جدول جديد.
--       هذا مطلب G13-4 حرفيًا: الحقول شديدة التخصص تُضاف كامتداد على السجل القائم،
--       ولا يُنشأ مصدر بيانات موازٍ لنفس الحقيقة (طلب الزائر).
--   (٢) دالّة `public_intake_set_consent` — **منفصلة عمدًا** عن
--       `capture_public_intake` ولا تعدّل توقيعها.
--
-- ★ لماذا دالّة ثانية بدل توسيع القائمة ★
--   PostgREST يحلّ الدوال **بأسماء المعاملات**. إضافة `p_consent_*` إلى
--   `capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)`
--   كانت ستجعل **كل إرسال عام يفشل بـPGRST202** بين لحظة نشر الكود ولحظة تشغيل هذا
--   الملف — أي تحويل تحسينٍ للخصوصية إلى انقطاع كامل في استقبال الطلبات.
--   الفصل يجعل الكود يسبق SQL بأمان: الصفّ يُكتب أولًا، والموافقة تُلحق بعده، وغياب
--   الدالّة يكلّف سطر سجلّ واحدًا لا أكثر (app/api/public/intake/route.ts).
--
-- ★ إضافي وidempotent ★
--   لا `DROP` لأي كائن قائم · لا تعديل على `capture_public_intake` · لا تغيير على
--   سياسات RLS القائمة · لا `CONCURRENTLY` · معاملة واحدة · فحص ذاتي يرفض الالتزام.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ §0 · PREFLIGHT — لا تُشغَّل على قاعدة غير مُهيّأة ══════════════════════
do $pf$
declare miss text := '';
begin
  if to_regclass('public.public_intake') is null then
    miss := miss || ' table:public_intake';
  end if;
  if to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is null then
    miss := miss || ' fn:capture_public_intake/14';
  end if;
  if miss <> '' then
    raise exception 'PREFLIGHT فشل — اعتماديات مفقودة:% · شغّل production_restore_latest_quotes_zoho_RUNME.sql أولًا', miss;
  end if;
end $pf$;


begin;

-- ═══ §1 · أعمدة الامتداد ════════════════════════════════════════════════════
-- `consent_given` يبقى NULL للصفوف القائمة عمدًا — و NULL هنا يعني
-- «لم تُسجَّل موافقة»، وهو **ليس** «رُفضت الموافقة». الفرق جوهري قانونيًا:
-- الصفوف السابقة لهذه الترحيلة لم تُسأل أصلًا. لذلك لا DEFAULT false.
alter table public.public_intake add column if not exists consent_given   boolean;
alter table public.public_intake add column if not exists consent_at      timestamptz;
alter table public.public_intake add column if not exists consent_version text;

comment on column public.public_intake.consent_given is
  'V2-0.1-F. true = وافق صراحةً. NULL = لم تُسجَّل موافقة (ليس رفضًا).';
comment on column public.public_intake.consent_at is
  'V2-0.1-F. لحظة الموافقة كما وصلت من المتصفح (UTC).';
comment on column public.public_intake.consent_version is
  'V2-0.1-F. نسخة نصّ الموافقة (lib/consent.ts → CONSENT_VERSION). بدونها لا يمكن إثبات ما وُوفِق عليه.';

-- سلامة داخلية: لا يوجد صفّ يدّعي موافقة بلا وقت أو بلا نسخة نصّ.
-- `not valid` كي لا يفحص الصفوف التاريخية (كلها NULL فتمرّ أصلًا) ولا يقفل الجدول.
do $c$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.public_intake'::regclass and conname = 'public_intake_consent_complete'
  ) then
    alter table public.public_intake
      add constraint public_intake_consent_complete
      check (consent_given is not true or (consent_at is not null and consent_version is not null))
      not valid;
  end if;
end $c$;


-- ═══ §2 · الدالّة — إلحاق الموافقة بصفّ قائم ═══════════════════════════════
-- SECURITY DEFINER بصلاحية المالك، **ممنوحة لـservice_role وحده** تمامًا كما
-- `capture_public_intake`. لا anon ولا authenticated — المسار الخادمي هو المتصل
-- الوحيد، فلا يستطيع أحد تزوير موافقة على صفّ ليس له.
create or replace function public.public_intake_set_consent(
  p_intake_id uuid,
  p_given     boolean,
  p_at        text,
  p_version   text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if p_intake_id is null then return false; end if;
  -- موافقة سلبية لا تُكتب: غياب السجلّ أصدق من صفّ يدّعي رفضًا لم يُسأل عنه.
  if p_given is not true then return false; end if;
  if p_version is null or btrim(p_version) = '' then
    raise exception 'consent_version مطلوبة — بدونها لا يمكن إثبات نصّ ما وُوفِق عليه';
  end if;

  -- وقت المتصفح غير موثوق: يُقبل، لكن إن كان غير صالح أو في المستقبل نستبدله
  -- بوقت الخادم بدل تسجيل طابع زمني مستحيل.
  begin
    v_at := p_at::timestamptz;
  exception when others then
    v_at := now();
  end;
  if v_at is null or v_at > now() + interval '5 minutes' then
    v_at := now();
  end if;

  update public.public_intake
     set consent_given   = true,
         consent_at      = coalesce(consent_at, v_at),   -- أول موافقة تُثبَّت ولا تُدهَس
         consent_version = coalesce(consent_version, btrim(p_version)),
         updated_at      = now()
   where id = p_intake_id;

  return found;
end $$;

revoke execute on function public.public_intake_set_consent(uuid,boolean,text,text) from public, anon, authenticated;
grant  execute on function public.public_intake_set_consent(uuid,boolean,text,text) to service_role;


-- ═══ §3 · RLS — لا سياسة جديدة، والقائمة تغطّي الأعمدة الجديدة ═════════════
-- `public_intake` عليها RLS مفعّلة وسياسة قراءة واحدة (`public_intake_read`)
-- على مستوى **الصفّ**، فالأعمدة الجديدة ترثها تلقائيًا: يراها صاحب الصفّ
-- (بالـuid أو بالبريد المُتحقَّق) والموظفون فقط. و`anon` لا يملك SELECT إطلاقًا.
-- ❌ لا سياسة إضافية — إضافة سياسة ثانية للقراءة تُوسّع الوصول لا تُضيّقه.
do $rls$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.public_intake'::regclass) then
    raise exception 'فشل: RLS غير مفعّلة على public_intake — لا تُضِف أعمدة موافقة إلى جدول مكشوف';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='public_intake'
       and grantee in ('anon','public') and privilege_type='SELECT'
  ) then
    raise exception 'فشل: anon يملك SELECT على public_intake';
  end if;
end $rls$;


-- ═══ §4 · فحص ذاتي — يرفض الالتزام إن لم تتحقّق النتيجة ════════════════════
do $v$
declare miss text := '';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='public_intake' and column_name='consent_given')
    then miss := miss || ' consent_given'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='public_intake' and column_name='consent_at')
    then miss := miss || ' consent_at'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='public_intake' and column_name='consent_version')
    then miss := miss || ' consent_version'; end if;
  if miss <> '' then raise exception 'فشل: أعمدة مفقودة بعد التطبيق:%', miss; end if;

  if to_regprocedure('public.public_intake_set_consent(uuid,boolean,text,text)') is null then
    raise exception 'فشل: public_intake_set_consent غير موجودة بعد التطبيق';
  end if;

  -- ★ الأهمّ ★ لم يُمَسّ مسار الالتقاط القائم.
  if to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is null then
    raise exception 'فشل خطير: توقيع capture_public_intake تغيّر — كل إرسال عام سينكسر';
  end if;

  if has_function_privilege('anon','public.public_intake_set_consent(uuid,boolean,text,text)','execute')
     or has_function_privilege('authenticated','public.public_intake_set_consent(uuid,boolean,text,text)','execute') then
    raise exception 'فشل أمني: anon أو authenticated يملك تنفيذ public_intake_set_consent';
  end if;
  if not has_function_privilege('service_role','public.public_intake_set_consent(uuid,boolean,text,text)','execute') then
    raise exception 'فشل: service_role لا يملك التنفيذ — المسار الخادمي لن يعمل';
  end if;

  raise notice 'CONSENT EXTENSION: نجح — ٣ أعمدة امتداد + دالّة إلحاق واحدة، capture_public_intake سليمة، RLS القائمة تغطّي الأعمدة الجديدة، والصلاحية لـservice_role وحده.';
end $v$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: فعّل الراية (docs/FEATURE_FLAG_REGISTRY.md)
--   Vercel → Environment Variables → NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED = true
--   ثم أعِد النشر. قبل ذلك تبقى النماذج الأربعة كما هي حرفيًا.
-- ════════════════════════════════════════════════════════════════════════════
