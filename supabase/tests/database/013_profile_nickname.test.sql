-- 공개 닉네임: profiles.nickname, set_my_nickname(), get_my_profile()
-- 근거: 개발 명세 DB-003 · AUTH-005 · OPEN-DB-004, 서정 확정 규칙(2026-11-02).
-- 한글 경계 문자는 chr(코드포인트)로 만든다 (파일 인코딩과 무관하게 같은 문자를 쓰려고).
-- 같은 트랜잭션에서는 now()가 변하지 않으므로, updated_at 비교는 먼저 옛 시각(2000-01-01)을 넣어 확인한다.
-- 테스트 데이터는 롤백으로 사라진다.
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

-- set_my_nickname 결과를 문자열로: 성공이면 nickname, 실패면 'SQLSTATE:메시지'
create function public.test_nick(p text) returns text language plpgsql as $$
begin
  return public.set_my_nickname(p)->>'nickname';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

-- 사용자 A(프로필 없음) / B(프로필 없음) / C(실명 name이 들어 있는 기존 계정) / D(프로필 없음, 읽기만)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000004');
insert into public.profiles (id, name, updated_at) values
  ('cccccccc-0000-4000-8000-000000000003', '실명홍길동', '2000-01-01 00:00:00+00');

-- ---------------------------------------------------------------- 구조 (superuser)
select is((select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'nickname'), 'YES', 'nickname은 NULL 허용');
select is((select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'nickname'), 'text', 'nickname은 text');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c'
    and conname = 'profiles_nickname_format'), 'nickname 형식 CHECK 제약이 있다');
select ok(not exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.profiles'::regclass and i.indisunique and a.attname = 'nickname'),
  'nickname에는 unique 인덱스가 없다 (중복 허용)');
select ok(has_column_privilege('authenticated', 'public.profiles', 'nickname', 'select'), 'authenticated는 nickname을 SELECT할 수 있다');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'nickname', 'update'), 'authenticated는 nickname을 UPDATE할 수 없다');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'nickname', 'insert'), 'authenticated는 nickname을 INSERT할 수 없다');
select ok(not has_column_privilege('anon', 'public.profiles', 'nickname', 'select'), 'anon은 nickname을 읽을 수 없다');
select ok(has_column_privilege('authenticated', 'public.profiles', 'name', 'select'), 'name 열 SELECT 권한은 그대로다 (이번에 건드리지 않음)');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'name', 'update'), 'name 열은 여전히 쓸 수 없다');

-- ---------------------------------------------------------------- 함수 정의
select ok((select prosecdef from pg_proc where oid = 'public.set_my_nickname(text)'::regprocedure), 'set_my_nickname은 SECURITY DEFINER');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.set_my_nickname(text)'::regprocedure), 'set_my_nickname의 search_path가 고정되어 있다');
select is((select proargnames from pg_proc where oid = 'public.set_my_nickname(text)'::regprocedure), array['p_nickname'], '인자 이름은 p_nickname');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_my_profile()'::regprocedure), 'get_my_profile은 SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.get_my_profile()'::regprocedure), 's', 'get_my_profile은 stable(읽기 전용)');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.get_my_profile()'::regprocedure), 'get_my_profile의 search_path도 고정되어 있다');
select ok(not exists (
    select 1 from pg_proc p
    where p.oid in ('public.set_my_nickname(text)'::regprocedure, 'public.get_my_profile()'::regprocedure)
      and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'), '두 함수 모두 PUBLIC에 열려 있지 않다');
select ok(not exists (
    select 1 from pg_proc p
    where p.oid in ('public.set_my_nickname(text)'::regprocedure, 'public.get_my_profile()'::regprocedure)
      and coalesce(p.proacl::text, '') ~ 'anon='), '두 함수 모두 anon에게 열려 있지 않다');
select ok(exists (select 1 from pg_proc p where p.oid = 'public.set_my_nickname(text)'::regprocedure
    and coalesce(p.proacl::text, '') ~ 'authenticated=X'), 'set_my_nickname은 authenticated에게 열려 있다');
select ok(exists (select 1 from pg_proc p where p.oid = 'public.get_my_profile()'::regprocedure
    and coalesce(p.proacl::text, '') ~ 'authenticated=X'), 'get_my_profile은 authenticated에게 열려 있다');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.set_my_nickname('홍길동')$$, '42501'), '[anon] set_my_nickname 실행 금지');
