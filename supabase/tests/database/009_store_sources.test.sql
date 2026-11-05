-- 가게 콘텐츠 출처: store_sources · store_source_records · store_source_approvals · list_store_sources
-- 근거: PRD FR-STORE-015~021, 개발 명세 SRC-002, 계약 초안 store-source-contract-draft.md, 서정 결정(공개 승인 후에만 · 응답 name/url만).
-- 테스트 데이터는 롤백으로 사라진다. migration에는 데이터가 없으므로(seed에도 출처는 없다) 모든 fixture를 여기서 만든다.
-- 앱 역할 전환은 zas()로 한다: 문장을 지정한 역할로 실행하고 오류는 'ERR:SQLSTATE:메시지' 문자열로 돌려준다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.test_err(p_sql text, p_state text, p_msg text default null)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_state and (p_msg is null or sqlerrm like '%' || p_msg || '%');
end;
$$;

-- 실행하고 'OK' 또는 'SQLSTATE:메시지'를 돌려준다
create function public.zq(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

-- 지정한 역할(anon · authenticated)로 select 한 값을 text로 돌려준다. 오류는 'ERR:SQLSTATE:메시지'
create function public.zas(p_role text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql into r;
  exception when others then
    r := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return r;
end;
$$;

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;

-- 역할별 공개 읽기. 성공이면 응답 JSON 문자열, 실패면 'ERR:...'
create function public.zr(p_role text, p_store uuid) returns text language sql as $$
  select public.zas(p_role, format('select public.list_store_sources(%L)::text', p_store))
$$;
create function public.zri(p_role text, p_store uuid) returns jsonb language sql as $$
  select (public.zr(p_role, p_store)::jsonb) -> 'items'
$$;

create function public.zfp(p_store uuid) returns text language sql as $$ select private.store_source_fingerprint(p_store) $$;

create function public.zins(p_store uuid, p_name text, p_url text, p_sort integer default 0) returns text language plpgsql as $$
begin
  return public.zq(format('insert into public.store_sources (store_id, name, url, sort_order) values (%L, %L, %L, %s)',
    p_store, p_name, p_url, p_sort));
end;
$$;

-- 현재 목록 그대로 승인 (검토한 지문 = 지금 지문)
create function public.zapprove(p_store uuid) returns text language plpgsql as $$
begin
  perform private.approve_store_sources(p_store, private.store_source_fingerprint(p_store), '서정', null);
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

-- ---------------------------------------------------------------- fixture
insert into public.categories (id, code, name, is_active) values
  (public.zid('CA'), 'zz-src-a', '출처 테스트 A', true),
  (public.zid('CX'), 'zz-src-x', '출처 테스트 비활성', false);

insert into public.stores (id, category_id, name, is_active, is_open) values
  (public.zid('SA'), public.zid('CA'), '출처가게A', true, true),
  (public.zid('SB'), public.zid('CA'), '출처가게B 영업종료', true, false),
  (public.zid('SC'), public.zid('CA'), '출처가게C 출처없음', true, true),
  (public.zid('SD'), public.zid('CA'), '출처가게D 비활성', false, true),
  (public.zid('SE'), public.zid('CX'), '출처가게E 비활성 카테고리', true, true),
  (public.zid('SF'), public.zid('CA'), '출처가게F 다른 가게', true, true),
  (public.zid('SG'), public.zid('CA'), '출처가게G 제약 시험', true, true),
  (public.zid('SH'), public.zid('CA'), '출처가게H 승인 안 함', true, true),
  (public.zid('SI'), public.zid('CA'), '출처가게I 낡은 승인', true, true),
  (public.zid('SK'), public.zid('CA'), '출처가게K 버거킹 후보 지점명', true, true),
  (public.zid('S50'), public.zid('CA'), '출처가게 상한 시험', true, true),
  (public.zid('S51'), public.zid('CA'), '출처가게 상한 시험2', true, true);

-- SA: 일부러 섞인 순서로 넣는다 (정렬은 sort_order → name → id)
insert into public.store_sources (store_id, name, url, sort_order) values
  (public.zid('SA'), '메뉴 목록', 'https://a.example/menu', 2),
  (public.zid('SA'), '공식 홈페이지', 'https://a.example/home', 1),
  (public.zid('SA'), '다이닝코드', 'https://dining.example/a', 2);
insert into public.store_sources (store_id, name, url, sort_order) values
  (public.zid('SB'), '영업종료 공식', 'https://b.example/home', 0),
  (public.zid('SD'), '비활성 가게 출처', 'https://d.example/home', 0),
  (public.zid('SE'), '비활성 카테고리 출처', 'https://e.example/home', 0),
  (public.zid('SF'), 'F 공식', 'https://f.example/home', 0),
  (public.zid('SH'), 'H 공식', 'https://h.example/home', 0),
  (public.zid('SI'), 'I 공식', 'https://i.example/home', 0);

select set_config('zz.rev_sa', (select catalog_revision::text from public.stores where id = public.zid('SA')), true);

-- ================================================================ A. 테이블 제약
select is(public.zins(public.zid('SG'), 'https 허용', 'https://ok.example/1'), 'OK', 'URL https 허용');
select is(public.zins(public.zid('SG'), 'http 허용', 'http://ok.example/2'), 'OK', 'URL http 허용');
select ok(public.zins(public.zid('SG'), 'js', 'javascript:alert(1)') ~ '^23514:', 'URL javascript: 거부');
select ok(public.zins(public.zid('SG'), 'ftp', 'ftp://x.example/y') ~ '^23514:', 'URL ftp: 거부');
select ok(public.zins(public.zid('SG'), 'empty', '') ~ '^23514:', 'URL 빈 값 거부');
select ok(public.zins(public.zid('SG'), 'scheme only', 'https://') ~ '^23514:', 'URL 스킴만 있으면 거부');
select ok(public.zins(public.zid('SG'), 'space', 'https://a b.example') ~ '^23514:', 'URL 공백 포함 거부');
select ok(public.zins(public.zid('SG'), 'tab', E'https://a\tb.example') ~ '^23514:', 'URL 탭 포함 거부');
select ok(public.zins(public.zid('SG'), 'newline', E'https://a.example/\nx') ~ '^23514:', 'URL 줄바꿈 포함 거부');
select ok(public.zins(public.zid('SG'), 'upper', 'HTTPS://x.example') ~ '^23514:', 'URL 스킴 대문자 거부(소문자만 허용)');
select ok(public.zins(public.zid('SG'), 'prefix', 'x https://a.example') ~ '^23514:', 'URL 앞에 다른 글자 거부');
select is(public.zins(public.zid('SG'), 'len2048', 'https://' || repeat('a', 2040)), 'OK', 'URL 2048자 허용');
select ok(public.zins(public.zid('SG'), 'len2049', 'https://' || repeat('a', 2041)) ~ '^23514:', 'URL 2049자 거부');

select ok(public.zins(public.zid('SG'), '', 'https://n.example/1') ~ '^23514:', '이름 빈 값 거부');
select ok(public.zins(public.zid('SG'), '   ', 'https://n.example/2') ~ '^23514:', '이름 공백만 거부');
select ok(public.zins(public.zid('SG'), ' 앞공백', 'https://n.example/3') ~ '^23514:', '이름 앞 공백 거부');
select ok(public.zins(public.zid('SG'), '뒤공백 ', 'https://n.example/4') ~ '^23514:', '이름 뒤 공백 거부');
select ok(public.zins(public.zid('SG'), E'탭\t포함', 'https://n.example/5') ~ '^23514:', '이름 제어문자 거부');
select is(public.zins(public.zid('SG'), repeat('가', 80), 'https://n.example/6'), 'OK', '이름 80자(한글) 허용');
select ok(public.zins(public.zid('SG'), repeat('가', 81), 'https://n.example/7') ~ '^23514:', '이름 81자 거부');
select ok(public.zins(public.zid('SG'), '음수 순서', 'https://n.example/8', -1) ~ '^23514:', 'sort_order 음수 거부');
select ok(public.zins(public.zid('SG'), '같은 URL', 'https://ok.example/1') ~ '^23505:', '같은 가게 같은 URL 거부');
select ok(public.zins(public.zid('SG'), 'https 허용', 'https://other.example/1') ~ '^23505:', '같은 가게 같은 이름 거부');
select is(public.zins(public.zid('SF'), 'https 허용', 'https://ok.example/1'), 'OK', '다른 가게는 같은 URL · 같은 이름 허용');
select ok(public.zins('00000000-0000-4000-8000-0000000000ff', 'x', 'https://x.example') ~ '^23503:', '없는 가게 거부(FK)');
delete from public.store_sources where store_id = public.zid('SG') or (store_id = public.zid('SF') and name <> 'F 공식');

-- 50개 상한
select is(public.zq(format($q$insert into public.store_sources (store_id, name, url)
  select %L, 'n' || g, 'https://cap.example/' || g from generate_series(1, 50) g$q$, public.zid('S50'))), 'OK', '한 문장으로 50개 삽입 허용');
select is((select count(*)::int from public.store_sources where store_id = public.zid('S50')), 50, '50개가 들어갔다');
select ok(public.zins(public.zid('S50'), 'n51', 'https://cap.example/51') ~ '^23514:STORE_SOURCES_LIMIT', '51번째 삽입 거부');
select ok(public.zq(format($q$insert into public.store_sources (store_id, name, url)
  select %L, 'n' || g, 'https://cap.example/' || g from generate_series(1, 51) g$q$, public.zid('S51'))) ~ '^23514:STORE_SOURCES_LIMIT',
  '한 문장으로 51개 삽입은 통째로 거부');
select is((select count(*)::int from public.store_sources where store_id = public.zid('S51')), 0, '거부된 문장은 한 행도 남기지 않는다');
select is(public.zins(public.zid('SG'), '다른 가게는 영향 없음', 'https://g.example/ok'), 'OK', '상한은 가게별이다');
select ok(public.zq(format($q$update public.store_sources set store_id = %L where store_id = %L$q$, public.zid('S50'), public.zid('SG')))
  ~ '^23514:STORE_SOURCES_LIMIT', '가득 찬 가게로 옮기는 UPDATE도 거부');
delete from public.store_sources where store_id = public.zid('S50') and name = 'n50';
select is(public.zins(public.zid('S50'), 'n50 다시', 'https://cap.example/50b'), 'OK', '하나 지우면 다시 넣을 수 있다');
delete from public.store_sources where store_id in (public.zid('S50'), public.zid('SG'));

-- updated_at
select is((select updated_at = created_at from public.store_sources where store_id = public.zid('SF') and name = 'F 공식'), true, '새 행은 updated_at = created_at');
update public.store_sources set name = name where store_id = public.zid('SF');
select is((select updated_at = created_at from public.store_sources where store_id = public.zid('SF')), true, '값이 같은 UPDATE는 updated_at을 바꾸지 않는다');
update public.store_sources set sort_order = 5 where store_id = public.zid('SF');
select is((select updated_at > created_at from public.store_sources where store_id = public.zid('SF')), true, '값이 바뀐 UPDATE는 updated_at을 올린다');
update public.store_sources set sort_order = 0 where store_id = public.zid('SF');

-- ================================================================ B. 내부 기록 · 공개하지 않을 URL
insert into private.store_source_records (store_id, url, collected_for, exclusion_reason, host_kind, name_rule, load_batch)
values (public.zid('SG'), 'https://hsd.example/magazine', 'MENU_NAME', '메뉴 데이터의 근거가 아님', 'OFFICIAL', 'MENU_LIST', 'test');
select ok(public.zins(public.zid('SG'), '매거진', 'https://hsd.example/magazine') ~ '^23514:STORE_SOURCE_EXCLUDED_URL', '제외 사유가 있는 URL은 공개 목록에 넣을 수 없다');
select is(public.zins(public.zid('SF'), '다른 가게의 같은 URL', 'https://hsd.example/magazine'), 'OK', '제외는 그 가게에만 적용된다');
delete from public.store_sources where store_id = public.zid('SF') and url = 'https://hsd.example/magazine';
select is(public.zins(public.zid('SG'), '공식 메뉴 목록', 'https://hsd.example/menu_list'), 'OK', '제외되지 않은 URL은 넣을 수 있다');
select ok(public.zq(format($q$update public.store_sources set url = 'https://hsd.example/magazine' where store_id = %L$q$, public.zid('SG')))
  ~ '^23514:STORE_SOURCE_EXCLUDED_URL', '이미 있는 행의 URL을 제외 URL로 바꾸는 것도 거부');
select ok(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for, exclusion_reason)
  values (%L, 'https://hsd.example/menu_list', 'MENU_NAME', '나중에 제외')$q$, public.zid('SG'))) ~ '^23514:STORE_SOURCE_EXCLUDED_URL',
  '이미 공개 목록에 있는 URL에는 제외 사유를 붙일 수 없다');
