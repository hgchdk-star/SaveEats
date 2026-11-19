# 버거킹(쿠팡이츠 홍제역점) → 기존 버거킹 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `burgerking-coupangeats-20261119`)를 SaveEats **개발 서버**의 기존 가게(`f754f737-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다.
백소정 도구(`../baeksojeong-coupangeats-20261119/import_baeksojeong.py`)를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 버거킹 구조
- **고유 메뉴 122개, 그룹 소속 126개**: 더 크리스퍼 4개 메뉴가 '신제품(NEW)'과 다른 그룹에 함께 속한다. 메뉴 본체·사진·옵션은 하나만 두고 그룹 연결만 늘린다. 메뉴 정렬은 첫 소속 순서다.
- **기존 가상 메뉴 5개는 전부 같은 상품으로 연결**한다(`menu_mapping.json`): 이름·가격이 같고(치즈와퍼 세트만 띄어쓰기 차이) 기존 사진과 수집 사진이 같은 상품. UUID·인기·주문·리뷰 참조·기존 사진은 유지하고 비어 있던 설명만 채운다. 삭제·숨길 메뉴는 없다.
- **필수 옵션**: 세트 38개에 "세트 사이드 교환"·"세트 음료 교환1"(각 SELECT_ONE 1~1, 필수 그룹 76개). 기본 선택값은 원본에도 없고 자동 선택하지 않는다. 선택 그룹 "컨디먼트 추가 선택"(0~1000종, 추가금 있음)과 "꿀조합"(0~1)은 필수가 아니다. 필수 38개 메뉴는 상세로, 나머지 84개는 목록에서 바로 담긴다.
- **수량**: 원본 수량 변경 선택지가 0개다. maxQuantity=1000인 선택지 122개는 수량 조절 근거가 아니라서 수량 조절을 켜지 않고 상한도 적용하지 않는다. `isExclusive`·`maxTotalQuantity`는 쓰지 않는다(이름만 보고 추가하지 않는다. `option_policy.json`이 비어 있다).
- **옵션 그룹 원본 ID는 메뉴가 재사용**한다(고유 그룹 5개·선택지 31개). 그룹·옵션 UUID는 메뉴별로 따로 만든다(`id_map.json`).
- **사진**: 126개 사진 기록 = 122개 메뉴 연결(4개 메뉴는 같은 파일을 두 번 기록) · 고유 파일 120개. 연결 5개는 기존 사진을 유지하고 새 메뉴 117개는 메뉴별 `menus/<메뉴 UUID>.jpg`로 올린다.

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--sold-out-mode ignore|source`: 수집 당시 "오늘 품절" 2개(오리지널스 엘파소 치폴레 12,000원, 오리지널스 엘파소 치폴레 세트 14,700원)를 판매 가능으로 표시(`ignore`)할지 품절로 표시(`source`)할지. 원본 상태·수집 시점은 내부 기록에 남긴다.
- 스냅샷이 가리키는 기존 가상 옵션 그룹(치즈와퍼 세트의 사이드 선택·음료 선택)의 삭제: 승인 전에는 삭제하지 않고 비활성으로 보존한다. 승인하면 `menu_mapping.json`의 `approved_snapshot_referenced_group_ids`에 그룹 id를 넣고(원본 ID 대응은 백업에 기록) 적용한다.
- `--group-names`: 그룹명에 혜택·할인 표현이 없어 정리 제안이 없다(필수 아님).

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/burgerking-coupangeats-20261119
python import_burgerking.py --package $P --check --sold-out-mode ignore                      # 읽기 전용 보고서(out/check_report.md)
python import_burgerking.py --package $P --backup --yes-dev-project --sold-out-mode ignore   # 적용 전 백업(backup/<시각>/)
python import_burgerking.py --package $P --apply --yes-dev-project --sold-out-mode ignore    # 백업 → 사진 117개 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_burgerking.py --package $P --verify --sold-out-mode ignore --backup-dir backup/<적용 전 시각>
python import_burgerking.py --package $P --restore --yes-dev-project --sold-out-mode ignore --backup-dir backup/<적용 전 시각>
```
(zsh에서는 옵션을 변수에 담아 `$F`로 넘기면 쪼개지지 않으니 옵션을 직접 쓴다.)

## 백업 · 복구
엽떡·도미노·백소정과 같다. 삭제 예정 행 전체와 기존 사진 파일을 백업하고, 적용 뒤에 만든 백업은 복구 기준이 아니다(`--restore`가 거절). 복구는 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고 삭제한 행을 되살리며 연결 메뉴의 가격·설명·순서를 되돌린다.

## 시험
`tests/test_bk_db.py`(26개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·적용·Guest 응답·필수 옵션·중복 소속·재실행·복구·스냅샷 참조 가상 옵션 보류/승인 분기를 확인한다.
```bash
pip install pgserver psycopg2-binary
BK_PACKAGE=/path/to/burgerking-coupangeats-20261119 python tests/test_bk_db.py
```
