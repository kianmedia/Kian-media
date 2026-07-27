-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P1.4 · تهيئة بريد التأجير للمرور عبر الطابور (خلف Feature Flag = OFF)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الخلفية ★
--   `civ_notify` يستثني عمدًا كل أنواع `rental_%` من الطابور الدائم
--   (docs/custody_notification_matrix_RUNME.sql:51) لأن نصوص التأجير تحوي مبالغ مالية.
--   لذلك بريد التأجير هو المسار الوحيد الذي يخرج **مباشرة** بلا صفّ، فلا Idempotency
--   ولا إعادة محاولة ولا ظهور في لوحة المراقبة.
--
-- ★ ما يفعله هذا الملفّ — وما لا يفعله ★
--   يبني **القدرة** فقط. لا يُحوِّل شيئًا اليوم:
--     • الراية `rental_email_queue_enabled` تُضاف بقيمة **false**.
--     • المسار المباشر القائم **لم يُمسّ ولم يُحذف**.
--     • لا Cutover قبل نشر معالج `portal_notify` وإثبات إشعار حقيقي بحالة `sent`.
--   وحين تُرفع الراية لاحقًا يصبح المسار **بديلًا** لا **إضافة** — الكود في
--   app/api/integrations/rental/notify/route.ts يختار أحدهما، فلا ازدواج إطلاقًا.
--
-- ★ سياسة المحتوى المالي (بأمر المالك، مُنفَّذة في SQL لا في الواجهة) ★
--   مسموح:  المبلغ المتفق عليه · ضريبة القيمة المضافة · الإجمالي · العربون ·
--           حالة السداد اللازمة للعميل.
--   ممنوع:  التكاليف الداخلية · هامش الربح · أسعار الموردين · البيانات البنكية
--           وبيانات الدفع الحساسة · وأي مبلغ داخل السجلات.
--   ⚠️ `deposit_method` و`deposit_ref_no` **مستبعدان صراحةً** — وسيلة الدفع ورقم
--      مرجع التحويل بيانات دفع حساسة، وليست «حالة سداد».
--
-- ★ السلامة ★
--   • إضافي و idempotent · لا `DROP` · لا حذف بيانات · لا جدول جديد
--     (نعيد استخدام `custody_inventory_settings` القائم).
--   • تحقّق من الارتباط **على الخادم**: لا يُصفّ بريد لمستلِم غير مرتبط فعليًا بالطلب.
--   • الطابور والعامل والمراقبة وإعادة المحاولة **مُورَّثة كما هي** — لا نظام موازٍ.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · متطلّبات
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.custody_rental_requests') is null then
    raise exception 'custody_rental_requests غير موجود — شغّل rental_insurance_production_RUNME.sql أولًا';
  end if;
  if to_regclass('public.custody_inventory_settings') is null then
    raise exception 'custody_inventory_settings غير موجود — شغّل portal_custody_inventory_system_v1_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.nt_enqueue_email_idem(text,text,text,text,text,uuid)') is null then
    raise exception 'nt_enqueue_email_idem غير موجود — شغّل email_backbone_phase1_enqueue_RUNME.sql أولًا';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · الراية — تُضاف مُطفأة
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.custody_inventory_settings
  add column if not exists rental_email_queue_enabled boolean not null default false;