select is(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for, source_id)
  select store_id, url, 'IMAGE_PAGE', id from public.store_sources where store_id = %L and url = 'https://hsd.example/menu_list'$q$, public.zid('SG'))),
  'OK', '제외 사유 없는 기록은 같은 URL의 공개 행에 연결할 수 있다');
select ok(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for, source_id)
  select store_id, 'https://hsd.example/other', 'IMAGE_PAGE', id from public.store_sources where store_id = %L and url = 'https://hsd.example/menu_list'$q$, public.zid('SG')))
  ~ '^23514:STORE_SOURCE_RECORD_MISMATCH', '기록의 URL이 연결한 공개 행과 다르면 거부');
select ok(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for, exclusion_reason, source_id)
  select store_id, url, 'MENU_PRICE', '제외', id from public.store_sources where store_id = %L and url = 'https://hsd.example/menu_list'$q$, public.zid('SG')))
  ~ '^23514:', '제외 사유와 공개 행 연결을 동시에 가질 수 없다');
select ok(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for) values (%L, 'ftp://x', 'OTHER')$q$, public.zid('SG')))
  ~ '^23514:', '기록 URL도 http(s)만 허용');
select ok(public.zq(format($q$insert into private.store_source_records (store_id, url, collected_for) values (%L, 'https://hsd.example/menu_list', 'IMAGE_PAGE')$q$, public.zid('SG')))
  ~ '^23505:', '같은 가게 · URL · 용도 · 대상의 기록 중복 거부');
