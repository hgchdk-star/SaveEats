-- 가게 콘텐츠 출처: store_sources(공개 목록) · store_source_records(내부 수집 기록) · store_source_approvals(가게별 승인)
--          + list_store_sources(공개 읽기 함수) + 검토용 view/preview/승인 함수(private)
-- 근거: PRD FR-STORE-015~021, 개발 명세 SRC-001~004 · OPEN-SRC-001, 계약 초안 store-source-contract-draft.md (저장소 밖),
--       서정 결정(출처명 규칙 · 페이지별 목록 · 공개 승인 후에만 공개 · 응답은 name/url만), 혜지 설계 확정(Q1~Q5, Q9).
-- 이 migration에는 데이터가 한 줄도 없다. 데이터는 저장소 밖 SQL로 따로 투입하고, 투입만으로는 공개되지 않는다.
--
-- 구조
--   public.store_sources           앱에 보일 수 있는 값(이름 · URL · 순서)만 가진 목록. 앱 역할에는 어떤 권한도 없다(직접 읽기 금지).
--   private.store_source_records   내부 수집 기록(근거 · 권리 · 제외 사유 · 후보 지점명). 한솥 magazine처럼 공개하지 않을 URL은 여기에만 둔다.
--   private.store_source_approvals 가게별 승인. 승인한 순간의 "목록 지문"을 저장한다. 목록이 바뀌면 지문이 달라져 승인이 무효가 된다.
--
-- 읽기 함수 list_store_sources(p_store_id uuid) → { items: [{ name, url }] }
--   SECURITY DEFINER: 승인 표가 private에 있어 INVOKER로는 읽을 수 없다. 앱 역할에 승인 표나 지문 함수를 열면 어느 가게가
--   승인됐는지 노출되고 /rest/v1로 목록을 직접 읽을 길이 열린다. 그래서 테이블에는 권한을 주지 않고 이 함수로만 읽는다.
--   RLS를 건너뛰므로 get_store와 같은 규칙(가게와 카테고리가 활성)을 함수 안에서 직접 건다.
--   승인이 없거나 지문이 다르면 오류가 아니라 { items: [] }. 가게가 없거나 비활성이면 RESOURCE_NOT_FOUND, null이면 INVALID_INPUT.
--   영업 종료(is_open = false) 가게도 출처는 그대로 나온다.
--
-- 승인의 의미: 이 승인은 "서정이 이 목록을 공개해도 된다고 확인했다"는 운영 기록일 뿐이다. 콘텐츠 이용 허락도, 권리 확인도 아니다(FR-STORE-020).
--
-- 지문 규칙 (v1): 그 가게 store_sources 행의 url · name · sort_order를 url 순으로 이어 붙여 sha256. 'v1:' + 소문자 16진수 64자.
--   id · 시각 · 내부 기록은 넣지 않는다(내부 메모를 고쳐도 승인이 풀리면 안 된다). 알고리즘을 바꾸면 접두사를 올려 모든 승인을 무효로 한다.
--   목록이 어떻게 바뀌든 읽을 때 현재 지문과 비교하므로 항상 닫힌 쪽으로 실패한다(트리거로 승인을 지우는 방식이 아니다).
--   되돌려서 승인받은 내용과 똑같아지면 승인도 다시 유효해진다(같은 내용을 승인받은 것이므로 의도한 동작).
--
-- 동시성: 승인 확인과 목록 읽기는 한 SQL 문장 안에서 STABLE 함수로 하며, STABLE 함수는 호출한 문장의 스냅샷을 그대로 쓴다.
--   그래서 읽는 도중 목록이 바뀌어도 "승인과 다른 목록"이 나가지 않는다. fingerprint · items 함수를 VOLATILE로 바꾸면 이 보장이 깨진다(테스트가 막는다).
--   목록 편집 트랜잭션과 승인은 가게별 advisory lock으로 직렬화한다(50개 상한 검사 포함).

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------

