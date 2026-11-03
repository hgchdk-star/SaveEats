-- 공개 닉네임: profiles.nickname + set_my_nickname() + get_my_profile()
-- 근거: 개발 명세 DB-003 · AUTH-005 · OPEN-DB-004, 서정 확정 규칙(2026-11-02), 팀 결정 (2026-11-04 N1~N6).
--
-- 규칙:
--   열     = profiles.nickname text (NULL 허용 = 닉네임 없는 기존 계정). unique 없음(중복 허용), 변경 횟수 제한 없음.
--   형식   = 앞뒤 일반 공백을 지운 뒤 2~12자, 완성형 한글(가-힣) · 영문 · 숫자만.
--            내부 공백 · 탭/줄바꿈 · 특수문자 · 이모지 · 자음/모음 단독 · 조합형 자모는 거절한다. 금칙어는 이번 범위가 아니다.
--            함수가 검증하고, 같은 정규식을 CHECK 제약에도 둔다(직접 쓰기 경로가 생겨도 규칙이 DB에 고정되게).
--   쓰기   = set_my_nickname만 쓴다 (DEFINER). 앱은 profiles에 직접 INSERT/UPDATE할 수 없다. 대상은 auth.uid()뿐.
--   읽기   = get_my_profile (INVOKER). 열 권한 select (nickname)과 기존 RLS(본인 행)로 본인 닉네임만 읽힌다.
--   name   = 이번 migration은 name을 읽거나 쓰거나 복사하지 않는다. name 열 · 그 grant · ensure_my_profile은 그대로 둔다.
--            (name 열 삭제는 영향 확인 후 별도 migration.) 가입 때 user_metadata로 받는 방식은 쓰지 않는다.
--   오류   = 로그인 안 됨 AUTH_REQUIRED, 규칙 위반(null · 빈 값 포함) NICKNAME_INVALID. 둘 다 P0001.

alter table public.profiles add column nickname text;

alter table public.profiles add constraint profiles_nickname_format
  check (nickname is null or nickname ~ '^[가-힣A-Za-z0-9]{2,12}$');

-- get_my_profile(INVOKER)가 읽을 수 있도록 이 열만 연다. name은 이 함수가 읽지 않는다.
grant select (nickname) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- set_my_nickname(p_nickname) → { nickname }
-- 프로필 행이 없으면 (id, nickname)만 넣어 만든다. 같은 값이면 UPDATE하지 않는다(updated_at 그대로).
-- ---------------------------------------------------------------------------

create function public.set_my_nickname(p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_nickname text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- 앞뒤 일반 공백(U+0020)만 지운다. 탭 · 줄바꿈 · 전각 공백은 허용 문자가 아니므로 아래에서 거절된다.
  v_nickname := btrim(p_nickname, ' ');

  if v_nickname is null or v_nickname !~ '^[가-힣A-Za-z0-9]{2,12}$' then
    raise exception using errcode = 'P0001', message = 'NICKNAME_INVALID';
  end if;

  insert into public.profiles (id, nickname) values (v_uid, v_nickname)
  on conflict (id) do update
    set nickname = excluded.nickname, updated_at = now()
    where public.profiles.nickname is distinct from excluded.nickname;

  return jsonb_build_object('nickname', v_nickname);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_my_profile() → { nickname: null | 문자열 }
-- 읽기 전용: 행이 없으면 만들지 않고 null. 닉네임 없는 기존 계정도 null로 성공한다.
-- ---------------------------------------------------------------------------

create function public.get_my_profile()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  return jsonb_build_object(
    'nickname', (select p.nickname from public.profiles p where p.id = v_uid)
  );
end;
$$;

revoke execute on function public.set_my_nickname(text) from public, anon, authenticated;
revoke execute on function public.get_my_profile() from public, anon, authenticated;
grant execute on function public.set_my_nickname(text) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
