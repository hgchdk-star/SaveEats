# 정정·취소 내역 숨김 migration 적용 기록 (개발 프로젝트)

- 적용일: 2026-11-18 (UTC 05:35경), 서정 승인 후 Claude Code가 실행
- 대상: Supabase 개발 프로젝트 ref `msiahbzzebgjsoanjbtx` (서정이 테스트용으로 확인)
- 적용 파일: `supabase/migrations/20261112000000_history_hide_and_correct.sql`
  - 원본 브랜치: `origin/feat/history-hide-and-correct` (혜지 작성, 아직 main에 병합되지 않음)
  - 원본 커밋: `e4fd166` (feat(db): 취소 주문 내역 숨기기와 완료 정정 서버 함수 추가). 브랜치 끝 `caf298a`의 같은 파일과 내용이 같다
  - SHA-256: `28daabb5dcaf23c4efa806d61c4761eb6399856262b637ffece9be029d78f94c`
  - 적용한 SQL은 이 파일과 같다(주석 포함). 적용 방법: Supabase MCP `apply_migration`(한 트랜잭션)
- 이번에 포함하지 않은 것: 회원 탈퇴 migration(`20261116000000_delete_my_account.sql`), 굽네 데이터 import, 앱 코드

## 무엇이 바뀌었나
- 컬럼: `orders.hidden_at`(timestamptz, null 허용, CHECK로 CANCELLED만), `order_status_updates.reason`(text, null 허용, `COMPLETION_CORRECTED`만)
- 교체한 함수 4개: `private.guard_order_update`, `public.list_my_orders`, `public.get_my_history_unread_summary`, `public.get_my_history_order`
- 새 함수 2개: `public.hide_cancelled_order(p_order_id)`, `public.correct_order_completion(p_order_id, p_operation_id)` (SECURITY DEFINER, search_path 고정, authenticated만 실행)
- 바꾸지 않은 것: `create_order`·`confirm_order`·`cancel_order`·`create_review`·`get_my_order`·`get_menu`·`validate_order_catalog` 등 옵션 수량(`20261117010000`)과 주문 처리 함수

## 적용 전 확인
- 선행 migration: 이력 `20261001000000`~`20261109000000`과 `20261117010000`이 모두 있고, `reviews.order_id/deleted_at`, `order_status_updates.operation_id` 등 필요한 열이 있다.
- 원격 정의 vs 저장소 기준: 원격 함수 본문은 일부가 윈도우 줄바꿈(CRLF)이다. 줄바꿈을 정규화하면 저장소 기준(옵션 수량 migration까지 적용한 임시 Postgres)과 모두 같았다. `create_order`만 저장소 파일에 주석이 더 있고 코드는 같다(주석·공백 제거 후 일치).
- migration이 바꾸는 함수는 위 4개뿐이다(임시 DB에서 적용 전·후 비교). 옵션 수량·주문 처리 함수는 바뀌지 않고 보안 속성(SECURITY DEFINER·search_path)도 유지된다. `get_my_history_order`는 `get_my_order`를 그대로 호출해 옵션 수량(`quantity`)이 유지된다.
- 임시 Postgres에서 혜지의 DB 시험 `019_history_hide_and_correct`(110개)가 실제 적용 순서(옵션 수량 → 이 migration)로 실패 0.

## 변경 전 정의 백업
`docs/evidence/history-hide-and-correct-pre-apply-defs/`의 4개 파일은 교체 전 함수 본문(`prosrc`)이다. 원격 원본과 바이트까지 같다(원격에서 읽은 md5와 일치 확인, CRLF 포함).

| 함수 | 원격 원본 md5(prosrc) |
|---|---|
| private.guard_order_update | `0694acd1718b169adcd84d6bac6982ee` |
| public.list_my_orders | `e7cc563800eb40c251ff73b86f68239f` |
| public.get_my_history_unread_summary | `542eb83a7a1e97a37508e1aea0687c62` |
| public.get_my_history_order | `54087b66700b5f2aa89fc3feefc567d3` |

되돌릴 때는 이 4개를 `create or replace function`으로 복원하고(함수 선언부는 이 migration 파일의 해당 함수와 같은 시그니처), 새 함수 2개와 컬럼 2개를 지운다. 컬럼은 null 허용이라 두어도 기존 앱 동작에는 영향이 없다.

## 적용 후 확인
- 이력: `20261112000000 history_hide_and_correct`로 기록. `apply_migration`이 처음에는 `20261118053543`으로 기록해 파일명과 맞게 `20261112000000`으로 고쳤다(그대로 두면 이후 `supabase db push`가 이 migration을 다시 적용하려 한다).
- 함수 6개의 본문이 저장소 원본과 같음(정규화 md5 일치).
- 권한: 두 새 함수 모두 `anon`·`public` 실행 불가, `authenticated` 실행 가능, SECURITY DEFINER, search_path 고정. 비로그인(anon) 호출은 `42501 permission denied`로 거절된다(존재하지 않는 UUID로 확인, 데이터 변경 없음). `orders_guard` 트리거 유지.
- 기존 주문 불변: 적용 전·후 지문이 같다. orders 35건, 상태 이력 68건, 주문 항목·옵션 스냅샷, USER_CONFIRMED 19건 그대로. `hidden_at`이 있는 주문 0건, `reason`이 있는 이력 0건. 실제 사용자 주문을 정정하거나 숨기지 않았다.
- 시험하지 못한 것: 실제 로그인 사용자로 정정·숨김 호출, iPhone 화면.

## 저장소 상태 메모
- 이 migration 파일은 아직 main에 없다. 혜지의 `feat/history-hide-and-correct` 병합이 필요하다. 그 브랜치에는 `delete_my_account` migration도 함께 있어, 병합하면 탈퇴 migration이 저장소에 들어오지만 원격에는 적용되지 않은 상태가 된다(별도 결정).
- 옵션 수량 migration(`20261117010000`)도 main에 없다(`feat/option-quantity`). 두 파일이 모두 병합되기 전에는 원격 이력과 main의 파일 목록이 어긋난다.
- 원격 migration 이력은 `20261112000000`이 `20261117010000`보다 앞 번호지만 나중에 적용되었다(번호 순서와 적용 순서가 다름).