delete from public.store_sources where store_id = public.zid('SG') and url = 'https://hsd.example/menu_list';
select is((select count(*)::int from private.store_source_records where store_id = public.zid('SG') and url = 'https://hsd.example/menu_list' and source_id is null),
  1, '공개 행을 지우면 기록은 남고 연결만 비워진다');

-- ================================================================ C. 지문
select matches(public.zfp(public.zid('SA')), '^v1:[0-9a-f]{64}$', '지문 형식 v1:소문자16진수64');
select is(public.zfp(public.zid('SA')), public.zfp(public.zid('SA')), '같은 목록은 같은 지문');
select isnt(public.zfp(public.zid('SA')), public.zfp(public.zid('SF')), '다른 가게 목록은 다른 지문');
select isnt(public.zfp(public.zid('SC')), public.zfp(public.zid('SA')), '빈 목록 지문은 값이 있는 목록과 다르다');
select is(public.zfp(public.zid('SC')), public.zfp(public.zid('S51')), '빈 목록끼리는 같은 지문');
select set_config('zz.fp_sa', public.zfp(public.zid('SA')), true);

update public.store_sources set name = '공식 홈페이지 수정' where store_id = public.zid('SA') and url = 'https://a.example/home';
select isnt(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '이름이 바뀌면 지문이 바뀐다');
update public.store_sources set name = '공식 홈페이지' where store_id = public.zid('SA') and url = 'https://a.example/home';
select is(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '이름을 되돌리면 지문도 같다');
update public.store_sources set url = 'https://a.example/home2' where store_id = public.zid('SA') and url = 'https://a.example/home';
select isnt(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), 'URL이 바뀌면 지문이 바뀐다');
update public.store_sources set url = 'https://a.example/home' where store_id = public.zid('SA') and url = 'https://a.example/home2';
update public.store_sources set sort_order = 9 where store_id = public.zid('SA') and url = 'https://a.example/home';
select isnt(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '순서가 바뀌면 지문이 바뀐다');
update public.store_sources set sort_order = 1 where store_id = public.zid('SA') and url = 'https://a.example/home';
insert into public.store_sources (store_id, name, url, sort_order) values (public.zid('SA'), '추가', 'https://a.example/extra', 3);
select isnt(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '항목이 늘면 지문이 바뀐다');
delete from public.store_sources where store_id = public.zid('SA') and url = 'https://a.example/extra';
select is(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '항목을 지우면 지문이 원래대로');
delete from public.store_sources where store_id = public.zid('SA') and url = 'https://a.example/home';
insert into public.store_sources (store_id, name, url, sort_order) values (public.zid('SA'), '공식 홈페이지', 'https://a.example/home', 1);
select is(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '행을 지우고 같은 값으로 다시 넣어도(id가 달라도) 지문은 같다');
update public.store_sources set name = name where store_id = public.zid('SA');
select is(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '값이 같은 UPDATE는 지문을 바꾸지 않는다');
insert into private.store_source_records (store_id, url, collected_for, note, rights_permission) values (public.zid('SA'), 'https://a.example/home', 'BRAND_HOME', '내부 메모', '미확인');
select is(public.zfp(public.zid('SA')), current_setting('zz.fp_sa'), '내부 기록은 지문에 영향이 없다');
select is(public.zfp(public.zid('SF')), public.zfp(public.zid('SF')), '다른 가게 편집은 이 가게 지문에 영향이 없다(SF 안정)');

