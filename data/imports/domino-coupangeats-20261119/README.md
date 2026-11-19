# 도미노피자(쿠팡이츠 홍제점) → 기존 도미노피자 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `domino-coupangeats-20261119`)를 SaveEats **개발 서버**의 기존 가게(`9d5acc03-…`)에 반영한다. **새 가게를 만들지 않는다.** 원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다.
엽떡 도구(`../yeopgi-coupangeats-20261118/import_yeopgi.py`)를 바탕으로 하고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 가져다 쓴다.

## 도미노 구조에서 달라진 점
- **메뉴 265개는 도우·크기·엣지 조합별 별개 상품**이다. 대표 메뉴로 줄이지 않고 이름의 약어([오]·[나]·[씬]·[오하]·[나하])도 풀어 쓰지 않는다.
- **기존 가상 메뉴 5개(포테이토 (M) 등)는 수집본에 동일 상품이 없어 연결하지 않는다**(수집본의 해당 메뉴는 전부 (L), 페퍼로니·단품 치즈는 없음). 참조(주문·리뷰)가 없으면 삭제, 있으면 지우지 않고 **숨김(비활성)으로 보존**한다(`menu_mapping.json`의 `remove`, 적용 직전 FK 참조를 다시 확인).
- **옵션 그룹 원본 ID는 여러 메뉴가 재사용**한다(고유 그룹 4개·선택지 32개). 그룹·옵션 UUID는 `(원본 가게, 원본 메뉴, 원본 그룹[, 원본 옵션])`으로 만들어 메뉴마다 별도 행이다(공유 없음, `id_map.json`).
- 필수(min_select≥1) 옵션 그룹이 하나도 없다 → 모든 메뉴가 목록에서 바로 담긴다.
- **사진은 메뉴마다 `menus/<메뉴 UUID>.jpg`로 올린다**(Storage 경로 정책: 메뉴 UUID 기준). 같은 원본 파일 65개가 257개 메뉴에 연결되므로 257개 복사본(약 4.5MiB)이 생긴다. 사진 없는 8개는 비운다.

## 결정이 필요한 값 (적용에 필수 플래그, 없으면 `--apply`가 거절)
- `--option-max-quantity N`: 원본 수량 1000인 선택지의 앱 상한. 원본이 2인 선택지는 min(원본, N)이라 2로 남는다(전부 N으로 덮어쓰지 않는다).
- `--drink-limit-mode source|conservative`: 음료 "(최대 2개 가능)" 수량형 그룹. 원본이 그룹 최대 2·옵션당 최대 2인데, 2가 *종류 수*인지 *수량 합계*인지 원본 자료로 알 수 없다. 앱·서버는 종류 수만 센다. `source`=원본 값 그대로(종류 최대 2, 옵션당 최대 2 → 합계 최대 4 가능), `conservative`=종류 최대 2·옵션당 1개(합계 2 보장, 같은 음료 2개는 불가).
- `--sold-out-mode ignore|source`: 수집 당시 "오늘 품절" 39개를 판매 가능으로 표시(`ignore`)할지 품절로 표시(`source`)할지. 원본 상태와 수집 시점은 내부 기록에 남긴다.
- `--group-names source|proposed`: 첫 메뉴 그룹 "[와우전용] 이츠셰프컬렉션" → 표시명 "셰프컬렉션" 제안(`menu_group_display.json`). 원본 이름은 DB `source_name`에 보존.

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'
P=/path/to/domino-coupangeats-20261119
F="--option-max-quantity 10 --drink-limit-mode source --sold-out-mode ignore --group-names proposed"   # 승인된 값으로
python import_domino.py --package $P --check $F                                  # 읽기 전용 보고서(out/check_report.md)
python import_domino.py --package $P --backup --yes-dev-project $F               # 적용 전 백업(backup/<시각>/)
python import_domino.py --package $P --apply --yes-dev-project $F                # 백업 → 사진 257개 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_domino.py --package $P --verify $F --backup-dir backup/<적용 전 시각>
python import_domino.py --package $P --restore --yes-dev-project $F --backup-dir backup/<적용 전 시각>
```

## 백업 · 복구
- 백업: 가게의 메뉴·옵션 그룹·옵션 원본 행, 삭제 예정 행 전체, 기존 사진 파일, 주문·리뷰 스냅샷 해시, 다른 가게 해시. 접속 정보 없음. 이미 적용된 뒤에 만든 백업은 복구 기준이 아니며 `--restore`가 거절한다.
- 복구: 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고, 삭제했던 메뉴·옵션을 되살리고, 숨겼던 메뉴를 다시 활성으로 돌린다. 새 메뉴·옵션을 가리키는 주문이 있으면 멈춘다.

## 시험
`tests/test_domino_db.py`(38개): 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷을 재현해 미결정 거절·삭제/숨김 분기·적용·Guest 응답·메뉴별 그룹 분리·재실행·복구·음료 보수안·품절 source 모드를 확인한다.
```bash
pip install pgserver psycopg2-binary
DOMINO_PACKAGE=/path/to/domino-coupangeats-20261119 python tests/test_domino_db.py
```
