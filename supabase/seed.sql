-- 개발용 카탈로그 Seed (dev-seed-v1)
-- 근거: 개발 명세 OPS-003, OPS-004, DB-004 / PRD FR-CAT-001, FR-DATA-020~026
--
-- ⚠️ 로컬/테스트 전용 가상 데이터입니다. 실제 서비스 Seed가 아닙니다.
--   - 팀 합의(2026-10-01): 구현 우선, 실제 데이터(OPEN-DB-009) 확정 전까지 가상 데이터 사용.
--   - 가게·메뉴 이름은 모두 가상이며 실제 브랜드를 쓰지 않습니다.
--   - 이미지(image_ref)는 넣지 않았습니다(출처·사용권 미검토). 앱은 중립 Placeholder 표시.
--   - 가짜 주문수/리뷰수/땡김도 평균은 넣지 않습니다.
--   - 카테고리는 PRD FR-CAT-001 후보 목록입니다('전체'는 UI 상태라 행으로 만들지 않음).
--
-- 1부 QA 데이터: 영업 종료 가게, 비활성 가게, 비활성 카테고리의 가게, 품절 메뉴, 비활성 메뉴,
--   필수 단일 선택 그룹, 선택 복수 그룹, 품절 옵션, 비활성 옵션, 비활성 그룹, 옵션 없는 메뉴.
-- 2부 탐색용 가상 데이터: 카테고리별 가게 2곳 + 메뉴 없는 가게 1곳.
--
-- 재적용 가능(upsert). 순서: categories → stores → menus → groups → options.
-- 1부 ID 규칙: 1… 카테고리 / 2… 가게 / 3… 메뉴 / 4… 옵션 그룹 / 5… 옵션
-- 2부 ID 규칙: md5('dev-seed-v1:<종류>:<키>')::uuid (키가 같으면 항상 같은 UUID)

-- ===========================================================================
-- 1부. QA 데이터
-- ===========================================================================

insert into public.categories (id, code, name, sort_order, is_active) values
  ('10000000-0000-4000-8000-000000000001', 'chicken',      '치킨',        10, true),
  ('10000000-0000-4000-8000-000000000002', 'bunsik',       '분식',        20, true),
  ('10000000-0000-4000-8000-000000000003', 'pizza',        '피자',        30, true),
  ('10000000-0000-4000-8000-000000000004', 'korean',       '한식',        40, true),
  ('10000000-0000-4000-8000-000000000005', 'chinese',      '중식',        50, true),
  ('10000000-0000-4000-8000-000000000006', 'japanese',     '일식',        60, true),
  ('10000000-0000-4000-8000-000000000007', 'burger',       '버거',        70, true),
  ('10000000-0000-4000-8000-000000000008', 'cafe_dessert', '카페·디저트', 80, true),
  ('10000000-0000-4000-8000-000000000099', 'qa_inactive',  'QA 비활성 카테고리', 990, false)
on conflict (id) do update set
  code = excluded.code, name = excluded.name,
  sort_order = excluded.sort_order, is_active = excluded.is_active;

insert into public.stores
  (id, category_id, name, description, is_active, is_open, is_recommended, source_type, source_ref)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '테스트 치킨집', '옵션·품절 QA용 개발 가게', true, true, true, 'SEED', 'dev-seed-v1:store-chicken'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   '테스트 분식집', '개발용 가게', true, true, false, 'SEED', 'dev-seed-v1:store-bunsik'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003',
   '테스트 피자집', '영업 종료(is_open=false) QA용 개발 가게', true, false, false, 'SEED', 'dev-seed-v1:store-pizza'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004',
   '테스트 한식집', '개발용 가게', true, true, true, 'SEED', 'dev-seed-v1:store-korean'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005',
   '테스트 중식집', '개발용 가게', true, true, false, 'SEED', 'dev-seed-v1:store-chinese'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006',
   '테스트 일식집', '개발용 가게', true, true, false, 'SEED', 'dev-seed-v1:store-japanese'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007',
   '테스트 버거집', '개발용 가게', true, true, false, 'SEED', 'dev-seed-v1:store-burger'),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008',
   '테스트 카페', '개발용 가게', true, true, false, 'SEED', 'dev-seed-v1:store-cafe'),
  ('20000000-0000-4000-8000-000000000098', '10000000-0000-4000-8000-000000000001',
   'QA 비활성 가게', '조회되면 안 됨', false, true, false, 'SEED', 'dev-seed-v1:qa-inactive-store'),
  ('20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000099',
   'QA 비활성 카테고리 가게', '가게는 활성이지만 카테고리가 비활성이라 조회되면 안 됨', true, true, false, 'SEED', 'dev-seed-v1:qa-inactive-category-store')
