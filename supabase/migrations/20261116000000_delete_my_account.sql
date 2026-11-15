-- 회원 탈퇴: public.delete_my_account()
-- 근거: 서정 확정 2026-11-11 (탈퇴 시 사용자 데이터 삭제). 함수 이름 · 순서는 혜지 설계. 이미 적용된 migration은 수정하지 않는다.
--
-- 호출한 사용자 본인의 데이터를 한 트랜잭션에서 모두 지우고 Auth 계정(auth.users)까지 지운다. 응답은 {"deleted": true}뿐이다(개인정보 없음).
-- 모든 FK는 on delete restrict이고 CASCADE를 추가하지 않는다. 그래서 자식부터 정해진 순서로 직접 지운다.
--   review_helpful(이 사용자가 누른 것 + 이 사용자 리뷰에 달린 것)
--   → private.review_command_receipts(이 사용자 것 + 이 사용자 리뷰를 가리키는 것)
--   → review_menus → reviews(삭제 표시된 것 포함) → order_item_options → order_items → order_status_updates → orders
--   → store_favorites → profiles → auth.users
-- 각 단계: 지우기 전에 센 개수와 지운 개수가 다르면 예외로 전체 롤백한다(ACCOUNT_DELETE_COUNT_MISMATCH).
--
-- 오류: 로그인 없음 · 사용자 행이 이미 없음(탈퇴 뒤 재시도 등, 토큰은 아직 유효) → 둘 다 P0001 AUTH_REQUIRED. 그 밖의 정상 경로 오류는 없다.
--   (개수 불일치 · 호스팅 권한 부족 등 예상 못 한 실패는 예외로 전체 롤백된다. 아무것도 지워지지 않는다.)
--
-- SECURITY DEFINER인 이유: 앱(authenticated)은 이 테이블들에 쓰기 권한이 없고, auth.users는 앱이 건드릴 수 없다.
--   search_path는 ''로 고정하고 대상은 auth.uid()로만 정한다. authenticated만 실행할 수 있다(anon · PUBLIC 거부).
--
-- 잠금 순서 (교착 방지)
--   다른 함수들은 "주문 행 FOR UPDATE → (리뷰 행) → 리뷰 INSERT 때 profiles 행의 FK 공유 잠금" 순서로 잠근다(create_review 등).
--   여기서 profiles를 먼저 FOR UPDATE로 잡으면, create_review가 주문 행을 쥔 채 profiles를 기다리고 탈퇴는 profiles를 쥔 채
--   주문 행을 기다리는 교착이 생긴다. 그래서 이 사용자의 주문 행을 id 순으로 먼저 잠그고 → profiles FOR UPDATE → 이 사용자의 리뷰 행 FOR UPDATE 순서로 잠근다.
--   create_order는 profiles → 카탈로그 순서이고 기존 주문 행을 잠그지 않으므로 이 순서와 겹쳐도 교착이 없다.
--   리뷰 행 잠금은 set_helpful(리뷰 행 FOR SHARE)이 세는 도중에 끼어들어 개수가 어긋나는 것을 막는다.

