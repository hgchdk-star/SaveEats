-- 홈 최근 본 항목: list_stores_by_ids, list_menu_cards_by_ids
-- 근거: docs/contracts/home-search-contract-draft.md 4.3절 (혜지 제안, 2026-10-29 추천안으로 진행. 서정 확인 권장: 품절·영업 종료 메뉴 포함)
-- 응답 타입: StoreCardDto[] (list_stores의 items와 같은 모양), MenuCardDto[] (list_popular_menus와 같은 모양)
--
-- 규칙 (두 함수 공통):
--   입력  = id 배열. 길이가 10을 넘으면 INVALID_INPUT (중복·null 원소를 센 원래 길이 기준).
--           null 배열·빈 배열은 [] (오류 아님). null 원소는 무시한다. 같은 id가 여러 번 오면 처음 나온 자리에 한 번만 남긴다.
--   순서  = 요청한 id 순서를 유지한다.
--   누락  = 없는 id, 비활성(가게·카테고리·메뉴) 항목은 응답에서 빠진다. RESOURCE_NOT_FOUND를 내지 않는다.
--           앱이 응답에 없는 id를 로컬 기록에서 지우므로, 일시적인 상태(품절·영업 종료)로는 빼지 않는다.
--   포함  = 품절 메뉴는 isSoldOut=true, 영업 종료 가게(의 메뉴)는 isOpen=false로 표시해서 포함한다.
--           (홈 인기 메뉴는 "권하는" 자리라 이 둘을 빼지만, 최근 본 항목은 "내가 본 기록"이라 지우지 않는다.)
--   호출  = Guest(anon)와 로그인 사용자 모두. 가게 카드의 isFavorite는 list_stores와 같다 (Guest는 null).
--
-- SECURITY INVOKER: 호출자의 GRANT/RLS를 그대로 쓴다. 숨겨진 컬럼(is_popular 등)이 필요 없어서 DEFINER가 아니다.
-- 아래 where의 is_active 조건은 RLS가 바뀌어도 새지 않도록 한 번 더 건 것이다.

create function public.list_stores_by_ids(
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
        'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null)
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

create function public.list_menu_cards_by_ids(
  p_menu_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_menu_ids, '{}'::uuid[]);
begin
  if cardinality(v_ids) > 10 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'at most 10 ids';
  end if;

  return coalesce((
    select jsonb_agg(page.card order by page.ord)
    from (
      select
        req.ord,
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'imageRef', m.image_ref,
          'price', m.base_price,
          'isSoldOut', m.is_sold_out,
          'store', jsonb_build_object('id', s.id, 'name', s.name, 'isOpen', s.is_open)
        ) as card
      from (
        select u.id, min(u.ord) as ord
        from unnest(v_ids) with ordinality as u (id, ord)
        where u.id is not null
        group by u.id
      ) req
      join public.menus m on m.id = req.id
      join public.stores s on s.id = m.store_id
      join public.categories c on c.id = s.category_id
      where m.is_active
        and s.is_active
        and c.is_active
    ) page
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.list_stores_by_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.list_stores_by_ids(uuid[]) to anon, authenticated;
revoke execute on function public.list_menu_cards_by_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.list_menu_cards_by_ids(uuid[]) to anon, authenticated;
