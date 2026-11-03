-- 원격 기능 스위치: feature_config + get_public_feature_config()
-- 근거: 개발 명세 DB-010 · OPS-002, 팀 결정 (2026-11-03 F1~F7).
--
-- 규칙:
--   테이블 = feature_config(key, boolean_value, revision, updated_at). 키마다 revision을 따로 가진다.
--   초기 행 = tossDeepLinkEnabled = false 하나뿐. 검증된 증거 없이 true를 넣지 않는다.
--   접근   = 앱(anon/authenticated)은 테이블을 직접 읽지도 쓰지도 못한다 (정책·권한 없음). 운영자만 SQL로 바꾼다.
--   조회   = get_public_feature_config()만 공개한다. 함수 안의 허용 key 목록에 있는 key만 내보낸다.
--            (비공개 key를 테이블에 둘 수 있다. 허용 목록을 바꾸려면 새 migration으로 함수를 교체한다.)
--   revision = 값(boolean_value)이 실제로 바뀔 때만 old.revision + 1. 같은 값으로 UPDATE하면 그대로.
--              직접 넣은 revision은 트리거가 덮어쓴다. INSERT는 항상 1에서 시작. key 변경 UPDATE는 거절한다.
--   configRevision = 허용 key들의 revision 중 최댓값. 허용 key 행이 없으면 그 flag는 false(안전 쪽)로 내보낸다.
--
-- 운영 변경 SQL 예시 (대시보드 SQL Editor, 서버 운영자만. 토스 사전입력 스위치):
--   켜기:  update public.feature_config set boolean_value = true  where key = 'tossDeepLinkEnabled';
--   끄기:  update public.feature_config set boolean_value = false where key = 'tossDeepLinkEnabled';
--   확인:  select key, boolean_value, revision, updated_at from public.feature_config;
--   켜기 전에 반드시 검증된 어댑터 capability가 있어야 한다 (명세 OPS-002). 끄기는 기존 주문을 바꾸거나 지우지 않는다.

-- ---------------------------------------------------------------------------
-- 트리거 함수: revision · updated_at 관리
-- ---------------------------------------------------------------------------

create function private.apply_feature_config_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.updated_at := now();
    return new;
  end if;

  if new.key is distinct from old.key then
    raise exception using errcode = 'P0001', message = 'FEATURE_KEY_IMMUTABLE',
      detail = 'feature_config.key는 바꿀 수 없다. 새 key는 새 행으로 추가한다.';
  end if;

  if new.boolean_value is distinct from old.boolean_value then
    new.revision := old.revision + 1;
    new.updated_at := now();
  else
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_feature_config_revision() from public;

-- ---------------------------------------------------------------------------
-- feature_config
-- ---------------------------------------------------------------------------

create table public.feature_config (
  key text primary key,
  boolean_value boolean not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create trigger feature_config_revision
  before insert or update on public.feature_config
  for each row execute function private.apply_feature_config_revision();

alter table public.feature_config enable row level security;
revoke all on table public.feature_config from public, anon, authenticated;
-- 정책도 만들지 않는다: 앱 권한으로는 읽기·쓰기가 모두 막힌다. 조회는 아래 DEFINER 함수로만 한다.

insert into public.feature_config (key, boolean_value) values ('tossDeepLinkEnabled', false);

-- ---------------------------------------------------------------------------
-- get_public_feature_config() : 공개 허용 key만, 입력 없음
-- 응답: { configRevision, fetchedAtServer, flags: { <key>: boolean } }
-- 앱이 테이블을 직접 읽을 수 없으므로 DEFINER로 실행한다.
-- ---------------------------------------------------------------------------

create function public.get_public_feature_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- 공개 허용 key 목록. 바꾸려면 새 migration으로 이 함수를 교체한다.
  v_allowed constant text[] := array['tossDeepLinkEnabled'];
  v_flags jsonb;
  v_revision bigint;
begin
  select coalesce(jsonb_object_agg(k.key, coalesce(c.boolean_value, false)), '{}'::jsonb),
         coalesce(max(c.revision), 0)
    into v_flags, v_revision
    from unnest(v_allowed) as k(key)
    left join public.feature_config c on c.key = k.key;

  return jsonb_build_object(
    'configRevision', v_revision,
    'fetchedAtServer', now(),
    'flags', v_flags
  );
end;
$$;

revoke execute on function public.get_public_feature_config() from public, anon, authenticated;
grant execute on function public.get_public_feature_config() to anon, authenticated;
