# 쿠팡이츠 수집본 8개 가게 → 기존 SaveEats 가게 확장 적용 도구 (2026-11-21 수집분)

수집 ZIP(`saveeats-catalog-batch-20261121.zip`, 읽기 전용, 저장소 밖)의 8개 지점 카탈로그를 SaveEats **개발 서버**(`msiahbzzebgjsoanjbtx`)의 기존 가게 8개에 반영하는 공용 도구다. **새 가게를 만들지 않고**, 수집 지점은 각 기존 가게의 카탈로그 출처(`private.store_source_records`)로 기록한다. 2026-11-23 개발 서버에 적용했다(`docs/evidence/catalog-batch-existing-stores-apply-20261123.md`).
한솥도시락 도구(`../hansot-coupangeats-20261120/import_hansot.py`)를 가게별 설정으로 일반화했고, 굽네 도구의 마스킹·연결·Storage 보조 함수를 쓴다.

## 구성
- `import_store.py --store <key>`: 가게 하나를 `--check / --backup / --apply / --verify / --restore`. 가게별 `stores/<key>/store.json`(기존 UUID), `menu_mapping.json`(대응표), `option_policy.json`(숨김 대상·대표 사진), `menu_group_display.json`을 읽는다.
- `run_batch.py`: 8개를 한 번의 승인으로 차례대로(가게마다 독립) 실행. 가게마다 **상태 재확인 → 적용 전 백업 → 사진 업로드(실패하면 DB 반영 전 중단) → DB 한 트랜잭션(안에서 검증) → Guest 검증 → 쓰기 없는 `--verify`(변경 없음 점검)**. 오류·미결정·새 의존성이 있으면 그 가게만 보류하고 다음으로 간다. `--restore-plan`은 가게별 복구 명령을 출력한다.
- `decisions.template.json`: 서정이 한 번에 정하는 값의 권장안. `build_stores.py`·`build_policies.py`·`dump_existing_state.py`: 설정·정책·시험 픽스처 생성(읽기 전용 조회).
- `tests/test_store_db.py <key>`: 임시 Postgres 시험(가게당 28~31개). `../../../tests/store/catalog-batch-chain.test.cjs`: 앱 체인 시험(에뮬레이션 Guest 응답 픽스처).

## 이번 일괄 작업에서 정한 처리 (결정 항목은 `--` 플래그가 없으면 `--apply`가 거절)
- **가격**: 메뉴 가격 = 상세 기본가(`base_price_krw`). 필수 옵션 포함가는 참고값이며 기본가에 다시 더하지 않는다. 맘스터치 6개·짬뽕지존 3개 차이는 모두 '목록가 = 기본가 + 필수 옵션 중 주문 가능한 최저 추가금'으로 설명된다(보고서의 가격 대조 표).
- **옵션 품절**(`--option-sold-out-mode ignore|source`): 수집 당시 SOLD_OUT 선택지(맘스터치 228·본죽 657)를 `is_sold_out`으로 반영(source, 권장)할지. 앱은 품절 선택지를 고를 수 없다. 필수 그룹에 주문 가능한 선택지가 부족하면 오류로 멈춘다(현재 0건).
- **수량 옵션**: 짬뽕지존 489개(원본 최대 1000, 최소 0/1)·피자스쿨 288개(1~10). 원본 1000은 앱 상한이 아니다(`--option-max-quantity`, 권장 10 = 굽네 결정과 같음). 원본 최소 0은 '선택 해제'로 읽는다(수량 1부터).
- **그룹 수량 합계**(`--group-total-mode none|source-max`): 피자스쿨 '토핑 추가 (최대 10개 가능)' 32개 그룹(선택지 9개, 옵션당 최대 10)의 10을 합계 상한으로 볼지. 근거는 정황(한솥과 같음)이라 결정 항목. 짬뽕지존 수량 그룹은 원본 최대가 1000이라 합계 제한 후보가 아니다. 맘스터치·메가MGC의 '(최대 N개 가능)'는 수량 없는 선택지의 종류 수 제한이라 결정 불필요.
- **숨김**(`--hide-menus import|hidden`): BHC 주류 2개, 짬뽕지존 주류 13개 + 리뷰이벤트 1개는 원본 보존 후 숨김이 기본안(FR-DATA-030·035).
- **그룹 표시명**(`--group-names source|proposed`): BHC '[와우전용] 이츠셰프컬렉션'→'셰프컬렉션'(굽네·도미노 승인과 같음), 메가MGC '쿠팡이츠 단독 메뉴'→'단독 메뉴'.
- **사진**: 메뉴마다 같은 원본의 400px 썸네일 + 1024px 파일이 있다. 1024px를 대표로, 서로 다른 사진이 둘인 13개 메뉴(신전 7·짬뽕지존 6)는 원본 첫 번째(전체가 보이는 구도)로 제안. 연결 메뉴도 수집 사진으로 교체(기존 파일은 지우지 않고 별도 경로 `menus/<UUID>-<sha8>.<ext>`, 복구는 `--restore`). 사진 미확보 20개(주류·소스 등)는 대체 사진 없이 비워 둔다. 서로 다른 메뉴가 같은 원본 사진을 쓰는 경우(BHC 콤보 3쌍·메가 18·본죽 10·신전 2·짬뽕지존 6)는 원본 그대로 반영하고 '원본 이미지 중복, 상품별 정확성 미확인'으로 기록한다.
- **신전떡볶이 포테이토치즈스틱(1개) 2개**(원본 ID 68720457·123187273): 이름·가격이 같아도 자동 병합하지 않는다(기록 라벨에 원본 ID를 붙여 구분).

## 실행 (승인 뒤)
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 .env.import(저장소 제외)나 환경변수로만 넣는다
python run_batch.py --package-root <ZIP을 푼 폴더> --decisions decisions.json --check
python run_batch.py --package-root <...> --decisions decisions.json --apply --yes-dev-project
python run_batch.py --package-root <...> --decisions decisions.json --restore-plan
```
백업은 `backup/<가게 키>/<시각>-pre-apply/`(gitignore). 적용 뒤에 만든 백업은 복구 기준이 아니다(`--restore`가 거절).

## 시험
```bash
pip install pgserver psycopg2-binary
for k in bhc momstouch megamgc misoya bonjuk sinjeon jjambbongjizon pizzaschool; do CATALOG_PACKAGES=<ZIP을 푼 폴더> python tests/test_store_db.py $k; done
```
