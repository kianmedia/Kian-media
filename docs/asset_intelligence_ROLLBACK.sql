-- ════════════════════════════════════════════════════════════════════════════
-- asset_intelligence_ROLLBACK.sql                          🚨 طوارئ فقط 🚨
--
-- ██ اقرأ هذا كاملًا قبل أن تنسخ سطرًا واحدًا ████████████████████████████████
--
-- هذه الحزمة **لم تُنشئ نظامًا جانبيًّا يمكن رميه**. هي وسّعت جداول عهدة حيّة
-- تحمل كاميرات مصروفة الآن باسم موظّفين. لذلك التراجع هنا ليس «إلغاء تثبيت»،
-- بل **حذف بيانات حقيقية** في بعض أقسامه.
--
-- ─── ما يستعيده هذا الملفّ بلا خسارة ───────────────────────────────────────
--   القسم ١: المُشغِّلات والحرّاس   → يعود السلوك إلى ما قبل الحزمة. لا فقدان صفوف.
--   القسم ٢: الدوالّ الجديدة        → تختفي الواجهة. لا فقدان صفوف.
--   القسم ٣: القيود والفهارس        → تُرخى الثوابت. لا فقدان صفوف.
--
-- ─── ما يُتلف بيانات حقيقية ولا يُسترجَع ───────────────────────────────────
--   القسم ٤ (اختياريّ · معطَّل بالتعليق):
--     • drop table custody_inventory_meter_readings
--       ⇒ ✂️ **كلّ قراءات العدّادات تُمحى**: ساعات التشغيل، عدّاد الغالق، دورات
--         البطارية، ساعات الطيران. هذه أرقام لا تُعاد بناؤها من أيّ مصدر آخر في
--         القاعدة — لا custody_inventory_movements ولا الصيانة تحملها. ضياعها
--         يعني أنّ «متى تُصان هذه الكاميرا» يصير تخمينًا إلى الأبد.
--     • drop table custody_inventory_maintenance_plans
--       ⇒ ✂️ كلّ سياسات الصيانة (كلّ ٦ أشهر / كلّ ٥٠٠ ساعة). أخفّ من الأولى لأنّها
--         تُعاد كتابتها يدويًّا، لكنّها تختفي فورًا مع كلّ استحقاق مبنيّ عليها.
--
--   القسم ٥ (اختياريّ · معطَّل بالتعليق · **الأخطر على الإطلاق**):
--     • drop column على custody_inventory_assets
--       ⇒ ✂️ **يمحو تاريخ عهدة حقيقيًّا**: disposal_date/‌_method/‌_reason/
--         _proceeds/‌_approved_by/‌_approved_at هي سجلّ تخريد أصول فعليّة، و
--         stolen_reported_at/stolen_report_ref قد يكون مرجع بلاغ شرطة، و
--         condition_grade هو نتيجة فحص مفتّش. لا نسخة من أيّ منها في مكان آخر.
--       ⇒ ✂️ qr_token: حذفه **يُبطل كلّ ملصق QR مطبوع وملصوق على معدّة**. إعادة
--         التوليد تُنتج رموزًا جديدة، فتصير كلّ الملصقات في المخزن ورقًا ميتًا
--         ويلزم إعادة طباعة الأسطول كلّه. (لهذا القسم ٥ يستثنيه صراحةً.)
--     • drop column على custody_inventory_reservations
--       ⇒ ✂️ fulfilled_by_assignment_id/fulfilled_at: الرابط بين الحجز والصرف
--         الذي نفّذه. بعده لا أحد يعرف أيّ حجز تحوّل إلى عهدة.
--
-- ─── الطريق الصحيح في ٩٩٪ من الحالات ──────────────────────────────────────
-- لا تحذف شيئًا. شغّل القسمين ١ و٢ فقط: تختفي السلوكيات الجديدة وتبقى كلّ صفّ
-- وكلّ عمود. الجداول الجديدة بلا دوالّها لا تضرّ أحدًا — تصير سجلًّا خاملًا.
-- الحذف يكون فقط حين يقرّر المالك صراحةً أنّ هذه البيانات لا قيمة لها.
--
-- ⚠️ قبل أيّ قسم اختياريّ: خُذ نسخة احتياطية وتحقّق منها. لا يوجد «تراجع عن
--    التراجع» في هذا الملفّ.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ١ — المُشغِّلات والحرّاس  (آمن · بلا فقدان صفوف)
--
-- ⚠️ انتبه لما تعنيه إزالة كلّ حارس، فهي ليست محايدة:
--   • trg_civ_guard_assignment_closure  → يعود ممكنًا أن **يعتمد موظّف إغلاق
--                                          عهدته بنفسه**.
--   • trg_civ_guard_assignment_history  → يعود تحريرُ إقرارات عهدة مغلقة بصمت.
--   • trg_civ_guard_evidence_path       → تعود إمكانية تبديل صورة «قبل» تحت
--                                          السجلّ نفسه فتضيع المقارنة.
--   • trg_civ_guard_asset_disposal      → يعود تخريد أصل وهو على عهدة حيّة.
--   • trg_civ_guard_reservation         → يعود الحجز المزدوج (وهو تحديدًا العطل
--                                          الذي وُصف في التدقيق §7).
--   • مُشغِّلات دفتر الاستخدام الثلاثة   → يصير الدفتر **قابلًا للتعديل والحذف**،
--                                          أي يفقد صفته الوحيدة.
-- إزالتها قرار تشغيليّ صريح، لا تنظيف.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop trigger if exists trg_civ_guard_assignment_closure on public.custody_inventory_assignments;
drop trigger if exists trg_civ_guard_assignment_history on public.custody_inventory_assignments;
drop trigger if exists trg_civ_guard_evidence_path      on public.custody_inventory_evidence;
drop trigger if exists trg_civ_guard_asset_disposal     on public.custody_inventory_assets;
drop trigger if exists trg_civ_guard_reservation        on public.custody_inventory_reservations;

