# 백소정(쿠팡이츠 광화문점) → 기존 백소정 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `baeksojeong-coupangeats-20261119`)를 SaveEats **개발 서버**의 기존 가게(`80b4c10d-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다.
도미노 도구(`../domino-coupangeats-20261119/import_domino.py`)를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 백소정 구조에서 달라진 점
- **고유 메뉴 66개, 그룹 소속 69개**: 같은 메뉴(마제소바·돈카츠(로스카츠)·모짜렐라 치즈카츠)가 'BEST 메뉴'와 '단품메뉴' 두 그룹에 속한다. 메뉴 본체·사진·옵션은 하나만 두고 그룹 연결만 늘린다. 메뉴 정렬은 첫 소속 순서다.
- **기존 가상 메뉴 5개 중 4개는 같은 상품으로 연결**한다(`menu_mapping.json`): 이름이 같고(또는 띄어쓰기만 다르고) 기존 사진과 수집 사진이 같은 상품. 가격은 수집 가격으로 갱신, 사진·인기·UUID는 유지. 나머지 1개(`돈카츠(등심카츠)`)는 수집본에 같은 상품이 없어(수집본은 로스카츠) 삭제 후보다. 참조(주문·리뷰)가 있으면 지우지 않고 숨긴다(적용 직전 FK 재확인).
- **옵션 그룹 원본 ID는 메뉴가 재사용**한다(고유 그룹 5개). 그룹·옵션 UUID는 메뉴별로 만들어 공유하지 않는다(`id_map.json`).
- **사진**: 70개 URL 기록 = 66개 메뉴 연결(4개 메뉴는 같은 URL·같은 파일을 두 번 기록) · 고유 파일 65개(마제소바+돈카츠·마제소바 돈카츠는 같은 파일을 쓴다). 연결 4개는 기존 사진을 유지하고, 새 메뉴 62개는 메뉴별 `menus/<메뉴 UUID>.jpg`로 올린다.
- 원본 약어와 메뉴 이름은 풀어 쓰지 않는다. 수집 당시 판매 상태는 전부 ON_SALE이다.

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--option-max-quantity N`: 앱 수량 상한(10). 원본 1~8 선택지는 min(8, N)=8로 남는다(10으로 덮어쓰지 않는다).
- `--group-total-mode none|source-max`: 필수 수량형 그룹 "키소카레 전용 옵션 (최소 1개 ~ 8개)". 원본은 그룹 최소 1·최대 8, 선택지 4종(선택안함·대파·마늘양파후레이크·눈꽃치즈) 모두 수량 1~8. 선택지가 4종뿐이라 그룹 최대 8은 '종류 수'일 수 없고 이름의 "최소 1개 ~ 8개"와 같이 '수량 합계'로 읽히나, 쿠팡이츠 응답에 명시된 필드는 없다. `source-max`=기존 `maxTotalQuantity`(합계 8)로 적용(서버 변경 없음), `none`=종류 수 1~8만(합계 제한 없음, 최대 4종×8개).
- `--none-option-mode source|no-quantity|exclusive`: '선택안함'(0원)의 원본 수량 변경 플래그. `source`=원본 그대로, `no-quantity`=수량 조절 없이 1개, `exclusive`=수량 조절 없이 1개 + 같은 그룹의 다른 옵션과 함께 고를 수 없는 단독 옵션(`menu_options.is_exclusive`, 서정 결정 2026-11-19, 쿠팡이츠 확인 사실이 아님). 모두 `option_policy.json`의 원본 ID로만 지정하며 이름 규칙이 아니다. 서버에 migration `20261119113501_option_exclusive.sql`이 먼저 있어야 한다.
- `--review-event-groups import|hidden`: 쿠팡이츠 "리뷰이벤트 (최대 1개 가능)" 옵션 그룹 54개(옵션: 괜찮아요·이미 골랐어요·수제 왕새우 튀김·음료 등). SaveEats에 없는 혜택으로 보일 수 있어 `hidden`=행은 보존하고 앱에는 숨김을 권장.
- `--group-names source|proposed`: 신메뉴·최대 할인 표현이 든 그룹 4개의 표시명 정리안(`menu_group_display.json`). 원본 이름은 DB `source_name`과 내부 기록에 보존.
- `--sold-out-mode`: 수집 당시 품절 메뉴가 없어 필요 없다.

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/baeksojeong-coupangeats-20261119
F="--option-max-quantity 10 --group-names proposed --group-total-mode source-max --none-option-mode exclusive --review-event-groups hidden"   # 승인된 값으로
python import_baeksojeong.py --package $P --check $F                       # 읽기 전용 보고서(out/check_report.md)
python import_baeksojeong.py --package $P --backup --yes-dev-project $F    # 적용 전 백업(backup/<시각>/)
python import_baeksojeong.py --package $P --apply --yes-dev-project $F     # 백업 → 사진 62개 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_baeksojeong.py --package $P --verify $F --backup-dir backup/<적용 전 시각>
python import_baeksojeong.py --package $P --restore --yes-dev-project $F --backup-dir backup/<적용 전 시각>
```

## 백업 · 복구
엽떡·도미노와 같다. 삭제 예정 행 전체와 기존 사진 파일을 백업하고, 적용 뒤에 만든 백업은 복구 기준이 아니다(`--restore`가 거절). 복구는 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고 삭제한 행을 되살리며 연결 메뉴의 가격·설명·순서를 되돌린다.

## 시험
`tests/test_baek_db.py`(33개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·적용·Guest 응답·중복 소속·필수 수량형 그룹·재실행·복구·원본 그대로 모드를 확인한다.
```bash
pip install pgserver psycopg2-binary
BAEK_PACKAGE=/path/to/baeksojeong-coupangeats-20261119 python tests/test_baek_db.py
```
