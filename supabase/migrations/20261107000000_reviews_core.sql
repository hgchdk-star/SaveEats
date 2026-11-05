-- 리뷰 핵심: 글 리뷰(사진은 후속) · 도움돼요 · 공개/내 목록 · 작성 자격 · 가게 요약 집계
-- 근거: 기획서 30~31, PRD 32, 개발 명세 REV-001~009 · DB-008~009 · ARCH-007, 팀 결정 (2026-11-06 R1~R9).
-- 이 migration에는 사진 관련 테이블·컬럼·함수·저장소가 없다(후속 PR). 응답 어디에도 images 키가 없다.
--
-- 규칙
--   작성 자격 = USER_CONFIRMED 주문(completed_at 있음)의 본인. 작성 기한 = completed_at + 정확히 720시간, 마감 시각까지 작성 가능.
--               PENDING · 취소 주문은 작성 불가. 활성 리뷰는 주문당 1개(부분 unique index). 삭제(soft) 후 기한 안이면 새 ID로 재작성.
--               기존 활성 리뷰는 기한이 지나도 조회 · 수정 · 삭제할 수 있다. 최종 판단은 서버(clock_timestamp, 주문 행 잠금 이후).
--   입력     = 땡김도 1~5 정수, 본문은 앞뒤 일반 공백(U+0020)만 지운 값의 문자 수 5~500(Unicode code point). 저장값은 지운 결과.
--   멱등성   = 쓰기 명령은 모두 operationId + 영수증(private.review_command_receipts). 같은 operationId + 같은 입력 = 적용 당시 결과를 다시 돌려줌
--               (replayed:true, 새로 적용하지 않음 · 삭제된 리뷰를 되살리지 않음), 다른 입력이나 다른 명령 = REVIEW_OPERATION_CONFLICT.
--   수정     = expectedRevision이 다르면 REVIEW_REVISION_CONFLICT. 내용이 같으면 no-op(revision · edited_at 그대로). 도움돼요는 유지된다.
--   삭제     = soft delete(deleted_at), revision +1. 이미 삭제된 본인 리뷰의 재시도는 기존 결과로 끝낸다. 도움돼요 행은 남지만 집계에서 빠진다.
--   도움돼요 = 목표값(desired) 방식. 자기 리뷰 불가(SELF_HELPFUL_NOT_ALLOWED), 삭제된 리뷰 불가(RESOURCE_NOT_FOUND), 사용자당 리뷰당 1개.
--   공개 응답 = authorNickname(없으면 null), 내부 orderId · user ID · 이메일 없음. 내 리뷰 응답에만 본인 orderId가 있다.
--   잠금     = create/update/delete: 본인 주문 행 FOR UPDATE → (리뷰 행 FOR UPDATE). set_helpful: 리뷰 행 FOR SHARE(삭제와 경합을 조율).
--   권한     = reviews · review_menus · review_helpful은 앱이 직접 읽거나 쓸 수 없다(권한 · 정책 없음). 모든 접근은 아래 DEFINER 함수로 한다.
--
-- 함수 (이름과 인자 이름)
--   get_review_eligibility(p_order_id uuid)                                                   DEFINER, authenticated
--   create_review(p_order_id uuid, p_operation_id uuid, p_rating integer, p_body text)        DEFINER, authenticated
--   update_review(p_review_id uuid, p_operation_id uuid, p_expected_revision bigint, p_rating integer, p_body text)   DEFINER, authenticated
--   delete_review(p_review_id uuid, p_operation_id uuid, p_expected_revision bigint)          DEFINER, authenticated
--   set_helpful(p_review_id uuid, p_operation_id uuid, p_desired boolean)                     DEFINER, authenticated
--   list_public_reviews(p_scope_type text, p_scope_id uuid, p_sort text, p_cursor text, p_page_size integer)   DEFINER, anon + authenticated
--   list_my_reviews(p_cursor text, p_page_size integer)                                       DEFINER, authenticated
--
-- 기존 함수 변경 (create or replace, signature 그대로)
--   list_stores · get_store · list_my_favorites · search_stores · list_recommended_stores · list_stores_by_ids:
--     reviewSummary 고정값 {count:0, averageCravingRating:null} → 실제 집계(활성 리뷰만, 평균은 소수 첫째 자리 반올림, 0개면 null).
--   get_my_history_order(→ list_my_orders의 각 행): reviewEligibility 키를 추가한다(작성 자격).

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  store_id uuid not null,
  revision bigint not null default 1 check (revision > 0),
  craving_rating smallint not null check (craving_rating between 1 and 5),
  body text not null check (body = btrim(body) and char_length(body) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete restrict
);

