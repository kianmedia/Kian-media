-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 5 · التسليم والحقوق — **بلا أيّ بند ماليّ**.
--
-- V2-5.1-A/B · V2-5.2-A/B · V2-5.3-A…D · V2-5.6-A
--
-- ⛔⛔ لا يمسّ هذا الملفّ المالية إطلاقًا. البنود V2-5.5-B/D/E/F محجوبة حتى
--     يُثبت خالد حالة Phase A/B على Production (W5-2). ولا يُفترض تطبيقها.
--
-- ★★ ما يغلقه هذا الملفّ فعليًّا: ثغرة «الكاتب النهائيّ المزدوج» ★★
-- كلا جدولَي الإصدارات يحمل `is_final`، ولكلٍّ كاتبه الحيّ. فيمكن اليوم أن يوجد
-- **إصداران نهائيّان مختلفان للمخرَج الواحد**، ولا شيء يمنع ذلك. §2 يمنعه بحارس
-- على الجدول — لا داخل RPC، لأنّ الكتابة المباشرة تلتفّ على الـRPC.
--
-- ★ القرارات المعتمدة المطبَّقة هنا ★
--  • W5-1: `deliverable_versions` هو المصدر. القديم Legacy/Frozen: **لا كتابة
--    جديدة · لا حذف · لا ترحيل بلا تدقيق قرائيّ**.
--  • V2-5.2-A: عمودان امتداد على `deliverables` — ❌ لا نظام حقوق جديد.
--  • V2-5.6-A: قدرات ضمن `project_member_roles` القائم — ❌ لا نموذج أدوار ثانٍ.
--
-- ⛔ إضافيّ · idempotent · لا حذف · لا استبدال مُشغِّل صامت.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.deliverables') is null then
    raise exception '🔴 deliverables مفقود';
  end if;
  if to_regclass('public.deliverable_versions') is null then
    raise exception '🔴 deliverable_versions مفقود — وهو المصدر المعتمد (D-4)';
  end if;
end $$;

-- ─── §1 · V2-5.2-A · حقوق العرض التسويقيّ ──────────────────────────────────
--
-- عمودان على `deliverables` نفسه. ⛔ لا جدول حقوق ولا نظام تراخيص: السؤال
-- «هل يجوز عرض هذا العمل في الشوريل؟» خاصيّة **للمخرَج**، لا كيان مستقلّ.
alter table public.deliverables
  add column if not exists showreel_allowed boolean not null default false,
  add column if not exists confidential     boolean not null default false,
  add column if not exists rights_note      text,
  add column if not exists rights_set_by    uuid references auth.users(id),
  add column if not exists rights_set_at    timestamptz;

comment on column public.deliverables.showreel_allowed is
  'V2-5.2-A — الافتراض false. إذن العرض التسويقيّ **يُمنح** ولا يُفترض: عملٌ '
  'يظهر في شوريل بلا إذن العميل خرق للسرّية لا خطأ عرض.';
comment on column public.deliverables.confidential is
  'V2-5.2-A — سرّيّ صراحةً. يتقدّم على showreel_allowed دائمًا (§3).';

-- 🔴 التناقض يُمنع في القاعدة لا في الواجهة: سرّيّ ومسموح تسويقيًّا معًا مستحيل.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliverables_rights_coherent') then
    alter table public.deliverables
      add constraint deliverables_rights_coherent
      check (not (confidential = true and showreel_allowed = true)) not valid;
    -- `not valid`: يُطبَّق على كلّ كتابة جديدة ولا يُسقط صفًّا قائمًا مخالفًا.
  end if;
end $$;

-- ─── §2 · 🔴 حراس تجميد الجدول القديم ونزاهة النسخة النهائية ───────────────
--
-- الحارس **على الجدول** لا داخل RPC: كتابة مباشرة عبر PostgREST أو دالّة أخرى
-- تلتفّ على أيّ فحص داخل RPC. (نفس منطق `23P01` في نطاق التشغيل.)