on conflict (id) do update set
  category_id = excluded.category_id, name = excluded.name, description = excluded.description,
  is_active = excluded.is_active, is_open = excluded.is_open, is_recommended = excluded.is_recommended,
  source_type = excluded.source_type, source_ref = excluded.source_ref;

insert into public.menus
  (id, store_id, name, description, base_price, is_active, is_sold_out, sort_order)
values
  -- 테스트 치킨집: 옵션/품절/비활성 QA
  ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000001',
   '후라이드치킨', '필수 단일 선택 + 선택 복수 옵션', 18000, true, false, 10),
  ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000001',
   '양념치킨', '필수 단일 선택 옵션', 19000, true, false, 20),
  ('30000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000001',
   '반반치킨', '품절 메뉴 QA', 20000, true, true, 30),
  ('30000000-0000-4000-8000-000000000104', '20000000-0000-4000-8000-000000000001',
   '콜라 1.25L', '옵션 없는 메뉴', 2500, true, false, 40),
  ('30000000-0000-4000-8000-000000000105', '20000000-0000-4000-8000-000000000001',
   'QA 비활성 메뉴', '조회되면 안 됨', 15000, false, false, 50),
  -- 테스트 분식집
  ('30000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000002',
   '떡볶이', '맵기 필수 선택', 5000, true, false, 10),
  ('30000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000002',
   '김밥', null, 3500, true, false, 20),
  -- 테스트 피자집 (영업 종료)
  ('30000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000003',
   '페퍼로니 피자', '사이즈 필수 선택', 21000, true, false, 10),
  -- 테스트 한식집
  ('30000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000004',
   '김치찌개', null, 9000, true, false, 10),
  ('30000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000004',
   '제육볶음', '공깃밥 추가 선택', 10000, true, false, 20),
  -- 테스트 중식집
  ('30000000-0000-4000-8000-000000000501', '20000000-0000-4000-8000-000000000005',
   '짜장면', null, 7000, true, false, 10),
  ('30000000-0000-4000-8000-000000000502', '20000000-0000-4000-8000-000000000005',
   '짬뽕', null, 8500, true, false, 20),
  -- 테스트 일식집
  ('30000000-0000-4000-8000-000000000601', '20000000-0000-4000-8000-000000000006',
   '돈카츠 정식', null, 11000, true, false, 10),
  -- 테스트 버거집
  ('30000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000007',
   '치즈버거', '세트 변경 선택', 6500, true, false, 10),
  -- 테스트 카페
  ('30000000-0000-4000-8000-000000000801', '20000000-0000-4000-8000-000000000008',
   '아메리카노', '온도 필수 선택', 4000, true, false, 10),
  ('30000000-0000-4000-8000-000000000802', '20000000-0000-4000-8000-000000000008',
   '치즈케이크', null, 6000, true, false, 20),
  -- QA 비활성 가게 / 비활성 카테고리 가게의 메뉴 (부모가 숨겨져 조회되면 안 됨)
  ('30000000-0000-4000-8000-000000009801', '20000000-0000-4000-8000-000000000098',
   'QA 숨김 메뉴 A', null, 10000, true, false, 10),
  ('30000000-0000-4000-8000-000000009901', '20000000-0000-4000-8000-000000000099',
   'QA 숨김 메뉴 B', null, 10000, true, false, 10)