create function public.delete_my_account()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_orders uuid[];
  v_items uuid[];
  v_reviews uuid[];
  v_exp_helpful bigint;
  v_exp_receipts bigint;
  v_exp_menus bigint;
  v_exp_reviews bigint;
  v_exp_options bigint;
  v_exp_items bigint;
  v_exp_updates bigint;
  v_exp_orders bigint;
  v_exp_favorites bigint;
  v_n bigint;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- ① 이 사용자의 주문 행을 id 순으로 먼저 잠근다 (다른 함수와 같은 방향, 위 설명 참고)
  select coalesce(array_agg(x.id order by x.id), '{}') into v_orders
  from (select o.id from public.orders o where o.user_id = v_uid order by o.id for update) x;

  -- ② 프로필 행 보장 + 잠금 (create_order와 같은 방식). 계정은 있는데 프로필이 아직 없으면 만들어서 같은 경로로 지운다.
  insert into public.profiles (id)
  select v_uid where exists (select 1 from auth.users u where u.id = v_uid)
  on conflict (id) do nothing;

  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then
    -- 사용자 행이 이미 없다 (탈퇴 뒤 재시도). 다른 오류를 내지 않는다.
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- ③ 이 사용자의 리뷰 행 잠금 (삭제 표시된 것 포함)
  select coalesce(array_agg(x.id order by x.id), '{}') into v_reviews
  from (select r.id from public.reviews r where r.user_id = v_uid order by r.id for update) x;

  select coalesce(array_agg(i.id), '{}') into v_items
  from public.order_items i where i.order_id = any (v_orders);

  -- 지우기 전에 센다
  select count(*) into v_exp_helpful from public.review_helpful h where h.user_id = v_uid or h.review_id = any (v_reviews);
  select count(*) into v_exp_receipts from private.review_command_receipts c
    where c.user_id = v_uid or c.applied_review_id = any (v_reviews) or c.target_id = any (v_reviews);
  select count(*) into v_exp_menus from public.review_menus m where m.review_id = any (v_reviews);
  v_exp_reviews := cardinality(v_reviews);
  select count(*) into v_exp_options from public.order_item_options op where op.order_item_id = any (v_items);
  v_exp_items := cardinality(v_items);
  select count(*) into v_exp_updates from public.order_status_updates s where s.order_id = any (v_orders);
  v_exp_orders := cardinality(v_orders);
  select count(*) into v_exp_favorites from public.store_favorites f where f.user_id = v_uid;

  -- 1) 도움돼요: 이 사용자가 누른 것 + 이 사용자 리뷰에 달린 것
  delete from public.review_helpful h where h.user_id = v_uid or h.review_id = any (v_reviews);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_helpful then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'review_helpful';
  end if;

  -- 2) 리뷰 영수증(멱등 키): 이 사용자 것 + 이 사용자 리뷰를 가리키는 것
  delete from private.review_command_receipts c
  where c.user_id = v_uid or c.applied_review_id = any (v_reviews) or c.target_id = any (v_reviews);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_receipts then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'review_command_receipts';
  end if;

  -- 3) 리뷰 메뉴
  delete from public.review_menus m where m.review_id = any (v_reviews);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_menus then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'review_menus';
  end if;

  -- 4) 리뷰 (삭제 표시된 것 포함)
  delete from public.reviews r where r.id = any (v_reviews);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_reviews then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'reviews';
  end if;

  -- 5) 주문 옵션
  delete from public.order_item_options op where op.order_item_id = any (v_items);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_options then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'order_item_options';
  end if;

  -- 6) 주문 항목
  delete from public.order_items i where i.id = any (v_items);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_items then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'order_items';
  end if;

  -- 7) 주문 상태 이력
  delete from public.order_status_updates s where s.order_id = any (v_orders);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_updates then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'order_status_updates';
  end if;

  -- 8) 주문 (orders_guard는 UPDATE 전용이라 DELETE를 막지 않는다. 트리거는 끄지 않는다)
  delete from public.orders o where o.id = any (v_orders);
  get diagnostics v_n = row_count;
  if v_n <> v_exp_orders then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'orders';
  end if;

  -- 9) 찜
  delete from public.store_favorites f where f.user_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n <> v_exp_favorites then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'store_favorites';
  end if;

  -- 10) 프로필
  delete from public.profiles p where p.id = v_uid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'profiles';
  end if;

  -- 11) Auth 계정. 호스팅(Supabase)에서 이 함수의 소유자가 auth.users를 지울 권한이 있는지는 로컬로 증명할 수 없다(보고서 "확인 필요").
  delete from auth.users u where u.id = v_uid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_COUNT_MISMATCH', detail = 'auth.users';
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