-- ================================================================ D. 승인 함수
select is(public.zr('anon', public.zid('SA'))::jsonb, '{"items":[]}'::jsonb, '[anon] 승인 전에는 출처가 있어도 빈 목록');
select is(public.zr('authenticated', public.zid('SA'))::jsonb, '{"items":[]}'::jsonb, '[authenticated] 승인 전에는 빈 목록');
select ok(public.zq(format($q$select private.approve_store_sources(%L, 'v1:0000', '서정')$q$, public.zid('SA'))) ~ '^P0001:FINGERPRINT_MISMATCH', '지문이 다르면 승인 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, %L, '서정')$q$, public.zid('SA'), 'v1:' || repeat('0', 64))) ~ '^P0001:FINGERPRINT_MISMATCH', '형식만 맞는 엉뚱한 지문도 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, null, '서정')$q$, public.zid('SA'))) ~ '^P0001:INVALID_INPUT', '지문 null 거절');
select ok(public.zq(format($q$select private.approve_store_sources(null, %L, '서정')$q$, public.zfp(public.zid('SA')))) ~ '^P0001:INVALID_INPUT', '가게 null 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, %L, null)$q$, public.zid('SA'), public.zfp(public.zid('SA')))) ~ '^P0001:INVALID_INPUT', '승인자 null 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, %L, '   ')$q$, public.zid('SA'), public.zfp(public.zid('SA')))) ~ '^P0001:INVALID_INPUT', '승인자 공백만 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, %L, %L)$q$, public.zid('SA'), public.zfp(public.zid('SA')), repeat('가', 41))) ~ '^P0001:INVALID_INPUT', '승인자 41자 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, 'v1:x', '서정')$q$, '00000000-0000-4000-8000-0000000000ff')) ~ '^P0001:RESOURCE_NOT_FOUND', '없는 가게 거절');
select ok(public.zq(format($q$select private.approve_store_sources(%L, %L, '서정')$q$, public.zid('SC'), public.zfp(public.zid('SC')))) ~ '^P0001:SOURCE_LIST_EMPTY', '빈 목록은 승인할 수 없다');
select is((select count(*)::int from private.store_source_approvals), 0, '거절된 승인은 아무것도 남기지 않는다');
select is(public.zr('anon', public.zid('SA'))::jsonb, '{"items":[]}'::jsonb, '거절된 뒤에도 공개되지 않는다');