on conflict (id) do update set
  store_id = excluded.store_id, name = excluded.name, description = excluded.description,
  base_price = excluded.base_price, is_active = excluded.is_active,
  is_sold_out = excluded.is_sold_out, sort_order = excluded.sort_order;

insert into public.menu_option_groups
  (id, menu_id, name, min_select, max_select, sort_order, is_active)
values
  ('40000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', '부위 선택', 1, 1, 10, true),
  ('40000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000101', '소스 추가', 0, 2, 20, true),
  ('40000000-0000-4000-8000-000000000103', '30000000-0000-4000-8000-000000000101', 'QA 비활성 그룹', 0, 1, 30, false),
  ('40000000-0000-4000-8000-000000000104', '30000000-0000-4000-8000-000000000102', '부위 선택', 1, 1, 10, true),
  ('40000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000201', '맵기', 1, 1, 10, true),
  ('40000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000301', '사이즈', 1, 1, 10, true),
  ('40000000-0000-4000-8000-000000000402', '30000000-0000-4000-8000-000000000402', '추가', 0, 1, 10, true),
  ('40000000-0000-4000-8000-000000000701', '30000000-0000-4000-8000-000000000701', '세트 변경', 0, 1, 10, true),
  ('40000000-0000-4000-8000-000000000801', '30000000-0000-4000-8000-000000000801', '온도', 1, 1, 10, true)
on conflict (id) do update set
  menu_id = excluded.menu_id, name = excluded.name, min_select = excluded.min_select,
  max_select = excluded.max_select, sort_order = excluded.sort_order, is_active = excluded.is_active;

insert into public.menu_options
  (id, group_id, name, additional_price, is_active, is_sold_out, sort_order)
values
  -- 후라이드치킨: 부위 선택(필수 1)
  ('50000000-0000-4000-8000-000000001011', '40000000-0000-4000-8000-000000000101', '뼈',   0,    true, false, 10),
  ('50000000-0000-4000-8000-000000001012', '40000000-0000-4000-8000-000000000101', '순살', 2000, true, false, 20),
  -- 후라이드치킨: 소스 추가(선택 0~2, 품절/비활성 포함)
  ('50000000-0000-4000-8000-000000001021', '40000000-0000-4000-8000-000000000102', '양념소스',     500, true,  false, 10),
  ('50000000-0000-4000-8000-000000001022', '40000000-0000-4000-8000-000000000102', '치즈소스',     500, true,  true,  20),
  ('50000000-0000-4000-8000-000000001023', '40000000-0000-4000-8000-000000000102', 'QA 비활성 소스', 500, false, false, 30),
  -- 후라이드치킨: 비활성 그룹의 옵션
  ('50000000-0000-4000-8000-000000001031', '40000000-0000-4000-8000-000000000103', 'QA 숨김 옵션', 0, true, false, 10),
  -- 양념치킨: 부위 선택(필수 1)
  ('50000000-0000-4000-8000-000000001041', '40000000-0000-4000-8000-000000000104', '뼈',   0,    true, false, 10),
  ('50000000-0000-4000-8000-000000001042', '40000000-0000-4000-8000-000000000104', '순살', 2000, true, false, 20),
  -- 떡볶이: 맵기
  ('50000000-0000-4000-8000-000000002011', '40000000-0000-4000-8000-000000000201', '순한맛', 0, true, false, 10),
  ('50000000-0000-4000-8000-000000002012', '40000000-0000-4000-8000-000000000201', '보통맛', 0, true, false, 20),
  ('50000000-0000-4000-8000-000000002013', '40000000-0000-4000-8000-000000000201', '매운맛', 0, true, false, 30),
  -- 페퍼로니 피자: 사이즈
  ('50000000-0000-4000-8000-000000003011', '40000000-0000-4000-8000-000000000301', 'M', 0,    true, false, 10),
  ('50000000-0000-4000-8000-000000003012', '40000000-0000-4000-8000-000000000301', 'L', 4000, true, false, 20),
  -- 제육볶음: 추가
  ('50000000-0000-4000-8000-000000004021', '40000000-0000-4000-8000-000000000402', '공깃밥 추가', 1000, true, false, 10),
  -- 치즈버거: 세트 변경
  ('50000000-0000-4000-8000-000000007011', '40000000-0000-4000-8000-000000000701', '세트로 변경', 2500, true, false, 10),
  -- 아메리카노: 온도
  ('50000000-0000-4000-8000-000000008011', '40000000-0000-4000-8000-000000000801', 'HOT', 0,   true, false, 10),
  ('50000000-0000-4000-8000-000000008012', '40000000-0000-4000-8000-000000000801', 'ICE', 500, true, false, 20)
