-- 가게 상세 사진(store_photos)과 get_store의 photos
-- 테스트 데이터는 롤백으로 사라진다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function public.zq(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-ph', '사진분류', 99);
insert into public.stores (id, category_id, name, image_ref) values
  (public.zid('S1'), public.zid('CA'), '사진가게', 'stores/' || public.zid('S1')::text || '.png'),
  (public.zid('S2'), public.zid('CA'), '사진없는가게', null),
  (public.zid('S3'), public.zid('CA'), '한장가게', null);
insert into public.stores (id, category_id, name, is_active) values (public.zid('S4'), public.zid('CA'), '비활성가게', false);

-- S1: 대표(0) + 원본 순서. 비활성 사진 하나
insert into public.store_photos (store_id, image_ref, sort_order, source_position, is_active) values
  (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-aaaaaaaa.jpg', 0, 4, true),
  (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-bbbbbbbb.jpg', 1, 1, true),
  (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-cccccccc.jpg', 2, 2, false),
  (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-dddddddd.jpg', 3, 3, true);
insert into public.store_photos (store_id, image_ref, sort_order, source_position) values
  (public.zid('S3'), 'stores/' || public.zid('S3')::text || '-eeeeeeee.jpg', 0, 1);
insert into public.store_photos (store_id, image_ref, sort_order, source_position) values
  (public.zid('S4'), 'stores/' || public.zid('S4')::text || '-ffffffff.jpg', 0, 1);

-- 경로·유일성 제약
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'menus/' || public.zid('S2')::text || '.jpg', 0) $$), '23514', 'menus/ 경로는 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S1')::text || '.jpg', 0) $$), '23514', '다른 가게 UUID 경로는 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S2')::text || '-abc.jpg', 0) $$), '23514', '해시는 8자리 16진수만');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S2')::text || '.gif', 0) $$), '23514', 'gif 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S2')::text || '-../x.jpg', 0) $$), '23514', '경로 이동 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-11111111.jpg', 0) $$), '23505', '같은 가게 sort_order 중복 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S1'), 'stores/' || public.zid('S1')::text || '-aaaaaaaa.jpg', 9) $$), '23505', '같은 가게 같은 파일 중복 거부');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S2')::text || '.png', 0) $$), 'OK', '기존 stores/<UUID>.png 모양도 허용');
delete from public.store_photos where store_id = public.zid('S2');

-- Guest 응답
set local role anon;
select is(public.get_store(public.zid('S1')) -> 'imageRef', to_jsonb('stores/' || public.zid('S1')::text || '.png'), '기존 imageRef 한 장 계약 유지(구버전 앱)');
select is(public.get_store(public.zid('S1')) #>> '{photos,0,imageRef}', 'stores/' || public.zid('S1')::text || '-aaaaaaaa.jpg', '첫 장 = 대표(sort_order 0)');
select is(jsonb_array_length(public.get_store(public.zid('S1')) -> 'photos'), 3, '활성 사진만(비활성 1장 제외)');
select is((select string_agg(p ->> 'imageRef', ',' order by o) from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'photos') with ordinality as t(p, o)),
          'stores/' || public.zid('S1')::text || '-aaaaaaaa.jpg,stores/' || public.zid('S1')::text || '-bbbbbbbb.jpg,stores/' || public.zid('S1')::text || '-dddddddd.jpg', 'sort_order 순서');
select is(public.get_store(public.zid('S2')) -> 'photos', '[]'::jsonb, '사진 없는 가게는 빈 배열');
select is(jsonb_array_length(public.get_store(public.zid('S3')) -> 'photos'), 1, '한 장');
select is(public.zq($$ select public.get_store(public.zid('S4')) $$), 'P0001', '비활성 가게는 RESOURCE_NOT_FOUND');
select is((select count(*)::int from public.store_photos where store_id = public.zid('S4')), 0, '비활성 가게 사진은 Guest에게 안 보인다');
select is(public.zq($$ select source_position from public.store_photos limit 1 $$), '42501', 'source_position은 앱에 열리지 않는다');
select is(public.zq($$ insert into public.store_photos (store_id, image_ref, sort_order) values (public.zid('S2'), 'stores/' || public.zid('S2')::text || '.png', 0) $$), '42501', '앱 키는 쓰기 불가');
reset role;

select * from finish();
rollback;
