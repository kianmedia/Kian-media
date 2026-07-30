-- ════════════════════════════════════════════════════════════════════════════
-- docs/smart_quoting_ROLLBACK.sql — للطوارئ وحدها.
--
-- ★ ما يفقده كلّ مستوى — مكتوبًا قبل أيّ سطر تنفيذ ★
--
--   المستوى ١ — تعطيل      : لا يفقد شيئًا. يسحب التنفيذ فتتوقّف الواجهة.
--                            البيانات كلّها باقية. **ابدأ من هنا دائمًا.**
--   المستوى ٢ — إزالة المنطق: يفقد الدوالّ والسياسات والمُشغّلات فقط.
--                            الجداول وصفوفها باقية بحرفها.
--   المستوى ٣ — إزالة كاملة : ★ يمحو كلّ شيء محوًا لا رجعة فيه ★
--
-- ما يُمحى فعلًا في المستوى ٣ — بالاسم، لا بعبارة «قد تُفقد بعض البيانات»:
--   · كلّ عرض سعر: مسوّداته ونسخه المعتمدة والمقبولة تاريخيًّا (sq_quotes)
--   · بنود العروض ومدخلات نطاقها ودفعات سدادها
--   · **دفاتر الأسعار وكلّ نسخها المنشورة** — وهذا أخطرها: بضياعها يصير كلّ
--     عرض صدر في الماضي غير قابل للتفسير، لأنّ السعر الذي بُني عليه اختفى.
--     تدقيق ربحية أيّ صفقة سابقة يصبح مستحيلًا، لا صعبًا.
--   · أسعار التكلفة وأجور المورّدين والطاقم (sq_cost_rates)
--   · قواعد التسعير — أي **المعادلة الداخلية للشركة** (sq_pricing_rules)
--   · كلّ حسابات الربحية: التكلفة والأرضية والهامش والربح (sq_quote_internal)
--   · طلبات الاعتماد وقراراتها — أي سجلّ من اعتمد أيّ سعر ومتى
--   · **سجلّ التدقيق كاملًا** (sq_audit) — بما فيه عدّادات التحسّس على
--     الأرضية. لو كان هناك تحقيق جارٍ في تسعير، فإنّ دليله يُمحى هنا.
--
-- ولا شيء من هذا في نسخة احتياطية يصنعها هذا الملفّ: **هو لا يصنع نسخًا.**
-- خُذ نسخة احتياطية بنفسك قبل المستوى ٣، أو لا تُشغّله.
--
-- مفاتيح الصلاحيات quote.* لا تُحذف في أيّ مستوى: هي في الكتالوج المشترك،
-- وحذفها يلمس موديولات أخرى. عطّلها يدويًّا إن أردت.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ١ — تعطيل فوريّ بلا فقد. آمن، وقابل للتراجع بإعادة تشغيل RUNME.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $off$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'sq\_%'
  loop
    begin execute format('revoke all on function %s from authenticated', f.sig);
    exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from anon', f.sig);
    exception when undefined_object then null; end;
  end loop;
  raise notice 'المستوى ١: سُحب التنفيذ. الواجهة ستقول «لا تملك صلاحية». لم تُفقد بيانة واحدة.';
end $off$;