do $t$
begin
  if to_regclass('public.custody_condition_reports') is not null then
    execute 'drop trigger if exists trg_civ_sync_condition_grade on public.custody_condition_reports';
  end if;
  if to_regclass('public.custody_inventory_meter_readings') is not null then
    execute 'drop trigger if exists trg_civ_meter_no_update   on public.custody_inventory_meter_readings';
    execute 'drop trigger if exists trg_civ_meter_no_delete   on public.custody_inventory_meter_readings';
    execute 'drop trigger if exists trg_civ_meter_no_truncate on public.custody_inventory_meter_readings';
  end if;
end $t$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٢ — دوالّ الحزمة  (آمن · بلا فقدان صفوف)
--
-- ⚠️ لا يُحذف هنا أيّ شيء لم تُنشئه هذه الحزمة. تحديدًا **لا تُلمَس**:
--   civ_can_manage · civ_can_admin · civ_can_finance · civ_can_delete_asset ·
--   civ_is_employee · civ_set_avail · civ_gen_no · custody_inv_admin_* القائمة ·
--   custody_inv_admin_create_reservation (v1) · custody_inv_resolve_qr ·
--   custody_inv_admin_reissue_qr · custody_inv_admin_close_maintenance.
-- حذف أيّ منها يكسر ~١٢٠ موضع نداء خارج نطاق هذه الحزمة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists public.custody_inv_asset_cost_summary(uuid);
drop function if exists public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz);
drop function if exists public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric);
drop function if exists public.custody_inv_maintenance_signals(uuid);
drop function if exists public.custody_inv_maint_plan_due(uuid);
drop function if exists public.custody_inv_maint_plan_archive(uuid,text);
drop function if exists public.custody_inv_maint_plan_upsert(jsonb);
drop function if exists public.custody_inv_asset_meter_totals(uuid);
drop function if exists public.civ_meter_usage_between(uuid,text,timestamptz,timestamptz);
drop function if exists public.civ_meter_total(uuid,text);
drop function if exists public.custody_inv_reverse_meter(uuid,text);
drop function if exists public.custody_inv_record_meter(jsonb);
drop function if exists public.custody_inv_lookup_asset(text);
drop function if exists public.custody_inv_admin_revoke_qr(uuid,text);
drop function if exists public.custody_inv_qr_scan(uuid,text);
drop function if exists public.custody_inv_qr_public_payload(uuid);
drop function if exists public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid);
drop function if exists public.custody_inv_expire_reservations();
drop function if exists public.custody_inv_fulfil_reservation(uuid,uuid);
drop function if exists public.custody_inv_admin_create_reservation_v2(jsonb);
drop function if exists public.custody_inv_post_closure_correction(uuid,text,jsonb);