create table public.store_sources (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  name text not null,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_sources_name_check
    check (btrim(name) <> '' and name = btrim(name) and char_length(name) <= 80 and name !~ '[[:cntrl:]]'),
  constraint store_sources_url_check
    check (url ~ '^https?://[^[:space:][:cntrl:]]+$' and char_length(url) <= 2048),
  constraint store_sources_sort_order_check check (sort_order >= 0),
  constraint store_sources_store_url_key unique (store_id, url),
  constraint store_sources_store_name_key unique (store_id, name)
);

create index store_sources_store_order_idx on public.store_sources (store_id, sort_order, name, id);

create table private.store_source_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  url text not null,
  -- 공개 목록에 올라간 행. 공개하지 않는 URL(제외 사유가 있는 것)은 비워 둔다. 공개 행이 지워지면 비워진다.
  source_id uuid references public.store_sources (id) on delete set null,
  collected_for text not null
    check (collected_for in ('BRAND_HOME', 'MENU_NAME', 'MENU_DESCRIPTION', 'MENU_PRICE', 'IMAGE_PAGE', 'OTHER')),
  subject_label text,
  host_kind text not null default 'UNKNOWN' check (host_kind in ('OFFICIAL', 'PLATFORM', 'UNKNOWN')),
  name_rule text check (name_rule is null or name_rule in ('DEFAULT', 'MENU_NAME', 'MENU_LIST', 'MANUAL')),
  -- 내부 참고용 지점명 후보. 공개 이름에 들어가면 검토 view가 표시한다.
  candidate_label text check (candidate_label is null or btrim(candidate_label) <> ''),
  exclusion_reason text check (exclusion_reason is null or btrim(exclusion_reason) <> ''),
  rights_permission text,
  reuse_permission text,
  evidence text,
  note text,
  checked_on date,
  load_batch text,
  created_at timestamptz not null default now(),
  constraint store_source_records_url_check
    check (url ~ '^https?://[^[:space:][:cntrl:]]+$' and char_length(url) <= 2048),
  constraint store_source_records_excluded_not_linked check (exclusion_reason is null or source_id is null)
);

create unique index store_source_records_uniq_idx
  on private.store_source_records (store_id, url, collected_for, coalesce(subject_label, ''));
create index store_source_records_store_url_idx on private.store_source_records (store_id, url);

create table private.store_source_approvals (
  store_id uuid primary key references public.stores (id) on delete restrict,
  list_fingerprint text not null check (list_fingerprint ~ '^v1:[0-9a-f]{64}$'),
  item_count integer not null check (item_count > 0),
  approved_at timestamptz not null default now(),
  approved_by text not null check (btrim(approved_by) <> '' and char_length(approved_by) <= 40),
  note text
);

-- ---------------------------------------------------------------------------
-- 권한: 앱 역할(anon · authenticated)에는 세 테이블 모두 어떤 권한도 없다. RLS도 켜 두며 정책은 만들지 않는다.
-- (Supabase는 public에 만든 테이블에 앱 권한을 자동으로 붙일 수 있어 명시적으로 걷어낸다.)
-- ---------------------------------------------------------------------------

alter table public.store_sources enable row level security;
alter table private.store_source_records enable row level security;
alter table private.store_source_approvals enable row level security;

revoke all on table public.store_sources from public, anon, authenticated;
revoke all on table private.store_source_records from public, anon, authenticated;
revoke all on table private.store_source_approvals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 지문 · 목록 조립 (private, STABLE: 호출한 문장의 스냅샷을 쓴다)
-- ---------------------------------------------------------------------------

create function private.store_source_fingerprint(p_store_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select 'v1:' || encode(sha256(convert_to(
    coalesce(string_agg(s.url || E'\x1f' || s.name || E'\x1f' || s.sort_order::text, E'\x1e' order by s.url), ''),
    'UTF8')), 'hex')
  from public.store_sources s
  where s.store_id = p_store_id
$$;

-- 앱에 나가는 모양을 만드는 유일한 곳. 키는 name · url 둘만 직접 지정한다(행 전체를 JSON으로 바꾸지 않는다).
create function private.store_source_items(p_store_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('name', s.name, 'url', s.url) order by s.sort_order, s.name, s.id),
    '[]'::jsonb)
  from public.store_sources s
  where s.store_id = p_store_id
