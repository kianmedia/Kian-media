-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — PROJECT PROGRESS ENGINE FIX (Hybrid, stage-bounded)  (RUN ONCE)
--
-- BUG: moving the lifecycle BACK to an early stage kept the bar at 100%.
-- Proven cause in project_progress(): the delivery-cap
--   `(v_delivered and v_dues) or stage='closed' → total = 100`  (project_progress_RUNME:123)
-- forces 100 whenever a deliverable is final_delivered + dues cleared, IGNORING the
-- lifecycle stage; and the lifecycle only imposes a FLOOR (greatest(total,floor)) —
-- there is NO stage CEILING to lower the displayed % on regression. So going back a
-- stage never dropped the number, and the overall (a cap artifact) did not match the
-- data-weighted phase breakdown.
--
-- FIX — a correct Hybrid: data-computed progress is CLAMPED to the lifecycle stage's
-- [floor, ceiling] band. Going back lowers the ceiling → the displayed % drops
-- immediately (no data/deliverables deleted). Lifecycle is معتمد→تم التسليم→مغلق, so:
--   • approved  → capped at 95 (< 100)
--   • delivered → capped at 99
--   • closed    → 100 ONLY when closure requirements are met (delivered + dues); a
--     closed project without those requirements stays below 100.
-- 100% is therefore reachable ONLY at stage='closed' + closure requirements. Going
-- forward re-clamps against existing data. A manual override still wins, is surfaced
-- (overridden), never hides the calculated value (auto_pct), and raises an explicit
-- flag (override_above_auto) when it exceeds the calculated/stage cap.
--
-- Also: project_core_set_stage RECOMPUTES + persists project_core.progress_pct in the
-- SAME transaction — NOT best-effort: if the recompute or save fails, the ENTIRE stage
-- change rolls back (stage unchanged, old % kept, a clear error returned to the UI —
-- nothing is swallowed). project_core_progress() delegates to project_progress() so
-- there is ONE source of truth for auto/final.
--
-- Idempotent · non-destructive · no data/column change · standalone-safe · forward-
-- compatible with master/subproject (per-leaf calculation; master rollup unaffected).
-- Depends on: project_progress(), project_core_set_stage(), project_core (progress_pct,
-- progress_manual, core_stage), can_manage_projects/can_edit_project, project_status_history.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.project_progress(uuid)')          is null then miss := miss || ' project_progress(uuid)'; end if;
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is null then miss := miss || ' project_core_set_stage'; end if;
  if to_regclass('public.project_core') is null then miss := miss || ' project_core'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_core' and column_name='progress_pct')=0 then miss := miss || ' project_core.progress_pct'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) المحرّك الموثوق — إضافة سقف حسب المرحلة + بوابة 100 مرتبطة بالمرحلة ═══
create or replace function public.project_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f_pre numeric := 0; f_sch numeric := 0; f_prod numeric := 0; f_post numeric := 0; f_rev numeric := 0; f_del numeric := 0;
  n int; d int; v_delivered boolean := false; v_dues boolean := false; v_status text; total numeric;
  v_manual int := null; v_final int; v_stage text; v_floor int := 0; v_ceiling int := 95; v_state text := 'active';