drop function if exists public.civ_guard_reservation();
drop function if exists public.civ_guard_asset_disposal();
drop function if exists public.civ_guard_evidence_path();
drop function if exists public.civ_guard_assignment_history();
drop function if exists public.civ_guard_assignment_closure();
drop function if exists public.civ_meter_block_write();
drop function if exists public.civ_sync_condition_grade();
drop function if exists public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid);
drop function if exists public.civ_qr_rate_ok(int);
drop function if exists public.civ_allowed_transitions(text,text);
drop function if exists public.civ_asset_state(uuid);
drop function if exists public.civ_condition_to_grade(text);
drop function if exists public.civ_grade_to_condition(text);
-- بانية النافذة الآمنة. مرتَّبة بعد مستهلكيها ترتيبًا **توثيقيًّا فقط**: PostgreSQL
-- لا يسجّل اعتمادًا على دالّة تُنادى داخل جسم دالّة plpgsql/sql، فالحذف ينجح بأيّ
-- ترتيب ولا يُرفض. لذلك حذفها وحدها دون هذا الملفّ كاملًا يترك المستهلكين يفشلون
-- بـ42883 عند أوّل نداء — لا عند الحذف.
drop function if exists public.civ_window(timestamptz,timestamptz);

-- المُسنَدات الستّة. ⚠️ أيّ شاشة أو سياسة كُتبت فوقها تنكسر فور حذفها.
drop function if exists public.civ_can_view_asset_sensitive_costs();
drop function if exists public.civ_can_manage_maintenance();
drop function if exists public.civ_can_close_custody();
drop function if exists public.civ_can_issue_custody();
drop function if exists public.civ_can_manage_assets();
drop function if exists public.civ_can_view_assets();
drop function if exists public.civ_perm(text);

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٣ — القيود والفهارس المضافة  (آمن · بلا فقدان صفوف · يُرخي الثوابت)
--
-- ⚠️ بعد هذا القسم تعود نافذة الحجز المقلوبة (reserved_to <= reserved_from)
--    ممكنة، وتعود درجة حالة خارج المفردات التسعة ممكنة.
-- ملاحظة: uq_civ_asset_qr_token **لا يُحذف هنا** — الترقيع المؤسّسي 01 يعتمده،
--         وحذفه يسمح برمزين متطابقين على معدّتين مختلفتين.
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.custody_inventory_assets        drop constraint if exists civ_asset_condition_grade_chk;
alter table public.custody_inventory_assets        drop constraint if exists civ_asset_salvage_chk;
alter table public.custody_inventory_assets        drop constraint if exists civ_asset_disposal_method_chk;
alter table public.custody_inventory_reservations  drop constraint if exists civ_resv_window_chk;

drop index if exists public.idx_civ_resv_window;
drop index if exists public.idx_civ_assets_tags;

-- سياسات القراءة على الجدولين الجديدين (تبقى الجداول والصفوف).
do $p$
begin
  if to_regclass('public.custody_inventory_maintenance_plans') is not null then
    execute 'drop policy if exists civ_maint_plans_read on public.custody_inventory_maintenance_plans';
  end if;
  if to_regclass('public.custody_inventory_meter_readings') is not null then
    execute 'drop policy if exists civ_meter_read on public.custody_inventory_meter_readings';
  end if;