select is(public.zq(format($q$select private.approve_store_sources(%L, %L, ' 서정 ', '1차 검토')$q$, public.zid('SA'), public.zfp(public.zid('SA')))), 'OK', '지문이 같으면 승인');
select is((select approved_by from private.store_source_approvals where store_id = public.zid('SA')), '서정', '승인자 앞뒤 공백은 정리돼 저장된다(첫 승인 직후)');
select is((select array_agg(k order by k) from jsonb_object_keys(private.approve_store_sources(public.zid('SA'), public.zfp(public.zid('SA')), '서정')) k),
  array['fingerprint', 'itemCount', 'storeId'], '승인 응답 키');
select is((select count(*)::int from private.store_source_approvals where store_id = public.zid('SA')), 1, '가게당 승인 행은 하나(다시 승인해도)');
select is((select item_count from private.store_source_approvals where store_id = public.zid('SA')), 3, '승인 항목 수');
select is((select approved_by from private.store_source_approvals where store_id = public.zid('SA')), '서정', '승인자 앞뒤 공백은 정리된다');
select is((select list_fingerprint from private.store_source_approvals where store_id = public.zid('SA')), current_setting('zz.fp_sa'), '승인에는 승인한 순간의 지문이 저장된다');

-- ================================================================ E. 공개 읽기
select set_config('zz.exp_sa', '[{"name":"공식 홈페이지","url":"https://a.example/home"},{"name":"다이닝코드","url":"https://dining.example/a"},{"name":"메뉴 목록","url":"https://a.example/menu"}]', true);

select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '[anon] 승인된 목록: sort_order → name 순서');
select is(public.zri('authenticated', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '[authenticated] 승인된 목록');
select is((select array_agg(k order by k) from jsonb_object_keys(public.zr('anon', public.zid('SA'))::jsonb) k), array['items'], '응답 최상위 키는 items뿐');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(public.zri('anon', public.zid('SA'))) e, jsonb_object_keys(e) k), array['name', 'url'], '항목 키는 name · url뿐');
select is(public.zri('anon', public.zid('SF')), '[]'::jsonb, 'SA의 승인이 다른 가게(SF)를 공개하지 않는다');
select is(public.zri('anon', public.zid('SH')), '[]'::jsonb, '승인하지 않은 가게는 빈 목록');
select is(public.zri('anon', public.zid('SC')), '[]'::jsonb, '출처가 없는 가게는 오류가 아니라 빈 목록');
select is(public.zr('authenticated', public.zid('SC'))::jsonb, '{"items":[]}'::jsonb, '[authenticated] 출처 없는 가게도 빈 목록');

select is(public.zapprove(public.zid('SB')), 'OK', '영업 종료 가게 승인');
select is(public.zri('anon', public.zid('SB')), '[{"name":"영업종료 공식","url":"https://b.example/home"}]'::jsonb, '영업 종료 가게도 출처가 나온다');
select is(public.zapprove(public.zid('SD')), 'OK', '비활성 가게도 승인 행은 만들 수 있다(공개는 별개)');
select is(public.zapprove(public.zid('SE')), 'OK', '비활성 카테고리 가게도 승인 행은 만들 수 있다');
select ok(public.zr('anon', public.zid('SD')) ~ '^ERR:P0001:RESOURCE_NOT_FOUND', '[anon] 비활성 가게는 승인돼도 RESOURCE_NOT_FOUND');
select ok(public.zr('authenticated', public.zid('SD')) ~ '^ERR:P0001:RESOURCE_NOT_FOUND', '[authenticated] 비활성 가게 RESOURCE_NOT_FOUND');
select ok(public.zr('anon', public.zid('SE')) ~ '^ERR:P0001:RESOURCE_NOT_FOUND', '[anon] 비활성 카테고리 가게는 RESOURCE_NOT_FOUND');
select ok(public.zr('authenticated', public.zid('SE')) ~ '^ERR:P0001:RESOURCE_NOT_FOUND', '[authenticated] 비활성 카테고리 가게 RESOURCE_NOT_FOUND');
select ok(public.zr('anon', '00000000-0000-4000-8000-0000000000ff') ~ '^ERR:P0001:RESOURCE_NOT_FOUND', '없는 가게 RESOURCE_NOT_FOUND');
select ok(public.zas('anon', 'select public.list_store_sources(null)::text') ~ '^ERR:P0001:INVALID_INPUT', '[anon] null 인자는 INVALID_INPUT');
select ok(public.zas('authenticated', 'select public.list_store_sources(null)::text') ~ '^ERR:P0001:INVALID_INPUT', '[authenticated] null 인자는 INVALID_INPUT');
select ok(public.zas('anon', $$select public.list_store_sources('not-a-uuid')::text$$) ~ '^ERR:22P02', '형식이 틀린 uuid는 22P02');

