# 동대문엽기떡볶이(쿠팡이츠 홍제점) → 기존 동대문엽기떡볶이 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖: `yeopgi-coupangeats-20261118`)를 SaveEats **개발 서버**의 기존 가게(`028512ff-…`)에 반영한다. **새 가게를 만들지 않는다.**
원격 적용은 서정이 계획을 확인·승인한 뒤에만 한다. 굽네 도구(`../goobne-coupangeats-20261117/import_goobne.py`)의 비밀값 마스킹·연결·Storage 보조 함수를 가져다 쓰고, 굽네 전용 값(가게 UUID, 주류 규칙, 소스 수량 근거)은 쓰지 않는다.

## 정책 (서정 결정 2026-11-18)
- 이 지점(홍제점) 수집 가격을 기존 엽떡의 대표값으로 쓴다. 전국 공통가로 확인됐다고 표현하지 않는다.
- 가게·기존 메뉴 UUID, 주문·리뷰 참조와 스냅샷, 추천·인기, 가게 대표사진은 유지한다.
- 설명·사진의 출처·권리 상태는 내부 기록(`private.store_source_records`)에 '미확인'으로 남긴다. 개발 서버 적용은 외부 공개 승인이 아니다.
- 기존 메뉴 ↔ 수집 메뉴 대응은 `menu_mapping.json`(근거 포함). 이름·가격·사진 상품이 같은 4개만 연결하고(`LINK`), 수집 목록에 없는 기존 가상 메뉴(`2인 엽기떡볶이`)는 삭제 후보(`remove`)다.
- 연결 메뉴: 가격 갱신, 비어 있던 설명 채움, 정렬 순서 갱신. 이름·사진·인기·활성은 그대로. 새 메뉴 31개는 UUIDv5(`id_map.json`)로 추가해 재실행해도 중복이 없다.
- 메뉴 그룹 7개와 그룹 안 순서는 수집 순서 그대로(기존/신규 구분 없음). 메뉴 `sort_order`도 같은 순서의 10 간격 숫자다. 메뉴 본체는 복제하지 않는다.
- 옵션: 그룹·선택지·추가금·필수(`min_select`)는 원본 그대로. 원본 기본 선택값은 없고, 있어도 자동 선택하지 않는다. 기본 판매가와 `price_with_mandatory_krw`는 더하지 않는다.
- 옵션 수량: 원본 `quantityChangeable=true`인 선택지(106개)만 켠다. 앱 허용 상한은 `--option-max-quantity N`으로 **서정이 정한 값**만 쓰며(원본 1000 사용 금지), 정해지기 전에는 `--apply`가 거절된다.
- 그룹 선택 상한(`max_select`) 원본 값(1000 포함)은 바꾸지 않는다.
- 기존 가상 옵션·그룹: 주문 스냅샷이 가리키지 않는 것은 삭제(행 전체를 백업에 저장), 가리키는 것은 비활성으로 보존. 삭제 직전에 모든 FK 참조(`pg_constraint` 기준)와 스냅샷 참조를 다시 확인하고 하나라도 있으면 전체를 되돌린다.
- 사진: 연결(기존 UUID) 메뉴 4개는 기존 사진 유지(같은 상품, 기존이 고해상도), 새 메뉴 30개는 새 경로(`menus/<메뉴 UUID>.jpg`)에 업로드, 사진 없는 음료는 비워 둔다. 기존 파일은 덮어쓰거나 지우지 않는다. 업로드가 하나라도 실패하면 DB를 반영하지 않고 멈춘다.

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수나 .env.import(저장소 제외)로만 넣는다
export DATABASE_URL='...' SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='...' EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'

P=/path/to/yeopgi-coupangeats-20261118
python import_yeopgi.py --package $P --check                                   # 읽기 전용 검사·보고서(out/check_report.md)
python import_yeopgi.py --package $P --backup --yes-dev-project                # 적용 전 백업(backup/<시각>/)
python import_yeopgi.py --package $P --apply --yes-dev-project --option-max-quantity 10   # 백업 → 사진 → DB 한 트랜잭션(안에서 검증) → Guest 검증
python import_yeopgi.py --package $P --verify --option-max-quantity 10 --backup-dir backup/<적용 전 시각>
python import_yeopgi.py --package $P --restore --yes-dev-project --backup-dir backup/<적용 전 시각>
```
옵션: `--sold-out-mode source`(수집일 "오늘 품절" 6개를 품절로 반영, 기본은 반영 안 함), `--no-option-quantity`.
`--verify`·`--restore`에도 `--apply`와 같은 `--option-max-quantity`/`--sold-out-mode`를 준다(같은 계획을 다시 만들기 때문).

## 백업 · 복구
- 백업: 가게의 메뉴·옵션 그룹·옵션 원본 행, 삭제 예정 행 전체, 기존 사진 파일, 주문·리뷰 스냅샷 해시, 다른 가게 해시. 접속 정보는 담지 않는다. 같은 이름의 백업은 덮어쓰지 않는다.
- **이미 적용된 뒤에 만든 백업은 복구 기준이 아니다**(도구가 표시하고 `--restore`를 거절한다). 최초 적용 전 백업을 보관한다.
- 복구: 새 메뉴·그룹·옵션·메뉴 그룹·내부 기록·새 사진을 지우고, 삭제했던 메뉴·옵션을 되살리고, 연결 메뉴의 가격·설명·순서와 옵션 활성 상태를 되돌린다. 새 메뉴·옵션을 가리키는 주문이 있으면 멈춘다.

## 시험
`tests/test_yeopgi_db.py`: 임시 Postgres에 저장소 migration 전체와 실서버 스냅샷(`tests/fixtures/existing_state.json`)을 재현해 점검·거절 경로·적용·Guest 응답·재실행·복구·복구 후 재적용을 확인한다(34개).
```bash
pip install pgserver psycopg2-binary
YEOPGI_PACKAGE=/path/to/yeopgi-coupangeats-20261118 python tests/test_yeopgi_db.py
```
