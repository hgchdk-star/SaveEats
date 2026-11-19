# 설빙(쿠팡이츠 홍제역점) → 기존 설빙 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `sulbing-coupangeats-20261119`)를 SaveEats **개발 서버**의 기존 가게(`3ddc0b28-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다.
보배반점 도구(`../bobae-coupangeats-20261119/import_bobae.py`)를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 설빙 구조
- **메뉴 102개, 그룹 소속 102개(중복 소속 없음), 그룹 10개**(추천메뉴 2·설빙 17·사이드 14·간편식 4·토핑추가 34·커피 9·음료 7·차 9·에이드 4·기타 2). '추천메뉴'는 수집 메뉴 그룹으로만 보존하고 SaveEats 추천·인기 점수로 바꾸지 않는다. '토핑추가' 그룹의 단품 메뉴 34개와 메뉴 상세의 '추가토핑' 옵션(35개)은 서로 다른 판매 단위라서 합치거나 지우지 않는다.
- **기존 가상 메뉴 5개는 전부 같은 상품으로 연결**한다(`menu_mapping.json`): 인절미설빙·팥인절미설빙·애플망고치즈설빙·딥초코브라우니설빙·순수요거블루베리설빙. 이름이 같고 기존 사진과 수집 사진이 같은 상품(실제 파일 대조). 가격은 수집 가격으로 갱신(전부 +1,500원), UUID·인기·주문·리뷰 참조·기존 사진은 유지하고 비어 있던 설명을 채운다. 삭제·숨길 메뉴는 없다.
- **옵션**: 옵션 그룹 91개(필수 53개·43개 메뉴)·선택지 761개. 수량 변경 선택지 0개라 수량 조절·단독·합계 제한·수량 상한을 쓰지 않는다. '추가토핑 (최대 20개 가능)'은 선택지 35개에 종류 수 최대 20(실제 제한)이다. 기본 선택값은 원본에 없어 자동 선택하지 않는다.
- **'(기본제공)' 필수 그룹**: 선택지가 "(기본제공)" 0원 하나뿐인 필수(1~1) 그룹 29개(연유 선택 19·바닐라아이스 선택 6·요거트아이스 선택 4·…)가 있다. 현재 계약에는 '기본 제공'이 없어 사용자가 "(기본제공)"을 눌러야 담긴다. 결정 플래그로 처리한다.
- **사진**: 111개 기록 = 102개 메뉴 연결 · 고유 파일 107개. 음료 9개는 사진이 2장(후보 1=ICE 컵, 후보 2=HOT 머그, 실제 파일 비교)이며 `option_policy.json`에 대표 사진 선택안(후보 1)을 두었다. 인절미샷라떼와 바닐라라떼는 후보 1이 같은 파일이다. 연결 5개는 기존 사진 유지, 새 메뉴 97개는 메뉴별 `menus/<UUID>.jpg`로 올린다(약 0.9MiB). 선택하지 않은 원본 사진은 수집 폴더에 그대로 보존한다.
- **가게 영업 상태 vs 메뉴 판매 상태**: 수집 때 가게 화면은 '오픈 준비 중'이었지만 메뉴 102개는 모두 ON_SALE이다. `stores.is_open`은 건드리지 않는다(검증에 포함).

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--included-groups keep|hidden`: "(기본제공)" 필수 그룹 29개를 원본 그대로 둘지(`keep`) 앱에서 숨길지(`hidden`, 행은 보존·필수 검증에서도 빠져 바로 담김).
- `--photo-choice proposed`: 사진 2장 음료 9개의 대표 사진을 `option_policy.json` 선택안(ICE 컵)으로 할지.

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/sulbing-coupangeats-20261119
python import_sulbing.py --package $P --check --included-groups keep --photo-choice proposed                      # 읽기 전용 보고서(out/check_report.md)
python import_sulbing.py --package $P --backup --yes-dev-project --included-groups keep --photo-choice proposed   # 적용 전 백업(backup/<시각>/)
python import_sulbing.py --package $P --apply --yes-dev-project --included-groups keep --photo-choice proposed    # 백업 → 사진 97개 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_sulbing.py --package $P --verify --included-groups keep --photo-choice proposed --backup-dir backup/<적용 전 시각>
python import_sulbing.py --package $P --restore --yes-dev-project --included-groups keep --photo-choice proposed --backup-dir backup/<적용 전 시각>
```
(zsh에서는 옵션을 변수에 담아 `$F`로 넘기면 쪼개지지 않으니 옵션을 직접 쓴다.)

## 백업 · 복구
엽떡·도미노·백소정·버거킹·보배반점과 같다. 삭제 예정 행 전체와 기존 사진 파일을 백업하고, 적용 뒤에 만든 백업은 복구 기준이 아니다(`--restore`가 거절). 복구는 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고 삭제한 행을 되살리며 연결 메뉴의 가격·설명·순서를 되돌린다.

## 시험
`tests/test_sulbing_db.py`(27개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·적용·Guest 응답·'(기본제공)' 그룹 keep/hidden·복수 사진 대표 선택·재실행·복구를 확인한다.
```bash
pip install pgserver psycopg2-binary
SULBING_PACKAGE=/path/to/sulbing-coupangeats-20261119 python tests/test_sulbing_db.py
```