-- 승인 무효화: 목록이 바뀌면 빈 목록, 되돌리면 다시 유효, 새 지문으로 재승인하면 새 목록
insert into public.store_sources (store_id, name, url, sort_order) values (public.zid('SA'), '추가', 'https://a.example/extra', 3);
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '항목을 추가하면 승인이 무효 → 빈 목록');
delete from public.store_sources where store_id = public.zid('SA') and url = 'https://a.example/extra';
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '원래대로 되돌리면 승인이 다시 유효하다');

update public.store_sources set name = '공식 홈페이지 수정' where store_id = public.zid('SA') and url = 'https://a.example/home';
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '이름을 바꾸면 무효');
update public.store_sources set name = '공식 홈페이지' where store_id = public.zid('SA') and url = 'https://a.example/home';
update public.store_sources set url = 'https://a.example/home2' where store_id = public.zid('SA') and url = 'https://a.example/home';
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, 'URL을 바꾸면 무효');
update public.store_sources set url = 'https://a.example/home' where store_id = public.zid('SA') and url = 'https://a.example/home2';
update public.store_sources set sort_order = 7 where store_id = public.zid('SA') and url = 'https://a.example/home';
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '순서를 바꾸면 무효');
update public.store_sources set sort_order = 1 where store_id = public.zid('SA') and url = 'https://a.example/home';
delete from public.store_sources where store_id = public.zid('SA') and url = 'https://a.example/menu';
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '항목을 지우면 무효');
insert into public.store_sources (store_id, name, url, sort_order) values (public.zid('SA'), '메뉴 목록', 'https://a.example/menu', 2);
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '같은 값으로 다시 넣으면(id가 달라도) 유효');
update public.store_sources set name = name where store_id = public.zid('SA');
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '값이 같은 UPDATE는 승인을 풀지 않는다');
update private.store_source_records set note = '메모 수정' where store_id = public.zid('SA');
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '내부 기록 변경은 승인을 풀지 않는다');

insert into public.store_sources (store_id, name, url, sort_order) values (public.zid('SA'), '새 출처', 'https://a.example/new', 0);
select is(public.zri('authenticated', public.zid('SA')), '[]'::jsonb, '[authenticated] 새 항목 추가 직후는 빈 목록');
select is(public.zapprove(public.zid('SA')), 'OK', '새 지문으로 재승인');
select is(jsonb_array_length(public.zri('anon', public.zid('SA'))), 4, '재승인하면 새 목록(4개)이 나온다');
select is(public.zri('anon', public.zid('SA')) -> 0, '{"name":"새 출처","url":"https://a.example/new"}'::jsonb, 'sort_order 0이 맨 앞');
select is((select item_count from private.store_source_approvals where store_id = public.zid('SA')), 4, '재승인하면 항목 수도 갱신');
select is((select count(*)::int from private.store_source_approvals where store_id = public.zid('SA')), 1, '재승인해도 승인 행은 하나');
delete from public.store_sources where store_id = public.zid('SA') and url = 'https://a.example/new';
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '재승인 뒤 목록이 바뀌면 다시 무효');
select is(public.zapprove(public.zid('SA')), 'OK', '다시 승인');
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '승인된 목록 복구');

select is(public.zri('anon', public.zid('SB')), '[{"name":"영업종료 공식","url":"https://b.example/home"}]'::jsonb, 'SA 편집은 SB 공개에 영향이 없다');
select is(public.zapprove(public.zid('SF')), 'OK', 'SF 승인');
update public.store_sources set name = 'F 공식 수정' where store_id = public.zid('SF');
select is(public.zri('anon', public.zid('SF')), '[]'::jsonb, 'SF 편집은 SF 승인만 무효로 만든다');
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, 'SF 편집은 SA 공개에 영향이 없다');

select is((select catalog_revision::text from public.stores where id = public.zid('SA')), current_setting('zz.rev_sa'), '출처를 고쳐도 stores.catalog_revision은 오르지 않는다');

-- 승인 취소(긴급 중단)
select is(private.revoke_store_source_approval(public.zid('SA')), true, '승인 취소: 지웠으면 true');
select is(public.zri('anon', public.zid('SA')), '[]'::jsonb, '승인 취소 즉시 빈 목록');
select is(private.revoke_store_source_approval(public.zid('SA')), false, '이미 없으면 false');
select is(public.zapprove(public.zid('SA')), 'OK', '다시 승인할 수 있다');
select is(public.zri('anon', public.zid('SA')), current_setting('zz.exp_sa')::jsonb, '다시 승인하면 공개');

-- ================================================================ F. 검토 view · preview
select is(private.preview_store_sources(public.zid('SH')), '{"items":[{"name":"H 공식","url":"https://h.example/home"}]}'::jsonb, 'preview: 승인 전이라도 현재 목록을 그대로 보여준다');
select is(public.zr('anon', public.zid('SH'))::jsonb, '{"items":[]}'::jsonb, '같은 가게의 공개 응답은 여전히 빈 목록');
select is(private.preview_store_sources(public.zid('SA')), public.zr('anon', public.zid('SA'))::jsonb, 'preview는 승인된 가게의 공개 응답과 같다');
select is(private.preview_store_sources(public.zid('SC')), '{"items":[]}'::jsonb, 'preview: 출처 없는 가게도 빈 목록');

