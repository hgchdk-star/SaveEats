-- 메뉴 사진 버킷: menu-images
-- 근거: 팀 결정 (2026-10-29). 공개 읽기, 앱 키의 업로드·수정·삭제·목록 조회 금지.
-- 이 테스트는 DB 수준(RLS)만 확인한다. 실제 Storage API(HTTP)로 올려 보는 확인은 따로 한다.
-- 테스트 객체는 롤백으로 사라진다.
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

-- 실행한 문장이 건드린 행 수. RLS가 행을 걸러 0행이거나, 권한이 없어 42501이면 0으로 본다 (둘 다 "막혔다").
create function public.test_affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return 0;
end;
$$;

-- ---------------------------------------------------------------- 버킷 설정 (superuser)
select is((select count(*)::int from storage.buckets where id = 'menu-images'), 1, '버킷 menu-images가 있다');
select is((select public from storage.buckets where id = 'menu-images'), true, '공개 버킷이다');
select is((select file_size_limit from storage.buckets where id = 'menu-images'), 2097152::bigint, '파일 크기 상한은 2MiB');
select is((select allowed_mime_types from storage.buckets where id = 'menu-images'), array['image/png', 'image/jpeg'], '허용 형식은 png, jpeg뿐');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), 'storage.objects는 RLS가 켜져 있다');
select is((select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%menu-images%' or coalesce(with_check, '') like '%menu-images%')),
  0, 'menu-images를 대상으로 하는 정책이 하나도 없다');

-- 관리자(superuser)는 올릴 수 있다. 앱 키가 막히는지 보려면 먼저 객체가 있어야 한다.
insert into storage.objects (bucket_id, name) values ('menu-images', 'menus/zz-test-existing.png');
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images' and name = 'menus/zz-test-existing.png'), 1,
  '관리자 권한으로는 업로드할 수 있다 (테스트 객체 준비)');

-- ---------------------------------------------------------------- anon
set local role anon;

select ok(public.test_err($$insert into storage.objects (bucket_id, name) values ('menu-images', 'menus/zz-anon-new.png')$$, '42501'),
  '[anon] 업로드(insert) 거부');
select is(public.test_affected($$update storage.objects set name = 'menus/zz-hacked.png' where bucket_id = 'menu-images'$$), 0::bigint,
  '[anon] 수정(update)은 한 행도 못 바꾼다');
select is(public.test_affected($$delete from storage.objects where bucket_id = 'menu-images'$$), 0::bigint,
  '[anon] 삭제(delete)는 한 행도 못 지운다');
select is(public.test_affected($$select name from storage.objects where bucket_id = 'menu-images'$$), 0::bigint,
  '[anon] 파일 목록(select)이 비어 있다 (목록 정책 없음)');
select ok(public.test_err($$update storage.buckets set public = false where id = 'menu-images'$$, '42501')
  or public.test_affected($$update storage.buckets set public = false where id = 'menu-images'$$) = 0,
  '[anon] 버킷 설정을 바꿀 수 없다');

-- ---------------------------------------------------------------- authenticated
reset role;
set local role authenticated;

select ok(public.test_err($$insert into storage.objects (bucket_id, name) values ('menu-images', 'menus/zz-auth-new.png')$$, '42501'),
  '[authenticated] 업로드(insert) 거부');
select is(public.test_affected($$update storage.objects set name = 'menus/zz-hacked.png' where bucket_id = 'menu-images'$$), 0::bigint,
  '[authenticated] 수정(update)은 한 행도 못 바꾼다');
select is(public.test_affected($$delete from storage.objects where bucket_id = 'menu-images'$$), 0::bigint,
  '[authenticated] 삭제(delete)는 한 행도 못 지운다');
select is(public.test_affected($$select name from storage.objects where bucket_id = 'menu-images'$$), 0::bigint,
  '[authenticated] 파일 목록(select)이 비어 있다 (목록 정책 없음)');

-- ---------------------------------------------------------------- 그대로 남았는지 (superuser)
reset role;

select is((select array_agg(name order by name) from storage.objects where bucket_id = 'menu-images'),
  array['menus/zz-test-existing.png'], '앱 키로 시도한 뒤에도 객체는 그대로이고 새 객체는 생기지 않았다');
select is((select public from storage.buckets where id = 'menu-images'), true, '앱 키로 시도한 뒤에도 버킷은 공개 그대로');

select * from finish();
rollback;
