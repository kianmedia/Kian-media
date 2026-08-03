-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 5 · V2-5.4-A…C — الموافقة الحكمية (Deemed Approval). **البنية فقط.**
--
-- 🔴🔴 القرار المعتمد (W5-3): default OFF · لكلّ مشروع على حدة · بند عقديّ
--      موقَّع مطلوب · مرجع دليل مطلوب · مهلة مُعدَّة · سجلّ تدقيق ·
--      **لا تفعيل عامّ · لا اعتماد صامت · لا أثر رجعيّ**.
--
-- ★★ لماذا هذا الملفّ لا يعتمد شيئًا ★★
-- الموافقة الحكمية تُحوّل **صمت** العميل إلى **قبول** له أثر تعاقديّ. وهي لا
-- تستند إلى كود بل إلى بند في عقد موقَّع. فالبنية هنا تُسجّل الشروط وتفرضها،
-- ولا تُطلق اعتمادًا: `deemed_approval_evaluate` **تُقيّم وتعيد الأهليّة**،
-- والاعتماد الفعليّ فعل بشريّ لاحق.
--
-- ⛔ ولا إرسال من القاعدة: إثبات الإشعار يُسجَّل من الخارج، ولا يُفترض.
-- ⛔ ولا أثر رجعيّ: لا يُقيَّم تسليم سبق تفعيل البند على مشروعه.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.deliverable_versions') is null then
    raise exception '🔴 deliverable_versions مفقود';
  end if;
end $$;

-- ─── §1 · التفعيل — لكلّ مشروع، وبعقد ─────────────────────────────────────
create table if not exists public.deemed_approval_config (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  -- 🔴 الافتراض OFF. ولا صفّ = لا موافقة حكمية، وهو الوضع الطبيعيّ.
  enabled           boolean not null default false,
  -- 🔴 الأساس التعاقديّ — نصّ البند الحرفيّ ومرجع النسخة الموقّعة. بلا هذين
  --    لا يُفعَّل شيء: عقد بناء لا يُطبَّق على مشروع آخر.
  clause_text       text,
  contract_reference text,
  signed_contract_evidence text,
  -- المهلة مُعدَّة صراحةً لكلّ مشروع — لا قيمة افتراضية عامّة.
  notice_period_days integer check (notice_period_days is null or notice_period_days between 1 and 365),
  enabled_by        uuid references auth.users(id),
  enabled_at        timestamptz,
  -- 🔴 لا أثر رجعيّ: لا يُقيَّم تسليم قبل هذه اللحظة.
  effective_from    timestamptz,
  disabled_by       uuid references auth.users(id),
  disabled_at       timestamptz,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- ★ الشرط الحاكم: التفعيل يوجب البند والمرجع والدليل والمهلة وبداية السريان.
  constraint deemed_requires_contract check (
    enabled = false or (
      length(btrim(coalesce(clause_text,''))) >= 20
      and length(btrim(coalesce(contract_reference,''))) >= 3
      and length(btrim(coalesce(signed_contract_evidence,''))) >= 3
      and notice_period_days is not null
      and effective_from is not null
    ))
);

comment on table public.deemed_approval_config is
  'V2-5.4 — تفعيل لكلّ مشروع. ⛔ لا تفعيل عامّ: لا عمود على مستوى النظام، '
  'والقيد يمنع تفعيلًا بلا بند موقَّع ومهلة وبداية سريان.';