select is(public.zapprove(public.zid('SI')), 'OK', 'SI 승인');
update public.store_sources set name = 'I 공식 수정' where store_id = public.zid('SI');
select is((select approval_status from private.store_source_review where store_id = public.zid('SA') limit 1), 'APPROVED', 'view: 승인된 가게 APPROVED');
select is((select approval_status from private.store_source_review where store_id = public.zid('SH')), 'NONE', 'view: 승인 없는 가게 NONE');
select is((select approval_status from private.store_source_review where store_id = public.zid('SI')), 'STALE', 'view: 승인 뒤 목록이 바뀐 가게 STALE');
select is((select count(*)::int from private.store_source_review where store_id = public.zid('SA')), 3, 'view: SA 행 3개');
select is((select max(item_count) from private.store_source_review where store_id = public.zid('SA')), 3::bigint, 'view: item_count');
select is((select current_fingerprint from private.store_source_review where store_id = public.zid('SA') limit 1), public.zfp(public.zid('SA')), 'view: 현재 지문 = 함수 결과');
select is((select approved_fingerprint from private.store_source_review where store_id = public.zid('SA') limit 1), public.zfp(public.zid('SA')), 'view: 승인 지문');
select is((select store_visible from private.store_source_review where store_id = public.zid('SA') limit 1), true, 'view: 활성 가게는 store_visible');
select is((select store_visible from private.store_source_review where store_id = public.zid('SD')), false, 'view: 비활성 가게는 store_visible = false');
select is((select store_visible from private.store_source_review where store_id = public.zid('SE')), false, 'view: 비활성 카테고리 가게는 store_visible = false');
select is((select array_agg(public_name order by sort_order, public_name) from private.store_source_review where store_id = public.zid('SA')),
  array['공식 홈페이지', '다이닝코드', '메뉴 목록'], 'view: 공개 예정 이름이 응답 순서와 같다');

insert into public.store_sources (store_id, name, url, sort_order) values
  (public.zid('SK'), '다이닝코드 · 버거킹(진주대로 540)', 'https://dining.example/bk', 0),
  (public.zid('SK'), '다이닝코드 · 후보지점 본점', 'https://dining.example/bk2', 1);
insert into private.store_source_records (store_id, url, collected_for, host_kind, name_rule, candidate_label) values
  (public.zid('SK'), 'https://dining.example/bk', 'MENU_NAME', 'PLATFORM', 'MANUAL', '후보지점'),
  (public.zid('SK'), 'https://dining.example/bk', 'MENU_PRICE', 'PLATFORM', 'MANUAL', '후보지점'),
  (public.zid('SK'), 'https://dining.example/bk2', 'MENU_NAME', 'PLATFORM', 'MANUAL', '후보지점');
select is((select name_has_candidate_label from private.store_source_review where store_id = public.zid('SK') and url = 'https://dining.example/bk'), false, 'view: 공개 이름에 후보 지점명이 없으면 false');
select is((select name_has_candidate_label from private.store_source_review where store_id = public.zid('SK') and url = 'https://dining.example/bk2'), true, 'view: 공개 이름에 후보 지점명이 들어가면 true');
select is((select record_count from private.store_source_review where store_id = public.zid('SK') and url = 'https://dining.example/bk'), 2::bigint, 'view: 같은 URL의 기록 수');
select is((select name_rules from private.store_source_review where store_id = public.zid('SK') and url = 'https://dining.example/bk'), 'MANUAL', 'view: 이름 부여 방식');
select is((select host_kinds from private.store_source_review where store_id = public.zid('SK') and url = 'https://dining.example/bk'), 'PLATFORM', 'view: 공식/플랫폼 구분');
select is((select record_count from private.store_source_review where store_id = public.zid('SH')), 0::bigint, 'view: 기록이 없으면 0');
select is((select name_has_candidate_label from private.store_source_review where store_id = public.zid('SH')), false, 'view: 기록이 없으면 후보명 표시도 false');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema = 'private' and table_name = 'store_source_review'),
  array['store_id', 'store_name', 'store_visible', 'source_id', 'sort_order', 'public_name', 'url', 'name_rules', 'host_kinds', 'record_count',
        'name_has_candidate_label', 'item_count', 'current_fingerprint', 'approved_fingerprint', 'approval_status', 'approved_at', 'approved_by'],
  'view 열 목록(권리 · 근거 열은 없다)');