notify pgrst, 'reload schema';
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ٢ — إزالة المنطق مع إبقاء البيانات.
--
-- استعمله حين يكون العطب في دالّة أو سياسة، لا في البيانات. بعده تصير
-- الجداول غير قابلة للقراءة من الواجهة (RLS مفعّل بلا سياسات = منع شامل)،
-- وهو **الوضع الآمن** حتى تُعاد الترحيلة.
--
-- ★ أزِل علامات التعليق لتشغيله. ★
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- do $lvl2$
-- declare r record;
-- begin
--   for r in select schemaname, tablename, policyname from pg_policies
--             where schemaname = 'public' and tablename like 'sq\_%'
--   loop
--     execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
--   end loop;
--
--   for r in select t.tgname, c.relname from pg_trigger t
--             join pg_class c on c.oid = t.tgrelid
--             join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname = 'public' and c.relname like 'sq\_%' and not t.tgisinternal
--   loop
--     execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
--   end loop;
--
--   for r in select p.oid::regprocedure as sig from pg_proc p
--             join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname like 'sq\_%'
--   loop
--     execute format('drop function if exists %s', r.sig);
--   end loop;
--
--   raise notice 'المستوى ٢: أُزيل المنطق. الجداول وصفوفها باقية، وغير مقروءة حتى تُعاد الترحيلة.';
-- end $lvl2$;
--
-- notify pgrst, 'reload schema';
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ المستوى ٣ — إزالة كاملة · محوٌ لا رجعة فيه ★★
--
-- لا تُشغّله لأنّ «الموديول لم يعجبنا». شغّله فقط إن قرّر المالك التخلّي عن
-- التسعير الذكيّ نهائيًّا، **وبعد نسخة احتياطية تحقّقتَ من صحّتها**.
--
-- اقرأ قائمة ما يُمحى في رأس الملفّ مرّة أخرى قبل إزالة التعليق. تحديدًا:
-- ضياع نسخ دفاتر الأسعار يجعل كلّ عرض ماضٍ غير قابل للتفسير إلى الأبد.
--
-- ★ أزِل علامات التعليق لتشغيله — ثلاث مرّات فكّر قبل مرّة واحدة تحذف. ★
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- -- الترتيب يحترم المفاتيح الأجنبية: الأبناء أوّلًا.
-- drop table if exists public.sq_audit               cascade;
-- drop table if exists public.sq_approval_requests   cascade;
-- drop table if exists public.sq_quote_milestones    cascade;
-- drop table if exists public.sq_quote_lines         cascade;
-- drop table if exists public.sq_quote_inputs        cascade;
-- drop table if exists public.sq_quote_internal      cascade;   -- ★ كلّ الربحية
-- drop table if exists public.sq_quotes              cascade;   -- ★ كلّ العروض
-- drop table if exists public.sq_cost_rates          cascade;   -- ★ كلّ التكلفة
-- drop table if exists public.sq_price_book_entries  cascade;
-- drop table if exists public.sq_price_book_versions cascade;   -- ★ تفسير الماضي
-- drop table if exists public.sq_price_books         cascade;
-- drop table if exists public.sq_pricing_rules       cascade;   -- ★ المعادلة
-- drop table if exists public.sq_service_catalog     cascade;
-- drop table if exists public.sq_settings            cascade;
--
-- drop sequence if exists public.sq_quote_code_seq;
-- drop sequence if exists public.sq_price_book_code_seq;
--
-- do $lvl3$
-- declare r record;
-- begin
--   for r in select p.oid::regprocedure as sig from pg_proc p
--             join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname like 'sq\_%'
--   loop
--     execute format('drop function if exists %s cascade', r.sig);
--   end loop;
--   raise notice 'المستوى ٣: أُزيل الموديول بالكامل. ما مُحي لا يُستعاد إلا من نسخة احتياطية.';
-- end $lvl3$;
--
-- notify pgrst, 'reload schema';
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ما لا يفعله هذا الملفّ في أيّ مستوى — عمدًا
--   · لا يحذف مفاتيح quote.* من كتالوج الصلاحيات (مشترك مع موديولات أخرى).
--   · لا يلمس public.projects ولا أيّ جدول من منصّة المشاريع المجمَّدة.
--     مرجع project_id كان اتّجاهًا واحدًا؛ إزالته لا تترك أثرًا هناك.
--   · لا يلمس المركز المالي ولا CRM ولا الاشتراكات (csub_*).
--   · لا يصنع نسخة احتياطية. النسخ مسؤوليّتك، وهذا الملفّ لا يدّعي غير ذلك.
-- ════════════════════════════════════════════════════════════════════════════