-- 한 주문에는 동시에 하나의 활성 리뷰만 (최종 방어선). 시간에 따라 변하는 기한은 인덱스에 넣지 않는다.
create unique index reviews_one_active_per_order on public.reviews (order_id) where deleted_at is null;
create index reviews_store_active_idx on public.reviews (store_id, created_at desc, id desc) where deleted_at is null;
create index reviews_user_active_idx on public.reviews (user_id, created_at desc, id desc) where deleted_at is null;

-- 주문에 포함된 서로 다른 메뉴 전체를 연결한다 (메뉴 범위 조회용)
create table public.review_menus (
  review_id uuid not null references public.reviews (id) on delete restrict,
  menu_id uuid not null references public.menus (id) on delete restrict,
  primary key (review_id, menu_id)
);
create index review_menus_menu_idx on public.review_menus (menu_id, review_id);

create table public.review_helpful (
  review_id uuid not null references public.reviews (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table private.review_command_receipts (
  user_id uuid not null references public.profiles (id) on delete restrict,
  operation_id uuid not null,
  command_kind text not null check (command_kind in ('create', 'update', 'delete', 'helpful')),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  target_id uuid not null,
  applied_review_id uuid references public.reviews (id) on delete restrict,
  applied_revision bigint check (applied_revision > 0),
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.reviews enable row level security;
alter table public.review_menus enable row level security;
alter table public.review_helpful enable row level security;
revoke all on table public.reviews, public.review_menus, public.review_helpful from public, anon, authenticated;
revoke all on table private.review_command_receipts from public, anon, authenticated;
-- 정책도 만들지 않는다: 앱 권한으로는 읽기 · 쓰기가 모두 막힌다.

-- 활성 리뷰만 센 가게별 요약 (뷰는 소유자 권한으로 읽으므로 앱이 reviews를 직접 읽지 못해도 집계는 공개된다. 집계값만 노출)
create view public.store_review_summaries as
select r.store_id,
       count(*)::integer as review_count,
       round(avg(r.craving_rating)::numeric, 1) as average_craving_rating
from public.reviews r
where r.deleted_at is null
group by r.store_id;
revoke all on table public.store_review_summaries from public, anon, authenticated;
grant select on public.store_review_summaries to anon, authenticated;

-- ---------------------------------------------------------------------------
-- private 보조 함수
-- ---------------------------------------------------------------------------

-- 작성 기한: 마감 시각(completed_at + 정확히 720시간)까지 작성 가능, 넘으면 불가
create function private.is_review_window_open(p_completed_at timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_now <= p_completed_at + interval '720 hours';
$$;

-- 입력 검증 + 정규화. 땡김도 1~5 정수, 본문은 앞뒤 일반 공백만 지운 값의 문자 수 5~500. 위반은 INVALID_REVIEW_INPUT. 지운 본문을 돌려준다.
create function private.normalize_review_input(p_rating integer, p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text := btrim(p_body);
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 or v_body is null or char_length(v_body) < 5 or char_length(v_body) > 500 then
    perform private.fail('INVALID_REVIEW_INPUT');
  end if;
  return v_body;
end;
$$;

-- 명령 지문: 명령 종류 · 대상 · 허용 입력 · (있으면) revision
create function private.review_fingerprint(p_kind text, p_target uuid, p_rating integer, p_body text, p_revision bigint default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    p_kind || '|' || p_target::text || '|' || coalesce(p_rating::text, '') || '|' || coalesce(btrim(p_body), '') || '|' || coalesce(p_revision::text, ''),
    'UTF8')), 'hex');
$$;

-- 리뷰 하나를 응답 모양으로. p_include_order=true면 본인 화면용으로 orderId를 넣는다(공개 응답에는 넣지 않는다). images 키는 없다.
create function private.review_json(p_review_id uuid, p_viewer uuid, p_include_order boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
           'reviewId', r.id,
           'revision', r.revision,
           'authorNickname', p.nickname,
           'rating', r.craving_rating,
           'body', r.body,
           'createdAt', r.created_at,
           'editedAt', r.edited_at,
           'storeId', r.store_id,
           'storeNameSnapshot', o.store_name_snapshot,
           'menuIds', coalesce((
             select jsonb_agg(x.menu_id order by x.first_line)
             from (select i.menu_id, min(i.line_no) as first_line from public.order_items i where i.order_id = r.order_id group by i.menu_id) x
           ), '[]'::jsonb),
           'menuNamesSnapshot', coalesce((
             select jsonb_agg(x.menu_name order by x.first_line)
             from (select (array_agg(i.menu_name_snapshot order by i.line_no))[1] as menu_name, min(i.line_no) as first_line
                   from public.order_items i where i.order_id = r.order_id group by i.menu_id) x
           ), '[]'::jsonb),
           'orderAmount', o.total_amount,
           'helpfulCount', (select count(*) from public.review_helpful h where h.review_id = r.id),
           'isMine', (p_viewer is not null and r.user_id = p_viewer),
           'myHelpful', (p_viewer is not null and exists (select 1 from public.review_helpful h where h.review_id = r.id and h.user_id = p_viewer))
         ) || case when p_include_order then jsonb_build_object('orderId', r.order_id) else '{}'::jsonb end
  from public.reviews r
  join public.orders o on o.id = r.order_id
  left join public.profiles p on p.id = r.user_id
  where r.id = p_review_id;
$$;

revoke execute on function private.is_review_window_open(timestamptz, timestamptz) from public;
revoke execute on function private.normalize_review_input(integer, text) from public;
revoke execute on function private.review_fingerprint(text, uuid, integer, text, bigint) from public;
revoke execute on function private.review_json(uuid, uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- get_review_eligibility(p_order_id) → { serverNow, completedAt, reviewDeadline, activeReviewId, eligibility }
--   eligibility = NOT_COMPLETED | HAS_ACTIVE_REVIEW | CAN_WRITE | DEADLINE_EXCEEDED. 본인 주문만(없거나 남의 주문은 RESOURCE_NOT_FOUND).
-- ---------------------------------------------------------------------------

create function public.get_review_eligibility(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_completed timestamptz;
  v_active uuid;
  v_now timestamptz := clock_timestamp();
  v_kind text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select o.status, o.completed_at into v_status, v_completed
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  select r.id into v_active from public.reviews r where r.order_id = p_order_id and r.deleted_at is null;

  if v_status <> 'USER_CONFIRMED' or v_completed is null then
    v_kind := 'NOT_COMPLETED';
  elsif v_active is not null then
    v_kind := 'HAS_ACTIVE_REVIEW';
  elsif private.is_review_window_open(v_completed, v_now) then
    v_kind := 'CAN_WRITE';
  else
    v_kind := 'DEADLINE_EXCEEDED';
  end if;

  return jsonb_build_object(
    'serverNow', v_now,
    'completedAt', case when v_kind = 'NOT_COMPLETED' then null else v_completed end,
    'reviewDeadline', case when v_kind = 'NOT_COMPLETED' then null else v_completed + interval '720 hours' end,
    'activeReviewId', v_active,
    'eligibility', v_kind
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_review
-- 순서: 로그인 → null 검사 → 본인 주문 행 잠금 → 영수증 → 입력 검증 → 완료 주문 → 기한 → 활성 리뷰 → 저장
-- ---------------------------------------------------------------------------

create function public.create_review(p_order_id uuid, p_operation_id uuid, p_rating integer, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_completed timestamptz;
  v_store uuid;
  v_fp text;
  v_receipt record;
  v_body text;
  v_now timestamptz;
  v_review_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select o.status, o.completed_at, o.store_id into v_status, v_completed, v_store
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  v_fp := private.review_fingerprint('create', p_order_id, p_rating, p_body);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'create' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  v_body := private.normalize_review_input(p_rating, p_body);

  if v_status <> 'USER_CONFIRMED' or v_completed is null then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_COMPLETED';
  end if;

  -- 주문 행 잠금 이후의 시각으로 기한을 본다 (오래 기다린 트랜잭션의 시작 시각으로 우회하지 못하게)
  v_now := clock_timestamp();
  if not private.is_review_window_open(v_completed, v_now) then
    raise exception using errcode = 'P0001', message = 'REVIEW_DEADLINE_EXCEEDED';
  end if;

  if exists (select 1 from public.reviews r where r.order_id = p_order_id and r.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'ACTIVE_REVIEW_EXISTS';
  end if;

  insert into public.reviews (order_id, user_id, store_id, craving_rating, body, created_at, updated_at)
  values (p_order_id, v_uid, v_store, p_rating, v_body, v_now, v_now)
  returning id into v_review_id;

  insert into public.review_menus (review_id, menu_id)
  select distinct v_review_id, i.menu_id from public.order_items i where i.order_id = p_order_id;

  v_result := private.review_json(v_review_id, v_uid, true);
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, applied_revision, result_payload)
  values (v_uid, p_operation_id, 'create', v_fp, p_order_id, v_review_id, 1, v_result);

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_review: 본인 리뷰의 땡김도 · 본문. 작성 기한은 수정 제한이 아니다.
-- 순서: 로그인 → null → 본인 주문 행 잠금 → 영수증 → 리뷰 행 잠금(삭제됐으면 RESOURCE_NOT_FOUND) → revision → 입력 검증 → 저장
-- ---------------------------------------------------------------------------

create function public.update_review(p_review_id uuid, p_operation_id uuid, p_expected_revision bigint, p_rating integer, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order_id uuid;
  v_fp text;
  v_receipt record;
  v_review record;
  v_body text;
  v_now timestamptz;
  v_revision bigint;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_review_id is null or p_operation_id is null or p_expected_revision is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select r.order_id into v_order_id from public.reviews r where r.id = p_review_id and r.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_order_id and o.user_id = v_uid for update;

  v_fp := private.review_fingerprint('update', p_review_id, p_rating, p_body, p_expected_revision);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'update' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  select r.revision, r.craving_rating, r.body, r.deleted_at into v_review
  from public.reviews r
  where r.id = p_review_id and r.user_id = v_uid
  for update;
  if v_review.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  if v_review.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVIEW_REVISION_CONFLICT';
  end if;

  v_body := private.normalize_review_input(p_rating, p_body);

  v_revision := v_review.revision;
  if v_body is distinct from v_review.body or p_rating is distinct from v_review.craving_rating::integer then
    v_now := clock_timestamp();
    v_revision := v_review.revision + 1;
    update public.reviews
    set craving_rating = p_rating, body = v_body, revision = v_revision, edited_at = v_now, updated_at = v_now
    where id = p_review_id;
  end if;

  v_result := private.review_json(p_review_id, v_uid, true);
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, applied_revision, result_payload)
  values (v_uid, p_operation_id, 'update', v_fp, p_review_id, p_review_id, v_revision, v_result);

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_review: soft delete. 기한과 무관하게 허용. 이미 삭제된 본인 리뷰의 재시도는 기존 결과로 끝낸다.
-- ---------------------------------------------------------------------------

create function public.delete_review(p_review_id uuid, p_operation_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order_id uuid;
  v_fp text;
  v_receipt record;
  v_review record;
  v_now timestamptz;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_review_id is null or p_operation_id is null or p_expected_revision is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select r.order_id into v_order_id from public.reviews r where r.id = p_review_id and r.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  perform 1 from public.orders o where o.id = v_order_id and o.user_id = v_uid for update;

  v_fp := private.review_fingerprint('delete', p_review_id, null, null, p_expected_revision);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'delete' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  select r.revision, r.deleted_at into v_review
  from public.reviews r
  where r.id = p_review_id and r.user_id = v_uid
  for update;

  if v_review.deleted_at is not null then
    return jsonb_build_object('reviewId', p_review_id, 'deletedAt', v_review.deleted_at, 'replayed', true);
  end if;
  if v_review.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVIEW_REVISION_CONFLICT';
  end if;

  v_now := clock_timestamp();
  update public.reviews
  set deleted_at = v_now, revision = revision + 1, updated_at = v_now
  where id = p_review_id;

  v_result := jsonb_build_object('reviewId', p_review_id, 'deletedAt', v_now);
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, applied_revision, result_payload)
  values (v_uid, p_operation_id, 'delete', v_fp, p_review_id, p_review_id, v_review.revision + 1, v_result);

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_helpful: 목표값 방식(재시도해도 뒤집히지 않는다). 리뷰 행 FOR SHARE로 delete와의 경합을 조율한다.
-- ---------------------------------------------------------------------------

create function public.set_helpful(p_review_id uuid, p_operation_id uuid, p_desired boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_deleted timestamptz;
  v_fp text;
  v_receipt record;
  v_count bigint;
  v_result jsonb;
  v_inserted boolean;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_review_id is null or p_operation_id is null or p_desired is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select r.user_id, r.deleted_at into v_owner, v_deleted
  from public.reviews r
  where r.id = p_review_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  v_fp := private.review_fingerprint('helpful', p_review_id, null, case when p_desired then 'true' else 'false' end);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'helpful' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  if v_deleted is not null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  if v_owner = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_HELPFUL_NOT_ALLOWED';
  end if;

  if p_desired then
    insert into public.review_helpful (review_id, user_id) values (p_review_id, v_uid)
    on conflict (review_id, user_id) do nothing;
  else
    delete from public.review_helpful where review_id = p_review_id and user_id = v_uid;
  end if;

  select count(*) into v_count from public.review_helpful h where h.review_id = p_review_id;
  v_result := jsonb_build_object('reviewId', p_review_id, 'helpful', p_desired, 'helpfulCount', v_count);

  -- 같은 operationId가 동시에 오면 하나만 영수증을 남기고, 나머지는 그 영수증으로 재생한다
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, result_payload)
  values (v_uid, p_operation_id, 'helpful', v_fp, p_review_id, p_review_id, v_result)
  on conflict (user_id, operation_id) do nothing
  returning true into v_inserted;

  if v_inserted is null then
    select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
    from private.review_command_receipts c
    where c.user_id = v_uid and c.operation_id = p_operation_id;
    if v_receipt.command_kind = 'helpful' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- list_public_reviews: 공개 목록(Guest도 가능). 가게 또는 메뉴 범위. 응답에 orderId · images가 없다.
--   p_scope_type 'store' | 'menu', p_sort LATEST(기본) | HELPFUL | RATING_DESC | RATING_ASC,
--   p_page_size 1~50(기본 20), p_cursor 불투명(scope · sort를 담아 검증). 정렬은 (정렬값 → 최신 → id) 모두 내림차순 keyset.
--   응답 { items, summary: {average(0개면 null), count}, hasMore, nextCursor }. summary는 범위 전체(페이지가 아니라) 활성 리뷰 기준.
--   도움순 · 땡김도 정렬은 값이 바뀔 수 있어 페이지 사이 고정 Snapshot을 보장하지 않는다(앱이 ID로 중복 제거).
--   범위의 가게/메뉴가 아예 없으면 RESOURCE_NOT_FOUND(비활성이어도 있으면 리뷰는 그대로 보인다).
-- ---------------------------------------------------------------------------

create function public.list_public_reviews(
  p_scope_type text,
  p_scope_id uuid,
  p_sort text default 'LATEST',
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_sort text := coalesce(p_sort, 'LATEST');
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_has_cursor boolean := false;
  v_after_k bigint;
  v_after_at timestamptz;
  v_after_id uuid;
  v_ids uuid[];
  v_ks bigint[];
  v_ats timestamptz[];
  v_count integer;
  v_has_more boolean;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text;
  v_summary jsonb;
begin
  if p_scope_type is null or p_scope_type not in ('store', 'menu') or p_scope_id is null
     or v_sort not in ('LATEST', 'HELPFUL', 'RATING_DESC', 'RATING_ASC') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT', detail = 'pageSize must be between 1 and 50';
  end if;
  if p_scope_type = 'store' and not exists (select 1 from public.stores s where s.id = p_scope_id) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  if p_scope_type = 'menu' and not exists (select 1 from public.menus m where m.id = p_scope_id) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      if jsonb_typeof(v_cursor) = 'object'
         and v_cursor ->> 'scope' = p_scope_type
         and (v_cursor ->> 'scopeId')::uuid = p_scope_id
         and v_cursor ->> 'sort' = v_sort then
        v_after_k := (v_cursor ->> 'k')::bigint;
        v_after_at := (v_cursor ->> 'createdAt')::timestamptz;
        v_after_id := (v_cursor ->> 'id')::uuid;
        v_has_cursor := v_after_k is not null and v_after_at is not null and v_after_id is not null;
      end if;
    exception when others then
      v_has_cursor := false;
    end;
    if not v_has_cursor then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT', detail = 'invalid cursor';
    end if;
  end if;

  select array_agg(z.id order by z.k desc, z.created_at desc, z.id desc),
         array_agg(z.k order by z.k desc, z.created_at desc, z.id desc),
         array_agg(z.created_at order by z.k desc, z.created_at desc, z.id desc)
    into v_ids, v_ks, v_ats
  from (
    select y.id, y.k, y.created_at
    from (
      select r.id, r.created_at,
             (case v_sort
                when 'HELPFUL' then (select count(*) from public.review_helpful h where h.review_id = r.id)
                when 'RATING_DESC' then r.craving_rating::bigint
                when 'RATING_ASC' then -(r.craving_rating::bigint)
                else 0::bigint
              end) as k
      from public.reviews r
      where r.deleted_at is null
        and ((p_scope_type = 'store' and r.store_id = p_scope_id)
             or (p_scope_type = 'menu' and exists (select 1 from public.review_menus rm where rm.review_id = r.id and rm.menu_id = p_scope_id)))
    ) y
    where (not v_has_cursor or (y.k, y.created_at, y.id) < (v_after_k, v_after_at, v_after_id))
    order by y.k desc, y.created_at desc, y.id desc
    limit v_page_size + 1
  ) z;

  v_count := coalesce(cardinality(v_ids), 0);
  v_has_more := v_count > v_page_size;
  if v_has_more then
    v_ids := v_ids[1:v_page_size];
    v_ks := v_ks[1:v_page_size];
    v_ats := v_ats[1:v_page_size];
  end if;

  if cardinality(v_ids) > 0 then
    select coalesce(jsonb_agg(private.review_json(t.id, v_viewer, false) order by t.ord), '[]'::jsonb)
      into v_items
    from unnest(v_ids) with ordinality as t (id, ord);
  end if;

  if v_has_more then
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object(
        'scope', p_scope_type,
        'scopeId', p_scope_id,
        'sort', v_sort,
        'k', v_ks[cardinality(v_ks)],
        'createdAt', to_char(v_ats[cardinality(v_ats)] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'id', v_ids[cardinality(v_ids)]
      )::text, 'UTF8'), 'base64'), E'\n', '');
  end if;

  select jsonb_build_object('average', round(avg(r.craving_rating)::numeric, 1), 'count', count(*))
    into v_summary
  from public.reviews r
  where r.deleted_at is null
    and ((p_scope_type = 'store' and r.store_id = p_scope_id)
         or (p_scope_type = 'menu' and exists (select 1 from public.review_menus rm where rm.review_id = r.id and rm.menu_id = p_scope_id)));

  return jsonb_build_object(
    'items', v_items,
    'summary', v_summary,
    'hasMore', v_has_more,
    'nextCursor', v_next_cursor
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- list_my_reviews: 본인 활성 리뷰, 작성 최신순(created_at → id 내림차순). 수정해도 위로 올리지 않는다. 본인 화면이라 orderId가 있다.
-- ---------------------------------------------------------------------------

create function public.list_my_reviews(p_cursor text default null, p_page_size integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  v_ids uuid[];
  v_ats timestamptz[];
  v_count integer;
  v_has_more boolean;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT', detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      if jsonb_typeof(v_cursor) = 'object' then
        v_after_at := (v_cursor ->> 'createdAt')::timestamptz;
        v_after_id := (v_cursor ->> 'id')::uuid;
      end if;
    exception when others then
      v_after_at := null;
      v_after_id := null;
    end;
    if v_after_at is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT', detail = 'invalid cursor';
    end if;
  end if;

  select array_agg(x.id order by x.created_at desc, x.id desc),
         array_agg(x.created_at order by x.created_at desc, x.id desc)
    into v_ids, v_ats
  from (
    select r.id, r.created_at
    from public.reviews r
    where r.user_id = v_uid and r.deleted_at is null
      and (v_after_id is null or (r.created_at, r.id) < (v_after_at, v_after_id))
    order by r.created_at desc, r.id desc
    limit v_page_size + 1
  ) x;

  v_count := coalesce(cardinality(v_ids), 0);
  v_has_more := v_count > v_page_size;
  if v_has_more then
    v_ids := v_ids[1:v_page_size];
    v_ats := v_ats[1:v_page_size];
  end if;

  if cardinality(v_ids) > 0 then
    select coalesce(jsonb_agg(private.review_json(t.id, v_uid, true) order by t.ord), '[]'::jsonb)
      into v_items
    from unnest(v_ids) with ordinality as t (id, ord);
  end if;

  if v_has_more then
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object(
        'createdAt', to_char(v_ats[cardinality(v_ats)] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'id', v_ids[cardinality(v_ids)]
      )::text, 'UTF8'), 'base64'), E'\n', '');
  end if;

  return jsonb_build_object('items', v_items, 'hasMore', v_has_more, 'nextCursor', v_next_cursor);
end;
$$;

revoke execute on function public.get_review_eligibility(uuid) from public, anon, authenticated;
revoke execute on function public.create_review(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.update_review(uuid, uuid, bigint, integer, text) from public, anon, authenticated;
revoke execute on function public.delete_review(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.set_helpful(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.list_public_reviews(text, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.list_my_reviews(text, integer) from public, anon, authenticated;
grant execute on function public.get_review_eligibility(uuid) to authenticated;
grant execute on function public.create_review(uuid, uuid, integer, text) to authenticated;
grant execute on function public.update_review(uuid, uuid, bigint, integer, text) to authenticated;
grant execute on function public.delete_review(uuid, uuid, bigint) to authenticated;
grant execute on function public.set_helpful(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_public_reviews(text, uuid, text, text, integer) to anon, authenticated;
grant execute on function public.list_my_reviews(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 내역 행에 reviewEligibility 추가 (get_my_history_order 교체, signature 그대로. list_my_orders는 이 함수를 부르므로 함께 바뀐다)
-- ---------------------------------------------------------------------------

create or replace function public.get_my_history_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order jsonb;
  v_unread jsonb;
  v_menus jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 없거나 남의 주문이면 RESOURCE_NOT_FOUND (get_my_order가 던진다)
  v_order := public.get_my_order(p_order_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', u.id,
           'revision', u.revision,
           'createdAt', u.created_at
         ) order by u.revision), '[]'::jsonb)
    into v_unread
  from public.order_status_updates u
  join public.orders o on o.id = u.order_id
  where u.order_id = p_order_id and o.user_id = v_uid and u.viewed_at is null;

  -- 메뉴 · 가게 · 분류가 지금도 앱에서 열리는 것만 (카탈로그 RLS가 걸러 준다)
  select coalesce(jsonb_agg(x.menu_id order by x.first_line), '[]'::jsonb)
    into v_menus
  from (
    select i.menu_id, min(i.line_no) as first_line
    from public.order_items i
    join public.menus m on m.id = i.menu_id
    where i.order_id = p_order_id
    group by i.menu_id
  ) x;

  return v_order || jsonb_build_object(
    'unreadUpdates', v_unread,
    'validCurrentMenuRefs', v_menus,
    'reviewEligibility', public.get_review_eligibility(p_order_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 가게 카드 · 상세의 reviewSummary를 실제 집계로 교체 (아래는 기존 정의에서 reviewSummary 한 줄만 바꾼 create or replace)
--   reviewSummary = { count, averageCravingRating }  (활성 리뷰만, 0개면 count 0 · 평균 null)
-- ---------------------------------------------------------------------------

-- public.list_stores(  (원본: 20261001000200_catalog_contract_0_1.sql, 교체 )
create or replace function public.list_stores(
  p_category_id uuid default null,
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
  v_next_cursor text;
  v_favorites uuid[];
begin
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_after_name := v_cursor ->> 'name';
      v_after_id := (v_cursor ->> 'id')::uuid;
    exception when others then
      v_after_name := null;
    end;
    if v_after_name is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  select
    coalesce(jsonb_agg(card order by sort_name, sort_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select
      s.name as sort_name,
      s.id as sort_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id)
      ) as card
    from public.stores s
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
    where (p_category_id is null or s.category_id = p_category_id)
      and (v_after_name is null or (s.name, s.id) > (v_after_name, v_after_id))
    order by s.name, s.id
    limit v_page_size + 1
  ) page;

  if v_count > v_page_size then
    v_rows := v_rows - v_page_size;  -- 다음 페이지 확인용 1건 제거
    v_last := v_rows -> (v_page_size - 1);
    -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object('name', v_last ->> 'name', 'id', v_last ->> 'id')::text, 'UTF8'), 'base64'),
      E'\n', '');
  end if;

  if v_uid is not null then
    select array_agg(f.store_id) into v_favorites
    from public.store_favorites f
    where f.user_id = v_uid
      and f.store_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_rows) e);
  end if;

  select coalesce(jsonb_agg(
           e || jsonb_build_object('isFavorite',
             case when v_uid is null then null
                  else coalesce((e ->> 'id')::uuid = any (v_favorites), false) end)
           order by ord), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows) with ordinality as t (e, ord);

  return jsonb_build_object(
    'items', v_rows,
    'hasMore', v_next_cursor is not null,
    'nextCursor', v_next_cursor
  );
end;
$$;

-- public.get_store(  (원본: 20261001000200_catalog_contract_0_1.sql, 교체 )
create or replace function public.get_store(p_store_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store jsonb;
  v_is_favorite boolean;
begin
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'imageRef', s.image_ref,
    'isOpen', s.is_open,
    'isRecommended', s.is_recommended,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
    'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id),
    'menus', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'description', m.description,
          'imageRef', m.image_ref,
          'price', m.base_price,
          'isSoldOut', m.is_sold_out
        )
        order by m.sort_order, m.name, m.id
      )
      from public.menus m
      where m.store_id = s.id
    ), '[]'::jsonb)
  )
  into v_store
  from public.stores s
  join public.categories c on c.id = s.category_id
  where s.id = p_store_id;

  if v_store is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  if v_uid is not null then
    v_is_favorite := exists (
      select 1 from public.store_favorites f
      where f.user_id = v_uid and f.store_id = p_store_id
    );
  end if;

  return v_store || jsonb_build_object('isFavorite', v_is_favorite);
end;
$$;

-- public.list_my_favorites(  (원본: 20261001000200_catalog_contract_0_1.sql, 교체 )
create or replace function public.list_my_favorites(
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_after_at := (v_cursor ->> 'favoritedAt')::timestamptz;
      v_after_id := (v_cursor ->> 'id')::uuid;
    exception when others then
      v_after_at := null;
    end;
    if v_after_at is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  select
    coalesce(jsonb_agg(card order by fav_at desc, fav_id desc), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select
      f.created_at as fav_at,
      f.store_id as fav_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id),
        'isFavorite', true,
        'favoritedAt', f.created_at
      ) as card
    from public.store_favorites f
    join public.stores s on s.id = f.store_id
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
    where f.user_id = v_uid
      and (v_after_at is null or (f.created_at, f.store_id) < (v_after_at, v_after_id))
    order by f.created_at desc, f.store_id desc
    limit v_page_size + 1
  ) page;

  if v_count > v_page_size then
    v_rows := v_rows - v_page_size;
    v_last := v_rows -> (v_page_size - 1);
    return jsonb_build_object(
      'items', v_rows,
      'hasMore', true,
      'nextCursor', translate(encode(convert_to(
        jsonb_build_object('favoritedAt', v_last ->> 'favoritedAt', 'id', v_last ->> 'id')::text,
        'UTF8'), 'base64'), E'\n', '')
    );
  end if;

  return jsonb_build_object('items', v_rows, 'hasMore', false, 'nextCursor', null);
end;
$$;

-- public.search_stores(  (원본: 20261015000000_search_stores.sql, 교체 )
create or replace function public.search_stores(
  p_query text,
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_query text := btrim(coalesce(p_query, ''), E' \t\r\n');
  v_pattern text;
  v_cursor jsonb;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
  v_next_cursor text;
  v_favorites uuid[];
begin
  if char_length(v_query) < 1 or char_length(v_query) > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'query must be 1 to 50 characters after trimming';
  end if;

  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_after_name := v_cursor ->> 'name';
      v_after_id := (v_cursor ->> 'id')::uuid;
    exception when others then
      v_after_name := null;
    end;
    if v_after_name is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  -- LIKE 특수문자를 일반 글자로 만든다. 백슬래시를 먼저 바꿔야 뒤에 붙인 이스케이프가 다시 바뀌지 않는다.
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select
    coalesce(jsonb_agg(card order by sort_name, sort_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select
      s.name as sort_name,
      s.id as sort_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id),
        'matchingMenu', hit.menu
      ) as card
    from public.stores s
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
        and m.is_active
        and m.name ilike v_pattern
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) hit on true
    where s.is_active
      and c.is_active
      and (s.name ilike v_pattern or c.name ilike v_pattern or hit.menu is not null)
      and (v_after_name is null or (s.name, s.id) > (v_after_name, v_after_id))
    order by s.name, s.id
    limit v_page_size + 1
  ) page;

  if v_count > v_page_size then
    v_rows := v_rows - v_page_size;  -- 다음 페이지 확인용 1건 제거
    v_last := v_rows -> (v_page_size - 1);
    -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object('name', v_last ->> 'name', 'id', v_last ->> 'id')::text, 'UTF8'), 'base64'),
      E'\n', '');
  end if;

  if v_uid is not null then
    select array_agg(f.store_id) into v_favorites
    from public.store_favorites f
    where f.user_id = v_uid
      and f.store_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_rows) e);
  end if;

  select coalesce(jsonb_agg(
           e || jsonb_build_object('isFavorite',
             case when v_uid is null then null
                  else coalesce((e ->> 'id')::uuid = any (v_favorites), false) end)
           order by ord), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows) with ordinality as t (e, ord);

  return jsonb_build_object(
    'items', v_rows,
    'hasMore', v_next_cursor is not null,
    'nextCursor', v_next_cursor
  );