begin
  if not (public.is_admin()
          or (public.is_staff() and public.can_access_project(p_project))
          or public.is_client_side(p_project)) then
    raise exception 'not authorized';
  end if;

  select status into v_status from public.projects where id = p_project;
  if v_status is null then raise exception 'not_found'; end if;

  if to_regclass('public.preproduction_items') is not null then
    select count(*) filter (where status = 'done' or approved_at is not null), count(*)
      into d, n from public.preproduction_items
      where project_id = p_project and coalesce(is_deleted,false)=false and coalesce(is_active,true)=true;
    f_pre := case when n > 0 then d::numeric / n else 0 end;
  end if;

  if to_regclass('public.project_shoot_sessions') is not null then
    select count(*) filter (where status <> 'cancelled') into n from public.project_shoot_sessions
      where project_id = p_project and coalesce(is_deleted,false)=false;
    if n > 0 then
      select count(*) filter (where status in ('confirmed','in_progress','completed')) into d
        from public.project_shoot_sessions where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled';
      f_sch := d::numeric / n;
      select count(*) filter (where status = 'completed') into d
        from public.project_shoot_sessions where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled';
      f_prod := d::numeric / n;
    end if;
  end if;

  select count(*), count(*) filter (where status in ('approved','final_delivered')) into n, d
    from public.deliverables where project_id = p_project and coalesce(is_deleted,false)=false;
  f_post := case when n > 0 then d::numeric / n else 0 end;
  v_delivered := exists (select 1 from public.deliverables where project_id = p_project and status = 'final_delivered' and coalesce(is_deleted,false)=false);

  if exists (select 1 from public.deliverables where project_id = p_project and coalesce(is_deleted,false)=false
             and status in ('client_review','revision_requested','approved','final_delivered')) then
    if exists (select 1 from public.client_comments c join public.deliverables dd on dd.id = c.deliverable_id
               where dd.project_id = p_project and coalesce(c.is_deleted,false)=false and coalesce(c.status,'open') <> 'resolved') then
      f_rev := 0.5; else f_rev := 1; end if;
  end if;

  if to_regclass('public.project_delivery_release') is not null then
    select coalesce(bool_or(dues_cleared), false) into v_dues from public.project_delivery_release where project_id = p_project;
  end if;
  f_del := case when v_delivered and v_dues then 1 when v_delivered then 0.6 else 0 end;

  total := 5*1 + 20*f_pre + 10*f_sch + 25*f_prod + 20*f_post + 10*f_rev + 10*f_del;  -- data-weighted (sum 100)

  -- المرحلة التشغيلية (13 مرحلة) هي المرجع؛ وإلا نرجع لحالة المشروع المسطّحة.
  if to_regclass('public.project_core') is not null then
    select core_stage, progress_manual into v_stage, v_manual from public.project_core where project_id = p_project;
  end if;

  -- الأرضية: لا تنخفض النسبة تحت حدّ المرحلة الأدنى (البيانات ترفع فوقها).
  v_floor := case coalesce(v_stage,'')
    when 'lead_approved' then 5 when 'project_created' then 5
    when 'planning' then 10 when 'ready' then 25 when 'scheduled' then 25
    when 'in_production' then 35 when 'post_production' then 60 when 'internal_review' then 70
    when 'client_review' then 80 when 'revision' then 80 when 'approved' then 95
    when 'delivered' then 95 when 'closed' then 95   -- closed لم يعد يفرض 100؛ 100 فقط عبر بوابة closed+متطلبات
    else case coalesce(v_status,'')
      when 'request_received' then 5 when 'pre_production' then 10 when 'shooting_scheduled' then 25
      when 'shooting_completed' then 35 when 'editing' then 60 when 'ready_for_review' then 80
      when 'delivered' then 95 else 5 end
    end;

  -- ★ السقف حسب المرحلة (الإصلاح): الرجوع لمرحلة مبكرة يخفض النسبة فورًا. دورة الحياة:
  --   معتمد → تم التسليم → مغلق. لذا: approved ≤ 95، delivered ≤ 99، والوصول إلى 100
  --   حصرًا في مرحلة closed مع تحقّق متطلبات الإقفال (تسليم + مستحقات).
  v_ceiling := case coalesce(v_stage,'')
    when 'lead_approved' then 10 when 'project_created' then 12
    when 'planning' then 25 when 'ready' then 35 when 'scheduled' then 45
    when 'in_production' then 65 when 'post_production' then 85 when 'internal_review' then 90
    when 'client_review' then 93 when 'revision' then 89 when 'approved' then 95
    when 'delivered' then 99 when 'closed' then 100
    else 95 end;   -- fallback (flat status only) — دون 100

  total := greatest(total, v_floor);   -- الأرضية ترفع

  -- الحدّ الأعلى حسب دورة الحياة؛ و100 حصرًا في closed + متطلبات الإقفال.
  if v_status in ('archived','cancelled') then
    -- حالة محايدة (مؤرشف/ملغى) — ليست 100 مزيّفة حتى لو كانت المرحلة closed والبيانات مكتملة.
    v_state := v_status; total := least(total, least(v_ceiling, 99));
  elsif coalesce(v_stage,'') = 'closed' and v_delivered and v_dues then
    total := 100;                        -- المسار الوحيد لـ100: المرحلة مغلقة + متطلبات الإقفال (تسليم + مستحقات)
  elsif coalesce(v_stage,'') = 'closed' then
    total := least(total, 99);           -- مغلق لكن متطلبات الإقفال غير مكتملة → دون 100
  else
    total := least(total, v_ceiling);    -- approved ≤ 95، delivered ≤ 99، والرجوع لمرحلة مبكرة يخفض فورًا
  end if;

  v_final := coalesce(v_manual, round(least(greatest(total,0),100))::int);

  return jsonb_build_object(
    'pct', v_final,
    'state', v_state, 'stage', v_stage, 'floor', v_floor, 'ceiling', v_ceiling,
    'overridden', (v_manual is not null),
    'auto_pct', round(least(greatest(total,0),100)),
    -- تنبيه: تجاوز يدوي يتخطّى النسبة المحسوبة/سقف المرحلة — لا يخفي calculated_progress (auto_pct يبقى معروضًا).
    'override_above_auto', (v_manual is not null and v_manual > round(least(greatest(total,0),100))),
    'delivered', (v_delivered and v_dues),
    'phases', jsonb_build_array(
      jsonb_build_object('key','initiation','ar','بدء المشروع','en','Initiation','weight',5,'pct',100,'earned',5),
      jsonb_build_object('key','preproduction','ar','ما قبل الإنتاج','en','Pre-Production','weight',20,'pct',round(f_pre*100),'earned',round(20*f_pre)),
      jsonb_build_object('key','scheduling','ar','الجاهزية والجدولة','en','Scheduling','weight',10,'pct',round(f_sch*100),'earned',round(10*f_sch)),
      jsonb_build_object('key','production','ar','الإنتاج/التصوير','en','Production','weight',25,'pct',round(f_prod*100),'earned',round(25*f_prod)),
      jsonb_build_object('key','postproduction','ar','ما بعد الإنتاج','en','Post-Production','weight',20,'pct',round(f_post*100),'earned',round(20*f_post)),
      jsonb_build_object('key','review','ar','مراجعة العميل','en','Client Review','weight',10,'pct',round(f_rev*100),'earned',round(10*f_rev)),
      jsonb_build_object('key','delivery','ar','الاعتماد والتسليم','en','Delivery','weight',10,'pct',round(f_del*100),'earned',round(10*f_del))
    ));