select ok(public.test_err($$select public.get_my_profile()$$, '42501'), '[anon] get_my_profile 실행 금지');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select ok(public.test_err($$select public.set_my_nickname('홍길동')$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] set_my_nickname → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_my_profile()$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] get_my_profile → AUTH_REQUIRED');
select ok(public.test_err($$select public.set_my_nickname(null)$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] null 입력도 먼저 AUTH_REQUIRED (로그인 확인이 먼저)');
reset role;
select is((select count(*)::int from public.profiles where nickname is not null), 0, '로그인 없이는 아무 닉네임도 저장되지 않았다');

-- ---------------------------------------------------------------- get_my_profile
-- D: 프로필 행이 없다
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_profile(), '{"nickname":null}'::jsonb, '프로필 행이 없으면 {nickname:null}로 성공');
reset role;
select is((select count(*)::int from public.profiles where id = 'dddddddd-0000-4000-8000-000000000004'), 0, 'get_my_profile은 행을 만들지 않는다');

-- C: 실명 name이 있고 닉네임은 없는 기존 계정
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_profile(), '{"nickname":null}'::jsonb, '닉네임 없는 기존 계정은 null 성공 (name은 응답에 없다)');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_profile()) k), array['nickname'], '응답 키는 nickname뿐');
reset role;

-- ---------------------------------------------------------------- 사용자 A: 유효 입력
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.set_my_nickname('  홍길동  '), '{"nickname":"홍길동"}'::jsonb, '앞뒤 공백을 지운 값이 응답이다');
select is((select array_agg(k order by k) from jsonb_object_keys(public.set_my_nickname('홍길동')) k), array['nickname'], 'set 응답 키는 nickname뿐');
select is(public.get_my_profile(), '{"nickname":"홍길동"}'::jsonb, 'get_my_profile이 저장된 값을 돌려준다');
reset role;
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '홍길동', '저장값은 trim한 결과');
select is((select name from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), null, '행이 없던 계정은 name 없이 만들어진다');

set local role authenticated;
select is(public.test_nick(v.s), v.s, v.d)
from (values
  ('가나', '유효: 한글 2자'),
  ('가나다라마바사아자차카타', '유효: 한글 12자'),
  ('ab', '유효: 영문 2자'),
  ('AbCdEfGhIjKl', '유효: 영문 12자'),
  ('12', '유효: 숫자 2자'),
  ('한글abc123', '유효: 한글+영문+숫자'),
  (chr(44032) || chr(44032), '유효: 경계 문자 U+AC00(가) 2자'),
  (chr(55203) || chr(55203), '유효: 경계 문자 U+D7A3(힣) 2자')
) as v(s, d);
select is(public.test_nick(chr(9) || 'abc'), 'P0001:NICKNAME_INVALID', '앞의 탭은 일반 공백이 아니므로 거절');
select is(public.test_nick('홍길동' || chr(10)), 'P0001:NICKNAME_INVALID', '뒤의 줄바꿈은 거절');
select is(public.test_nick(chr(12288) || '홍길동'), 'P0001:NICKNAME_INVALID', '앞의 전각 공백(U+3000)은 거절');
select is(public.test_nick(chr(160) || '홍길동'), 'P0001:NICKNAME_INVALID', '앞의 NBSP(U+00A0)는 거절');