-- (أ) لا كتابة جديدة في الجدول المُجمَّد.
create or replace function public.dv_block_legacy_writes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ⛔ INSERT ممنوع تمامًا. UPDATE مسموح **فقط** لإطفاء is_final (تصحيح تعارض)
  --    أو لتعديل لا يمسّ حالة النهائيّ — فالتجميد يمنع النموّ لا الإصلاح.
  if tg_op = 'INSERT' then
    raise exception
      'project_deliverable_versions is frozen (W5-1). Write to deliverable_versions instead.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and coalesce(new.is_final,false) = true
     and coalesce(old.is_final,false) = false then
    raise exception
      'project_deliverable_versions is frozen: a NEW final version may not be created here (W5-1).'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ⚠️ يُسقَط ثمّ يُنشأ باسمه الخاصّ — لا استبدال صامت لمُشغِّل قائم لغيرنا.
drop trigger if exists trg_dv_block_legacy_writes on public.project_deliverable_versions;
create trigger trg_dv_block_legacy_writes
  before insert or update on public.project_deliverable_versions
  for each row execute function public.dv_block_legacy_writes();

-- (ب) نسخة نهائية واحدة فعّالة لكلّ مخرَج، في الجدول المعتمد.
create unique index if not exists deliverable_versions_one_final
  on public.deliverable_versions (deliverable_id)
  where is_final = true and is_deleted = false;

-- (ج) نزاهة الإصدار: العلامة المائية · الحذف الناعم · حماية النزاع.
create or replace function public.dv_integrity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 🔴 لا تجاوز للعلامة المائية على معاينة غير نهائية. المعاينة تخرج من أيدينا،
  --    والعلامة هي ما يمنع تداولها كنسخة مسلَّمة.
  if tg_op in ('INSERT','UPDATE')
     and coalesce(new.is_final,false) = false
     and coalesce(new.watermark_required,true) = false
     and coalesce(new.preview_url,'') <> '' then
    raise exception
      'watermark_required cannot be disabled on a non-final preview'
      using errcode = '23514';
  end if;

  -- 🔴 لا حذف نهائيّ: الحذف إخفاء. صفّ ذاهب بلا أثر لا يُسترجَع.
  if tg_op = 'DELETE' then
    raise exception
      'deliverable_versions rows are soft-deleted, never removed (set is_deleted)'
      using errcode = '42501';
  end if;

  -- 🔴 حماية النزاع: إصدار طُلب تعديله لا يُخفى. إخفاؤه يمحو أثر الاعتراض.
  if tg_op = 'UPDATE'
     and coalesce(new.is_deleted,false) = true
     and coalesce(old.is_deleted,false) = false
     and old.decision = 'revision_requested' then
    raise exception
      'a version under revision_requested may not be deleted while disputed'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_dv_integrity_guard on public.deliverable_versions;
create trigger trg_dv_integrity_guard
  before insert or update or delete on public.deliverable_versions
  for each row execute function public.dv_integrity_guard();

-- ─── §3 · V2-5.2-B · عرض التصفية التسويقيّ ─────────────────────────────────
-- 🔴 السرّية تتقدّم دائمًا، والنهائيّ شرط: لا يُعرض تسويقيًّا ما لم يُسلَّم.
create or replace view public.deliverable_showreel_v as
select
  d.id            as deliverable_id,
  d.project_id,
  d.title,
  d.type,
  d.rights_note,
  dv.id           as final_version_id,
  dv.version_no   as final_version_no,
  dv.preview_url
from public.deliverables d
join public.deliverable_versions dv
  on dv.deliverable_id = d.id and dv.is_final = true and dv.is_deleted = false
where d.showreel_allowed = true
  and d.confidential = false          -- ⛔ السرّية تتقدّم
  and d.status = 'final_delivered';   -- ⛔ ولا يُعرض ما لم يُسلَّم

comment on view public.deliverable_showreel_v is
  'V2-5.2-B — تصفية لا نظام حقوق. ثلاثة شروط معًا: إذن صريح · غير سرّيّ · مُسلَّم.';

