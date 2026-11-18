# 굽네(쿠팡이츠 서대문 연희점) → 기존 굽네치킨 가게 확장 적용 도구

수집 자료(읽기 전용, 저장소 밖)를 SaveEats **개발 서버**의 기존 굽네치킨 가게(`d5c4fa89-…`)에 반영한다.
이 폴더는 `supabase/`가 아닌 별도 작업 폴더다. 원격 적용은 서정이 승인한 뒤에만 한다.

## 정책 요약 (서정 결정 2026-11-17)
- 이 지점 메뉴·가격을 기존 굽네치킨의 대표 데이터로 쓴다. 전국 공통가로 확인됐다고 표현하지 않는다.
- 기존 가게·메뉴 UUID, 주문·리뷰 참조, 주문 스냅샷, 추천·인기, 가게 대표사진은 바꾸지 않는다.
- 기존 메뉴 ↔ 수집 메뉴 대응은 `menu_mapping.json`(근거 포함). 근거가 부족한 것은 `HOLD`로 두고 연결하지 않는다.
- 연결된 메뉴는 **가격만 갱신**한다(이름·사진·설명 유지, 설명이 비어 있으면 채움).
- 기존 가상 옵션은 삭제하지 않고 **비활성**, 실제 옵션은 새 행으로 추가한다.
- 옵션 수량 조절: `quantity_rule()`이 정한 확인된 옵션(소스&치킨무&피클 그룹의 소스 옵션)에만 켠다. 상한은 **서정이 정할 때까지 미결정**이며(원본 1000·mock 5 사용 금지) 정해지기 전에는 `--apply`가 거절된다. 미확인 옵션은 보고서에 따로 나오고 일반 옵션으로 둔다.
- 그룹 선택 상한(max_select) 원본 1000은 바꾸지 않는다(`--max-select-mode options`는 보류, 기본은 source).
- 시카고 딥디쉬 피자는 '시카고 피자'와 연결(서정 확정). 주류 7개는 비노출로 추가(`--show-alcohol`로 노출).
- 공개 출처 목록(`store_sources`, 승인 지문이 있는 16건)은 건드리지 않는다. 쿠팡이츠 출처는 내부 기록(`private.store_source_records`)에만 남긴다(권리·사용 허락 미확인).

## 실행 순서
```bash
pip install psycopg2-binary
# 값은 채팅에 적지 말고 터미널 환경변수로만 넣는다 (또는 .env.import, 저장소에서 제외됨)
export DATABASE_URL='...'                      # 대시보드 Connect → Session pooler 연결 문자열
export SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'         # 사진 업로드·삭제에만 사용
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...'  # anon 검증(공개 키)

P=/path/to/goobne-coupangeats-20261117        # 수집 자료 폴더
python import_goobne.py --package $P --check                       # 읽기 전용 검사·보고서(out/check_report.md)
python import_goobne.py --package $P --backup --yes-dev-project    # 적용 전 백업(backup/<시각>/)
python import_goobne.py --package $P --apply  --yes-dev-project    # 사진 업로드 → DB 한 트랜잭션 → 검증
python import_goobne.py --package $P --verify --backup-dir backup/<시각>
python import_goobne.py --package $P --restore --yes-dev-project --backup-dir backup/<적용 전 시각>
```
옵션: `--no-option-quantity`(옵션 수량 조절을 전부 끔), `--show-alcohol`(주류 노출), `--option-max-quantity N`(서정이 정한 수량 상한, 적용에 필수), `--max-select-mode options`(보류 중인 A안).

## 백업 · 복구
- 백업은 기존 가게의 메뉴·옵션 그룹·옵션 원본 행, 이 가게 주문·리뷰 스냅샷 해시, 다른 가게 해시를 저장한다. 같은 이름의 백업은 덮어쓰지 않는다.
- **이미 적용된 뒤에 만든 백업은 복구 기준이 아니다**(도구가 표시하고 `--restore`를 거절한다). 적용 전에 만든 백업 폴더를 쓴다.
- 복구는 새로 만든 메뉴·그룹·옵션·내부 기록·사진을 지우고, 기존 메뉴의 가격·설명과 기존 가상 옵션의 활성 상태를 백업 값으로 되돌린다. 새 메뉴·옵션을 가리키는 주문이 있으면 멈춘다.
- 사진은 새 경로에만 올린다. 기존 사진 파일은 덮어쓰지 않는다.

## 검증 (--apply가 자동 수행, --verify로 재실행)
가게·기존 메뉴 UUID 유지, 가격·옵션·선택 제한 일치, 가상 옵션 비활성(삭제 아님), 추천·인기·품절·활성 보존, 주문·리뷰 스냅샷 해시 불변, 다른 가게 해시 불변, 공개 출처 목록 불변, 소스 2개 = 1,400원과 (기본가+옵션 합)×메뉴 수량, anon `get_menu` 일치(가상 옵션이 함께 보이지 않음)와 사진 실제 내려받기.

## 비밀값 보호
- 모든 출력은 `redact()`를 거친다(환경변수의 DB 비밀번호·키와 그 조각, URL 안의 비밀번호, JWT 형태 키를 `***`로 가림). 처리되지 않은 예외도 가려진 한 줄과 위치만 출력한다(`sys.excepthook`).
- DB 연결 문자열의 흔한 형식 오류(비밀번호를 감싼 `[ ]`, 비밀번호 안의 `@` 등)는 메모리에서만 바로잡는다. `.env.import` 파일은 바꾸지 않는다.
- 시험: `python -m unittest test_redaction` (가짜 비밀값만 사용. 연결 시험에는 psycopg2 필요).

## 기존 가상 옵션 물리 삭제 (`--cleanup`)
```bash
python import_goobne.py --package $P --cleanup                                  # 후보와 참조 건수만 보여 줌(점검 전용)
python import_goobne.py --package $P --cleanup --execute --yes-dev-project      # 삭제(옵션 → 그룹, 한 트랜잭션, 삭제 행 전체를 backup/cleanup-<시각>/에 저장)
python import_goobne.py --package $P --cleanup-restore --yes-dev-project --backup-dir backup/cleanup-<시각>
```
주문 옵션 스냅샷이 가리키는 옵션(과 그 그룹)은 기본으로 남긴다(`--include-referenced`로 포함 가능). 메뉴는 삭제하지 않는다. 전체 되돌리기(`--restore`)를 하려면 먼저 `--cleanup-restore`를 한다.
테스트는 `GOOBNE_BACKUP_ROOT`로 임시 백업 폴더를 쓴다(실제 백업과 섞이지 않게).