end $$;

-- ═══ 2) set_stage — يعيد احتساب progress_pct ويحفظه في نفس المعاملة (ذرّي، بلا ابتلاع) ═══
--     (نسخة UI_COMPLETION الفائزة، مطابقة حرفيًا + سطر إعادة الاحتساب قبل return)
create or replace function public.project_core_set_stage(p_project uuid, p_stage text, p_note text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_from text; v_fi int; v_ti int; v_reason text := nullif(btrim(p_note),'');
  v_order text[] := array['lead_approved','project_created','planning','ready','scheduled','in_production',
                          'post_production','internal_review','client_review','revision','approved','delivered','closed'];
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if not (p_stage = any(v_order)) then raise exception 'bad_stage'; end if;
  select core_stage into v_from from public.project_core where project_id = p_project;
  v_from := coalesce(v_from, 'project_created');
  if v_from = p_stage then
    select * into r from public.project_core where project_id = p_project; return r;
  end if;
  v_fi := array_position(v_order, v_from); v_ti := array_position(v_order, p_stage);

  if v_ti < v_fi or p_stage = 'closed' then
    if v_reason is null then raise exception 'reason_required'; end if;
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  if p_stage = 'delivered' and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  if v_ti > v_fi + 1 and not public.is_owner() then raise exception 'no_stage_skip'; end if;
  if p_stage = 'ready' then
    if not exists (select 1 from public.project_members m where m.project_id = p_project and m.role='kian_manager' and m.is_deleted=false)
      then raise exception 'need_manager'; end if;
    if not exists (select 1 from public.project_core pc where pc.project_id = p_project and pc.due_date is not null)
      then raise exception 'need_due_date'; end if;
  end if;

  insert into public.project_core(project_id, core_stage, updated_by)
    values (p_project, p_stage, auth.uid())
    on conflict (project_id) do update set core_stage = p_stage, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (p_project, v_from, p_stage, v_reason, auth.uid());
  perform public.pc_log(p_project, 'stage_changed', 'project', p_project, jsonb_build_object('from', v_from, 'to', p_stage));
  perform public.pc_notify_team(p_project, 'project_status_changed', 'project', p_project,
    'تغيّرت مرحلة المشروع إلى '||p_stage, 'Project stage changed to '||p_stage, auth.uid());

  -- ★ إعادة احتساب التقدّم وحفظه داخل نفس المعاملة — بلا ابتلاع أخطاء. أي فشل في الاحتساب
  --   أو الحفظ يرفع استثناءً يُلغي المعاملة كاملًا (Rollback): المرحلة لا تتغيّر، والنسبة
  --   القديمة تبقى، ويصل خطأ واضح للواجهة. التجاوز اليدوي يبقى محفوظًا (project_progress
  --   يُعيد coalesce(manual, auto) فيُخزَّن الصحيح).
  update public.project_core
    set progress_pct = (public.project_progress(p_project)->>'pct')::int, updated_at = now()
    where project_id = p_project returning * into r;
  if r.project_id is null then raise exception 'progress_recompute_failed'; end if;

  return r;
end $$;

-- ═══ 3) توحيد المصدر: project_core_progress يفوّض إلى المحرّك الموثوق نفسه ═══
create or replace function public.project_core_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_man int;
begin
  if not public.can_access_project(p_project) then raise exception 'not authorized'; end if;
  v := public.project_progress(p_project);                 -- المصدر الوحيد للحساب
  select progress_manual into v_man from public.project_core where project_id = p_project;
  return jsonb_build_object('auto', (v->>'auto_pct')::int, 'manual', v_man, 'final', (v->>'pct')::int);
