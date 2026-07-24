-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 8C — المسار السريع للمشاريع الصغيرة (Small Project Fast Lane)
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط):
--   • لا يوجد أيّ وضع «مبسّط/سريع» في المنصّة (بحث شامل: صفر مطابقات).
--   • الحقول الإلزامية فعليًّا لإنشاء مشروع = الاسم + العميل فقط
--     (project_core_create_project يرفع name_required/client_required ولا شيء غيرهما؛
--     ومعالج الإنشاء يفرض نفس الشرطين في `ready`). كل ما عداها مؤجَّل بأمان.
--   • project_core.project_type نصّ حرّ **بلا CHECK** ⇒ أنواع المشاريع السريعة
--     مفردات واجهة آمنة لا تكسر أيّ قيد.
--   • كل مصادر قائمة الإنجاز موجودة فعلًا: project_tasks · project_shoot_sessions ·
--     deliverables(+status) · deliverable_version_summary · deliverable_final_master_state ·
--     project_closure_readiness · pc_project_closure_status ⇒ القائمة تُشتقّ بالكامل
--     ولا تحتاج أيّ عمود Boolean جديد (وهو ممنوع صراحةً).
--   • 7A بذر ٤ قوالب فقط (video_production/photo_shoot/monthly_retainer/event_coverage)
--     ⇒ ثمانية أنواع سريعة بلا قالب.
--
-- لماذا احتجنا SQL (وليست الدفعة UI-only):
--   ١) تجربة التشغيل للمشروع **المستقل** (simple ضدّ standard) لا يمكن اشتقاقها من
--      أيّ بيانات قائمة — master يُشتقّ program وsubproject يُشتقّ standard، أمّا
--      standalone فتفضيل يجب أن يبقى بين الجلسات (ومسار الترقية simple→standard
--      يفترض حالة محفوظة). عمود واحد nullable هو أقلّ ما يفي.
--   ٢) لوحة المشروع السريع تحتاج مهام+جلسات+مخرجات+مراجعات+جاهزية إغلاق معًا؛
--      جمعها في المتصفّح = عدّة نداءات لكل مشروع (N+1). نداء واحد مشتقّ أنظف وأسرع.
--   ٣) ثمانية قوالب ناقصة تُبذَر بنفس نمط 7A (idempotent عبر template_key).
--
-- قيود ملتزَم بها: إضافات فقط · لا تغيير project_scope · لا core_stage جديد · لا
-- كتابة progress · لا نظام مهام/إغلاق/Checklist موازٍ · لا أعمدة حالة Boolean ·
-- لا إعادة تعريف بوّابات الوصول · لا مالية · لا Zoho · لا عهدة · لا حذف بيانات.
--
-- ترتيب التشغيل: … → 6A → 6B → 6C → 7A → 7B → 8A → 8B → 8C.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '8C PREFLIGHT: pc_can_read_project مفقودة (Project Core غير مطبّق)'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then raise exception '8C PREFLIGHT: مسار الإنشاء الرسميّ مفقود'; end if;
  -- public.project_templates أنشأه Project Core V1 لا 7A، فوجوده وحده لا يثبت شيئًا.
  -- ما يعتمد عليه §4 فعلًا هو أعمدة 7A والفهرس الجزئيّ على template_key.
  if to_regclass('public.project_templates') is null
    then raise exception '8C PREFLIGHT: جدول القوالب مفقود (Project Core غير مطبّق)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='project_templates'
                   and column_name in ('template_key','is_seed','category')
                 group by table_name having count(distinct column_name) = 3)
    then raise exception '8C PREFLIGHT: نظام القوالب 7A غير مطبّق (template_key/is_seed/category مفقودة)'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='project_templates'
                   and indexdef ilike '%template_key%' and indexdef ilike '%unique%')
    then raise exception '8C PREFLIGHT: الفهرس الفريد على template_key مفقود (ON CONFLICT سيفشل)'; end if;
  if to_regclass('public.project_tasks') is null or to_regclass('public.deliverables') is null
    then raise exception '8C PREFLIGHT: جداول المهام/المخرجات مفقودة'; end if;
  -- project_scope من 6A: تجربة التشغيل تُشتقّ منه
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='project_scope')
    then raise exception '8C PREFLIGHT: هرمية 6A غير مطبّقة (projects.project_scope مفقود)'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الصلاحيات — عمدًا بلا صلاحية جديدة.
