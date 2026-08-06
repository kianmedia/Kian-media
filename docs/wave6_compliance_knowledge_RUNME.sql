-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · الامتثال والمعرفة — الحزمة الثانية.
--
-- V2-6.4-A · V2-6.6-A/B/C
--
-- ★★ 🔴 انحراف موثَّق عن الـBrief: V2-6.6-A ليس 🆕 ★★
-- الـBrief يطلب جدول `sops` جديدًا. والفحص يقول إنّ قاعدة المعرفة **قائمة
-- بالكامل** في `ai_knowledge_sources`، وفيها بالضبط ما يلزم إجراءً تشغيليًّا:
--
--   • `source_type` يقبل **`'operations_procedure'`** أصلًا — لا توسعة قيد.
--   • `status in (draft, in_review, approved, rejected, expired, archived)`
--     — دورة تحرير ونشر وأرشفة كاملة.
--   • `allowed_roles text[]` + `sensitivity` — صلاحيات وحسّاسية.
--   • `ai_source_revisions` — إصدارات بسجلّ تغيير.
--   • `submitted_by/approved_by/rejected_reason/archived_at` — مسار اعتماد.
--   • `storage_bucket/storage_path` — مرفقات بلا رابط مخزَّن.
--
-- ⇒ جدول `sops` كان سيصير **قاعدة معرفة ثانية**، وهو أوّل ما تمنعه الموجة.
--    فالإجراء وثيقة في النظام القائم، و**الجديد الوحيد** هنا خطواته المرتَّبة.
--
-- ★ وV2-6.4-A سجلّ HSE: **عرض مشتقّ** يوحّد ثلاثة مصادر قائمة ★
-- `ops_job_hse` (فحوص) · `ops_incidents` (حوادث تشغيل) · `custody_incidents`
-- (حوادث عهدة). ⛔ لا سجلّ حوادث رابع — العرض يقرأ الثلاثة ولا يكتب حرفًا.
--
-- ⛔ ولا ادّعاء امتثال: لا شهادة ISO ولا سياسة سلامة مخترعة. ما لا وثيقة له
--    يبقى فارغًا.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.ai_knowledge_sources') is null then
    raise exception '🔴 ai_knowledge_sources مفقود — وهو قاعدة المعرفة القائمة التي تمتدّ عليها الإجراءات';
  end if;
  if to_regclass('public.project_task_checklists') is null then
    raise exception '🔴 project_task_checklists مفقود — V2-6.6-C يعيد استعماله';
  end if;
end $$;

-- ─── §1 · V2-6.4-A · سجلّ HSE موحَّد — عرض مشتقّ لا جدول ───────────────────
--
-- 🔴 كلّ صفّ هنا يعيش في جدوله الأصليّ. لا نسخ ولا مزامنة ولا سجلّ رابع.
create or replace view public.hse_register_v as
  -- فحوص السلامة على أوامر العمل.
  select
    'ops_hse'::text                as source,
    h.id                           as source_id,
    h.job_id                       as job_id,
    null::uuid                     as asset_id,
    h.item_ar                      as title,
    case h.status when 'issue' then 'issue' when 'ok' then 'ok'
                  when 'na' then 'not_applicable' else 'pending' end as state,
    -- الفحص ليس حادثًا: شدّته غير منطبقة، ولا تُخترع.
    null::text                     as severity,
    h.checked_at                   as occurred_at,
    h.checked_by                   as actor,
    h.is_required                  as is_required
  from public.ops_job_hse h
  where coalesce(h.is_deleted,false) = false

  union all
  -- حوادث التشغيل.
  select
    'ops_incident', i.id, i.job_id, null::uuid,
    coalesce(nullif(btrim(i.incident_type),''), 'incident'),
    i.status, i.severity, i.occurred_at, i.reported_by, true
  from public.ops_incidents i
  where coalesce(i.is_deleted,false) = false

  union all
  -- حوادث العهدة.
  select
    'custody_incident', c.id, null::uuid, c.asset_id,
    coalesce(nullif(btrim(c.incident_type),''), 'incident'),
    c.status, null::text, c.occurred_at, c.reported_by, true
  from public.custody_incidents c
  where coalesce(c.is_deleted,false) = false;

comment on view public.hse_register_v is
  'V2-6.4-A — يوحّد ops_job_hse و ops_incidents و custody_incidents. ⛔ عرض '
  'مشتقّ: لا سجلّ حوادث رابع، ولا نسخة تتقادم.';

-- ─── §2 · V2-6.6-B · خطوات الإجراء — الجديد الوحيد ────────────────────────
--
-- الوثيقة نفسها صفّ في `ai_knowledge_sources` بـ`source_type='operations_procedure'`.
-- وهذه خطواتها المرتَّبة — وهي ما لا يوجد في أيّ جدول.
create table if not exists public.sop_items (
  id           uuid primary key default gen_random_uuid(),
  -- 🔗 الوثيقة في قاعدة المعرفة القائمة. ⛔ لا جدول إجراءات موازٍ.
  source_id    uuid not null references public.ai_knowledge_sources(id) on delete cascade,
  sort_order   int not null default 0,
  label_ar     text not null check (length(btrim(label_ar)) between 2 and 300),
  label_en     text,
  -- خطوة إلزامية تمنع إغلاق القائمة؛ وغير الإلزامية تُترك بلا اعتراض.
  is_required  boolean not null default true,
  hint         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false,
  unique (source_id, sort_order)
);