end;
$$;

-- public.list_recommended_stores(  (원본: 20261027000000_recommended_stores.sql, 교체 )
create or replace function public.list_recommended_stores(
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := coalesce(p_limit, 10);
  v_rows jsonb;
  v_favorites uuid[];
begin
  if v_limit < 1 or v_limit > 20 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'limit must be between 1 and 20';
  end if;

  select coalesce(jsonb_agg(card order by sort_name, sort_id), '[]'::jsonb)
  into v_rows
  from (
    select
      s.name as sort_name,
      s.id as sort_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id)
      ) as card
    from public.stores s
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
    where s.is_recommended
      and s.is_active
      and c.is_active
    order by s.name, s.id
    limit v_limit
  ) page;

  if v_uid is not null then
    select array_agg(f.store_id) into v_favorites
    from public.store_favorites f
    where f.user_id = v_uid
      and f.store_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_rows) e);
  end if;

  select coalesce(jsonb_agg(
           e || jsonb_build_object('isFavorite',
             case when v_uid is null then null
                  else coalesce((e ->> 'id')::uuid = any (v_favorites), false) end)
           order by ord), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows) with ordinality as t (e, ord);

  return v_rows;
end;
$$;

-- public.list_stores_by_ids(  (원본: 20261029000000_recent_items.sql, 교체 )
create or replace function public.list_stores_by_ids(
  p_store_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[] := coalesce(p_store_ids, '{}'::uuid[]);
  v_rows jsonb;
  v_favorites uuid[];
begin
  if cardinality(v_ids) > 10 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'at most 10 ids';
  end if;

  select coalesce(jsonb_agg(card order by ord), '[]'::jsonb)
  into v_rows
  from (
    select
      req.ord,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id)
      ) as card
    from (
      select u.id, min(u.ord) as ord
      from unnest(v_ids) with ordinality as u (id, ord)
      where u.id is not null
      group by u.id
    ) req
    join public.stores s on s.id = req.id
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
    where s.is_active
      and c.is_active
  ) page;

  if v_uid is not null then
    select array_agg(f.store_id) into v_favorites
    from public.store_favorites f
    where f.user_id = v_uid
      and f.store_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_rows) e);
  end if;

  select coalesce(jsonb_agg(
           e || jsonb_build_object('isFavorite',
             case when v_uid is null then null
                  else coalesce((e ->> 'id')::uuid = any (v_favorites), false) end)
           order by ord), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows) with ordinality as t (e, ord);

  return v_rows;
end;
$$;