-- ---------------------------------------------------------------- 무효 입력: 모두 같은 오류, 기존 값 불변
select is(public.set_my_nickname('안정값'), '{"nickname":"안정값"}'::jsonb, '(준비) 기존 닉네임을 안정값으로');
select is(public.test_nick(v.s), 'P0001:NICKNAME_INVALID', v.d)
from (values
  (null, '무효: null'),
  ('', '무효: 빈 문자열'),
  ('   ', '무효: 공백만'),
  ('가', '무효: 1자(한글)'),
  ('a', '무효: 1자(영문)'),
  ('가나다라마바사아자차카타파', '무효: 13자(한글)'),
  ('abcdefghijklm', '무효: 13자(영문)'),
  ('  가나다라마바사아자차카타파  ', '무효: trim 뒤에도 13자'),
  ('홍 길동', '무효: 내부 공백'),
  ('홍길동!', '무효: 특수문자 !'),
  ('홍길동_1', '무효: 밑줄'),
  ('홍길동-1', '무효: 하이픈'),
  ('홍길동@', '무효: @'),
  ('홍길동' || chr(128512), '무효: 이모지'),
  (chr(12593) || chr(12593), '무효: 자음 단독 ㄱㄱ(U+3131)'),
  ('ㅋㅋㅋ', '무효: 자음 단독 ㅋㅋㅋ'),
  (chr(12623) || chr(12623), '무효: 모음 단독 ㅏㅏ(U+314F)'),
  ('가' || chr(12593), '무효: 완성형 뒤에 자음 하나'),
  (chr(4352) || chr(4449) || chr(4352) || chr(4449), '무효: 조합형 자모(NFD, U+1100 U+1161)'),
  (chr(44031) || chr(44031), '무효: 한글 범위 바로 앞 문자(U+ABFF)'),
  (chr(55204) || chr(55204), '무효: 한글 범위 바로 뒤 문자(U+D7A4)'),
  (chr(28450) || chr(23383), '무효: 한자'),
  (chr(65297) || chr(65298), '무효: 전각 숫자'),
  ('홍길동' || chr(7), '무효: 제어 문자(벨)')
) as v(s, d);
select is(public.get_my_profile(), '{"nickname":"안정값"}'::jsonb, '무효 입력을 여러 번 보내도 기존 닉네임은 그대로');
reset role;
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '안정값', 'DB 값도 그대로');