-- ─── §2 · إثبات الإشعار — يُسجَّل ولا يُفترض ───────────────────────────────
--
-- 🔴 **فشل الإشعار يمنع بدء المهلة.** مهلة تبدأ من تسليم لم يصل العميل تُحوّل
--    عطلًا تقنيًّا إلى قبول تعاقديّ.
create table if not exists public.deemed_approval_notices (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.deliverable_versions(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  channel        text not null check (channel in ('email','whatsapp','portal','manual')),
  -- 🔴 `delivered` وحدها تبدأ المهلة. أيّ حالة أخرى تُوقفها.
  outcome        text not null check (outcome in ('delivered','failed','bounced','unknown')),
  delivered_at   timestamptz,
  evidence_ref   text,
  recorded_by    uuid references auth.users(id),
  recorded_at    timestamptz not null default now(),
  constraint deemed_notice_delivered_pair check (
    outcome <> 'delivered' or (delivered_at is not null and length(btrim(coalesce(evidence_ref,''))) >= 3))
);

create index if not exists deemed_notices_version_idx
  on public.deemed_approval_notices (version_id, outcome, delivered_at);

-- ─── §3 · سجلّ التدقيق — في السجلّ القائم لا في سجلّ جديد ──────────────────
-- الـBrief: «القيد التدقيقي غير القابل للتغيير يُكتب في السجل القائم لا في سجل
-- جديد». فلا جدول تدقيق هنا — يُكتب في `activity_log` عبر `log_activity`.

-- ─── §4 · التقييم — يُقيّم ولا يعتمد ───────────────────────────────────────
create or replace function public.deemed_approval_evaluate(p_version uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v record; c record; v_notice record; v_due timestamptz;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select dv.*, d.project_id into v
    from public.deliverable_versions dv
    join public.deliverables d on d.id = dv.deliverable_id
   where dv.id = p_version and coalesce(dv.is_deleted,false) = false;
  if v.id is null then return jsonb_build_object('eligible', false, 'reason', 'version_not_found'); end if;

  select * into c from public.deemed_approval_config where project_id = v.project_id;

  -- ١) مُفعَّل لهذا المشروع تحديدًا؟
  if c.project_id is null or c.enabled = false then
    return jsonb_build_object('eligible', false, 'reason', 'not_enabled_for_project');
  end if;

  -- ٢) 🔴 لا أثر رجعيّ.
  if v.uploaded_at < c.effective_from then
    return jsonb_build_object('eligible', false, 'reason', 'predates_clause_effective_date');
  end if;

  -- ٣) 🔴 المتنازَع عليه لا يُعتمد صمتًا — ولا المعتمَد أصلًا.
  if v.decision = 'revision_requested' then
    return jsonb_build_object('eligible', false, 'reason', 'revision_requested');
  end if;
  if v.decision = 'approved' then
    return jsonb_build_object('eligible', false, 'reason', 'already_approved');
  end if;

  -- ٤) 🔴 إشعار **ناجح** موثَّق. غيابه أو فشله ⇒ المهلة لا تبدأ.
  select * into v_notice from public.deemed_approval_notices
   where version_id = p_version and outcome = 'delivered' and delivered_at is not null
   order by delivered_at asc limit 1;
  if v_notice.id is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_successful_delivery_notice');
  end if;
  if exists (select 1 from public.deemed_approval_notices
              where version_id = p_version and outcome in ('failed','bounced')
                and recorded_at > v_notice.delivered_at) then
    return jsonb_build_object('eligible', false, 'reason', 'later_notification_failure');
  end if;

  -- ٥) المهلة تُحسب من لحظة وصول الإشعار، لا من رفع الإصدار.
  v_due := v_notice.delivered_at + make_interval(days => c.notice_period_days);
  if now() < v_due then
    return jsonb_build_object('eligible', false, 'reason', 'notice_period_not_elapsed',
                              'due_at', v_due);
  end if;

  -- ٦) 🔴 أيّ نشاط أو اعتراض من العميل بعد الإشعار يوقف الاعتماد.
  if to_regclass('public.deliverable_comments') is not null then
    if exists (select 1 from public.deliverable_comments dc
                where dc.version_id = p_version and dc.created_at > v_notice.delivered_at) then
      return jsonb_build_object('eligible', false, 'reason', 'client_activity_after_notice');
    end if;
  end if;

  -- ★ أهليّة فقط. ⛔ لا اعتماد يقع هنا — الفعل قرار بشريّ لاحق يُسجَّل.
  return jsonb_build_object(
    'eligible', true, 'due_at', v_due,
    'notice_delivered_at', v_notice.delivered_at,
    'contract_reference', c.contract_reference,
    'requires_human_action', true);
