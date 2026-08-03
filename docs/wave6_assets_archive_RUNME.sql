-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · الأصول والأرشيف والحقوق — الحزمة الأولى.
--
-- V2-6.1-D · V2-6.2-A/B · V2-6.3-A/B · V2-6.5-A
--
-- ★★ ما لا يُنشأ هنا، ولماذا ★★
--  ⛔ لا نظام أصول ثانٍ — `custody_inventory_assets` يحمل ٣٥+ عمودًا تشمل
--     الشراء والقيمة والتسلسل والإهلاك والضمان والتصرّف. **الفجوة الوحيدة**
--     الحقيقية في V2-6.1-D: `asset_insurance_policies` سجلّ وثائق **بلا رابط
--     إلى أصل** — فلا يُعرف ما الذي تغطّيه وثيقة. فجدول ربط واحد، لا أكثر.
--  ⛔ لا نظام عهدة ثانٍ · لا دفتر استخدام (V2-6.1-B قائم بثلاثة مُشغِّلات) ·
--     لا جدول صيانة (V2-6.1-C قائم بخططه وcron تنبيهاته).
--  ⛔ ولا مسار تخزين ثانٍ: كلّ وسائط هنا تتبع نمط `ops_media` نفسه —
--     `bucket`+`path` ولا رابط مخزَّن، والتوقيع بعد إثبات القاعدة للصلاحية.
--
-- ★ ولماذا `archive_media` **جديد مبرَّر** ★
-- `project_archives` القائم أرشيف **إغلاق مشروع**: لقطة وسياسة احتفاظ وحجز
-- قانونيّ. وهذا سجلّ **وسائط فيزيائية** — قرص وسعة وصحّة ورفّ. المفهومان لا
-- يشتركان في عمود واحد، ودمجهما يُنتج جدولًا بمعنيين.
--
-- ⛔ إضافيّ · idempotent · لا حذف · RLS deny-by-default · لا استبدال مُشغِّل صامت.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.custody_inventory_assets') is null then
    raise exception '🔴 custody_inventory_assets مفقود — نظام الأصول القائم هو الأساس';
  end if;
  if to_regclass('public.asset_insurance_policies') is null then
    raise exception '🔴 asset_insurance_policies مفقود — هذه الحزمة تربطه ولا تستبدله';
  end if;
end $$;

-- ─── §1 · V2-6.1-D · تغطية التأمين — الفجوة الوحيدة في سجلّ الأصول ─────────
--
-- ⛔ لا عمود `insurance_policy_id` على الأصل: الوثيقة الواحدة تغطّي أصولًا
--    كثيرة، والأصل قد تغطّيه وثيقتان في فترتين. العلاقة **متعدّد لمتعدّد**.
create table if not exists public.asset_insurance_coverage (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.custody_inventory_assets(id) on delete cascade,
  policy_id   uuid not null references public.asset_insurance_policies(id) on delete cascade,
  covered_from date,
  covered_to   date,
  covered_value numeric(14,2) check (covered_value is null or covered_value >= 0),
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  constraint aic_window check (covered_to is null or covered_from is null or covered_to >= covered_from),
  unique (asset_id, policy_id, covered_from)
);

create index if not exists aic_asset_idx  on public.asset_insurance_coverage (asset_id) where is_deleted = false;
create index if not exists aic_policy_idx on public.asset_insurance_coverage (policy_id) where is_deleted = false;

comment on table public.asset_insurance_coverage is
  'V2-6.1-D — الفجوة الوحيدة: وثيقة التأمين لم تكن مرتبطة بأصل. ⛔ ليست نظام '
  'تأمين ثانيًا — الوثائق والمطالبات قائمة في asset_insurance_policies/insurance_claims.';

-- ─── §2 · V2-6.2-A/B · سجلّ الوسائط الفيزيائية ─────────────────────────────
create table if not exists public.archive_media (
  id              uuid primary key default gen_random_uuid(),
  label           text not null check (length(btrim(label)) between 2 and 160),
  media_kind      text not null default 'hdd'
                  check (media_kind in ('hdd','ssd','nas','lto','sd','cf','ssd_raid','optical','other')),
  serial_number   text,
  capacity_gb     numeric(12,2) check (capacity_gb is null or capacity_gb > 0),
  used_gb         numeric(12,2) check (used_gb is null or used_gb >= 0),
  -- 🔴 صحّة الوسيط تُدخَل ولا تُستنتَج: لا SMART هنا ولا فحص آليّ.
  health_status   text not null default 'unknown'
                  check (health_status in ('unknown','good','degraded','failing','failed','retired')),
  health_checked_at date,
  -- الموقع الفيزيائيّ نصّ حرّ عمدًا: رفّ وخزانة ودرج لا تُنمذَج بجدول.
  physical_location text,
  custodian_user_id uuid references auth.users(id) on delete set null,
  filesystem      text,
  encrypted       boolean not null default false,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_deleted      boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users(id),
  delete_reason   text,
  -- المستخدَم لا يتجاوز السعة — رقم مستحيل يُفسد كلّ تقرير مساحة.
  constraint archive_media_capacity check (used_gb is null or capacity_gb is null or used_gb <= capacity_gb)
);