-- ---------------------------------------------------------------- 같은 값 재전송 / 변경 / updated_at
update public.profiles set updated_at = '2000-01-01 00:00:00+00' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.set_my_nickname('안정값'), '{"nickname":"안정값"}'::jsonb, '같은 값을 다시 보내면 같은 결과');
select is(public.set_my_nickname(' 안정값 '), '{"nickname":"안정값"}'::jsonb, '공백만 다른 같은 값도 같은 결과');
reset role;
select is((select updated_at from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '2000-01-01 00:00:00+00'::timestamptz,
  '같은 값이면 UPDATE를 건너뛰어 updated_at이 그대로');
set local role authenticated;
select is(public.set_my_nickname('새이름'), '{"nickname":"새이름"}'::jsonb, '다른 값으로 바꾸면 새 값이 응답');
reset role;
select ok((select updated_at from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001') > '2000-01-01 00:00:00+00'::timestamptz,
  '다른 값이면 updated_at 갱신');
set local role authenticated;
select is((select count(*)::int from generate_series(1, 8) g where public.test_nick('변경' || g::text) = '변경' || g::text), 8, '변경 횟수 제한 없음: 연속 8번 성공');
select is(public.get_my_profile(), '{"nickname":"변경8"}'::jsonb, '마지막 값이 저장되어 있다');
reset role;

-- ---------------------------------------------------------------- 사용자 C: name이 있는 기존 계정
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(public.set_my_nickname('Alice1'), '{"nickname":"Alice1"}'::jsonb, '[C] 기존 계정이 닉네임을 설정');
reset role;
select is((select name from public.profiles where id = 'cccccccc-0000-4000-8000-000000000003'), '실명홍길동', '[C] name은 건드리지 않는다');
select ok((select nickname is distinct from name from public.profiles where id = 'cccccccc-0000-4000-8000-000000000003'), '[C] name이 닉네임으로 복사되지 않는다');
select is((select count(*)::int from public.profiles where nickname = '실명홍길동'), 0, '실명이 어떤 닉네임으로도 저장되지 않았다');

-- ---------------------------------------------------------------- 사용자 B: 중복 허용, 타인 불변, 직접 쓰기 금지
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.set_my_nickname('Alice1'), '{"nickname":"Alice1"}'::jsonb, '[B] 다른 사용자와 같은 닉네임도 허용(중복 허용)');
select is(public.get_my_profile(), '{"nickname":"Alice1"}'::jsonb, '[B] 자기 닉네임만 본다');
select is((select count(*)::int from public.profiles), 1, '[B] profiles는 본인 행만 보인다');
select ok(public.test_err($$update public.profiles set nickname = 'hacked'$$, '42501'), '[B] 직접 UPDATE 금지');
select ok(public.test_err($$insert into public.profiles (id, nickname) values ('dddddddd-0000-4000-8000-000000000004', 'forged')$$, '42501'), '[B] 타인 행 직접 INSERT 금지');
select ok(public.test_err($$delete from public.profiles$$, '42501'), '[B] 직접 DELETE 금지');
reset role;
select is((select count(*)::int from public.profiles where nickname = 'Alice1'), 2, '같은 닉네임이 두 계정에 저장되어 있다');
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '변경8', 'B의 작업이 A의 닉네임에 영향을 주지 않았다');
select is((select nickname from public.profiles where id = 'cccccccc-0000-4000-8000-000000000003'), 'Alice1', 'B의 작업이 C에게 영향을 주지 않았다');
select is((select count(*)::int from public.profiles where id = 'dddddddd-0000-4000-8000-000000000004'), 0, '타인 id로 행이 만들어지지 않았다');

-- ---------------------------------------------------------------- CHECK 제약 (관리자 권한으로도 규칙 위반은 막힌다)
select ok(public.test_err($$update public.profiles set nickname = 'a' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 1자 거절');
select ok(public.test_err($$update public.profiles set nickname = 'abcdefghijklm' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 13자 거절');
select ok(public.test_err($$update public.profiles set nickname = '한 글' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 내부 공백 거절');
select ok(public.test_err($$update public.profiles set nickname = ' 한글 ' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 앞뒤 공백이 남은 값 거절');
select ok(public.test_err($$update public.profiles set nickname = '한글' || chr(10) where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 뒤 줄바꿈 거절');
select ok(public.test_err($$update public.profiles set nickname = 'ㅋㅋ' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, '23514'), 'CHECK: 자음 단독 거절');
update public.profiles set nickname = null where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select is((select nickname from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), null,
  'CHECK: null은 허용된다 (닉네임 없는 계정으로 되돌릴 수 있다)');

-- ---------------------------------------------------------------- 기존 함수는 그대로
select ok(exists (select 1 from pg_proc where oid = 'public.ensure_my_profile()'::regprocedure), 'ensure_my_profile이 그대로 있다');
select ok(pg_get_functiondef('public.ensure_my_profile()'::regprocedure) not like '%nickname%', 'ensure_my_profile은 닉네임을 다루지 않는다');
select ok(pg_get_functiondef('public.set_my_nickname(text)'::regprocedure) !~ '\mname\M', 'set_my_nickname은 name 열을 참조하지 않는다');
select ok(pg_get_functiondef('public.get_my_profile()'::regprocedure) !~ '\mp\.name\M', 'get_my_profile은 name 열을 참조하지 않는다');

select * from finish();
rollback;