-- ================================================================ G. 앱 역할 접근 차단
select ok(public.zas(r.role, format('select public.zq(%L)', v.stmt)) ~ '^42501:', r.role || ' ' || v.label || ' 거부')
from (values ('anon'), ('authenticated')) r(role)
cross join (values
  ('store_sources SELECT', 'select * from public.store_sources'),
  ('store_sources SELECT 한 열', 'select url from public.store_sources'),
  ('store_sources INSERT', format($q$insert into public.store_sources (store_id, name, url) values (%L, 'x', 'https://x.example')$q$, public.zid('SC'))),
  ('store_sources UPDATE', $q$update public.store_sources set name = 'hacked'$q$),
  ('store_sources DELETE', 'delete from public.store_sources'),
  ('records SELECT', 'select * from private.store_source_records'),
  ('records INSERT', format($q$insert into private.store_source_records (store_id, url, collected_for) values (%L, 'https://x.example', 'OTHER')$q$, public.zid('SC'))),
  ('approvals SELECT', 'select * from private.store_source_approvals'),
  ('approvals INSERT', format($q$insert into private.store_source_approvals (store_id, list_fingerprint, item_count, approved_by) values (%L, %L, 1, 'x')$q$, public.zid('SC'), 'v1:' || repeat('0', 64))),
  ('approvals DELETE', 'delete from private.store_source_approvals'),
  ('review view SELECT', 'select * from private.store_source_review'),
  ('fingerprint 함수', format('select private.store_source_fingerprint(%L)', public.zid('SA'))),
  ('items 함수', format('select private.store_source_items(%L)', public.zid('SA'))),
  ('preview 함수', format('select private.preview_store_sources(%L)', public.zid('SA'))),
  ('approve 함수', format($q$select private.approve_store_sources(%L, %L, 'x')$q$, public.zid('SC'), 'v1:' || repeat('0', 64))),
  ('revoke 함수', format('select private.revoke_store_source_approval(%L)', public.zid('SA'))),
  ('lock 함수', format('select private.store_source_lock(%L)', public.zid('SA'))),
  ('트리거 함수', 'select private.store_sources_guard()')
) v(label, stmt);

select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'), 'private 스키마에는 앱 역할의 USAGE가 없다');

-- 앱 역할이 어떤 새 테이블 · view에도 권한이 없다 (나중에 누가 추가해도 걸리도록 카탈로그를 훑는다)
select is((select count(*)::int from pg_class c
    where c.relkind in ('r', 'v', 'm', 'p') and (c.relnamespace = 'private'::regnamespace or c.relname like 'store\_source%')
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
        or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references'))),
  0, 'private의 모든 관계와 store_source* 관계에 앱 역할 권한이 없다(열 단위 포함)');
select is((select count(*)::int from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'private의 모든 함수는 앱 역할이 실행할 수 없다(PUBLIC 포함)');
select is((select count(*)::int from pg_class where relname like 'store\_source%' and relnamespace = 'public'::regnamespace and relkind in ('r', 'v')),
  1, 'public에 있는 store_source* 관계는 store_sources 하나뿐이다');
select is((select count(*)::int from pg_class where relname in ('store_sources', 'store_source_records', 'store_source_approvals') and relrowsecurity), 3, '세 테이블 모두 RLS 활성화');
select is((select count(*)::int from pg_policy where polrelid in ('public.store_sources'::regclass, 'private.store_source_records'::regclass, 'private.store_source_approvals'::regclass)),
  0, '정책은 만들지 않는다(직접 읽기 길이 없다)');
select is((select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'public.store_sources'::regclass and attnum > 0 and not attisdropped),
  array['id', 'store_id', 'name', 'url', 'sort_order', 'created_at', 'updated_at'], 'store_sources 열: 권리 · 근거 · 공개 여부 열이 없다');

-- 함수 속성
select ok((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.list_store_sources(uuid)'::regprocedure),
  'list_store_sources: SECURITY DEFINER · STABLE · search_path 고정');
select ok(has_function_privilege('anon', 'public.list_store_sources(uuid)', 'execute') and has_function_privilege('authenticated', 'public.list_store_sources(uuid)', 'execute'),
  'list_store_sources는 anon · authenticated가 실행할 수 있다');
select ok(coalesce((select proacl::text from pg_proc where oid = 'public.list_store_sources(uuid)'::regprocedure), '') !~ '(^|[{,])=X', 'list_store_sources를 PUBLIC에 열지 않았다');
select ok((select bool_and(provolatile = 's') from pg_proc
    where oid in ('private.store_source_fingerprint(uuid)'::regprocedure, 'private.store_source_items(uuid)'::regprocedure, 'private.preview_store_sources(uuid)'::regprocedure)),
  '지문 · 목록 · preview 함수는 STABLE이다(호출 문장의 스냅샷을 쓰므로 승인과 목록이 어긋나지 않는다)');
select ok((select provolatile = 'v' from pg_proc where oid = 'private.approve_store_sources(uuid,text,text,text)'::regprocedure),
  '승인 함수는 VOLATILE이다(잠금 뒤 새 스냅샷으로 지문을 계산한다)');
select ok((select bool_and('search_path=""' = any (proconfig)) from pg_proc
    where pronamespace = 'private'::regnamespace and proname like any (array['store\_source%', 'preview\_store%', 'approve\_store%', 'revoke\_store%'])),
  'private 출처 함수는 모두 search_path가 고정돼 있다');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.store_sources'::regclass and tgname = 'store_sources_guard' and not tgisinternal), 1, 'store_sources 가드 트리거');
select is((select count(*)::int from pg_trigger where tgrelid = 'private.store_source_records'::regclass and tgname = 'store_source_records_guard' and not tgisinternal), 1, 'records 가드 트리거');

select * from finish();
rollback;
