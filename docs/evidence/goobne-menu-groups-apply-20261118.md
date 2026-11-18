# 굽네 메뉴 그룹·모짜치즈볼 교체·가상 옵션 정리 반영 기록 (개발 프로젝트)

- 반영일: 2026-11-18, 서정 승인 후 Claude Code가 실행
- 대상: Supabase 개발 프로젝트 ref `msiahbzzebgjsoanjbtx`(서정이 테스트용으로 확인), 가게 `굽네치킨` `d5c4fa89-212d-58ca-ac17-b364518e55e3`
- 도구: `data/imports/goobne-coupangeats-20261117/import_goobne.py` (브랜치 `feat/goobne-existing-store-import`). 메뉴 그룹 자료는 저장소 밖(`goobne-menu-groups-20261118`, 읽기 전용)
- migration: `20261119000000_store_menu_groups.sql` (브랜치 `feat/store-menu-groups`, 반영한 SQL은 저장소 파일과 같음, `get_store` 본문 지문 일치). 이력 버전은 파일명에 맞게 `20261119000000`으로 고쳤다.

## 반영 순서와 결과
1. 상태 재확인(읽기 전용): FK 4개(`menu_option_groups→menus`, `menu_options→menu_option_groups`, `order_items→menus`, `review_menus→menus`, 모두 RESTRICT), `source_option_id/source_group_id`를 쓰는 함수는 `create_order`(기록만), 트리거 3개, 뷰 의존 0, 참조 건수(가상 옵션 1·그룹 1, 모짜치즈볼 0)가 보고와 같았다.
2. 백업(아래).
3. migration: `store_menu_groups`(12행), `store_menu_group_items`(116행) 추가, `get_store`에 `menuGroups`. RLS는 활성 그룹만, 원본 이름(`source_name`) 열은 앱에 열지 않음.
4. 모짜치즈볼 교체(C안): 기존 `모짜치즈볼(5pcs)`(`e5525d07-02b7-59d7-a806-8aadd7b9d722`, 주문·리뷰·옵션 참조 0)를 행·사진 파일(179,461바이트)까지 백업한 뒤 물리 삭제하고, 수집 "모짜치즈볼"(원본 97001427, 5,000원, 수집 설명, 수집 사진)을 새 UUID `37f16a72-1449-5e15-8e2d-970ced147a75`로 등록했다. 개수(5pcs)는 쓰지 않았다. 기존 사진 파일은 재사용하지 않고 삭제했다.
5. 메뉴 그룹·순서: 12개 그룹(표시명 `셰프컬렉션`은 서정 승인, 원본 `[와우전용] 이츠셰프컬렉션`은 `source_name`과 내부 출처 기록에 보존)과 116개 연결, 메뉴 `sort_order`를 수집 순서로 맞춤.
6. 이전 가상 옵션 정리(서정 승인, 주문 스냅샷이 가리키던 옵션·그룹 포함): 실행 직전 FK·의존성·참조 건수를 다시 확인해 보고와 같음을 확인한 뒤 옵션 23개·그룹 8개 물리 삭제.

## 결과 수치
| 구분 | 값 |
|---|---|
| 굽네 메뉴 | 116(활성 109, 숨김 7=주류) / 서버 전체 활성 메뉴 259 |
| 메뉴 그룹 | 12개 중 앱에 보이는 그룹 11개(주류 그룹은 보이는 메뉴가 없어 숨김) |
| 그룹 연결 | 수집 메뉴 116개 전부(그룹 없는 활성 메뉴 0, "기타 메뉴" 없음) |
| 옵션 그룹·옵션 | 510→502, 3,499→3,476 (가상 옵션 그룹 8·옵션 23 삭제) |
| 수량 조절 옵션 | 475행, 상한 10 (변경 없음) |
| 사진 | 굽네 메뉴 image_ref 98개 모두 Storage에 파일이 있음, 가게 대표사진 `stores.image_ref` 변경 없음 |

## 검증
- 도구 검증: 관리자 20개, Guest(anon) `get_menu` 109/109 일치, 사진 84/84 실제 내려받기·해시 일치, 그룹·순서 10개(REST `get_store` 포함).
- 서버 직접 확인: 가상 그룹·옵션 0개 남음, 주문 옵션 스냅샷 행 그대로(1건), 주문 지문 불변(검증 시점), 소유자 권한으로 `get_my_order`·`get_my_history_order`·`list_my_orders` 정상(삭제된 옵션 이름·가격 "구성 선택 / 순살 +2,000원"이 스냅샷에 그대로).
- 앱 코드 확인: 실제 Guest 응답을 앱의 파서·구역 구성·가게 안 검색에 통과시켜 구역 11개, 메뉴 109개, 기타 메뉴 없음, 사이드 메뉴 8번째(원본 순서값 7)가 모짜치즈볼임을 확인.
- 재실행: `--check`·`--apply`·`--groups-apply`·`--cleanup` 재실행에서 메뉴·그룹·연결·옵션·사진 수와 지문이 그대로(중복 없음).
- 실제 사용자 주문은 만들거나 바꾸지 않았다. 검증 도중 서정이 앱에서 만든 다른 가게 주문 1건이 늘었고, 굽네 주문 `cda03c8b…`는 앱에서 정정되어 `CANCELLED`가 되었다(이 작업과 무관).

## 백업 (비공개, git 제외, 인증정보 없음 — 값 일치 검사로 확인)
`data/imports/goobne-coupangeats-20261117/backup/` (도구용 작업 폴더 `SaveEats-goobne-tool` 안)
- `20261118-182753-392539/`: 이번 작업 시작 전 상태(`before_state.json`)와 교체 대상 기존 메뉴 행·사진 파일(`replaced_menus.json`, `replaced_files/`)
- `pre-groups-get_store-20261118-164018/`: 적용 전 `get_store` 정의
- `groups-20261118-183525-663366/`: 그룹 적용 전 메뉴 `sort_order`
- `cleanup-20261118-183535-980229/`: 삭제한 가상 옵션·그룹 행 전체(`deleted_rows.json`)와 과거 주문 스냅샷의 원본 ID 대응(`snapshot_source_id_map.json`)
- 가져오기 최초 적용(11-18 오후) 전 백업은 앱 폴더(`SaveEats/data/imports/…/backup/20261118-151905-467820/`)에 있다.

## 되돌리는 방법
- 가상 옵션 정리: `--cleanup-restore --yes-dev-project --backup-dir backup/cleanup-…` (행 전체 복원)
- 메뉴 그룹: `--groups-restore --yes-dev-project --backup-dir backup/groups-…` (그룹·연결 삭제, 메뉴 순서 복원). 그룹 테이블과 `get_store`를 되돌리려면 테이블 2개를 삭제하고 백업한 `get_store` 정의를 실행한다.
- 모짜치즈볼 교체: `--replace-restore --yes-dev-project --backup-dir backup/20261118-182753-392539` (새 메뉴 삭제, 기존 행·사진 복원)
- 되돌릴 때는 정리 → 그룹 → 교체 순서의 반대 순서(정리 복원 → 그룹 복원 → 교체 복원)로 한다.