end $$;

-- ─── §5 · التفعيل والإلغاء ────────────────────────────────────────────────
create or replace function public.deemed_approval_set(p_project uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_enable boolean := coalesce((p_payload->>'enabled')::boolean, false);
begin
  -- 🔴 صلاحية إدارة المشاريع وحدها. ولا تفعيل جماعيّ: مشروع واحد لكلّ نداء.
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project is null then raise exception 'project_required'; end if;

  insert into public.deemed_approval_config as t
    (project_id, enabled, clause_text, contract_reference, signed_contract_evidence,
     notice_period_days, enabled_by, enabled_at, effective_from, note)
  values
    (p_project, v_enable, nullif(btrim(p_payload->>'clause_text'),''),
     nullif(btrim(p_payload->>'contract_reference'),''),
     nullif(btrim(p_payload->>'signed_contract_evidence'),''),
     nullif(p_payload->>'notice_period_days','')::int,
     auth.uid(), case when v_enable then now() end,
     -- 🔴 السريان لا يسبق الآن أبدًا — وهذا ما يمنع الأثر الرجعيّ.
     case when v_enable then greatest(now(), coalesce(nullif(p_payload->>'effective_from','')::timestamptz, now())) end,
     nullif(btrim(p_payload->>'note'),''))
  on conflict (project_id) do update set
    enabled = v_enable,
    clause_text = coalesce(nullif(btrim(excluded.clause_text),''), t.clause_text),
    contract_reference = coalesce(nullif(btrim(excluded.contract_reference),''), t.contract_reference),
    signed_contract_evidence = coalesce(nullif(btrim(excluded.signed_contract_evidence),''), t.signed_contract_evidence),
    notice_period_days = coalesce(excluded.notice_period_days, t.notice_period_days),
    enabled_by  = case when v_enable then auth.uid() else t.enabled_by end,
    enabled_at  = case when v_enable then coalesce(t.enabled_at, now()) else t.enabled_at end,
    effective_from = case when v_enable then coalesce(t.effective_from, now()) else t.effective_from end,
    disabled_by = case when not v_enable then auth.uid() else null end,
    disabled_at = case when not v_enable then now() else null end,
    note = coalesce(nullif(btrim(excluded.note),''), t.note),
    updated_at = now();

  -- سجلّ تدقيق في السجلّ القائم — ⛔ لا سجلّ ثانٍ.
  if to_regproc('public.log_activity(text,text,uuid,jsonb)') is not null then
    perform public.log_activity('deemed_approval_config', 'project', p_project,
                                jsonb_build_object('enabled', v_enable));
  end if;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'enabled', v_enable);
end $$;

-- ─── §6 · RLS والصلاحيات ──────────────────────────────────────────────────
alter table public.deemed_approval_config  enable row level security;
alter table public.deemed_approval_notices enable row level security;

drop policy if exists deemed_cfg_read on public.deemed_approval_config;
create policy deemed_cfg_read on public.deemed_approval_config
  for select to authenticated using (public.can_manage_projects());
drop policy if exists deemed_notice_read on public.deemed_approval_notices;
create policy deemed_notice_read on public.deemed_approval_notices
  for select to authenticated using (public.can_manage_projects());

revoke all on public.deemed_approval_config  from anon, public;
revoke all on public.deemed_approval_notices from anon, public;

revoke all on function public.deemed_approval_evaluate(uuid) from public, anon;
grant execute on function public.deemed_approval_evaluate(uuid) to authenticated;
revoke all on function public.deemed_approval_set(uuid,jsonb) from public, anon;
grant execute on function public.deemed_approval_set(uuid,jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