-- قراءة الراية. لا تُستخدم كحماية — الحماية في §2 — بل كمفتاح تشغيل.
create or replace function public.civ_rental_email_queue_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rental_email_queue_enabled from public.custody_inventory_settings where id = 1), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · ★ التحقّق من الارتباط ★ — لا يُصفّ بريد لمستلِم غير مرتبط بالطلب
-- ─────────────────────────────────────────────────────────────────────────────
-- يُنفَّذ على الخادم قبل أيّ إدراج. إخفاء الزرّ في الواجهة ليس حماية.
create or replace function public.civ_rental_email_recipient_allowed(p_rental uuid, p_email text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_ok boolean;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) = 0 then return false; end if;
  if p_rental is null then return false; end if;

  -- (أ) المستأجر نفسه: بريده في سجلّ العميل، أو بريد حسابه في auth.users.
  select exists (
    select 1
    from public.custody_rental_requests r
    join public.custody_rental_customers c on c.id = r.customer_id
    where r.id = p_rental
      and coalesce(c.is_deleted, false) = false
      and (
        lower(btrim(coalesce(c.email, ''))) = v_email
        or exists (select 1 from auth.users u
                   where u.id = c.user_id and lower(btrim(coalesce(u.email, ''))) = v_email)
      )
  ) into v_ok;
  if v_ok then return true; end if;

  -- (ب) طاقم كيان المخوّل تشغيليًا لهذا الملفّ. نفس المجموعة التي يستخدمها
  --     المسار المباشر القائم (app/api/integrations/rental/notify/route.ts) حتى لا
  --     يتغيّر جمهور المستلِمين عند التحويل.
  select exists (
    select 1 from public.profiles p
    where lower(btrim(coalesce(p.email, ''))) = v_email
      and p.account_status = 'active'
      and (p.account_type = 'admin'
           or p.staff_role in ('super_admin','manager','custody_officer','finance'))
  ) into v_ok;
  return coalesce(v_ok, false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · جسم الرسالة — الحقول المسموحة فقط، مبنيّ في SQL لا في الواجهة
-- ─────────────────────────────────────────────────────────────────────────────
-- بناؤه هنا يعني أن الواجهة **لا تستطيع** تسريب حقل ممنوع حتى لو أُخطئ فيها لاحقًا.
create or replace function public.civ_rental_email_body(p_rental uuid, p_event text)
returns text language plpgsql stable security definer set search_path = public as $$
declare r record; v text; v_cur text;
begin
  select request_number, subtotal, vat_amount, grand_total, currency,
         deposit_amount, deposit_status, rental_from, rental_to
    into r
    from public.custody_rental_requests where id = p_rental;
  if not found then return null; end if;

  v_cur := coalesce(nullif(btrim(r.currency), ''), 'SAR');
  v := 'طلب التأجير رقم: ' || coalesce(r.request_number, '—');
  if r.rental_from is not null then
    v := v || E'\nالفترة: ' || to_char(r.rental_from, 'YYYY-MM-DD')
           || ' → ' || coalesce(to_char(r.rental_to, 'YYYY-MM-DD'), '—');
  end if;

  -- المسموح حصرًا. أيّ حقل خارج هذه القائمة ممنوع بأمر المالك:
  -- التكاليف الداخلية · هامش الربح · أسعار الموردين · البيانات البنكية/الدفع.
  -- تحديدًا: deposit_method و deposit_ref_no مستبعدان — وسيلة الدفع ورقم المرجع
  -- بيانات دفع حساسة وليست «حالة سداد».
  if coalesce(r.grand_total, 0) > 0 or coalesce(r.deposit_amount, 0) > 0 then
    v := v || E'\n——'
           || E'\nالمبلغ المتفق عليه: '     || trim(to_char(coalesce(r.subtotal, 0),     'FM999999990.00')) || ' ' || v_cur
           || E'\nضريبة القيمة المضافة: '  || trim(to_char(coalesce(r.vat_amount, 0),   'FM999999990.00')) || ' ' || v_cur
           || E'\nالإجمالي: '              || trim(to_char(coalesce(r.grand_total, 0),  'FM999999990.00')) || ' ' || v_cur;
    if coalesce(r.deposit_amount, 0) > 0 then
      v := v || E'\nالعربون: ' || trim(to_char(r.deposit_amount, 'FM999999990.00')) || ' ' || v_cur
             || E'\nحالة العربون: ' || case r.deposit_status
                  when 'not_required'       then 'غير مطلوب'
                  when 'pending'            then 'بانتظار السداد'
                  when 'received'           then 'مُستلَم'
                  when 'held'               then 'محتجَز'
                  when 'partially_applied'  then 'مُطبَّق جزئيًا'
                  when 'fully_applied'      then 'مُطبَّق بالكامل'
                  when 'release_pending'    then 'بانتظار الإرجاع'
                  when 'released'           then 'أُعيد'
                  when 'refunded'           then 'مُسترَد'
                  when 'forfeited'          then 'مُصادَر'
                  else '—' end;
    end if;
  end if;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · الإدراج في الطابور — مفتاح Idempotency ثابت لكل (حدث × مستلِم)
-- ─────────────────────────────────────────────────────────────────────────────
-- يُعيد jsonb: { outcome, delivery_id }
--   outcome ∈ disabled | not_linked | no_rental | queued | error
--   delivery_id = معرّف الصفّ (أو null) — يحتاجه المستدعي لتصريف الطابور فورًا
--   بالمعرّفات الدقيقة بدل مسح عام. يُقرأ بالمفتاح الفريد بعد الإدراج، فيصحّ سواء
--   أُدرج الصفّ الآن أم كان موجودًا (on conflict do nothing) — وهذا هو سلوك Idempotency
--   المطلوب: نفس الحدث لنفس المستلِم يُعيد نفس الصفّ ولا يُنشئ ثانيًا.
-- لا يرفع استثناءً أبدًا — فشل البريد يجب ألّا يُفشِل عملية التأجير.
create or replace function public.civ_rental_enqueue_email(
  p_event           text,
  p_rental          uuid,
  p_recipient_email text,
  p_subject         text,
  p_url             text,
  p_recipient_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_body text; v_key text; v_email text; v_id uuid;
begin
  -- (1) الراية. مُطفأة ⇒ لا شيء يحدث إطلاقًا (سلوك اليوم).
  if not public.civ_rental_email_queue_enabled() then
    return jsonb_build_object('outcome', 'disabled', 'delivery_id', null);
  end if;

  v_email := lower(btrim(coalesce(p_recipient_email, '')));
  if p_rental is null or v_email = '' then
    return jsonb_build_object('outcome', 'no_rental', 'delivery_id', null);
  end if;

  -- (2) التحقّق من الارتباط على الخادم — قبل أي إدراج.
  if not public.civ_rental_email_recipient_allowed(p_rental, v_email) then
    return jsonb_build_object('outcome', 'not_linked', 'delivery_id', null);
  end if;

  v_body := public.civ_rental_email_body(p_rental, p_event);
  if v_body is null then
    return jsonb_build_object('outcome', 'no_rental', 'delivery_id', null);
  end if;

  -- (3) مفتاح ثابت وفريد لكل (حدث × طلب × مستلِم). ثابت عبر إعادة المحاولة، فيمنع
  --     الازدواج عبر الفهرس الفريد الجزئي uq_edel_idem.
  v_key := 'rental:' || coalesce(nullif(btrim(p_event), ''), 'unknown')
        || ':' || p_rental::text || ':' || v_email;

  perform public.nt_enqueue_email_idem(
    v_email,
    coalesce(nullif(btrim(p_subject), ''), 'تحديث تأجير — كيان'),
    v_body, p_url, v_key, p_recipient_id);

  -- المفتاح فريد، فهذه القراءة قطعية: تُعيد الصفّ الجديد أو الصفّ القائم.
  select id into v_id from public.email_deliveries where idempotency_key = v_key;
  return jsonb_build_object('outcome', 'queued', 'delivery_id', v_id);
exception when others then
  -- لا نُسجّل الجسم ولا المبالغ ولا البريد — SQLSTATE فقط.
  raise warning 'civ_rental_enqueue_email failed: %', sqlstate;
  return jsonb_build_object('outcome', 'error', 'delivery_id', null);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 · سياسة الاحتفاظ — تنقيح (لا حذف)
-- ─────────────────────────────────────────────────────────────────────────────
-- أجسام بريد التأجير تحوي مبالغ. بعد التسليم لم يعد لبقائها مبرّر تشغيلي.
-- **تنقيح لا حذف**: يبقى الصفّ وتاريخه وحالته للتدقيق، ويُفرَّغ النصّ فقط.
-- ⚠️ غير مربوطة بأي Cron عمدًا — تشغيلها قرار إداري صريح، لا أثر جانبي.
create or replace function public.civ_rental_email_redact_old(p_days int default 90)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_days int;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  v_days := greatest(coalesce(p_days, 90), 7);   -- لا تنقيح أحدث من أسبوع
  update public.email_deliveries
     set body_text = '[redacted-by-retention-policy]'
   where status = 'sent'
     and left(coalesce(idempotency_key, ''), 7) = 'rental:'
     and body_text is not null
     and body_text <> '[redacted-by-retention-policy]'
     and coalesce(sent_at, created_at) < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6 · الصلاحيات — خدمة فقط (وPostgreSQL يمنح PUBLIC افتراضيًا ⇒ سحب صريح)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.civ_rental_enqueue_email(text,uuid,text,text,text,uuid) from public, anon, authenticated;
grant  execute on function public.civ_rental_enqueue_email(text,uuid,text,text,text,uuid) to service_role;

revoke all on function public.civ_rental_email_body(uuid,text) from public, anon, authenticated;
grant  execute on function public.civ_rental_email_body(uuid,text) to service_role;

revoke all on function public.civ_rental_email_recipient_allowed(uuid,text) from public, anon, authenticated;
grant  execute on function public.civ_rental_email_recipient_allowed(uuid,text) to service_role;

-- الراية تُقرأ من الخادم فقط.
revoke all on function public.civ_rental_email_queue_enabled() from public, anon;
grant  execute on function public.civ_rental_email_queue_enabled() to authenticated, service_role;

-- التنقيح إداريّ (يفرض can_manage_projects داخليًا أيضًا).
revoke all on function public.civ_rental_email_redact_old(int) from public, anon;
grant  execute on function public.civ_rental_email_redact_old(int) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §7 · فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_flag boolean; v_n int;
begin
  if to_regprocedure('public.civ_rental_enqueue_email(text,uuid,text,text,text,uuid)') is null then
    raise exception 'فشل: civ_rental_enqueue_email لم تُنشأ';
  end if;

  -- ★ الأهم: الراية يجب أن تكون مُطفأة — لا Cutover في هذا الملفّ.
  select public.civ_rental_email_queue_enabled() into v_flag;
  if v_flag is not false then
    raise exception 'فشل: الراية ليست OFF — هذا الملفّ يجب ألّا يُحوِّل أيّ بريد';
  end if;

  -- مستلِم غير مرتبط يجب أن يُرفض حتى لو كان بريدًا صحيحًا.
  if public.civ_rental_email_recipient_allowed(
       (select id from public.custody_rental_requests limit 1),
       'definitely-not-linked@example.invalid') then
    raise exception 'فشل أمني: قُبل مستلِم غير مرتبط بالطلب';
  end if;

  -- لا صلاحية تنفيذ لأيّ حساب مُسجَّل دخول على دالّة الإدراج.
  if has_function_privilege('authenticated',
       'public.civ_rental_enqueue_email(text,uuid,text,text,text,uuid)', 'execute') then
    raise exception 'فشل أمني: authenticated يملك EXECUTE على civ_rental_enqueue_email';
  end if;

  raise notice '✓ P1.4 تمّ: القدرة مبنيّة · الراية OFF · المسار المباشر لم يُمسّ';
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- التفعيل لاحقًا (خطوة مستقلّة — لا تُنفَّذ الآن):
--   1) انشر معالج portal_notify واختبر إشعارًا حقيقيًا حتى حالة sent.
--   2) update public.custody_inventory_settings set rental_email_queue_enabled = true where id = 1;
--   3) راقب لوحة الإشعارات، ثم أوقف المسار المباشر تدريجيًا.
-- التراجع الفوري: اضبط الراية على false — يعود المسار المباشر فورًا.
-- ════════════════════════════════════════════════════════════════════════════