on conflict (id) do update set
  group_id = excluded.group_id, name = excluded.name, additional_price = excluded.additional_price,
  is_active = excluded.is_active, is_sold_out = excluded.is_sold_out, sort_order = excluded.sort_order;

-- ===========================================================================
-- 2부. 탐색용 가상 데이터
-- ===========================================================================

-- 가게: (키, 카테고리 code, 이름, 소개, 영업 중, 추천)
with v (store_key, category_code, name, description, is_open, is_recommended) as (values
  ('chicken-afternoon', 'chicken',      '바삭한오후 치킨', '얇은 튀김옷의 바삭한 치킨',       true,  true),
  ('chicken-alley',     'chicken',      '골목닭강정',      '달콤한 소스의 닭강정',             true,  false),
  ('bunsik-malang',     'bunsik',       '말랑떡방',        '쫄깃한 떡볶이와 튀김',             true,  true),
  ('bunsik-roll',       'bunsik',       '한줄김밥상회',    '든든한 김밥과 면 요리',            true,  false),
  ('pizza-oven',        'pizza',        '화덕한판',        '화덕에서 굽는 얇은 도우 피자',     true,  false),
  ('pizza-double',      'pizza',        '두판피자',        '토핑 넉넉한 미국식 피자',          false, false),
  ('korean-table',      'korean',       '집밥한상',        '매일 바뀌는 집밥 정식',            true,  false),
  ('korean-gukbap',     'korean',       '국밥한그릇',      '진한 국물의 돼지국밥',             true,  true),
  ('chinese-lantern',   'chinese',      '홍등반점',        '불맛 나는 중화요리',               true,  false),
  ('chinese-mala',      'chinese',      '마라공방',        '맵기와 토핑을 고르는 마라 요리',   true,  true),
  ('japanese-sushi',    'japanese',     '스시하루',        '그날 손질한 초밥',                 true,  false),
  ('japanese-ramen',    'japanese',     '라멘야 유우',     '진한 육수의 라멘',                 true,  false),
  ('burger-grill',      'burger',       '그릴스탠드',      '직화로 굽는 패티',                 true,  true),
  ('burger-craft',      'burger',       '수제버거공방',    '두툼한 수제 패티 버거',            true,  false),
  ('cafe-afternoon',    'cafe_dessert', '오후의커피',      '직접 로스팅한 원두 커피',          true,  false),
  ('cafe-sweet',        'cafe_dessert', '달콤제과',        '케이크와 구움과자',                true,  false),
  ('qa-empty-menu',     'cafe_dessert', '메뉴 준비 중인 가게', 'QA: 활성 메뉴가 하나도 없는 가게', true, false)
)
insert into public.stores
  (id, category_id, name, description, is_active, is_open, is_recommended, source_type, source_ref)
select
  md5('dev-seed-v1:store:' || v.store_key)::uuid, c.id, v.name, v.description,
  true, v.is_open, v.is_recommended, 'SEED', 'dev-seed-v1:' || v.store_key
from v
join public.categories c on c.code = v.category_code
on conflict (id) do update set
  category_id = excluded.category_id, name = excluded.name, description = excluded.description,
  is_active = excluded.is_active, is_open = excluded.is_open, is_recommended = excluded.is_recommended,
  source_type = excluded.source_type, source_ref = excluded.source_ref;

