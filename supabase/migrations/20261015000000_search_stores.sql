-- 검색: search_stores
-- 근거: docs/contracts/home-search-contract-draft.md 3.1절(호출·입력), 3.2절(매칭 메뉴), 6.2절(입력 규칙, 서정 확인 2026-10-08)
-- 응답 타입: SearchStoreCardDto = StoreCardDto + matchingMenu (계약 3.1절. src/contracts/에는 지우가 추가한다)
--
-- 규칙:
--   입력  = p_query를 앞뒤 공백을 지운 뒤 1~50자. null·빈 값·범위 밖이면 INVALID_INPUT.
--           중간 공백은 그대로 둔다("후라이드 치킨"은 통째로 부분 일치). 초성·오타 보정은 하지 않는다.
--   대상  = 가게 이름 / 메뉴 이름 / 카테고리 이름 중 하나라도 대소문자 무시 부분 일치.
--           % _ \ 는 일반 글자로 취급한다(이스케이프). 품절 메뉴도 검색 대상이다.
--   영업 종료 가게도 제외하지 않는다. isOpen=false로 내려가고 앱이 "준비 중" 배지를 붙인다 (계약 4.4절, 서정 확인 2026-10-14).
--   매칭 메뉴 = 검색어와 일치한 활성 메뉴 중 판매 가능 우선 → sort_order → 이름 → id 첫 메뉴. 모두 품절이면 같은 순서의 첫 메뉴(isSoldOut=true).
--               가게·카테고리 이름으로만 걸리면 null.
--   정렬·커서 = list_stores와 같다 (가게 이름 → id, 커서는 {name, id}의 base64). 같은 가게는 한 번만 나온다.
--   호출  = Guest(anon)와 로그인 사용자 모두. isFavorite는 list_stores와 같다 (Guest는 null).
--
-- SECURITY INVOKER: 호출자의 GRANT/RLS를 그대로 쓰므로 비활성 가게·메뉴·카테고리는 자동으로 숨는다.
-- 아래 where의 is_active 조건은 RLS가 바뀌어도 새지 않도록 한 번 더 건 것이다.

create function public.search_stores(
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
        'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null),
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

revoke execute on function public.search_stores(text, text, integer) from public, anon, authenticated;
grant execute on function public.search_stores(text, text, integer) to anon, authenticated;
