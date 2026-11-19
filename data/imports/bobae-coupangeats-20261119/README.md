# 보배반점(쿠팡이츠 응암점) → 기존 보배반점 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `bobae-coupangeats-20261119`)를 SaveEats **개발 서버**의 기존 가게(`ae4676a3-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다.
버거킹 도구(`../burgerking-coupangeats-20261119/import_burgerking.py`)를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 보배반점 구조
- **메뉴 81개, 그룹 소속 81개(중복 소속 없음), 그룹 10개.**
- **기존 가상 메뉴 5개 중 4개는 같은 상품으로 연결**한다(`menu_mapping.json`): 보배짬뽕·소고기짬뽕·크림짬뽕·보배짜장면(띄어쓰기만 다름). 가격은 수집 가격으로 갱신(소고기짬뽕 13,000→14,000, 크림짬뽕 14,000→15,000), UUID·인기·주문·리뷰 참조·기존 사진은 유지. 나머지 `보배간짜장`(12,000원)은 수집본에 간짜장이 없어 삭제 후보이며(실제 존재 여부는 확인하지 않음) 참조가 없다.
- **숨김(원본 보존)**: 리뷰이벤트 그룹의 `포토 리뷰 이벤트 참여`(0원, 자체 옵션 그룹 '리뷰 이벤트 참여'로 음료(랜덤)·춘권5개) 1개와 주류 그룹 18개 메뉴. 원본 그룹 소속(`option_policy.json`의 원본 ID)으로 지정하며 이름으로 고르지 않는다. 숨겨도 음식 메뉴의 필수 옵션과 연결되지 않는다(이벤트·주류 메뉴를 가리키는 음식 메뉴 옵션이 없고, 주류에는 옵션 그룹이 없음). 적용하면 앱에 보이는 메뉴 62개·그룹 8개.
- **가게 영업 상태 vs 메뉴 판매 상태**: 수집 때 가게 화면은 '오픈 준비 중'이었지만 메뉴 81개는 모두 ON_SALE이다. `stores.is_open`은 건드리지 않고 메뉴는 품절로 표시하지 않는다(검증에 포함).
- **옵션**: 옵션 그룹 64개(필수 63개·44개 메뉴, 전부 SELECT_ONE 1~1)·선택지 240개, 기본 선택값 없음(자동 선택 없음). 수량 변경 선택지 0개라 수량 조절을 켜지 않고, 단독 옵션·합계 제한·수량 상한은 쓰지 않는다. 필수 44개 메뉴는 상세로, 나머지 18개는 바로 담긴다.
- **사진**: 59개 메뉴 연결(고유 파일 59개), 미확보 22개(주류 18개 + 중화해물우동 밥·공기밥·짬뽕국물·단무지 추가)는 비워 둔다. 연결 4개는 기존 사진 유지, 새로 55개(숨기는 이벤트 메뉴 1개 포함)는 메뉴별 `menus/<UUID>.jpg`로 올린다.

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--hide-menus import|hidden`: 리뷰이벤트·주류 19개를 앱에서 숨길지(`hidden`, 권장) 노출할지.
- `--link-descriptions keep|source`: 연결 메뉴 4개의 기존(가상) 설명을 그대로 둘지(`keep`) 수집 설명으로 바꿀지(`source`).
- 스냅샷이 가리키는 가상 옵션 그룹(크림짬뽕의 양 선택, 옵션 2개)의 삭제: 승인 전에는 삭제하지 않고 비활성 보존. 승인하면 `menu_mapping.json`의 `approved_snapshot_referenced_group_ids`에 그룹 id를 넣는다(원본 ID 대응은 백업에 기록).
- 보배짜장면의 표시 이름을 수집본("보배 짜장면")으로 바꿀지: 기본은 기존 이름 유지(`rename_to_source`).

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/bobae-coupangeats-20261119
python import_bobae.py --package $P --check --hide-menus hidden --link-descriptions source                      # 읽기 전용 보고서(out/check_report.md)
python import_bobae.py --package $P --backup --yes-dev-project --hide-menus hidden --link-descriptions source   # 적용 전 백업(backup/<시각>/)
python import_bobae.py --package $P --apply --yes-dev-project --hide-menus hidden --link-descriptions source    # 백업 → 사진 55개 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_bobae.py --package $P --verify --hide-menus hidden --link-descriptions source --backup-dir backup/<적용 전 시각>
python import_bobae.py --package $P --restore --yes-dev-project --hide-menus hidden --link-descriptions source --backup-dir backup/<적용 전 시각>
```
(zsh에서는 옵션을 변수에 담아 `$F`로 넘기면 쪼개지지 않으니 옵션을 직접 쓴다.)

## 백업 · 복구
엽떡·도미노·백소정·버거킹과 같다. 삭제 예정 행 전체와 기존 사진 파일을 백업하고, 적용 뒤에 만든 백업은 복구 기준이 아니다(`--restore`가 거절). 복구는 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고 삭제한 행을 되살리며 연결 메뉴의 가격·설명·순서를 되돌린다.

## 시험
`tests/test_bobae_db.py`(27개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·적용·숨김 메뉴·Guest 응답·필수 옵션·재실행·복구·스냅샷 참조 가상 옵션 보류/승인·설명 keep/source 분기를 확인한다.
```bash
pip install pgserver psycopg2-binary
BOBAE_PACKAGE=/path/to/bobae-coupangeats-20261119 python tests/test_bobae_db.py
```