create index if not exists archive_media_health_idx
  on public.archive_media (health_status) where is_deleted = false;

comment on table public.archive_media is
  'V2-6.2-A — وسائط فيزيائية (قرص/شريط/بطاقة). ⛔ ليست project_archives: ذاك '
  'أرشيف إغلاق مشروع بسياسة احتفاظ وحجز قانونيّ، وهذا رفّ وأقراص.';

-- ربط المشروع بالوسيط. ⛔ لا نسخ لبيانات المشروع — المرجع وحده.
create table if not exists public.archive_project_links (
  id          uuid primary key default gen_random_uuid(),
  media_id    uuid not null references public.archive_media(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  path_on_media text,
  size_gb     numeric(12,2) check (size_gb is null or size_gb >= 0),
  -- ⛔ الأرشفة ليست حذفًا: الحالة تقول أين المادّة، لا أنّها ذهبت.
  link_status text not null default 'stored'
              check (link_status in ('stored','verified','migrated','missing')),
  verified_at date,
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  unique (media_id, project_id, path_on_media)
);

create index if not exists apl_project_idx on public.archive_project_links (project_id) where is_deleted = false;
create index if not exists apl_media_idx   on public.archive_project_links (media_id)   where is_deleted = false;

-- ─── §3 · V2-6.3-A/B · تراخيص الموسيقى ────────────────────────────────────
create table if not exists public.music_licenses (
  id            uuid primary key default gen_random_uuid(),
  track_title   text not null check (length(btrim(track_title)) between 1 and 200),
  artist        text,
  source        text,
  license_type  text not null default 'unknown'
                check (license_type in ('unknown','royalty_free','rights_managed','creative_commons','public_domain','custom_composed','in_house')),
  license_id    text,
  purchased_at  date,
  expires_at    date,
  -- 🔴 النطاق حقيقة تعاقدية لا تخمين: غير محدَّد يبقى غير محدَّد.
  scope_note    text,
  -- إثبات الترخيص: bucket+path، ⛔ لا رابط مخزَّن.
  proof_bucket  text,
  proof_path    text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint ml_window check (expires_at is null or purchased_at is null or expires_at >= purchased_at),
  constraint ml_proof_pair check (
    (proof_bucket is null and proof_path is null)
    or (length(btrim(coalesce(proof_bucket,''))) > 0
        and length(btrim(coalesce(proof_path,''))) > 0
        and proof_path !~* '^https?://')),
  unique (track_title, coalesce(license_id, ''))
);

create table if not exists public.music_license_project_links (
  id          uuid primary key default gen_random_uuid(),
  license_id  uuid not null references public.music_licenses(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  usage_note  text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  unique (license_id, project_id)
);

-- ─── §4 · V2-6.5-A · إقرارات الظهور (Model Releases) — PDPL ────────────────
--
-- 🔴 بيانات شخصية. يتبع `SECURE_DOCUMENT_GRANT_CONTRACT.md`:
--    دلو خاصّ · لا رابط مخزَّن · توقيع بعد إثبات الصلاحية في القاعدة.
-- ⛔ والحدّ الأدنى من البيانات: لا رقم هويّة ولا عنوان ولا تاريخ ميلاد.
--    ما يلزم لإثبات الإقرار: اسم · وسيلة تواصل واحدة · نطاق · تاريخ.
create table if not exists public.model_releases (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete set null,
  person_name   text not null check (length(btrim(person_name)) between 2 and 160),
  -- وسيلة تواصل **واحدة** اختيارية. ⛔ لا رقم هويّة ولا عنوان (PDPL: أقلّ ما يلزم).
  contact_ref   text,
  release_scope text not null default 'project_only'
                check (release_scope in ('project_only','marketing','showreel','unrestricted','withdrawn')),
  signed_at     date,
  expires_at    date,
  -- المستند نفسه في دلو خاصّ.
  doc_bucket    text,
  doc_path      text,
  -- 🔴 حقّ السحب — PDPL يوجبه. السحب يُبطل النطاق فورًا عبر العرض المشتقّ.
  withdrawn_at  timestamptz,
  withdrawn_reason text,
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint mr_window check (expires_at is null or signed_at is null or expires_at >= signed_at),
  constraint mr_doc_pair check (
    (doc_bucket is null and doc_path is null)
    or (length(btrim(coalesce(doc_bucket,''))) > 0
        and length(btrim(coalesce(doc_path,''))) > 0
        and doc_path !~* '^https?://')),
  constraint mr_withdrawn_pair check (
    release_scope <> 'withdrawn' or withdrawn_at is not null)
);

create index if not exists mr_project_idx on public.model_releases (project_id) where is_deleted = false;

comment on table public.model_releases is
  'V2-6.5-A — PDPL: أقلّ بيانات ممكنة، ⛔ لا رقم هويّة ولا عنوان. المستند في '
  'دلو خاصّ بلا رابط مخزَّن، والسحب يُبطل النطاق فورًا.';

-- ─── §5 · RLS — deny by default على الجميع ─────────────────────────────────
alter table public.asset_insurance_coverage    enable row level security;
alter table public.archive_media               enable row level security;
alter table public.archive_project_links       enable row level security;
alter table public.music_licenses              enable row level security;
alter table public.music_license_project_links enable row level security;
alter table public.model_releases              enable row level security;

drop policy if exists aic_read on public.asset_insurance_coverage;
create policy aic_read on public.asset_insurance_coverage
  for select to authenticated using (public.civ_can_view_assets());

drop policy if exists am_read on public.archive_media;
create policy am_read on public.archive_media
  for select to authenticated using (public.civ_can_view_assets());
drop policy if exists apl_read on public.archive_project_links;
create policy apl_read on public.archive_project_links
  for select to authenticated using (public.civ_can_view_assets());

drop policy if exists ml_read on public.music_licenses;
create policy ml_read on public.music_licenses
  for select to authenticated using (public.can_manage_projects());
drop policy if exists mlpl_read on public.music_license_project_links;
create policy mlpl_read on public.music_license_project_links
  for select to authenticated using (public.can_manage_projects());

-- 🔴 إقرارات الظهور أضيق: إدارة المشاريع وحدها. لا طاقم ولا عهدة.
drop policy if exists mr_read on public.model_releases;
create policy mr_read on public.model_releases
  for select to authenticated using (public.can_manage_projects());

-- ⛔ لا سياسة كتابة على أيّ منها: الكتابة عبر الدوالّ المحروسة. ولا شيء لـanon.
revoke all on public.asset_insurance_coverage    from anon, public;
revoke all on public.archive_media               from anon, public;
revoke all on public.archive_project_links       from anon, public;
revoke all on public.music_licenses              from anon, public;
revoke all on public.music_license_project_links from anon, public;
revoke all on public.model_releases              from anon, public;

-- ─── §6 · V2-6.3-B · ملخّص حقوق المشروع — مشتقّ لا مخزَّن ──────────────────
create or replace function public.project_rights_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_music jsonb; v_releases jsonb; v_archive jsonb;
begin
  if not public.can_manage_projects() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'track_title', m.track_title, 'artist', m.artist,
           'license_type', m.license_type, 'license_id', m.license_id,
           'expires_at', m.expires_at,
           -- 🔴 مشتقّ: ترخيص منتهٍ يُعلن منتهيًا ولو بقي مربوطًا بالمشروع.
           'expired', (m.expires_at is not null and m.expires_at < current_date),
           'has_proof', (m.proof_path is not null),
           'usage_note', l.usage_note
         ) order by m.track_title), '[]'::jsonb) into v_music
  from public.music_license_project_links l
  join public.music_licenses m on m.id = l.license_id
  where l.project_id = p_project and coalesce(l.is_deleted,false) = false
    and coalesce(m.is_deleted,false) = false;

  -- ⛔ لا اسم شخص في الملخّص القابل للطباعة: عدد وحالة فقط (PDPL).
  select jsonb_build_object(
           'total', count(*),
           'withdrawn', count(*) filter (where release_scope = 'withdrawn'),
           'expired', count(*) filter (where expires_at is not null and expires_at < current_date),
           'missing_document', count(*) filter (where doc_path is null)
         ) into v_releases
  from public.model_releases
  where project_id = p_project and coalesce(is_deleted,false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
           'media_label', am.label, 'media_kind', am.media_kind,
           'health_status', am.health_status, 'link_status', apl.link_status,
           'physical_location', am.physical_location
         ) order by am.label), '[]'::jsonb) into v_archive
  from public.archive_project_links apl
  join public.archive_media am on am.id = apl.media_id
  where apl.project_id = p_project and coalesce(apl.is_deleted,false) = false
    and coalesce(am.is_deleted,false) = false;

  return jsonb_build_object('ok', true, 'project_id', p_project,
                            'music', v_music, 'model_releases', v_releases, 'archive', v_archive);
end $$;

-- ─── §7 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.project_rights_summary(uuid) from public, anon;
grant execute on function public.project_rights_summary(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