-- 메뉴: (가게 키, 메뉴 키, 이름, 설명, 기본가격, 정렬, 품절)
with v (store_key, menu_key, name, description, base_price, sort_order, is_sold_out) as (values
  ('chicken-afternoon', 'ca-fried',     '오후 후라이드',     '바삭한 기본 후라이드',     17000, 10, false),
  ('chicken-afternoon', 'ca-soy',       '간장치킨',          '단짠 간장 소스',           18500, 20, false),
  ('chicken-afternoon', 'ca-nugget',    '치킨너겟',          null,                        6000, 30, false),
  ('chicken-afternoon', 'ca-fries',     '감자튀김',          null,                        3500, 40, false),
  ('chicken-alley',     'cl-gangjeong', '닭강정',            '사이즈 선택',              12000, 10, false),
  ('chicken-alley',     'cl-boneless',  '순살 닭강정',       null,                       14000, 20, false),
  ('chicken-alley',     'cl-tteok',     '떡꼬치',            null,                        3000, 30, false),
  ('chicken-alley',     'cl-cider',     '사이다 500ml',      null,                        2000, 40, false),
  ('bunsik-malang',     'bm-rose',      '로제떡볶이',        '맵기 선택',                 7000, 10, false),
  ('bunsik-malang',     'bm-sundae',    '순대',              null,                        4500, 20, false),
  ('bunsik-malang',     'bm-twigim',    '모둠튀김',          null,                        5000, 30, false),
  ('bunsik-malang',     'bm-eomuk',     '어묵탕',            null,                        4000, 40, false),
  ('bunsik-roll',       'br-tuna',      '참치김밥',          null,                        4500, 10, false),
  ('bunsik-roll',       'br-cheese',    '치즈김밥',          null,                        4500, 20, false),
  ('bunsik-roll',       'br-rabokki',   '라볶이',            null,                        6000, 30, false),
  ('bunsik-roll',       'br-jjolmyeon', '쫄면',              null,                        6500, 40, true),
  ('pizza-oven',        'po-margherita','마르게리타',        '사이즈 선택',              18000, 10, false),
  ('pizza-oven',        'po-gorgonzola','고르곤졸라',        '꿀 포함',                  16000, 20, false),
  ('pizza-oven',        'po-salad',     '콘샐러드',          null,                        4000, 30, false),
  ('pizza-oven',        'po-garlic',    '갈릭디핑소스',      null,                         500, 40, false),
  ('pizza-double',      'pd-bulgogi',   '불고기피자',        '사이즈 선택',              19000, 10, false),
  ('pizza-double',      'pd-potato',    '포테이토피자',      '사이즈 선택',              19000, 20, false),
  ('pizza-double',      'pd-spaghetti', '치즈오븐스파게티',  null,                        7500, 30, false),
  ('pizza-double',      'pd-cola',      '콜라 1.25L',        null,                        2000, 40, false),
  ('korean-table',      'kt-doenjang',  '된장찌개',          null,                        8500, 10, false),
  ('korean-table',      'kt-bulgogi',   '불고기정식',        null,                       12000, 20, false),
  ('korean-table',      'kt-egg',       '계란말이',          null,                        6000, 30, true),
  ('korean-table',      'kt-rice',      '공깃밥',            null,                        1000, 40, false),
  ('korean-gukbap',     'kg-pork',      '돼지국밥',          '양념 선택',                 9000, 10, false),
  ('korean-gukbap',     'kg-sundae',    '순대국밥',          '양념 선택',                 9500, 20, false),
  ('korean-gukbap',     'kg-suyuk',     '수육 (소)',         null,                       15000, 30, false),
  ('korean-gukbap',     'kg-rice',      '공깃밥',            null,                        1000, 40, false),
  ('chinese-lantern',   'cn-ganjjajang','간짜장',            null,                        8000, 10, false),
  ('chinese-lantern',   'cn-tangsuyuk', '탕수육 (소)',       '소스 방식 선택',           16000, 20, false),
  ('chinese-lantern',   'cn-friedrice', '볶음밥',            null,                        8000, 30, false),
  ('chinese-lantern',   'cn-mandu',     '군만두',            null,                        5000, 40, false),
  ('chinese-mala',      'cm-malatang',  '마라탕',            '맵기 필수, 토핑 최대 3개', 9000, 10, false),
  ('chinese-mala',      'cm-guobaorou', '꿔바로우',          null,                       17000, 20, false),
  ('chinese-mala',      'cm-xiangguo',  '마라샹궈',          '맵기 선택',                18000, 30, false),
  ('chinese-mala',      'cm-eggrice',   '계란볶음밥',        null,                        7000, 40, false),
  ('japanese-sushi',    'js-moum',      '모둠초밥 12p',      null,                       15000, 10, false),
  ('japanese-sushi',    'js-salmon',    '연어초밥 10p',      null,                       16000, 20, false),
  ('japanese-sushi',    'js-udon',      '우동',              null,                        7000, 30, false),
  ('japanese-sushi',    'js-miso',      '미소된장국',        null,                        2000, 40, false),
  ('japanese-ramen',    'jr-tonkotsu',  '돈코츠라멘',        '토핑 추가 가능',           10000, 10, false),
  ('japanese-ramen',    'jr-shoyu',     '쇼유라멘',          '토핑 추가 가능',            9500, 20, false),
  ('japanese-ramen',    'jr-chashu',    '차슈덮밥',          null,                        9000, 30, false),
  ('japanese-ramen',    'jr-gyoza',     '교자 5p',           null,                        5000, 40, false),
  ('burger-grill',      'bg-classic',   '클래식버거',        '세트 변경 가능',            7500, 10, false),
  ('burger-grill',      'bg-bacon',     '베이컨치즈버거',    '세트 변경 가능',            8900, 20, false),
  ('burger-grill',      'bg-fries',     '감자튀김',          null,                        3000, 30, false),
  ('burger-grill',      'bg-shake',     '밀크쉐이크',        null,                        4500, 40, false),
  ('burger-craft',      'bc-double',    '더블패티버거',      null,                       11000, 10, false),
  ('burger-craft',      'bc-avocado',   '아보카도버거',      null,                       10500, 20, false),
  ('burger-craft',      'bc-onion',     '어니언링',          null,                        4000, 30, false),
  ('burger-craft',      'bc-lemonade',  '레모네이드',        null,                        4000, 40, false),
  ('cafe-afternoon',    'cf-latte',     '카페라떼',          '온도 필수, 샷 추가 가능',   4800, 10, false),
  ('cafe-afternoon',    'cf-vanilla',   '바닐라라떼',        '온도 필수',                 5300, 20, false),
  ('cafe-afternoon',    'cf-croffle',   '크로플',            null,                        5500, 30, false),
  ('cafe-afternoon',    'cf-tiramisu',  '티라미수',          null,                        6500, 40, false),
  ('cafe-sweet',        'cs-strawberry','딸기케이크',        null,                        7000, 10, false),
  ('cafe-sweet',        'cs-macaron',   '마카롱 3개',        null,                        7500, 20, false),
  ('cafe-sweet',        'cs-saltbread', '소금빵',            null,                        3500, 30, false),
  ('cafe-sweet',        'cs-milktea',   '밀크티',            '온도 필수',                 5000, 40, false)
)
insert into public.menus
  (id, store_id, name, description, base_price, is_active, is_sold_out, sort_order)