--     «مشروع سريع» هو **نفسه** إنشاء مشروع بحقول أقلّ، ويمرّ حرفيًّا بـ
--     project_core_create_project / project_create_from_template اللتين تفرضان
--     can_manage_projects(). صلاحية منفصلة مثل projects.quick_create لن تحرس
--     شيئًا (المسار يفرض القديمة على أيّ حال) فتبقى مدخلًا ميتًا في الكتالوج —
--     وهو بالضبط خطأ 7A (templates.create_project). أمّا تبديل «سريع/قياسي» فهو
--     تفضيل عرض ويُحرَس بـ can_manage_projects()/can_edit_project داخل §2.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- §2) تجربة التشغيل — عمود واحد nullable، وذو معنى للمشروع المستقل فقط.
--     master ⇒ program و subproject ⇒ standard يُشتقّان ولا يُخزَّنان (لا ازدواج).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.projects add column if not exists operating_experience text;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_operating_experience_chk') then
    alter table public.projects add constraint projects_operating_experience_chk
      check (operating_experience is null or operating_experience in ('simple','standard'));
  end if;
end $chk$;

-- المُحلِّل الرسميّ الوحيد للقاعدة (مصدر واحد للمنطق — لا تُكرَّر في الواجهة وحدها).
create or replace function public.project_operating_experience(p_project uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_scope text; v_stored text;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- المحذوف/المؤرشف: pc_can_read_project لا يفحص is_deleted للأدوار الواسعة
  -- (staff_reads_all_projects تختصر قبل قراءة الصفّ)، فنفحصه هنا حتى لا يختلف
  -- المُحلِّل عن اللقطة على الصفوف نفسها.
  select project_scope, operating_experience into v_scope, v_stored
    from public.projects where id = p_project and coalesce(is_deleted,false) = false;
  if v_scope is null then raise exception 'not_found'; end if;
  -- الاشتقاق يسبق التخزين: قيمة محفوظة على master/subproject تُتجاهل لا تُناقض النطاق.
  if v_scope = 'master' then return 'program'; end if;
  if v_scope = 'subproject' then return 'standard'; end if;
  return coalesce(v_stored, 'standard');
end $$;
revoke execute on function public.project_operating_experience(uuid) from public, anon;
grant execute on function public.project_operating_experience(uuid) to authenticated;

-- تبديل التجربة — للمستقل فقط (البقية مشتقّة)، ولا يمسّ أيّ بيانات مشروع.
create or replace function public.project_set_operating_experience(p_project uuid, p_value text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_scope text; v_old text; v_del boolean;
begin
  if p_value is null or p_value not in ('simple','standard') then raise exception 'bad_experience'; end if;
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not (coalesce(public.can_manage_projects(),false) or coalesce(public.can_edit_project(p_project),false))
    then raise exception 'not authorized'; end if;

  select project_scope, operating_experience, coalesce(is_deleted,false) into v_scope, v_old, v_del
    from public.projects where id = p_project for update;
  if v_scope is null then raise exception 'not_found'; end if;
  if v_del then raise exception 'project_is_deleted'; end if;   -- نفس عرف 6A/6B
  -- master/subproject تجربتهما مشتقّة من النطاق: التخزين هنا يخلق مصدر حالة ثانيًا.
  if v_scope <> 'standalone' then raise exception 'experience_is_derived'; end if;

  update public.projects set operating_experience = p_value where id = p_project;
  perform public.pc_log(p_project, 'operating_experience_changed', 'project', p_project,
    jsonb_build_object('from', v_old, 'to', p_value, 'reason', nullif(btrim(p_reason),'')));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'operating_experience', p_value);
end $$;
revoke execute on function public.project_set_operating_experience(uuid,text,text) from public, anon;
grant execute on function public.project_set_operating_experience(uuid,text,text) to authenticated;

-- ترقية standalone→master (6A) تُبطل تفضيل التجربة: البرنامج يُشتقّ، فلا نُبقي قيمة
-- ميتة تعود للظهور لو خُفِّض المشروع لاحقًا.
create or replace function public.fastlane_scope_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_scope is distinct from old.project_scope and new.project_scope <> 'standalone' then
    new.operating_experience := null;
  end if;
  return new;
end $$;
revoke execute on function public.fastlane_scope_cleanup() from public, anon, authenticated;
drop trigger if exists trg_fastlane_scope_cleanup on public.projects;
create trigger trg_fastlane_scope_cleanup before update of project_scope on public.projects
  for each row execute function public.fastlane_scope_cleanup();

-- ════════════════════════════════════════════════════════════════════════════
-- §3) لقطة المشروع السريع — نداء واحد، مشتقّة بالكامل من المصادر الرسمية.
--     لا تُخزَّن قائمة إنجاز ولا next_action، ولا عمود Boolean واحد.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_quick_snapshot(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_name text; v_client text; v_scope text; v_exp text;
  v_stage text; v_health text; v_start date; v_due date; v_mgr text;
  v_tasks_open int := 0; v_tasks_late int := 0; v_tasks_total int := 0;
  v_shoot jsonb; v_shoots_total int := 0; v_shoot_done int := 0;
  v_dlv jsonb; v_dlv_total int := 0; v_versions int := 0;
  v_st_preview boolean := false; v_st_client boolean := false; v_st_approved boolean := false;
  v_has_final boolean := null; v_delivered boolean := false; v_type text;
  v_final_ok int := null; v_final_all int := null; v_sent_client boolean := null; v_no_shoot boolean := false;
  v_ready boolean := null; v_ready_pct numeric; v_closure text;
  v_next text; v_checks jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;

  select p.project_name, p.project_scope,
         (select nullif(btrim(coalesce(cl.full_name, cl.company)),'') from public.clients cl where cl.id = p.client_id),
         pc.core_stage, pc.health, pc.start_date, pc.due_date, pc.project_type
    into v_name, v_scope, v_client, v_stage, v_health, v_start, v_due, v_type
  from public.projects p join public.project_core pc on pc.project_id = p.id
  where p.id = p_project and coalesce(p.is_deleted,false) = false;
  if v_name is null then raise exception 'not_found'; end if;
  v_exp := public.project_operating_experience(p_project);

  select coalesce(pr.full_name, pr.email) into v_mgr
    from public.project_members m join public.profiles pr on pr.id = m.user_id
   where m.project_id = p_project and m.role = 'kian_manager' and coalesce(m.is_deleted,false)=false
   order by m.created_at limit 1;

  -- المهام (المصدر الرسميّ الوحيد)
  begin
    select count(*),
           count(*) filter (where t.status not in ('done','cancelled')),
           count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today)
      into v_tasks_total, v_tasks_open, v_tasks_late
    from public.project_tasks t where t.project_id = p_project and coalesce(t.is_deleted,false)=false;
  exception when undefined_table or undefined_column then null; end;

  -- جلسات التصوير
  begin
    select count(*), count(*) filter (where s.status = 'completed')
      into v_shoots_total, v_shoot_done
    from public.project_shoot_sessions s
    where s.project_id = p_project and coalesce(s.is_deleted,false)=false and s.status <> 'cancelled';
    select jsonb_build_object('id', s.id, 'title', s.title, 'session_date', s.session_date, 'status', s.status)
      into v_shoot
    from public.project_shoot_sessions s
    where s.project_id = p_project and coalesce(s.is_deleted,false)=false and s.status not in ('cancelled','completed')
      and s.session_date is not null
    order by s.session_date limit 1;
  exception when undefined_table or undefined_column then null; end;

  -- المخرجات وحالاتها (deliverables.status هو مصدر حالة المراجعة — لا Boolean موازٍ)
  begin
    select count(*),
           bool_or(d.status in ('client_review','revision_requested','approved','final_delivered')),
           bool_or(d.status in ('client_review','revision_requested')),
           bool_or(d.status in ('approved','final_delivered')),
           bool_or(d.status = 'final_delivered')
      into v_dlv_total, v_st_preview, v_st_client, v_st_approved, v_delivered
    from public.deliverables d where d.project_id = p_project and coalesce(d.is_deleted,false) = false;
    select jsonb_build_object('id', d.id, 'title', d.title, 'status', d.status, 'type', d.type)
      into v_dlv
    from public.deliverables d where d.project_id = p_project and coalesce(d.is_deleted,false) = false
    order by case d.status when 'final_delivered' then 5 when 'approved' then 4
                           when 'client_review' then 3 when 'revision_requested' then 2
                           when 'internal_review' then 1 else 0 end desc, d.created_at desc
    limit 1;
  exception when undefined_table or undefined_column then null; end;

  -- نسخ المعاينة المرفوعة — «رُفعت ملفات» فعلًا لا «أُنشئ مخرَج».
  -- تنبيه حقيقيّ: t_deliverable_autoversion (AFTER INSERT ON deliverables) يُنشئ V1
  -- تلقائيًّا لكل مخرَج، فعدّ الصفوف وحده يجعل البند مطابقًا لـdeliverable_created
  -- ويصير «تم» بعد ثوانٍ من الإنشاء بلا ملفّ واحد. لذلك نشترط مرجع أصل حقيقيًّا.
  -- والمساران حيّان معًا: deliverable_versions (مسار تسليم العميل) و
  -- project_deliverable_versions (وحدة Project Core). «غير متاح» فقط بغياب الاثنين.
  declare v_v1 int := null; v_v2 int := null;
  begin
    begin
      select count(*) into v_v1
      from public.deliverable_versions v
        join public.deliverables d on d.id = v.deliverable_id
      where d.project_id = p_project and coalesce(d.is_deleted,false) = false
        and coalesce(v.is_deleted,false) = false
        and (nullif(btrim(coalesce(v.preview_url,'')),'') is not null
          or nullif(btrim(coalesce(v.vimeo_video_id,'')),'') is not null
          or nullif(btrim(coalesce(v.vimeo_review_url,'')),'') is not null);
    exception when undefined_table or undefined_column then v_v1 := null; end;
    begin
      select count(*) into v_v2
      from public.project_deliverable_versions v
        join public.deliverables d on d.id = v.deliverable_id
      where d.project_id = p_project and coalesce(d.is_deleted,false) = false
        and (nullif(btrim(coalesce(v.preview_url,'')),'') is not null
          or nullif(btrim(coalesce(v.file_path,'')),'') is not null);
    exception when undefined_table or undefined_column then
      begin
        select count(*) into v_v2
        from public.project_deliverable_versions v
          join public.deliverables d on d.id = v.deliverable_id
        where d.project_id = p_project and coalesce(d.is_deleted,false) = false
          and nullif(btrim(coalesce(v.preview_url,'')),'') is not null;
      exception when undefined_table or undefined_column then v_v2 := null; end;
    end;
    v_versions := case when v_v1 is null and v_v2 is null then null
                       else coalesce(v_v1,0) + coalesce(v_v2,0) end;
  end;

  -- «أُرسلت المعاينة للعميل» — سجلّ إظهار حقيقيّ (pc_deliverable_review action='send_client'
  -- يضبط client_visible، و'unshare' يرفعه) لا مجرّد حالة لحظية للمخرَج تعود إلى
  -- internal_review مع كل نسخة جديدة.
  begin
    select exists (
      select 1 from public.project_deliverable_versions v
        join public.deliverables d on d.id = v.deliverable_id
      where d.project_id = p_project and coalesce(d.is_deleted,false) = false and v.client_visible = true)
      into v_sent_client;
  exception when undefined_table or undefined_column then v_sent_client := null; end;

  -- النسخة النهائية — على **كل** المخرجات لا على المخرَج الأعلى ترتيبًا فقط، ومن
  -- المسارين معًا. مسار العميل: deliverable_versions.is_final مع final_master_status
  -- = 'present' (وهو معنى `safe`؛ أمّا has_final فيصدق حتى على نسخة نهائية بملفّ
  -- مفقود/غير آمن). ومسار Project Core: project_deliverable_versions.is_final الذي
  -- يضبطه pc_deliverable_review action='final' ولا تراه دالة المسار الأوّل إطلاقًا.
  -- null = المصدران غير متاحين، لا «ناقص».
  if v_dlv_total > 0 then
    begin
      select count(*) filter (where fin), count(*) into v_final_ok, v_final_all from (
        select (
          exists (select 1 from public.deliverable_versions dv
                   where dv.deliverable_id = d.id and dv.is_final = true
                     and coalesce(dv.is_deleted,false) = false
                     and coalesce(dv.final_master_status,'none') = 'present')
          or exists (select 1 from public.project_deliverable_versions pv
                      where pv.deliverable_id = d.id and pv.is_final = true)) as fin
        from public.deliverables d
        where d.project_id = p_project and coalesce(d.is_deleted,false) = false) x;
    exception when undefined_table or undefined_column then
      begin
        select count(*) filter (where fin), count(*) into v_final_ok, v_final_all from (
          select exists (select 1 from public.project_deliverable_versions pv
                          where pv.deliverable_id = d.id and pv.is_final = true) as fin
          from public.deliverables d
          where d.project_id = p_project and coalesce(d.is_deleted,false) = false) x;
      exception when undefined_table or undefined_column then v_final_ok := null; v_final_all := null; end;
    end;
    v_has_final := case when v_final_all is null or v_final_all = 0 then null
                        else v_final_ok = v_final_all end;
  end if;

  -- جاهزية الإغلاق (5C) وحالة الإغلاق
  if to_regprocedure('public.project_closure_readiness(uuid)') is not null then
    begin
      select (r->>'ready')::boolean, (r->>'readiness_percent')::numeric
        into v_ready, v_ready_pct from public.project_closure_readiness(p_project) r;
    exception when others then v_ready := null; v_ready_pct := null; end;
  end if;
  if to_regprocedure('public.pc_project_closure_status(uuid)') is not null then
    begin v_closure := public.pc_project_closure_status(p_project); exception when others then v_closure := null; end;
  end if;

  -- ─── قائمة الإنجاز: كل بند مشتقّ من مصدره، وnull = «غير متاح» لا «ناقص» ───
  -- «مونتاج فقط» نوع رسميّ في المسار السريع بلا تصوير إطلاقًا، فبنداه «غير متاح»
  -- لا «لم يتم» — وإلّا استحال بلوغ ١٠٠٪ على مشروع مكتمل تمامًا.
  v_no_shoot := (coalesce(v_type,'') = 'editing_only') and v_shoots_total = 0;
  v_checks := jsonb_build_array(
    jsonb_build_object('code','prepared','ar','تم تجهيز المشروع','done', (v_tasks_total > 0 or v_dlv_total > 0),'source','project_tasks/deliverables'),
    jsonb_build_object('code','shoot_scheduled','ar','تم تحديد جلسة التصوير','done', case when v_no_shoot then null else (v_shoots_total > 0) end,'source','project_shoot_sessions'),
    jsonb_build_object('code','shoot_done','ar','تم تنفيذ التصوير','done', case when v_no_shoot or v_shoots_total = 0 then null else (v_shoot_done > 0) end,'source','project_shoot_sessions.status'),
    jsonb_build_object('code','deliverable_created','ar','تم إنشاء المخرج','done', (v_dlv_total > 0),'source','deliverables'),
    jsonb_build_object('code','files_uploaded','ar','تم رفع الملفات','done', case when v_versions is null then null else (v_versions > 0) end,'source','deliverable_versions+project_deliverable_versions (بمرجع أصل)'),
    jsonb_build_object('code','preview_sent','ar','تم إرسال المعاينة للعميل','done', case when v_sent_client is null then coalesce(v_st_client,false) else (v_sent_client or coalesce(v_st_client,false)) end,'source','project_deliverable_versions.client_visible'),
    jsonb_build_object('code','deliverable_approved','ar','تم اعتماد المخرج','done', coalesce(v_st_approved,false),'source','deliverables.status (اعتماد رسميّ من الإدارة)'),
    jsonb_build_object('code','final_master','ar','تم رفع النسخة النهائية لكل المخرجات','done', v_has_final,'source','deliverable_versions.final_master_status/project_deliverable_versions.is_final'),
    jsonb_build_object('code','delivered','ar','تم التسليم','done', (coalesce(v_delivered,false) or v_stage in ('delivered','closed')),'source','deliverables.status/core_stage'),
    jsonb_build_object('code','ready_to_close','ar','جاهز للإغلاق','done', v_ready,'source','project_closure_readiness'));

  -- ─── الإجراء التالي: مشتقّ بترتيب معلن (أوّل مطابقة تفوز) — لا يُخزَّن ───
  -- قواعد الترتيب المصحَّحة: (أ) التصوير لا يعلو على التسليم/الإغلاق — جلسة قديمة
  -- لم يُغلقها أحد كانت تُثبّت «افتح جلسة التصوير» إلى الأبد. (ب) لا يُطلب رفع نسخة
  -- نهائية لمخرَج سُلِّم فعلًا. (ج) الإغلاق يشترط core_stage='delivered' لأن
  -- project_closure_request_create يرفع stage_not_delivered دونه، فنطلب أوّلًا نقل
  -- المرحلة. (د) كل حالات الإغلاق التالية لها إجراء «تابع الإغلاق» لا «لا إجراء».
  v_next := case
    when v_stage = 'closed' then 'none'
    when v_tasks_total = 0 and v_dlv_total = 0 then 'add_task'
    when not coalesce(v_delivered,false) and v_stage <> 'delivered' and v_shoot is not null then 'open_shoot'
    when not coalesce(v_delivered,false) and v_stage <> 'delivered'
         and v_shoots_total > 0 and v_shoot_done = 0 then 'open_shoot'
    when v_dlv_total = 0 then 'add_deliverable'
    when coalesce(v_st_client,false) then 'open_client_review'
    when v_dlv is not null and (v_dlv->>'status') = 'internal_review' then 'open_review'
    when coalesce(v_st_approved,false) and not coalesce(v_delivered,false)
         and v_has_final is not distinct from false then 'upload_final'
    when coalesce(v_delivered,false) and v_stage <> 'delivered' then 'record_delivery'
    when v_stage = 'delivered' and coalesce(v_closure,'closure_not_started') = 'closure_not_started' then 'start_closure'
    when v_stage = 'delivered' and v_closure in ('closure_in_progress','awaiting_internal_approval',
         'closure_blocked','closure_approved','reopened') then 'continue_closure'
    when v_tasks_open > 0 then 'open_tasks'
    else 'none' end;

  return jsonb_build_object(
    'project_id', p_project, 'project_name', v_name, 'client_name', v_client,
    'project_scope', v_scope, 'operating_experience', v_exp,
    'core_stage', v_stage, 'health', v_health,
    'start_date', v_start, 'due_date', v_due, 'manager_name', v_mgr,
    'tasks', jsonb_build_object('total', v_tasks_total, 'open', v_tasks_open, 'overdue', v_tasks_late),
    'next_shoot', v_shoot, 'shoots_total', v_shoots_total, 'shoots_completed', v_shoot_done,
    'current_deliverable', v_dlv, 'deliverables_total', v_dlv_total,
    'preview_versions', case when v_versions is null then to_jsonb('unavailable'::text) else to_jsonb(v_versions) end,
    'has_final_master', v_has_final,
    'deliverables_with_final', v_final_ok, 'project_type', v_type,
    'closure', jsonb_build_object('status', v_closure, 'ready', v_ready, 'readiness_percent', v_ready_pct),
    'checklist', v_checks,
    'next_action', v_next,
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_quick_snapshot(uuid) from public, anon;
grant execute on function public.project_quick_snapshot(uuid) to authenticated;

comment on function public.project_operating_experience(uuid) is '8C: المُحلِّل الرسميّ لتجربة التشغيل — master⇒program، subproject⇒standard، standalone⇒المخزَّن أو standard.';
comment on function public.project_quick_snapshot(uuid) is '8C: لقطة المشروع السريع — قائمة الإنجاز والإجراء التالي مشتقّان بالكامل (لا تخزين ولا Boolean).';

-- ════════════════════════════════════════════════════════════════════════════
-- §4) بذور القوالب السريعة الناقصة (7A بذر ٤ فقط) — Idempotent عبر template_key.
--     تنبيه 7A: الفهرس على template_key **جزئيّ**، فيجب تكرار شرطه في ON CONFLICT
--     وإلّا رفع PostgreSQL 42P10 وأجهض الترحيل كلّه.
--     وتنبيه 7A الآخر: deliverables.type مقيَّد بـ('video','photo','other') فقط.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.project_templates (template_key, name, description, category, service_type, default_duration_days, is_seed, is_active, spec) values
  ('seed_drone_shoot','تصوير درون','تصوير جوّي لموقع أو أرض مع تصريح وتسليم سريع','production','drone',7,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','تحديد الموقع ومتطلبات العميل','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','استخراج تصريح التصوير الجوّي','priority','urgent','offset_days',0,'due_offset_days',3),
       jsonb_build_object('title','فحص الطقس وتجهيز الدرون','priority','normal','offset_days',3,'due_offset_days',4),
       jsonb_build_object('title','يوم التصوير الجوّي','priority','high','offset_days',4,'due_offset_days',5),
       jsonb_build_object('title','المونتاج وتصحيح الألوان','priority','normal','offset_days',5,'due_offset_days',6),
       jsonb_build_object('title','التسليم','priority','high','offset_days',6,'due_offset_days',7)),
     'milestones', jsonb_build_array(jsonb_build_object('title','اعتماد التصريح','offset_days',3)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','الفيديو الجوّي النهائي','type','video','offset_days',7)),
     'risks', jsonb_build_array(jsonb_build_object('title','رفض أو تأخّر التصريح','severity','high','likelihood','possible'),
                                jsonb_build_object('title','رياح أو طقس غير مناسب','severity','medium','likelihood','likely')))),
  ('seed_real_estate_shoot','تصوير عقاري','تصوير عقار داخلي وخارجي مع معالجة','production','photo',6,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','تنسيق موعد الزيارة مع العميل','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','تجهيز العقار للتصوير','priority','normal','offset_days',1,'due_offset_days',2),
       jsonb_build_object('title','التصوير الداخلي والخارجي','priority','high','offset_days',2,'due_offset_days',3),
       jsonb_build_object('title','المعالجة والتحسين','priority','normal','offset_days',3,'due_offset_days',5),
       jsonb_build_object('title','التسليم','priority','high','offset_days',5,'due_offset_days',6)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','صور العقار المعالَجة','type','photo','offset_days',6)),
     'risks', jsonb_build_array(jsonb_build_object('title','تعذّر الوصول للعقار في الموعد','severity','medium','likelihood','possible')))),
  ('seed_product_photography','تصوير منتجات','جلسة تصوير منتجات في الاستوديو مع معالجة','production','photo',8,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','استلام المنتجات وحصرها','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','تجهيز الإضاءة والخلفيات','priority','normal','offset_days',1,'due_offset_days',2),
       jsonb_build_object('title','التصوير','priority','high','offset_days',2,'due_offset_days',4),
       jsonb_build_object('title','الفرز والمعالجة','priority','normal','offset_days',4,'due_offset_days',7),
       jsonb_build_object('title','التسليم وإرجاع المنتجات','priority','high','offset_days',7,'due_offset_days',8)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','صور المنتجات المعالَجة','type','photo','offset_days',8)))),
  ('seed_corporate_video','فيلم تعريفي','فيلم تعريفي قصير لشركة أو خدمة','production','video',20,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','اجتماع فهم النشاط والرسالة','priority','high','offset_days',0,'due_offset_days',2),
       jsonb_build_object('title','كتابة السيناريو','priority','high','offset_days',2,'due_offset_days',6),
       jsonb_build_object('title','اعتماد العميل للسيناريو','priority','urgent','offset_days',6,'due_offset_days',8),
       jsonb_build_object('title','التصوير','priority','high','offset_days',9,'due_offset_days',12),
       jsonb_build_object('title','المونتاج','priority','normal','offset_days',12,'due_offset_days',17),
       jsonb_build_object('title','المراجعة والتعديلات','priority','normal','offset_days',17,'due_offset_days',19),
       jsonb_build_object('title','التسليم','priority','high','offset_days',19,'due_offset_days',20)),
     'milestones', jsonb_build_array(jsonb_build_object('title','اعتماد السيناريو','offset_days',8)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','الفيلم التعريفي','type','video','offset_days',20)))),
  ('seed_live_stream','بث مباشر','تجهيز وتشغيل بث مباشر لفعالية','production','event',5,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','معاينة الموقع والإنترنت','priority','urgent','offset_days',0,'due_offset_days',2),
       jsonb_build_object('title','تجهيز معدّات البث والاختبار','priority','high','offset_days',2,'due_offset_days',3),
       jsonb_build_object('title','بروفة البث','priority','high','offset_days',3,'due_offset_days',4),
       jsonb_build_object('title','يوم البث المباشر','priority','urgent','offset_days',4,'due_offset_days',4),
       jsonb_build_object('title','تسليم التسجيل','priority','normal','offset_days',4,'due_offset_days',5)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','تسجيل البث','type','video','offset_days',5)),
     'risks', jsonb_build_array(jsonb_build_object('title','انقطاع الإنترنت أثناء البث','severity','critical','likelihood','possible'),
                                jsonb_build_object('title','عطل في معدّات البث','severity','high','likelihood','rare')))),
  ('seed_studio_session','جلسة استوديو','جلسة تصوير واحدة داخل الاستوديو','production','photo',5,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','حجز الاستوديو وتأكيد الموعد','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','تجهيز الإضاءة','priority','normal','offset_days',1,'due_offset_days',2),
       jsonb_build_object('title','الجلسة','priority','high','offset_days',2,'due_offset_days',2),
       jsonb_build_object('title','الفرز والمعالجة','priority','normal','offset_days',2,'due_offset_days',4),
       jsonb_build_object('title','التسليم','priority','high','offset_days',4,'due_offset_days',5)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','مخرجات الجلسة','type','photo','offset_days',5)))),
  ('seed_podcast_episode','حلقة بودكاست','إنتاج حلقة بودكاست واحدة من الإعداد إلى النشر','production','podcast',9,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','إعداد الحلقة والضيف','priority','high','offset_days',0,'due_offset_days',2),
       jsonb_build_object('title','تجهيز الاستوديو والصوت','priority','normal','offset_days',2,'due_offset_days',3),
       jsonb_build_object('title','التسجيل','priority','high','offset_days',3,'due_offset_days',3),
       jsonb_build_object('title','المونتاج ومعالجة الصوت','priority','normal','offset_days',3,'due_offset_days',6),
       jsonb_build_object('title','المراجعة','priority','normal','offset_days',6,'due_offset_days',7),
       jsonb_build_object('title','النسخة النهائية والتشويقي','priority','high','offset_days',7,'due_offset_days',9)),
     'deliverables', jsonb_build_array(
       jsonb_build_object('title','الحلقة الكاملة','type','video','offset_days',9),
       jsonb_build_object('title','مقطع تشويقي','type','video','offset_days',9)))),
  ('seed_social_video','فيديو سوشيال ميديا','فيديو قصير لمنصّات التواصل','production','social',6,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','الفكرة والنصّ القصير','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','التصوير','priority','high','offset_days',1,'due_offset_days',3),
       jsonb_build_object('title','المونتاج العمودي والأفقي','priority','normal','offset_days',3,'due_offset_days',5),
       jsonb_build_object('title','التسليم','priority','high','offset_days',5,'due_offset_days',6)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','نسخ السوشيال','type','video','offset_days',6)))),
  ('seed_editing_only','مونتاج فقط','مشروع مونتاج لمواد جاهزة — بلا تصوير','post_production','editing',7,true,true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','استلام المواد من العميل','priority','urgent','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','فرز المواد وبناء الخطّ الزمني','priority','normal','offset_days',1,'due_offset_days',3),
       jsonb_build_object('title','المونتاج','priority','high','offset_days',3,'due_offset_days',5),
       jsonb_build_object('title','المراجعة والتعديلات','priority','normal','offset_days',5,'due_offset_days',6),
       jsonb_build_object('title','التسليم','priority','high','offset_days',6,'due_offset_days',7)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','النسخة المونتَجة','type','video','offset_days',7)),
     'risks', jsonb_build_array(jsonb_build_object('title','تأخّر وصول المواد من العميل','severity','high','likelihood','likely'))))
