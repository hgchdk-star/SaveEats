-- 홈 "지금 많이 찾는 메뉴": list_popular_menus
-- 근거: docs/contracts/home-search-contract-draft.md 4.4절(응답 모양), 6.1절(기준, 서정 승인 2026-10-08)
--
-- 기준:
--   대상  = is_popular = true 이고, 메뉴·가게·카테고리가 모두 활성이고, 품절이 아니고, 가게가 영업 중(is_open = true)인 메뉴
--   정렬  = popularity_score 내림차순 → 이름 → id
--   개수  = p_limit (1~20, 기본 10). 범위 밖이면 INVALID_INPUT
--   응답  = MenuCardDto 배열 (4.3절과 같은 모양). 점수·순위 숫자는 내려주지 않는다 (FR-HOME-005, FR-DATA-024)
--   호출  = Guest(anon)와 로그인 사용자 모두
--
-- 영업 종료 가게 메뉴를 뺀 것은 문서에 명시돼 있지 않던 결정이다 (혜지 확인 2026-10-14).
-- 영업 종료 가게 메뉴는 담을 수 없으므로, 품절 메뉴를 뺀 이유(담을 수 없는 메뉴를 홈에서 권하지 않기)와 같다.
-- 계약 문서 4.4절에 이 한 줄을 추가하는 것은 docs 담당(서정)이 반영한다.
--
-- SECURITY DEFINER인 이유: is_popular·popularity_score는 앱(anon/authenticated)이 직접 읽을 수 없는 컬럼이다
-- (catalog_read.sql의 공개 컬럼 GRANT에 없음). 호출자 권한(INVOKER)으로는 이 컬럼으로 고르고 정렬할 수 없다.
-- DEFINER 함수는 RLS를 우회하므로, 활성 여부 조건을 함수 안에서 직접 건다 (SEC-004).
-- 반환하는 값은 공개 컬럼뿐이다.

create function public.list_popular_menus(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := coalesce(p_limit, 10);
begin
  if v_limit < 1 or v_limit > 20 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'limit must be between 1 and 20';
  end if;

  return coalesce((
    select jsonb_agg(page.card order by page.ord)
    from (
      select
        row_number() over (order by m.popularity_score desc, m.name, m.id) as ord,
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'imageRef', m.image_ref,
          'price', m.base_price,
          'isSoldOut', m.is_sold_out,
          'store', jsonb_build_object('id', s.id, 'name', s.name, 'isOpen', s.is_open)
        ) as card
      from public.menus m
      join public.stores s on s.id = m.store_id
      join public.categories c on c.id = s.category_id
      where m.is_popular
        and m.is_active
        and not m.is_sold_out
        and s.is_active
        and s.is_open
        and c.is_active
      order by m.popularity_score desc, m.name, m.id
      limit v_limit
    ) page
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.list_popular_menus(integer) from public, anon, authenticated;
grant execute on function public.list_popular_menus(integer) to anon, authenticated;
