-- 원격 기능 스위치: feature_config + get_public_feature_config()
-- 근거: 개발 명세 DB-010 · OPS-002. 테스트 데이터는 롤백으로 사라진다.
-- 같은 트랜잭션 안에서는 now()가 변하지 않으므로, updated_at 갱신은 트리거를 잠시 끄고 옛 시각을 넣어 확인한다.
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

-- ---------------------------------------------------------------- 초기 상태 (superuser)
select is((select count(*)::int from public.feature_config), 1, '초기 행은 정확히 1개');
select is((select key from public.feature_config), 'tossDeepLinkEnabled', '초기 key는 tossDeepLinkEnabled');
select is((select boolean_value from public.feature_config where key = 'tossDeepLinkEnabled'), false, '초기값은 false');
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 1::bigint, '초기 revision은 1');

-- ---------------------------------------------------------------- 응답 모양
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_public_feature_config()) k),
  array['configRevision','fetchedAtServer','flags'], '응답 최상위 키는 configRevision / fetchedAtServer / flags');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_public_feature_config()->'flags') k),
  array['tossDeepLinkEnabled'], 'flags에는 허용 key만 있다');
select is(jsonb_typeof(public.get_public_feature_config()->'flags'->'tossDeepLinkEnabled'), 'boolean', 'flag 값은 boolean');
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, false, '초기 응답 flag는 false');
select is(jsonb_typeof(public.get_public_feature_config()->'configRevision'), 'number', 'configRevision은 숫자');
select is((public.get_public_feature_config()->>'configRevision')::bigint, 1::bigint, '초기 configRevision은 1');
select is(jsonb_typeof(public.get_public_feature_config()->'fetchedAtServer'), 'string', 'fetchedAtServer는 문자열(시각)');
select ok((public.get_public_feature_config()->>'fetchedAtServer')::timestamptz is not null, 'fetchedAtServer는 시각으로 읽힌다');

-- ---------------------------------------------------------------- 함수 정의 (DEFINER, search_path 고정, 입력 없음)
select ok((select prosecdef from pg_proc where oid = 'public.get_public_feature_config()'::regprocedure),
  'get_public_feature_config는 SECURITY DEFINER');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%') from pg_proc where oid = 'public.get_public_feature_config()'::regprocedure),
  'search_path가 빈 값으로 고정되어 있다');
select is((select pronargs::int from pg_proc where oid = 'public.get_public_feature_config()'::regprocedure), 0, '입력 인자가 없다');
select ok(not exists (
    select 1 from pg_proc p
    where p.oid = 'public.get_public_feature_config()'::regprocedure and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  'PUBLIC에는 EXECUTE를 열어두지 않았다');
select ok(not exists (
    select 1 from pg_proc p
    where p.oid = 'private.apply_feature_config_revision()'::regprocedure and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  '트리거 함수도 PUBLIC에 열려 있지 않다');

-- ---------------------------------------------------------------- 테이블 보호 (설정)
select ok((select relrowsecurity from pg_class where oid = 'public.feature_config'::regclass), 'feature_config는 RLS가 켜져 있다');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'feature_config'), 0, '정책이 하나도 없다');
select ok(not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid = 'public.feature_config'::regclass
      and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)),
  'anon/authenticated/PUBLIC 대상 테이블 권한이 없다');
select ok(not exists (
    select 1 from pg_attribute where attrelid = 'public.feature_config'::regclass and attnum > 0 and attacl is not null),
  '열 단위 권한도 없다');

-- ---------------------------------------------------------------- 앱 권한: 함수는 실행, 테이블은 전부 거절
set local role anon;
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, false, '[anon] 함수로 flag를 읽는다');
select ok(public.test_err($$select * from public.feature_config$$, '42501'), '[anon] 테이블 SELECT 거부');
select ok(public.test_err($$insert into public.feature_config (key, boolean_value) values ('x', true)$$, '42501'), '[anon] INSERT 거부');
select ok(public.test_err($$update public.feature_config set boolean_value = true$$, '42501'), '[anon] UPDATE 거부');
select ok(public.test_err($$delete from public.feature_config$$, '42501'), '[anon] DELETE 거부');
select ok(public.test_err($$select private.apply_feature_config_revision()$$, '42501'), '[anon] 트리거 함수 직접 실행 거부');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, false, '[로그인] 함수로 flag를 읽는다');
select ok(public.test_err($$select * from public.feature_config$$, '42501'), '[로그인] 테이블 SELECT 거부');
select ok(public.test_err($$insert into public.feature_config (key, boolean_value) values ('x', true)$$, '42501'), '[로그인] INSERT 거부');
select ok(public.test_err($$update public.feature_config set boolean_value = true$$, '42501'), '[로그인] UPDATE 거부');
select ok(public.test_err($$delete from public.feature_config$$, '42501'), '[로그인] DELETE 거부');
reset role;
select is((select boolean_value from public.feature_config where key = 'tossDeepLinkEnabled'), false, '앱 권한 시도 후에도 값은 false 그대로');

