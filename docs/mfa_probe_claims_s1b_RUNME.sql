-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S1b · تصحيح المِسبار: يُستدعى من جلسة حقيقية، ويُظهر sub و session_id
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ تصحيح خطأ في تعليماتي السابقة ★
--   طلبتُ تشغيل `select public.mfa_claim_probe();` من محرّر SQL في Supabase. **هذا خطأ.**
--   محرّر SQL يعمل بدور `postgres` ولا يحمل Access Token لجلسة البوابة إطلاقًا، فيكون
--   `current_setting('request.jwt.claims')` فارغًا هناك دائمًا. كان المِسبار سيُعيد
--   `aal = null` **لسبب لا علاقة له بالسؤال المطروح**، فأستنتج خطأً أن الادّعاءات لا تصل
--   وأبني S4 على أساس فاسد.
--
--   الاستدعاء الصحيح الوحيد: **PostgREST RPC مُصادَق عليه بـJWT المستخدم الفعلي** —
--   وهو نمط كل استدعاءات البوابة أصلًا (`lib/portal/client.ts` و`rpcAsUser`).
--   الطريق الجاهز: `GET /api/admin/mfa-probe` (محمي للمالك فقط).
--
-- ★ ما يضيفه هذا الملفّ ★
--   `sub` و `session_id` إلى الخرج (طلب المالك)، مع بوّابة `is_owner()`.
--   نفس الصيغة `mfa_claim_probe()` بلا معاملات ⇒ `create or replace` آمن، ولا 42725.
--
-- ★ خصوصية ★
--   يُعيد فقط ادّعاءات **جلسة المتصل نفسه** — لا بيانات مستخدم آخر إطلاقًا.
--   ولا يُعيد الـAccess Token ولا أيّ سرّ. و`sub`/`session_id` معرّفا جلسة المتصل ذاته،
--   وهو يملكهما أصلًا في متصفّحه.
--
-- ★ السلامة ★  إضافي · idempotent · قراءة فقط (`stable`) · لا DROP · لا تغيير بيانات.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.mfa_claim_probe()') is null then
    raise exception 'mfa_claim_probe غير موجودة — شغّل mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;
end $$;

create or replace function public.mfa_claim_probe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_raw text; v_j jsonb;
begin
  -- بوّابة المالك. `coalesce` إلزامي: is_owner() تُبنى على OR وقد تُعيد NULL،
  -- وهو نمط الانهيار الصفري الموثَّق في هذا المستودع.
  if not coalesce(public.is_owner(), false) then raise exception 'not authorized'; end if;

  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j := v_raw::jsonb; exception when others then v_j := null; end;

  return jsonb_build_object(
    -- الأسئلة الأربعة المطلوبة صراحةً:
    'sub',            v_j ->> 'sub',
    'role',           v_j ->> 'role',
    'aal',            v_j ->> 'aal',          -- ★ السؤال الحاسم: aal1 قبل TOTP، aal2 بعده
    'session_id',     v_j ->> 'session_id',
    -- سياق مساعد:
    'claims_present', (v_j is not null),
    'uid_present',    (auth.uid() is not null),
    'uid_matches_sub',(auth.uid()::text is not distinct from (v_j ->> 'sub')),
    'amr_present',    (v_j ? 'amr'),
    'claim_keys',     (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                       from jsonb_object_keys(coalesce(v_j, '{}'::jsonb)) k),
    'checked_at',     now()
  );
exception
  when insufficient_privilege then raise;
  when others then
    -- لا نُسرّب محتوى الادّعاءات في رسالة خطأ.
    if sqlstate = 'P0001' then raise; end if;
    return jsonb_build_object('claims_present', false, 'aal', null, 'probe_error', sqlstate);
end $$;

revoke all    on function public.mfa_claim_probe() from public, anon;
grant  execute on function public.mfa_claim_probe() to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.mfa_claim_probe()', 'execute') then
    raise exception 'فشل أمني: anon يملك EXECUTE على mfa_claim_probe';
  end if;
  raise notice '✓ S1b تمّ. الاستدعاء الصحيح: GET /api/admin/mfa-probe (بحساب المالك، من المتصفّح)';
  raise notice '  ✗ لا تُشغّله من محرّر SQL — الدور هناك postgres بلا JWT جلسة، فالنتيجة بلا معنى';
end $$;

commit;