-- ─── §4 · V2-5.3-A…C · إكمال رباعية رابط التسليم ───────────────────────────
--
-- القائم: `project_delivery_release` (بوّابة السداد) · `deliverable_downloads`
-- · `deliverable_final_opens` · `pc_release_window_ok`. ⛔ لا نظام روابط ثانٍ —
-- الناقص هو **الرمز والانتهاء والعدّاد والإلغاء**، وهي تُضاف كجدول رموز واحد
-- بنفس عقد رموز التقويم (بصمة لا رمزًا خامًّا).
create table if not exists public.delivery_share_links (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete cascade,
  label         text,
  -- ⛔ الرمز الخامّ لا يُخزَّن.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint    text check (token_hint is null or length(token_hint) <= 8),
  status        text not null default 'active'
                check (status in ('active','revoked','expired','exhausted')),
  expires_at    timestamptz not null,
  max_opens     integer check (max_opens is null or max_opens between 1 and 100000),
  opens_used    integer not null default 0 check (opens_used >= 0),
  last_opened_at timestamptz,
  issued_by     uuid references auth.users(id),
  issued_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  revoke_reason text,
  constraint dsl_window check (expires_at > issued_at),
  constraint dsl_revoked_pair check (
    status <> 'revoked' or (revoked_at is not null and length(btrim(coalesce(revoke_reason,''))) >= 3))
);

create index if not exists dsl_project_idx on public.delivery_share_links (project_id, status);

alter table public.delivery_share_links enable row level security;
drop policy if exists dsl_read on public.delivery_share_links;
create policy dsl_read on public.delivery_share_links
  for select to authenticated using (public.can_manage_projects());
revoke all on public.delivery_share_links from anon, public;

