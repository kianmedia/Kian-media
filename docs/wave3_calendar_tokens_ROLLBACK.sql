-- WAVE 3 · V2-3.6 · ROLLBACK.
-- §1 يوقف الميزة فورًا بلا فقد بيانات — وهو ما تريده في حادثة.
begin;
-- 🔴 أوّل ما يُسحب: وصول anon. ثانية واحدة تكفي لإغلاق الباب.
-- ⚠️ التوقيع `(text)` **واحد** قبل الإصلاح وبعده: القديم `(p_token_hash text)`
--    والجديد `(p_token text)`. فهذا السطر يُسقط أيًّا منهما — وهو المقصود:
--    التراجع يجب ألّا يترك النسخة القديمة (الثغرة) حيّة بحال.
-- 🔴 ولا يُعتمد على اسم الوسيط في الإسقاط: Postgres يطابق **الأنواع** لا الأسماء.
revoke all on function public.prodops_calendar_feed(text) from anon, authenticated;
drop function if exists public.prodops_calendar_feed(text);
drop function if exists public.prodops_calendar_token_issue(text,text,integer,integer);
drop function if exists public.prodops_calendar_token_revoke(uuid,text);
commit;

-- §2 · إزالة الجدول — 🔴 تُفقد كلّ الرموز المُصدَرة. أزل التعليق عن قصد فقط.
-- begin;
-- drop table if exists public.ops_calendar_tokens;
-- commit;


-- ─── تحقّق ما بعد التراجع — ⛔ لا يبقى أيّ إصدار من دالّة التغذية ────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';
  if v_n > 0 then
    raise exception '🔴 ROLLBACK ناقص: بقي % إصدارًا من prodops_calendar_feed '
      '(قد يكون بتوقيع مختلف). أسقطه يدويًّا قبل المتابعة.', v_n;
  end if;
end $$;
