# 한솥도시락(쿠팡이츠 명지대점) → 기존 한솥도시락 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `hansot-coupangeats-20261120`, source_store_id 544628)를 SaveEats **개발 서버**의 기존 가게(`5ab234b5-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다. (현재 준비 단계 — 개발 서버에 적용하지 않았다.)
설빙·보배반점 도구를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 한솥도시락 구조
- **메뉴 111개, 그룹 소속 111개(중복 소속 없음), 그룹 20개**(신메뉴 11·스페셜 3·프리미엄 2·세트 2·고기고기 3·마요 5·모둠 9·덮밥 11·비빔밥 3·볶음밥 2·찌개 2·실속반찬 8·미니반찬 2·치킨 4·스낵 8·프리즈드라이 국 6·소스류 5·음료류 17·라면류 7·밥 1). 그룹 이름에 혜택 문구가 없어 표시명 정리는 없다(원본 그대로).
- **기존 가상 메뉴 5개**: 4개는 같은 상품으로 연결(치킨마요·치킨제육·돈까스도련님↔(BEST)돈까스도련님·돈까스도련님 고기고기↔(BEST)돈까스도련님 고기고기), 가격은 수집 가격으로 갱신(+1,200원 안팎), UUID·인기·주문·리뷰 참조·기존 사진 유지. "(BEST)" 두 메뉴는 이름을 수집본으로 맞춘다(`rename_to_source`). **제육볶음도시락**은 수집본에 같은 상품이 없고 이미 비활성(사진 없음·참조 없음)이라 삭제 후보다.
- **옵션**: 옵션 그룹 238개·선택지 1,308개, **필수 그룹 0개**. 111개 메뉴 모두 목록에서 바로 담기고, 선택 옵션은 상세에서 추가한다. 수량 변경 선택지 288개(계란후라이·김치·찌개 각 96)만 수량 조절(1~10, 원본 범위와 같다). 원본 maxQuantity=1000(847개)은 수량 변경 불가 선택지의 값이라 앱 상한으로 쓰지 않는다. 밥추가 그룹 46개는 최대 1종 그대로.
- **사진**: 음료 7개는 사진이 2장(같은 상품의 다른 각도)이라 `option_policy.json`에 대표 사진 선택안(원본 첫 번째, 제품 전체 정면)을 두었다. 연결 4개는 기존 사진 유지, 새 메뉴 107개는 `menus/<UUID>.jpg`로 올린다. 선택하지 않은 원본은 수집 폴더에 보존.

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--group-total-mode none|source-max`: '계란후라이·김치·찌개 (최대 10개 가능)' 그룹(144개)의 최대 10을 수량 **합계 상한**으로 쓸지. 근거는 정황(그룹 이름 문구·SELECT_MULTI_QTY·선택지 2개뿐이라 종류 수 10은 불가·옵션 최대 10)이다. 원본에 합계를 명시한 필드는 없다.
- `--link-descriptions keep|source`: 연결 메뉴 4개의 기존(가상) 설명 유지/수집 설명으로 교체.
- `--option-max-quantity 10`: 수량 조절 선택지의 앱 상한(원본 범위와 같은 10).
- `--photo-choice proposed`: 사진 2장 음료 7개의 대표 사진.
- `menu_mapping.json`의 `approved_snapshot_referenced_group_ids`: 치킨제육의 가상 '밥 양'(주문 스냅샷이 원본 ID로 가리킴)을 삭제할지. 승인 전에는 삭제하지 않고 비활성 보존.

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/hansot-coupangeats-20261120
python import_hansot.py --package $P --check --option-max-quantity 10 --group-total-mode source-max --link-descriptions source --photo-choice proposed
python import_hansot.py --package $P --backup --yes-dev-project --option-max-quantity 10 --group-total-mode source-max --link-descriptions source --photo-choice proposed
python import_hansot.py --package $P --apply --yes-dev-project --option-max-quantity 10 --group-total-mode source-max --link-descriptions source --photo-choice proposed
python import_hansot.py --package $P --verify ... --backup-dir backup/<적용 전 시각>
python import_hansot.py --package $P --restore --yes-dev-project ... --backup-dir backup/<적용 전 시각>
```

## 백업 · 복구
엽떡~설빙과 같다. 삭제 예정 행 전체와 기존 사진 파일을 백업하고, 적용 뒤에 만든 백업은 복구 기준이 아니다. 복구는 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고 삭제한 행을 되살리며 연결 메뉴의 가격·이름·설명·순서를 되돌린다.

## 시험
- `tests/test_hansot_db.py`(34개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·적용·Guest 응답·수량 옵션·합계 10 제한·바로 담기·재실행·복구·스냅샷 참조 보류/승인을 확인한다.
- `tests/store/hansot-chain.test.cjs`: 로컬 에뮬레이션 Guest 응답을 앱 코드(바로 담기·옵션 수량·섹션·검색)에 통과시킨다. 서버 적용 뒤 실제 Guest 응답으로 교체한다.
```bash
pip install pgserver psycopg2-binary
HANSOT_PACKAGE=/path/to/hansot-coupangeats-20261120 python tests/test_hansot_db.py
```