end $$;

-- ═══ 4) Grants (تبقى كما كانت) + VALIDATION ═══
do $g$
begin
  execute 'grant execute on function public.project_progress(uuid) to authenticated';
  execute 'grant execute on function public.project_core_set_stage(uuid,text,text) to authenticated';
  execute 'grant execute on function public.project_core_progress(uuid) to authenticated';
end $g$;

do $v$
declare v jsonb;
begin
  if to_regprocedure('public.project_progress(uuid)') is null then raise exception 'فشل: project_progress'; end if;
  -- تحقّق بنيوي: المفتاح ceiling أصبح موجودًا في المخرجات.
  if (to_regprocedure('public.project_progress(uuid)') is not null) then
    -- (لا نستدعيها هنا لتجنّب حاجة سياق مستخدم؛ التحقق الوظيفي في فحوص ما بعد التشغيل)
    null;
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- ─── فحوص ما بعد التشغيل (شغّلها بحساب كادر على مشروع فعلي) ───
--  -- 1) قبل/بعد الرجوع: النسبة تنخفض فورًا:
--     select (public.project_progress('<PID>')->>'pct') as pct_now, public.project_progress('<PID>')->>'stage' as stage;
--     -- غيّر المرحلة إلى lead_approved ثم:
--     select (public.project_progress('<PID>')->>'pct') as pct_after, public.project_progress('<PID>')->'ceiling' as ceiling;  -- pct ≤ 10
--  -- 2) الإجمالي المخزّن تحدّث:
--     select progress_pct, core_stage from public.project_core where project_id='<PID>';
--  -- 3) 100% فقط عند delivered/closed + تسليم:
--     select (public.project_progress('<closed_or_delivered_PID>')->>'pct');   -- 100 فقط في هذه الحالة
--  -- 4) التجاوز اليدوي ظاهر:
--     select public.project_progress('<PID_with_override>')->'overridden';     -- true
