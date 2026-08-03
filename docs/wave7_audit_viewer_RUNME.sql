-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 7 · V2-7.3-A — عارض سجلّ التدقيق. **قراءة فقط.**
--
-- ★★ القرار المتحفّظ، وسببه ★★
-- الـBrief يترك السؤال مفتوحًا: «عارض يقرأ الخمسة عشر، أم `activity_log` وحده؟
-- ❌ لا سجل سادس عشر».
--
-- **المختار: `activity_log` وحده، مع سجلّ إحالة للبقيّة.**
--
-- ولماذا لا تُوحَّد الأربعة عشر:
--   • لكلّ منها **شكل مختلف**: `cs_audit` يحمل نسخة، و`fin_audit` يحمل مبلغًا،
--     و`whatsapp_send_audit` يحمل حالة تسليم. توحيدها يفرض شكلًا لا يوجد.
--   • والأخطر أنّ العرض الموحَّد **يبدو كاملًا وهو ليس كذلك**: من يقرأه يظنّ
--     أنّه رأى كلّ ما جرى، بينما التوحيد أسقط ما لم يُطابق الشكل المفروض.
--   • وبعضها يحمل **حقولًا مالية أو شخصية** لها بوّاباتها — وجمعها في عرض واحد
--     يتطلّب إمّا حجب أعمدة (فيصير ناقصًا) أو كشفها (فيصير تسريبًا).
--
-- ⇒ العارض يقرأ السجلّ العابر للوحدات، **ويُسمّي البقيّة صراحةً** مع مكان كلٍّ
--    منها، فيعرف القارئ ما لم يره بدل أن يظنّ أنّه رأى كلّ شيء.
--
-- 🔴 القرار مسجَّل بوصفه معلَّقًا: **W7-1**.
--
-- ⛔ لا سجلّ سادس عشر · لا كتابة · لا تعديل على أيّ سجلّ قائم.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.activity_log') is null then
    raise exception '🔴 activity_log مفقود — وهو السجلّ العابر للوحدات';
  end if;
end $$;

-- ─── §1 · العارض — قراءة `activity_log` وحده ───────────────────────────────
create or replace function public.audit_viewer_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_lim int; v_from timestamptz; v_to timestamptz;
begin
  -- 🔴 سجلّ التدقيق يكشف من فعل ماذا ومتى — للإدارة وحدها.
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_lim  := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  v_from := coalesce(nullif(p_filters->>'from','')::timestamptz, now() - interval '30 days');
  v_to   := coalesce(nullif(p_filters->>'to','')::timestamptz, now());

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'id', a.id, 'actor_id', a.actor_id, 'actor_role', a.actor_role,
             'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
             'created_at', a.created_at,
             -- ⛔ `metadata` **لا يُعاد خامًّا**: قد يحمل أيّ شيء كتبه مستدعٍ
             --    سابق. تُعاد مفاتيحه فقط، فيُعرف ما سُجِّل بلا كشف قيمه.
             'metadata_keys', (select coalesce(jsonb_agg(k), '[]'::jsonb)
                                 from jsonb_object_keys(coalesce(a.metadata,'{}'::jsonb)) k)
           ) as x
      from public.activity_log a
     where a.created_at between v_from and v_to
       and (p_filters->>'action' is null or a.action = p_filters->>'action')
       and (p_filters->>'entity_type' is null or a.entity_type = p_filters->>'entity_type')
       and (p_filters->>'actor_id' is null or a.actor_id = (p_filters->>'actor_id')::uuid)
     order by a.created_at desc
     limit v_lim
  ) s;

  return jsonb_build_object('ok', true, 'rows', v_rows,
                            'from', v_from, 'to', v_to, 'limit', v_lim,
                            -- 🔴 يُعلن صراحةً أنّ هذا ليس كلّ التدقيق.
                            'source', 'activity_log',
                            'is_complete_audit', false);
end $$;

-- ─── §2 · سجلّ الإحالة — ما لم يُقرَأ، ومكانه ──────────────────────────────
--
-- 🔴 هذا هو الفرق بين عارض متحفّظ وعارض كاذب: القارئ يعرف ما لم يره.
create or replace function public.audit_sources_registry()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- يُبنى من الكتالوج فعليًّا — ⛔ لا قائمة مكتوبة يدويًّا تتقادم.
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'in_viewer', (c.relname = 'activity_log'),
           'rows_visible_here', (c.relname = 'activity_log')
         ) order by c.relname), '[]'::jsonb) into v_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (c.relname = 'activity_log' or c.relname like '%audit%');

  return jsonb_build_object(
    'ok', true, 'sources', v_rows,
    'note', 'The viewer reads activity_log only. Module audits keep their own '
            'shapes and gates; unifying them would impose a schema that does not '
            'exist and would look complete while silently dropping rows. (W7-1)');
end $$;

-- ─── §3 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.audit_viewer_list(jsonb) from public, anon;
grant execute on function public.audit_viewer_list(jsonb) to authenticated;
revoke all on function public.audit_sources_registry() from public, anon;
grant execute on function public.audit_sources_registry() to authenticated;

commit;

notify pgrst, 'reload schema';