create index if not exists sop_items_source_idx
  on public.sop_items (source_id, sort_order) where is_deleted = false;

comment on table public.sop_items is
  'V2-6.6-B — خطوات إجراء. الوثيقة نفسها في ai_knowledge_sources '
  '(source_type=operations_procedure). ⛔ لا قاعدة معرفة ثانية.';

alter table public.sop_items enable row level security;
drop policy if exists sop_items_read on public.sop_items;
create policy sop_items_read on public.sop_items
  for select to authenticated
  -- الرؤية **تتبع الوثيقة الأمّ** — لا مسار صلاحية ثانٍ.
  using (exists (select 1 from public.ai_knowledge_sources s where s.id = source_id));
revoke all on public.sop_items from anon, public;

-- ─── §3 · V2-6.6-C · إرفاق الإجراء بمهمّة كقائمة إلزامية ──────────────────
--
-- ⛔ يعيد استعمال `project_task_checklists` القائم — لا جدول قوائم ثانٍ.
create or replace function public.sop_attach_to_task(p_source uuid, p_task uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0; r record; v_base int;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- الوثيقة يجب أن تكون **إجراءً معتمَدًا**: مسوّدة لا تُفرَض على طاقم.
  if not exists (
    select 1 from public.ai_knowledge_sources s
     where s.id = p_source and s.source_type = 'operations_procedure' and s.status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'sop_not_approved');
  end if;
  if not exists (select 1 from public.project_tasks t where t.id = p_task) then
    return jsonb_build_object('ok', false, 'reason', 'task_not_found');
  end if;

  -- تُلحق بعد القائمة الحالية ولا تمحوها: قائمة موجودة قد تكون نصف منجَزة.
  select coalesce(max(sort_order), 0) into v_base
    from public.project_task_checklists where task_id = p_task;

  for r in
    select label_ar, sort_order from public.sop_items
     where source_id = p_source and coalesce(is_deleted,false) = false
     order by sort_order
  loop
    -- ⛔ لا تكرار: البند نفسه لا يُضاف مرّتين.
    if not exists (
      select 1 from public.project_task_checklists c
       where c.task_id = p_task and c.label = r.label_ar
    ) then
      insert into public.project_task_checklists (task_id, label, sort_order)
      values (p_task, r.label_ar, v_base + r.sort_order);
      v_n := v_n + 1;
    end if;
  end loop;

  if to_regprocedure('public.log_activity(text,text,uuid,jsonb)') is not null then
    perform public.log_activity('sop_attached_to_task', 'task', p_task,
                                jsonb_build_object('source_id', p_source, 'items', v_n));
  end if;
  return jsonb_build_object('ok', true, 'items_added', v_n);
end $$;

-- ─── §4 · القراءة ──────────────────────────────────────────────────────────
create or replace function public.sop_list(p_status text default 'approved')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title_ar', s.title_ar, 'title_en', s.title_en,
           'status', s.status, 'version', s.version, 'sensitivity', s.sensitivity,
           'approved_at', s.approved_at, 'expires_at', s.expires_at,
           -- مشتقّ: إجراء منتهٍ يُعلن منتهيًا ولو بقيت حالته 'approved'.
           'expired', (s.expires_at is not null and s.expires_at < current_date),
           'item_count', (select count(*) from public.sop_items i
                           where i.source_id = s.id and coalesce(i.is_deleted,false) = false)
         ) order by s.title_ar), '[]'::jsonb) into v_rows
  from public.ai_knowledge_sources s
  where s.source_type = 'operations_procedure'
    and (p_status is null or s.status = p_status);
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

create or replace function public.sop_items_list(p_source uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'sort_order', i.sort_order, 'label_ar', i.label_ar,
           'label_en', i.label_en, 'is_required', i.is_required, 'hint', i.hint
         ) order by i.sort_order), '[]'::jsonb) into v_rows
  from public.sop_items i
  where i.source_id = p_source and coalesce(i.is_deleted,false) = false;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- ملخّص HSE لمهمّة أو لأصل — من العرض المشتقّ لا من جدول.
create or replace function public.hse_register_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.prodops_can_view() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.occurred_at desc nulls last), '[]'::jsonb)
    into v_rows
  from public.hse_register_v h
  where (p_filters->>'source' is null or h.source = p_filters->>'source')
    and (p_filters->>'job_id' is null or h.job_id = (p_filters->>'job_id')::uuid)
    and (p_filters->>'asset_id' is null or h.asset_id = (p_filters->>'asset_id')::uuid);
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- ─── §5 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.sop_attach_to_task(uuid,uuid) from public, anon;
grant execute on function public.sop_attach_to_task(uuid,uuid) to authenticated;
revoke all on function public.sop_list(text) from public, anon;
grant execute on function public.sop_list(text) to authenticated;
revoke all on function public.sop_items_list(uuid) from public, anon;
grant execute on function public.sop_items_list(uuid) to authenticated;
revoke all on function public.hse_register_list(jsonb) from public, anon;
grant execute on function public.hse_register_list(jsonb) to authenticated;

revoke all on public.hse_register_v from anon, public;
grant select on public.hse_register_v to authenticated;

commit;

notify pgrst, 'reload schema';