-- ─── §5 · V2-5.6-A · قدرة اعتماد العميل — بلا نموذج أدوار موازٍ ────────────
--
-- ⛔ لا دور جديد: `project_member_roles` يحمل `client_representative` و`approver`
--    أصلًا. المطلوب **قدرة** تُفرض في القاعدة لا في الواجهة.
create or replace function public.pc_client_can_approve(p_project uuid, p_user uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := coalesce(p_user, auth.uid());
begin
  -- 🔴 NULL لا يمرّ: مستدعٍ بلا هويّة ليس معتمِدًا.
  if v_user is null or p_project is null then return false; end if;
  return exists (
    select 1 from public.project_member_roles r
     where r.project_id = p_project
       and r.user_id = v_user
       and r.project_role = 'approver'
       and coalesce(r.is_deleted,false) = false
  );
end $$;

create or replace function public.pc_client_can_view(p_project uuid, p_user uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := coalesce(p_user, auth.uid());
begin
  if v_user is null or p_project is null then return false; end if;
  return exists (
    select 1 from public.project_member_roles r
     where r.project_id = p_project
       and r.user_id = v_user
       and r.project_role in ('client_representative','approver','observer','reviewer')
       and coalesce(r.is_deleted,false) = false
  );
end $$;


-- ─── §5·١ · دوالّ روابط التسليم — جدول بلا دوالّ ليس ميزة ──────────────────
--
-- نفس عقد رموز التقويم (Wave 3): الرمز يُولَّد في الخادم، ويُعاد **مرّة واحدة**،
-- ولا يُخزَّن إلّا مهشَّمًا. والرفض موحَّد فلا يكشف وجود مشروع.
create or replace function public.delivery_link_issue(
  p_project uuid, p_deliverable uuid default null,
  p_days integer default 14, p_max_opens integer default null, p_label text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_raw text; v_hash text; v_id uuid; v_days int;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project is null then raise exception 'project_required'; end if;
  v_days := least(greatest(coalesce(p_days, 14), 1), 90);

  v_raw  := encode(public.gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.delivery_share_links
    (project_id, deliverable_id, label, token_hash, token_hint, expires_at, max_opens, issued_by)
  values
    (p_project, p_deliverable, nullif(btrim(coalesce(p_label,'')),''), v_hash, right(v_raw, 6),
     now() + make_interval(days => v_days), p_max_opens, auth.uid())
  returning id into v_id;

  -- ⚠️ يظهر مرّة واحدة. ⛔ ولا إرسال من هنا: التسليم قرار بشريّ.
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_raw,
                            'hint', right(v_raw, 6), 'expires_in_days', v_days,
                            'auto_sent', false);
end $$;

create or replace function public.delivery_link_revoke(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;
  update public.delivery_share_links
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   where id = p_id and status = 'active';
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 🔴 التحقّق العامّ. الحارس قبل أيّ SELECT، ومطابقة تامّة، وردّ موحَّد.
create or replace function public.delivery_link_check(p_token_hash text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if p_token_hash is null
     or length(p_token_hash) <> 64
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;
  select * into r from public.delivery_share_links where token_hash = p_token_hash for update;
  if r.id is null then return jsonb_build_object('ok', false); end if;
  if r.status <> 'active' then return jsonb_build_object('ok', false); end if;
  if r.expires_at <= now() then
    update public.delivery_share_links set status = 'expired' where id = r.id and status = 'active';
    return jsonb_build_object('ok', false);
  end if;
  if r.max_opens is not null and r.opens_used >= r.max_opens then
    update public.delivery_share_links set status = 'exhausted' where id = r.id and status = 'active';
    return jsonb_build_object('ok', false);
  end if;

  -- 🔴 بوّابة السداد القائمة تُحترم كما هي — الرابط لا يلتفّ عليها.
  if to_regproc('public.pc_release_window_ok(uuid)') is not null then
    if not public.pc_release_window_ok(r.project_id) then
      return jsonb_build_object('ok', false);
    end if;
  end if;

  update public.delivery_share_links
     set opens_used = opens_used + 1, last_opened_at = now() where id = r.id;

  -- ⛔ لا يُعاد معرّف مشروع ولا عنوان: الرمز يُثبت الحقّ ولا يكشف ما وراءه.
  return jsonb_build_object('ok', true, 'deliverable_id', r.deliverable_id);
end $$;

-- ─── §5·٢ · ضبط حقوق العرض — العمودان بلا كاتب ليسا ميزة ───────────────────
create or replace function public.deliverable_rights_set(p_deliverable uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_showreel boolean; v_conf boolean;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_showreel := coalesce((p_payload->>'showreel_allowed')::boolean, false);
  v_conf     := coalesce((p_payload->>'confidential')::boolean, false);
  -- 🔴 التناقض يُرفض برسالة مفهومة قبل أن يرفضه القيد برسالة غامضة.
  if v_showreel and v_conf then
    raise exception 'confidential work cannot be showreel-allowed';
  end if;

  update public.deliverables
     set showreel_allowed = v_showreel,
         confidential     = v_conf,
         rights_note      = nullif(btrim(coalesce(p_payload->>'rights_note','')),''),
         rights_set_by    = auth.uid(),
         rights_set_at    = now()
   where id = p_deliverable;
  if not found then raise exception 'not_found'; end if;

  if to_regproc('public.log_activity(text,text,uuid,jsonb)') is not null then
    perform public.log_activity('deliverable_rights_set', 'deliverable', p_deliverable,
                                jsonb_build_object('showreel_allowed', v_showreel, 'confidential', v_conf));
  end if;
  return jsonb_build_object('ok', true, 'showreel_allowed', v_showreel, 'confidential', v_conf);
end $$;

-- ─── §6 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.pc_client_can_approve(uuid,uuid) from public, anon;
grant execute on function public.pc_client_can_approve(uuid,uuid) to authenticated;
revoke all on function public.pc_client_can_view(uuid,uuid) from public, anon;
grant execute on function public.pc_client_can_view(uuid,uuid) to authenticated;

-- المُشغِّلان داخليّان: لا يُنفَّذان بنداء مستخدم.
revoke all on function public.dv_block_legacy_writes() from public, anon, authenticated;
revoke all on function public.dv_integrity_guard()    from public, anon, authenticated;

revoke all on function public.delivery_link_issue(uuid,uuid,integer,integer,text) from public, anon;
grant execute on function public.delivery_link_issue(uuid,uuid,integer,integer,text) to authenticated;
revoke all on function public.delivery_link_revoke(uuid,text) from public, anon;
grant execute on function public.delivery_link_revoke(uuid,text) to authenticated;
revoke all on function public.deliverable_rights_set(uuid,jsonb) from public, anon;
grant execute on function public.deliverable_rights_set(uuid,jsonb) to authenticated;

-- 🔴 الوحيدة الممنوحة لـanon: التحقّق من الرمز. حارسها داخلها.
revoke all on function public.delivery_link_check(text) from public;
grant execute on function public.delivery_link_check(text) to anon, authenticated;

revoke all on public.deliverable_showreel_v from anon, public;
grant select on public.deliverable_showreel_v to authenticated;

commit;

notify pgrst, 'reload schema';