end $p$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ القسم ٤ — حذف الجدولين الجديدين   ✂️ فقدان بيانات نهائيّ ✂️
--
-- معطَّل بالتعليق عمدًا. أزل التعليق فقط بعد قرار مالك صريح ونسخة احتياطية
-- **مُتحقَّق منها**. لا مسار عودة بعده.
--
-- ما يُمحى فعلًا:
--   • كلّ ساعة تشغيل وكلّ قراءة عدّاد سُجّلت من الميدان. لا مصدر بديل في القاعدة.
--   • كلّ خطّة صيانة، ومعها كلّ استحقاق وإشارة مبنيّة عليها.
--
-- الأخفّ منه: احتفظ بالجدولين واحذف الدوالّ فقط (القسم ٢). الجدول الخامل
-- لا يضرّ، والبيانات تبقى قابلة للاستخراج لاحقًا.
--
-- خُذ نسخة قبل الحذف (شغّلها وصدّر النتيجة، لا تكتفِ بقراءتها):
--   select * from public.custody_inventory_meter_readings order by recorded_at;
--   select * from public.custody_inventory_maintenance_plans order by created_at;
--
-- drop table if exists public.custody_inventory_meter_readings;
-- drop table if exists public.custody_inventory_maintenance_plans;
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ⛔⛔ القسم ٥ — حذف الأعمدة من جداول العهدة الحيّة   ✂️✂️ الأخطر ✂️✂️
--
-- معطَّل بالتعليق عمدًا، ومن المرجّح ألّا يكون صحيحًا أبدًا.
--
-- هذه الأعمدة على **جداول تحمل عهدًا حيّة**. حذفها ليس تراجعًا عن ميزة، بل محو
-- سجلّ تشغيليّ حقيقيّ:
--   disposal_*        سجلّ تخريد أصول فعليّة، بمن اعتمده ومتى.
--   stolen_report_*   قد يكون مرجع بلاغ رسميّ.
--   condition_grade   نتيجة فحص مفتّش (المصدر custody_condition_reports يبقى،
--                     لكنّ الدرجة المحسوبة على الأصل تختفي فورًا).
--   fulfilled_*       الرابط بين حجز وصرفٍ نفّذه — بعده لا أحد يعرف مصير الحجز.
--
-- 🚫 qr_token/qr_status/label_version مستثناة نهائيًّا من هذا القسم: حذفها يُبطل
--    كلّ ملصق QR مطبوع وملصوق على معدّة في المخزن، ويستلزم إعادة طباعة الأسطول.
--    وهي أصلًا من الترقيع المؤسّسي 01 لا من هذه الحزمة.
--
-- alter table public.custody_inventory_assets drop column if exists condition_grade;
-- alter table public.custody_inventory_assets drop column if exists condition_grade_at;
-- alter table public.custody_inventory_assets drop column if exists salvage_value;
-- alter table public.custody_inventory_assets drop column if exists tags;
-- alter table public.custody_inventory_assets drop column if exists stolen_reported_at;
-- alter table public.custody_inventory_assets drop column if exists stolen_report_ref;
-- alter table public.custody_inventory_assets drop column if exists disposal_date;
-- alter table public.custody_inventory_assets drop column if exists disposal_method;
-- alter table public.custody_inventory_assets drop column if exists disposal_reason;
-- alter table public.custody_inventory_assets drop column if exists disposal_proceeds;
-- alter table public.custody_inventory_assets drop column if exists disposal_approved_by;
-- alter table public.custody_inventory_assets drop column if exists disposal_approved_at;
-- alter table public.custody_inventory_reservations drop column if exists fulfilled_by_assignment_id;
-- alter table public.custody_inventory_reservations drop column if exists fulfilled_at;
-- alter table public.custody_inventory_reservations drop column if exists hold_expires_at;
-- alter table public.custody_inventory_reservations drop column if exists updated_by;
-- alter table public.custody_inventory_categories   drop column if exists code_scheme;
-- ════════════════════════════════════════════════════════════════════════════