select
  md5('dev-seed-v1:menu:' || v.menu_key)::uuid, md5('dev-seed-v1:store:' || v.store_key)::uuid,
  v.name, v.description, v.base_price, true, v.is_sold_out, v.sort_order
from v
on conflict (id) do update set
  store_id = excluded.store_id, name = excluded.name, description = excluded.description,
  base_price = excluded.base_price, is_active = excluded.is_active,
  is_sold_out = excluded.is_sold_out, sort_order = excluded.sort_order;

-- 옵션 그룹: (메뉴 키, 그룹 키, 이름, 최소, 최대, 정렬)
with v (menu_key, group_key, name, min_select, max_select, sort_order) as (values
  ('cl-gangjeong',  'cl-gangjeong-size',  '사이즈',    1, 1, 10),
  ('bm-rose',       'bm-rose-spicy',      '맵기',      1, 1, 10),
  ('po-margherita', 'po-margherita-size', '사이즈',    1, 1, 10),
  ('pd-bulgogi',    'pd-bulgogi-size',    '사이즈',    1, 1, 10),
  ('pd-potato',     'pd-potato-size',     '사이즈',    1, 1, 10),
  ('kg-pork',       'kg-pork-sauce',      '양념',      1, 1, 10),
  ('kg-sundae',     'kg-sundae-sauce',    '양념',      1, 1, 10),
  ('cn-tangsuyuk',  'cn-tangsuyuk-sauce', '소스 방식', 1, 1, 10),
  ('cm-malatang',   'cm-malatang-spicy',  '맵기',      1, 1, 10),
  ('cm-malatang',   'cm-malatang-topping','토핑 추가', 0, 3, 20),
  ('cm-xiangguo',   'cm-xiangguo-spicy',  '맵기',      1, 1, 10),
  ('jr-tonkotsu',   'jr-tonkotsu-topping','토핑 추가', 0, 2, 10),
  ('jr-shoyu',      'jr-shoyu-topping',   '토핑 추가', 0, 2, 10),
  ('bg-classic',    'bg-classic-set',     '세트 변경', 0, 1, 10),
  ('bg-bacon',      'bg-bacon-set',       '세트 변경', 0, 1, 10),
  ('cf-latte',      'cf-latte-temp',      '온도',      1, 1, 10),
  ('cf-latte',      'cf-latte-shot',      '샷 추가',   0, 2, 20),
  ('cf-vanilla',    'cf-vanilla-temp',    '온도',      1, 1, 10),
  ('cs-milktea',    'cs-milktea-temp',    '온도',      1, 1, 10)
)
insert into public.menu_option_groups
  (id, menu_id, name, min_select, max_select, sort_order, is_active)
