# 옵션별 수량 migration 적용 기록 (개발 프로젝트)

- 적용일: 2026-11-17, 서정 승인("반영해요") 후 Claude Code가 실행
- 대상: Supabase 개발 프로젝트 ref `msiahbzzebgjsoanjbtx` (서정이 테스트용으로 확인)
- 적용 파일: `supabase/migrations/20261117010000_option_quantity.sql`
  - 원본 브랜치: `feat/option-quantity`, 원본 커밋 `004a3d1`
  - SHA-256: `defff9717e22909864452656425d0288b908088a08714b08d1458ed21845d187`
  - 적용 방법: Supabase MCP `apply_migration`(한 트랜잭션). 이력 버전은 파일명과 같은 `20261117010000`
- 앱 코드(요청 v3, 메뉴 상세 수량 조절, 장바구니, 주문 스냅샷 표시)는 이 PR에 없고 `feat/option-quantity`에 있다.

## 무엇이 바뀌었나
- 컬럼: `menu_options.allow_quantity`(기본 false), `menu_options.max_quantity`(CHECK: 허용 안 하면 null, 허용하면 1 이상), `order_item_options.quantity_snapshot`(기본 1)
- 교체한 함수: `private.normalize_order_request`, `private.order_request_fingerprint`, `private.validate_order_catalog`, `public.create_order`, `public.get_my_order`, `public.get_menu`
- 새 함수: `private.order_line_options_q`
- 계약: 주문 요청 `requestVersion` 2(기존, `optionIds`)와 3(`options: [{optionId, quantity}]`)을 함께 받는다. 옵션 수량이 모두 1이면 요청 지문이 기존과 같아 재전송이 호환된다. `get_menu`는 옵션에 `allowQuantity`/`maxQuantity`를 주고 `get_my_order`의 옵션에는 `quantity`가 있다. 그룹의 최소·최대 선택은 계속 "고른 옵션 종류 수" 기준이고, 금액은 (기본가 + Σ(옵션 추가금 × 옵션 수량)) × 메뉴 수량이다.
- **이 migration은 어떤 옵션의 수량도 켜지 않는다.** 서버에서 `allow_quantity = true`인 옵션은 0개다(2026-11-18 확인). 켜는 것은 별도 데이터 작업이다.

## 확인한 것
- 2026-11-18 원격 확인: 위 컬럼·CHECK·함수가 있고 이력에 `20261117010000 option_quantity`가 있다.
- 원격 함수 7개의 코드(주석·공백 제외)가 이 파일을 임시 Postgres에 적용한 결과와 같다(`normalize_order_request`, `order_request_fingerprint`, `validate_order_catalog`, `order_line_options_q`, `create_order`, `get_menu`, `get_my_order`). 보안 속성(SECURITY DEFINER·search_path)도 같다.
- 시험: `011`·`012`·`014`의 옵션 키 목록에 `quantity` 반영, `019_option_quantity` 추가. 파일명 순서(`20261112000000` → `20261117010000`)와 실제 원격 적용 순서(`20261117010000` → `20261112000000`) 모두에서 정정·숨김 migration과 함께 DB 시험이 실패 0이다(임시 Postgres).

## 알려진 차이와 한계
- 저장소 파일의 `create_order`에는 원격에 적용된 함수에 없는 주석이 있다. 코드는 같다. 적용된 migration을 수정하지 않는 원칙에 따라 파일은 그대로 두었다.
- 적용 직전 함수 정의를 따로 백업하지 않았다. 교체 전 정의는 이 저장소의 이전 migration 파일(`20261105000000`·`20261105010000`·`20261001000200` 등)과 같다. 되돌리려면 그 정의로 `create or replace`하고 새 컬럼·함수를 지운다. 이미 `quantity_snapshot`이 있는 주문이 생기면 컬럼을 지우지 않는다.
- 실제 서버·실제 앱에서 옵션 수량을 켠 주문은 아직 시험하지 않았다.
