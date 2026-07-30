-- ════════════════════════════════════════════════════════════════════════════
-- live_operations_dashboard_ROLLBACK.sql                        🚨 طوارئ فقط 🚨
--
-- ██ اقرأ هذا كاملًا قبل أن تنسخ سطرًا واحدًا ████████████████████████████████
--
-- هذه الحزمة **وحدة قائمة بذاتها**: كلّ جداولها جديدة، ولم تعدّل عمودًا ولا
-- قيدًا ولا سياسة في أيّ وحدة أخرى، ولم تنشئ مفتاحًا أجنبيًّا نحو المشاريع ولا
-- أوامر العمل. لذلك التراجع هنا **لا يمسّ شيئًا خارجها** — وهذه هي الأخبار
-- الجيّدة الوحيدة في هذا الملفّ.
--
-- ─── ما يستعيده هذا الملفّ بلا خسارة صفّ واحد ──────────────────────────────
--   القسم ١: المُشغِّلات  → يختفي حارس الحالة وماسح الأسرار وحارس نسبة التشغيل.
--   القسم ٢: الدوالّ      → تختفي الواجهة كاملًا. الجداول تبقى سجلًّا خاملًا.
--   القسم ٣: المنح        → تُسحَب القراءة. لا أحد يرى شيئًا. لا فقدان صفوف.
--   ⚠️ بعد القسم ١ يزول الحارز الذي يمنع العميل من تغيير الحالة. لكنّ القسم ٣
--      يسحب كلّ منح القراءة والكتابة أصلًا، فلا يبقى لأحد مسار إلى الجدول.
--      **شغّل ١ و٢ و٣ معًا أو لا تشغّل شيئًا** — لا تترك ١ بلا ٣.
--
-- ─── ⚠️ ما يُتلف بيانات حقيقية ولا يُسترجَع (معطَّل بالتعليق) ───────────────
--   القسم ٤:
--     • drop table liveops_incidents
--       ⇒ ✂️ **يُمحى ما حدث فعلًا أثناء بثّ مباشر**: متى انقطع، وما السبب
--         الجذريّ، وماذا فعلنا. عند أيّ نزاع مع عميل حول فعالية متعثّرة، هذا
--         الصفّ هو الرواية الوحيدة الموثَّقة زمنيًّا. لا نسخة منه في مكان آخر.
--     • drop table liveops_link_access_log
--       ⇒ ✂️ يُمحى **من فتح رابط المتابعة ومتى، والمحاولات المرفوضة**. هذا هو
--         الدليل الوحيد على تخمين رموز أو تسريب رابط. حذفه يجعل سؤال «هل
--         تسرّب رابط الفعالية؟» بلا جواب إلى الأبد.
--     • drop table liveops_client_links
--       ⇒ ✂️ يُمحى من أصدر لمن وإلى متى وبأيّ حدّ. أثر تدقيق تجاريّ.
--     • drop table liveops_reports
--       ⇒ ✂️ يُمحى تقرير ما بعد الفعالية المعتمَد — بما فيه تأكيد التسجيل
--         والنسخ الاحتياطيّ. هذا مستند تسليم، لا مسوّدة.
--     • drop table liveops_rundown / liveops_cues / liveops_stream_health
--       ⇒ ✂️ تُمحى الخطّة الزمنية الفعلية وسجلّ الإشارات وقراءات الشبكة: كامل
--         إعادة بناء ما جرى دقيقةً بدقيقة.
--     • drop table liveops_audit
--       ⇒ ✂️ يُمحى من غيّر الحالة ومن اعتمد ملخّصًا للعميل ومن أفرج عن سبب
--         جذريّ. هذا سجلّ مسؤولية، لا سجلّ تشخيص.
--
--   القسم ٥ (معطَّل · الكتالوج):
--     • حذف مفاتيح live_ops.* من public.permissions
--       ⇒ ✂️ يُسقط الإسنادات المبنية عليها في **جداول الصلاحيات المشتركة**،
--         وهي مشتركة مع وحدات أخرى. لا تفعل هذا إلّا بقرار صريح.
--
-- ─── الطريق الصحيح في ٩٩٪ من الحالات ──────────────────────────────────────
-- لا تحذف شيئًا. شغّل الأقسام ١ و٢ و٣ فقط: تختفي الوحدة من الوجود عمليًّا،
-- ويبقى كلّ صفّ وكلّ عمود. جدول بلا دوالّه ولا منحه سجلّ خامل لا يضرّ أحدًا.
-- الحذف يكون فقط حين يقرّر المالك صراحةً وكتابةً أنّ هذه البيانات بلا قيمة.
--
-- ⚠️ قبل أيّ قسم اختياريّ: خُذ نسخة احتياطية **وتحقّق منها بالاستعادة**. لا
--    يوجد «تراجع عن التراجع» في هذا الملفّ.
-- ⚠️ لا يوجد في هذا الملفّ أيّ سطر يمسّ public.projects أو project_core أو
--    deliverables أو ops_jobs أو أيّ جدول من الوحدات الاثنتي عشرة المكتملة.
--    لو رأيت اسم أحدها هنا فالملفّ عُدِّل — توقّف.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ١ — المُشغِّلات (آمن · بلا فقدان صفوف)
-- ════════════════════════════════════════════════════════════════════════════
do $r1$
declare t text;
begin
  if to_regclass('public.liveops_sessions') is not null then
    drop trigger if exists liveops_sessions_guard on public.liveops_sessions;
  end if;
  if to_regclass('public.liveops_reports') is not null then
    drop trigger if exists liveops_reports_uptime on public.liveops_reports;
  end if;
  foreach t in array array['liveops_inventory','liveops_rundown','liveops_incidents','liveops_bulletins'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    end if;
  end loop;
  foreach t in array array['liveops_sessions','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_rundown','liveops_inventory'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_secret_scan', t);
    end if;
  end loop;
end $r1$;

drop function if exists public.liveops_session_guard();
drop function if exists public.liveops_report_uptime_guard();
drop function if exists public.liveops_client_text_guard();
drop function if exists public.liveops_touch();

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٢ — الدوالّ (آمن · بلا فقدان صفوف)
--   تختفي الواجهة كاملًا: لا سرد، لا تعديل، ولا سطح عميل.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.liveops_client_view(text,text);
drop function if exists public.liveops_client_preview(uuid);
drop function if exists public.liveops_client_payload(uuid);
drop function if exists public.liveops_session_upsert(jsonb);
drop function if exists public.liveops_session_set_status(uuid,text,text,text);
drop function if exists public.liveops_session_list(jsonb);
drop function if exists public.liveops_session_detail(uuid);
drop function if exists public.liveops_live_board(uuid);
drop function if exists public.liveops_inventory_upsert(jsonb);
drop function if exists public.liveops_inventory_set_state(uuid,text,text,text);
drop function if exists public.liveops_inventory_delete(uuid,text);
drop function if exists public.liveops_health_record(jsonb);
drop function if exists public.liveops_rundown_upsert(jsonb);
drop function if exists public.liveops_rundown_set_status(uuid,text,timestamptz);
drop function if exists public.liveops_rundown_delete(uuid,text);
drop function if exists public.liveops_cue_log(uuid,text,uuid,text);
drop function if exists public.liveops_incident_open(jsonb);
drop function if exists public.liveops_incident_update(jsonb);
drop function if exists public.liveops_incident_resolve(uuid,text,text);
drop function if exists public.liveops_incident_release_root_cause(uuid,boolean,text);
drop function if exists public.liveops_bulletin_upsert(jsonb);
drop function if exists public.liveops_client_person_upsert(jsonb);
drop function if exists public.liveops_client_person_delete(uuid);
drop function if exists public.liveops_report_upsert(jsonb);
drop function if exists public.liveops_report_approve(uuid,text);
drop function if exists public.liveops_link_create(jsonb);
drop function if exists public.liveops_link_issue(uuid);
drop function if exists public.liveops_link_revoke(uuid,text);
drop function if exists public.liveops_link_list(uuid);
drop function if exists public.liveops_link_audit(uuid);
drop function if exists public.liveops_log(text,text,uuid,uuid,boolean,jsonb);
drop function if exists public.liveops_notify(uuid,text,uuid,text,text);
-- المُسنَدات وأدوات jsonb والماسح — بعد كلّ مستهلكيها.
drop function if exists public.liveops_can_operate_session(uuid);
drop function if exists public.liveops_can_read_session(uuid);
drop function if exists public.liveops_can_issue_client_link();
drop function if exists public.liveops_can_reveal_root_cause();
drop function if exists public.liveops_can_approve_report();
drop function if exists public.liveops_can_view();
drop function if exists public.liveops_can_operate();
drop function if exists public.liveops_can_manage();
drop function if exists public.liveops_is_client();
drop function if exists public.liveops_perm(text);
drop function if exists public.liveops_status_allowed(text,text);
drop function if exists public.liveops_default_client_status(text);
drop function if exists public.liveops_has_secret(text);
drop function if exists public.liveops_secret_reason(text);
drop function if exists public.liveops_txt(jsonb,text);
drop function if exists public.liveops_bool(jsonb,text,boolean);
drop function if exists public.liveops_int(jsonb,text);
drop function if exists public.liveops_num(jsonb,text);
drop function if exists public.liveops_ts(jsonb,text);
drop function if exists public.liveops_uuid(jsonb,text);

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٣ — المنح والسياسات (آمن · بلا فقدان صفوف)
--   يُقفَل كلّ جدول في وجه الجميع (fail-closed). RLS تبقى مفعّلة عن قصد: جدول
--   بلا سياسة وبلا منح لا يُقرأ ولا يُكتب من أيّ دور تطبيقيّ.
-- ════════════════════════════════════════════════════════════════════════════
do $r3$
declare t text;
begin
  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_client_links',
                           'liveops_link_access_log','liveops_audit'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_read', t);
      execute format('revoke all on public.%I from authenticated', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke all on public.%I from public', t);
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $r3$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٤ — 🚨 حذف الجداول 🚨 (معطَّل عمدًا · إتلاف نهائيّ)
--   لا تُفعّله إلّا بعد نسخة احتياطية **مستعادة ومُتحقَّق منها**، وبقرار مكتوب.
--   الترتيب يحترم المفاتيح الأجنبية الداخلية (الأبناء قبل الجذر).
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- drop table if exists public.liveops_link_access_log;
-- drop table if exists public.liveops_client_links;
-- drop table if exists public.liveops_reports;
-- drop table if exists public.liveops_client_people;
-- drop table if exists public.liveops_bulletins;
-- drop table if exists public.liveops_incidents;
-- drop table if exists public.liveops_cues;
-- drop table if exists public.liveops_rundown;
-- drop table if exists public.liveops_stream_health;
-- drop table if exists public.liveops_inventory;
-- drop table if exists public.liveops_audit;
-- drop table if exists public.liveops_sessions;
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٥ — 🚨 حذف مفاتيح الصلاحيات 🚨 (معطَّل عمدًا)
--   public.permissions **مشترك مع وحدات أخرى**. حذف صفّ منه يُسقط إسنادات
--   المهن المبنية عليه عبر ON DELETE CASCADE، وهو أثر يتجاوز هذه الوحدة.
--   الأسلم تركها: مفتاح بلا دالّة تقرأه لا يمنح شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- delete from public.permissions where key in
--   ('live_ops.view','live_ops.operate','live_ops.manage',
--    'live_ops.client_link','live_ops.report_approve');
-- commit;