select
  md5('dev-seed-v1:group:' || v.group_key)::uuid, md5('dev-seed-v1:menu:' || v.menu_key)::uuid,
  v.name, v.min_select, v.max_select, v.sort_order, true
from v
on conflict (id) do update set
  menu_id = excluded.menu_id, name = excluded.name, min_select = excluded.min_select,
  max_select = excluded.max_select, sort_order = excluded.sort_order, is_active = excluded.is_active;

-- 옵션: (그룹 키, 옵션 키, 이름, 추가가격, 정렬, 품절)
with v (group_key, option_key, name, additional_price, sort_order, is_sold_out) as (values
  ('cl-gangjeong-size',   'cl-gangjeong-size-s',   '소',          0,    10, false),
  ('cl-gangjeong-size',   'cl-gangjeong-size-m',   '중',          5000, 20, false),
  ('cl-gangjeong-size',   'cl-gangjeong-size-l',   '대',          9000, 30, false),
  ('bm-rose-spicy',       'bm-rose-spicy-1',       '순한맛',      0,    10, false),
  ('bm-rose-spicy',       'bm-rose-spicy-2',       '보통맛',      0,    20, false),
  ('bm-rose-spicy',       'bm-rose-spicy-3',       '매운맛',      0,    30, false),
  ('po-margherita-size',  'po-margherita-size-m',  'M',           0,    10, false),
  ('po-margherita-size',  'po-margherita-size-l',  'L',           4000, 20, false),
  ('pd-bulgogi-size',     'pd-bulgogi-size-m',     'M',           0,    10, false),
  ('pd-bulgogi-size',     'pd-bulgogi-size-l',     'L',           5000, 20, false),
  ('pd-potato-size',      'pd-potato-size-m',      'M',           0,    10, false),
  ('pd-potato-size',      'pd-potato-size-l',      'L',           5000, 20, true),
  ('kg-pork-sauce',       'kg-pork-sauce-plain',   '맑게',        0,    10, false),
  ('kg-pork-sauce',       'kg-pork-sauce-dadegi',  '다대기 넣기', 0,    20, false),
  ('kg-sundae-sauce',     'kg-sundae-sauce-plain', '맑게',        0,    10, false),
  ('kg-sundae-sauce',     'kg-sundae-sauce-dadegi','다대기 넣기', 0,    20, false),
  ('cn-tangsuyuk-sauce',  'cn-tangsuyuk-sauce-pour','부어서',     0,    10, false),
  ('cn-tangsuyuk-sauce',  'cn-tangsuyuk-sauce-dip','찍어서',      0,    20, false),
  ('cm-malatang-spicy',   'cm-malatang-spicy-0',   '안 맵게',     0,    10, false),
  ('cm-malatang-spicy',   'cm-malatang-spicy-1',   '1단계',       0,    20, false),
  ('cm-malatang-spicy',   'cm-malatang-spicy-2',   '2단계',       0,    30, false),
  ('cm-malatang-spicy',   'cm-malatang-spicy-3',   '3단계',       0,    40, false),
  ('cm-malatang-topping', 'cm-malatang-top-beef',  '소고기',      3000, 10, false),
  ('cm-malatang-topping', 'cm-malatang-top-shrimp','새우',        2500, 20, false),
  ('cm-malatang-topping', 'cm-malatang-top-noodle','넓적당면',    1000, 30, false),
  ('cm-malatang-topping', 'cm-malatang-top-tofu',  '건두부',      1000, 40, true),
  ('cm-xiangguo-spicy',   'cm-xiangguo-spicy-1',   '1단계',       0,    10, false),
  ('cm-xiangguo-spicy',   'cm-xiangguo-spicy-2',   '2단계',       0,    20, false),
  ('jr-tonkotsu-topping', 'jr-tonkotsu-top-egg',   '반숙계란',    1500, 10, false),
  ('jr-tonkotsu-topping', 'jr-tonkotsu-top-chashu','차슈 추가',   3000, 20, false),
  ('jr-shoyu-topping',    'jr-shoyu-top-egg',      '반숙계란',    1500, 10, false),
  ('jr-shoyu-topping',    'jr-shoyu-top-chashu',   '차슈 추가',   3000, 20, false),
  ('bg-classic-set',      'bg-classic-set-yes',    '세트로 변경', 2900, 10, false),
  ('bg-bacon-set',        'bg-bacon-set-yes',      '세트로 변경', 2900, 10, false),
  ('cf-latte-temp',       'cf-latte-temp-hot',     'HOT',         0,    10, false),
  ('cf-latte-temp',       'cf-latte-temp-ice',     'ICE',         500,  20, false),
  ('cf-latte-shot',       'cf-latte-shot-1',       '샷 1회 추가', 500,  10, false),
  ('cf-latte-shot',       'cf-latte-shot-decaf',   '디카페인 변경', 500, 20, false),
  ('cf-vanilla-temp',     'cf-vanilla-temp-hot',   'HOT',         0,    10, false),
  ('cf-vanilla-temp',     'cf-vanilla-temp-ice',   'ICE',         500,  20, false),
  ('cs-milktea-temp',     'cs-milktea-temp-hot',   'HOT',         0,    10, false),
  ('cs-milktea-temp',     'cs-milktea-temp-ice',   'ICE',         500,  20, false)
)
insert into public.menu_options
  (id, group_id, name, additional_price, is_active, is_sold_out, sort_order)
select
  md5('dev-seed-v1:option:' || v.option_key)::uuid, md5('dev-seed-v1:group:' || v.group_key)::uuid,
  v.name, v.additional_price, true, v.is_sold_out, v.sort_order
from v
on conflict (id) do update set
  group_id = excluded.group_id, name = excluded.name, additional_price = excluded.additional_price,
  is_active = excluded.is_active, is_sold_out = excluded.is_sold_out, sort_order = excluded.sort_order;