on conflict (template_key) where template_key is not null do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_n int;
begin
  foreach v_def in array array['public.project_operating_experience(uuid)',
      'public.project_set_operating_experience(uuid,text,text)','public.project_quick_snapshot(uuid)'] loop
    if to_regprocedure(v_def) is null then raise exception '8C FAIL: الدالة % مفقودة', v_def; end if;
  end loop;

  -- التجربة مشتقّة للنطاقات غير المستقلّة (لا مصدر حالة ثانٍ)
  v_def := pg_get_functiondef('public.project_operating_experience(uuid)'::regprocedure);
  if position('''program''' in v_def) = 0 or position('''standard''' in v_def) = 0
    then raise exception '8C FAIL: المُحلِّل لا يشتقّ من project_scope'; end if;
  v_def := pg_get_functiondef('public.project_set_operating_experience(uuid,text,text)'::regprocedure);
  if position('experience_is_derived' in v_def) = 0
    then raise exception '8C FAIL: يمكن تخزين تجربة على master/subproject'; end if;

  -- اللقطة قراءة فقط ولا تكتب حالة
  v_def := pg_get_functiondef('public.project_quick_snapshot(uuid)'::regprocedure);
  if v_def ~* 'insert into|update\s+public\.|delete from' then raise exception '8C FAIL: اللقطة تكتب بيانات'; end if;
  if position('next_action' in v_def) = 0 then raise exception '8C FAIL: اللقطة بلا إجراء تالٍ مشتقّ'; end if;
  -- «رُفعت الملفات» لا تساوي «أُنشئ مخرَج»: لا بدّ من اشتراط مرجع أصل حقيقيّ،
  -- وإلّا صدق البند بفعل t_deliverable_autoversion وحده.
  if position('vimeo_review_url' in v_def) = 0 or position('file_path' in v_def) = 0
    then raise exception '8C FAIL: عدّ النسخ بلا اشتراط مرجع أصل ⇒ بند «رُفعت الملفات» بلا معنى'; end if;
  -- النسخة النهائية: المعنى الآمن ('present') والمساران معًا
  if position('final_master_status' in v_def) = 0 or position('project_deliverable_versions pv' in v_def) = 0
    then raise exception '8C FAIL: النسخة النهائية تقرأ مسارًا واحدًا أو تتجاهل حالة الأمان'; end if;
  -- الإغلاق: كل حالاته لها إجراء، والإغلاق يشترط مرحلة delivered
  if position('continue_closure' in v_def) = 0
    then raise exception '8C FAIL: حالات الإغلاق التالية بلا إجراء'; end if;

  -- لا عمود Boolean لحالة مصدرها الرسميّ موجود
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='projects'
               and column_name in ('shoot_done','client_approved','files_uploaded','delivered','preview_sent'))
    then raise exception '8C FAIL: عمود حالة Boolean موازٍ على projects'; end if;

  -- البذور: أنواع المخرجات ضمن CHECK الحقيقي
  select count(*) into v_n from public.project_templates t, jsonb_array_elements(
      case when jsonb_typeof(t.spec->'deliverables')='array' then t.spec->'deliverables' else '[]'::jsonb end) d
   where coalesce(t.is_seed,false) = true and (d->>'type') not in ('video','photo','other');
  if v_n > 0 then raise exception '8C FAIL: % مخرَج في البذور بنوع يخالف CHECK', v_n; end if;

  -- 7A يبذر ٤ و8C يبذر ٩ ⇒ ١٣. عدد أقلّ = بذرة سقطت (كان الحدّ ١٢ فيمرّ رغم نقصان واحدة).
  select count(*) into v_n from public.project_templates
   where coalesce(is_seed,false) = true and template_key is not null;
  if v_n < 13 then raise exception '8C FAIL: بذور القوالب ناقصة (% من ١٣)', v_n; end if;
  -- ولكل مفتاح تطلبه الواجهة بذرة فعلية
  foreach v_def in array array['seed_drone_shoot','seed_real_estate_shoot','seed_product_photography',
      'seed_corporate_video','seed_live_stream','seed_studio_session','seed_podcast_episode',
      'seed_social_video','seed_editing_only','seed_event_coverage'] loop
    if not exists (select 1 from public.project_templates where template_key = v_def)
      then raise exception '8C FAIL: قالب النوع السريع % مفقود', v_def; end if;
  end loop;

  raise notice '8C ✅ نجح الاختبار الذاتي — تجربة التشغيل/اللقطة المشتقّة/القوالب السريعة.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