$$;

-- ---------------------------------------------------------------------------
-- 쓰기 가드 (트리거)
-- ---------------------------------------------------------------------------

-- 가게별 직렬화 열쇠. 목록 편집 · 승인 · 내부 기록 변경이 같은 가게에서 겹치지 않게 한다.
create function private.store_source_lock(p_store_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('store_sources:' || p_store_id::text, 0))
$$;

create function private.store_sources_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- 두 가게가 걸리면(가게 옮김) 정렬해서 잠가 교착을 피한다.
  for v_id in
    select x from (
      select distinct x from unnest(array[
        case when tg_op <> 'INSERT' then old.store_id end,
        case when tg_op <> 'DELETE' then new.store_id end]) x
      where x is not null) t
    order by x
  loop
    perform private.store_source_lock(v_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' or new.store_id is distinct from old.store_id then
    if (select count(*) from public.store_sources s where s.store_id = new.store_id) >= 50 then
      raise exception using errcode = '23514', message = 'STORE_SOURCES_LIMIT';
    end if;
  end if;

  if tg_op = 'INSERT' or new.store_id is distinct from old.store_id or new.url is distinct from old.url then
    if exists (
      select 1 from private.store_source_records r
      where r.store_id = new.store_id and r.url = new.url and r.exclusion_reason is not null
    ) then
      raise exception using errcode = '23514', message = 'STORE_SOURCE_EXCLUDED_URL';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      new.updated_at := clock_timestamp();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger store_sources_guard
  before insert or update or delete on public.store_sources
  for each row execute function private.store_sources_guard();

create function private.store_source_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.store_source_lock(new.store_id);

  if new.exclusion_reason is not null and exists (
    select 1 from public.store_sources s where s.store_id = new.store_id and s.url = new.url
  ) then
    raise exception using errcode = '23514', message = 'STORE_SOURCE_EXCLUDED_URL';
  end if;

  if new.source_id is not null and not exists (
    select 1 from public.store_sources s
    where s.id = new.source_id and s.store_id = new.store_id and s.url = new.url
  ) then
    raise exception using errcode = '23514', message = 'STORE_SOURCE_RECORD_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger store_source_records_guard
  before insert or update on private.store_source_records
  for each row execute function private.store_source_records_guard();

-- ---------------------------------------------------------------------------
-- 공개 읽기 함수
-- ---------------------------------------------------------------------------

create function public.list_store_sources(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if p_store_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- get_store와 같은 규칙: 가게와 카테고리가 모두 활성이어야 한다 (DEFINER라 RLS가 대신해 주지 않는다)
  if not exists (
    select 1
    from public.stores s join public.categories c on c.id = s.category_id
    where s.id = p_store_id and s.is_active and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- 승인 확인과 목록 읽기를 한 문장에서 한다 (같은 스냅샷)
  select case
           when exists (
             select 1 from private.store_source_approvals a
             where a.store_id = p_store_id
               and a.list_fingerprint = private.store_source_fingerprint(p_store_id)
           ) then private.store_source_items(p_store_id)
           else '[]'::jsonb
         end
    into v_items;

  return jsonb_build_object('items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- 검토 · 승인 도구 (private: 관리자 SQL 전용, 앱에는 열지 않는다)
-- ---------------------------------------------------------------------------

-- 지금 승인한다면 앱이 받을 JSON. 승인 여부와 상관없이 현재 목록 그대로 보여준다.
create function private.preview_store_sources(p_store_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('items', private.store_source_items(p_store_id))
$$;

-- 서정이 검토한 목록 지문(p_expected_fingerprint)이 지금 지문과 같을 때만 승인한다. 가게당 승인 행은 하나.
create function private.approve_store_sources(
  p_store_id uuid,
  p_expected_fingerprint text,
  p_approved_by text,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_fp text;
  v_count integer;
begin
  if p_store_id is null or p_expected_fingerprint is null or p_approved_by is null
     or btrim(p_approved_by) = '' or char_length(p_approved_by) > 40 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- 진행 중인 편집이 끝난 뒤의 목록으로 계산한다 (이 함수는 VOLATILE이라 잠금 뒤 새 스냅샷을 쓴다)
  perform private.store_source_lock(p_store_id);

  select count(*) into v_count from public.store_sources where store_id = p_store_id;
  if v_count = 0 then
    raise exception using errcode = 'P0001', message = 'SOURCE_LIST_EMPTY';
  end if;
  v_fp := private.store_source_fingerprint(p_store_id);
  if v_fp is distinct from p_expected_fingerprint then
    raise exception using errcode = 'P0001', message = 'FINGERPRINT_MISMATCH';
  end if;

  insert into private.store_source_approvals as a (store_id, list_fingerprint, item_count, approved_by, note)
  values (p_store_id, v_fp, v_count, btrim(p_approved_by), p_note)
  on conflict (store_id) do update
    set list_fingerprint = excluded.list_fingerprint,
        item_count = excluded.item_count,
        approved_at = now(),
        approved_by = excluded.approved_by,
        note = excluded.note;

  return jsonb_build_object('storeId', p_store_id, 'itemCount', v_count, 'fingerprint', v_fp);
end;
$$;

-- 긴급 중단: 그 가게의 승인을 지우면 즉시 빈 목록으로 돌아간다. 지웠으면 true.
create function private.revoke_store_source_approval(p_store_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.store_source_approvals where store_id = p_store_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- 검토용 표: 공개 예정 목록을 가게별로 한눈에. 승인 상태는 NONE(승인 없음) / APPROVED / STALE(승인 후 목록이 바뀜).
create view private.store_source_review as
select
  st.id as store_id,
  st.name as store_name,
  (st.is_active and c.is_active) as store_visible,
  s.id as source_id,
  s.sort_order,
  s.name as public_name,
  s.url,
  rr.name_rules,
  rr.host_kinds,
  rr.record_count,
  rr.name_has_candidate_label,
  count(*) over (partition by s.store_id) as item_count,
  private.store_source_fingerprint(s.store_id) as current_fingerprint,
  a.list_fingerprint as approved_fingerprint,
  case
    when a.store_id is null then 'NONE'
    when a.list_fingerprint = private.store_source_fingerprint(s.store_id) then 'APPROVED'
    else 'STALE'
  end as approval_status,
  a.approved_at,
  a.approved_by
from public.store_sources s
join public.stores st on st.id = s.store_id
join public.categories c on c.id = st.category_id
left join private.store_source_approvals a on a.store_id = s.store_id
left join lateral (
  select
    string_agg(distinct r.name_rule, ',' order by r.name_rule) as name_rules,
    string_agg(distinct r.host_kind, ',' order by r.host_kind) as host_kinds,
    count(*) as record_count,
    coalesce(bool_or(r.candidate_label is not null and position(r.candidate_label in s.name) > 0), false) as name_has_candidate_label
  from private.store_source_records r
  where r.store_id = s.store_id and r.url = s.url
) rr on true;

-- ---------------------------------------------------------------------------
-- 함수 · view 권한
-- ---------------------------------------------------------------------------

revoke execute on function private.store_source_fingerprint(uuid) from public, anon, authenticated;
revoke execute on function private.store_source_items(uuid) from public, anon, authenticated;
revoke execute on function private.store_source_lock(uuid) from public, anon, authenticated;
revoke execute on function private.store_sources_guard() from public, anon, authenticated;
revoke execute on function private.store_source_records_guard() from public, anon, authenticated;
revoke execute on function private.preview_store_sources(uuid) from public, anon, authenticated;
revoke execute on function private.approve_store_sources(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function private.revoke_store_source_approval(uuid) from public, anon, authenticated;
revoke all on table private.store_source_review from public, anon, authenticated;

revoke execute on function public.list_store_sources(uuid) from public, anon, authenticated;
grant execute on function public.list_store_sources(uuid) to anon, authenticated;
