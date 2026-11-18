
begin
  -- 상태와 관련된 네 열 말고는 바꿀 수 없다
  if (to_jsonb(new) - array['status', 'status_revision', 'completed_at', 'cancelled_at'])
     is distinct from (to_jsonb(old) - array['status', 'status_revision', 'completed_at', 'cancelled_at']) then
    raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
      detail = '주문의 스냅샷·소유자·금액 등은 바꿀 수 없다.';
  end if;

  if old.status <> 'PENDING' then
    -- terminal(USER_CONFIRMED / CANCELLED)은 상태·시각·revision 모두 고정
    if (new.status, new.status_revision, new.completed_at, new.cancelled_at)
       is distinct from (old.status, old.status_revision, old.completed_at, old.cancelled_at) then
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '완료·취소된 주문의 상태와 시각은 바꿀 수 없다.';
    end if;
  elsif new.status is distinct from old.status then
    -- PENDING에서 상태가 바뀔 때는 revision이 정확히 +1
    if new.status_revision <> old.status_revision + 1 then
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '상태가 바뀔 때 status_revision은 정확히 1 늘어야 한다.';
    end if;
  elsif (new.status_revision, new.completed_at, new.cancelled_at)
        is distinct from (old.status_revision, old.completed_at, old.cancelled_at) then
    raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
      detail = '상태가 그대로면 revision과 시각도 그대로여야 한다.';
  end if;
  return new;
end;