-- ---------------------------------------------------------------- 비공개 key 비노출
insert into public.feature_config (key, boolean_value) values ('zzPrivateFlag', true);
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_public_feature_config()->'flags') k),
  array['tossDeepLinkEnabled'], '허용 목록에 없는 key는 flags에 나오지 않는다');
select is(public.get_public_feature_config()::text like '%zzPrivateFlag%', false, '응답 어디에도 비공개 key 이름이 없다');
update public.feature_config set boolean_value = false where key = 'zzPrivateFlag';
update public.feature_config set boolean_value = true where key = 'zzPrivateFlag';
select is((select revision from public.feature_config where key = 'zzPrivateFlag'), 3::bigint, '비공개 key의 revision은 따로 올라간다');
select is((public.get_public_feature_config()->>'configRevision')::bigint, 1::bigint,
  'configRevision은 허용 key의 revision만 본다 (비공개 key는 영향 없음)');

-- ---------------------------------------------------------------- 트리거: INSERT
insert into public.feature_config (key, boolean_value, revision) values ('zzInsert99', false, 99);
select is((select revision from public.feature_config where key = 'zzInsert99'), 1::bigint, 'INSERT는 직접 준 revision을 무시하고 1에서 시작');
insert into public.feature_config (key, boolean_value, revision) values ('zzInsert0', false, 0);
select is((select revision from public.feature_config where key = 'zzInsert0'), 1::bigint, 'INSERT에 revision 0을 줘도 1');
select ok(public.test_err($$insert into public.feature_config (key, boolean_value) values ('zzInsert99', true)$$, '23505'), '같은 key 중복 INSERT 거절');
select ok(public.test_err($$insert into public.feature_config (key, boolean_value) values ('zzNull', null)$$, '23502'), 'boolean_value가 null이면 거절');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.feature_config'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%revision > 0%'), 'revision > 0 검사 제약이 있다');

-- ---------------------------------------------------------------- 트리거: UPDATE
-- 시각 비교를 위해 트리거를 잠시 끄고 updated_at을 옛날로 돌린다
alter table public.feature_config disable trigger feature_config_revision;
update public.feature_config set updated_at = '2000-01-01 00:00:00+00' where key = 'tossDeepLinkEnabled';
alter table public.feature_config enable trigger feature_config_revision;

update public.feature_config set boolean_value = false where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 1::bigint, '같은 값으로 UPDATE하면 revision 그대로');
select is((select updated_at from public.feature_config where key = 'tossDeepLinkEnabled'), '2000-01-01 00:00:00+00'::timestamptz, '같은 값 UPDATE는 updated_at도 그대로');
select is((public.get_public_feature_config()->>'configRevision')::bigint, 1::bigint, '같은 값 UPDATE 후 configRevision 그대로');

update public.feature_config set boolean_value = true where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 2::bigint, '값이 바뀌면 revision +1');
select ok((select updated_at from public.feature_config where key = 'tossDeepLinkEnabled') > '2000-01-01 00:00:00+00'::timestamptz, '값이 바뀌면 updated_at 갱신');
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, true, '응답 flag가 true로 바뀐다');
select is((public.get_public_feature_config()->>'configRevision')::bigint, 2::bigint, '응답 configRevision이 따라 올라간다');

update public.feature_config set boolean_value = false where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 3::bigint, '다시 바뀌면 또 +1 (되돌려도 내려가지 않는다)');
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, false, '다시 false로 끄면 응답도 false');

update public.feature_config set revision = 500, boolean_value = true where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 4::bigint, '값 변경과 함께 준 revision은 덮어쓰고 old+1');
update public.feature_config set revision = 1 where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 4::bigint, 'revision만 낮춰 쓰려 해도 그대로 (값 안 바뀜)');
update public.feature_config set revision = 900 where key = 'tossDeepLinkEnabled';
select is((select revision from public.feature_config where key = 'tossDeepLinkEnabled'), 4::bigint, 'revision만 높여 쓰려 해도 그대로');

select ok(public.test_err($$update public.feature_config set key = 'tossRenamed' where key = 'tossDeepLinkEnabled'$$, 'P0001', 'FEATURE_KEY_IMMUTABLE'),
  'key를 바꾸는 UPDATE는 거절');
select ok(public.test_err($$update public.feature_config set key = 'tossRenamed', boolean_value = true where key = 'tossDeepLinkEnabled'$$, 'P0001', 'FEATURE_KEY_IMMUTABLE'),
  'key와 값을 같이 바꾸는 UPDATE도 거절');
select is((select count(*)::int from public.feature_config where key = 'tossDeepLinkEnabled'), 1, 'key 변경 시도 후에도 원래 key가 그대로 있다');

-- ---------------------------------------------------------------- 허용 key 행이 없을 때 (안전 쪽)
delete from public.feature_config where key = 'tossDeepLinkEnabled';
select is((public.get_public_feature_config()->'flags'->>'tossDeepLinkEnabled')::boolean, false, '허용 key 행이 없으면 flag는 false');
select is((public.get_public_feature_config()->>'configRevision')::bigint, 0::bigint, '허용 key 행이 없으면 configRevision은 0');

select * from finish();
rollback;
