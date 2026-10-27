-- 홈 추천 가게: list_recommended_stores
-- 근거: docs/contracts/home-search-contract-draft.md 4.2절 (혜지 제안, 2026-10-27 추천안으로 진행. 서정 확인은 영업 종료 포함 여부)
-- 응답 타입: StoreCardDto[] (catalog@0.1, list_stores의 items와 같은 모양)
--
-- 규칙:
--   대상  = is_recommended = true 이고 가게·카테고리가 모두 활성인 가게.
--   영업 종료 가게도 제외하지 않는다. isOpen=false로 내려가고 앱이 "준비 중" 배지를 붙인다 (계약 4.4절의 목록·검색 규칙과 같다).
--   정렬  = 가게 이름 → id 오름차순. 페이지네이션은 하지 않는다.
--   개수  = p_limit 1~20, 기본 10. null이면 기본값. 범위 밖이면 INVALID_INPUT (보정하지 않는다).
--   호출  = Guest(anon)와 로그인 사용자 모두. isFavorite는 list_stores와 같다 (Guest는 null).
--   결과가 없으면 빈 배열 [] (오류 아님). 앱은 섹션을 숨긴다.
--
-- SECURITY INVOKER: 호출자의 GRANT/RLS를 그대로 쓴다. is_recommended는 앱이 직접 읽을 수 있는 컬럼이다.
-- 아래 where의 is_active 조건은 RLS가 바뀌어도 새지 않도록 한 번 더 건 것이다.

create function public.list_recommended_stores(
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
        'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null)
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

revoke execute on function public.list_recommended_stores(integer) from public, anon, authenticated;
grant execute on function public.list_recommended_stores(integer) to anon, authenticated;
