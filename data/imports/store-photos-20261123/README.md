# 가게 대표사진 교체 + 상세 사진 갤러리 (16곳, 쿠팡이츠 가게 상단 이미지 66장)

**준비 단계 — 개발 서버에는 아무것도 쓰지 않았다.** 적용은 서정이 확인한 뒤에 한다(원격 migration 적용 → 사진 업로드 → DB 연결).
수집 폴더 `store-photos-coupangeats-20261123`(저장소 밖, 읽기 전용): `store_photos.json`·`images/`. 사진은 가게 상단 이미지이며 매장 외관 사진으로 분류하지 않는다. 권한은 미확인.

## 구성
- `supabase/migrations/20261123000000_store_photos.sql`: `public.store_photos`(가게별 순서 있는 사진, `sort_order` 0 = 대표) + `get_store`에 `photos: [{imageRef}]` 추가(기존 `imageRef`·필드·권한 그대로, 목록 함수는 그대로). 경로는 `stores/<그 가게 UUID>[-<8자리 해시>].<png|jpg|jpeg>`만 허용(DB 제약).
- `build_map.py` → `stores_map.json`: 가게별 사진 계획(경로·해시·원본 위치·대표). 대표 = 원본 `representative_candidate_position`, 나머지는 원본 순서.
- `import_store_photos.py`: `--check / --backup / --apply / --verify / --restore`, `--stores a,b`(기본 16곳 전체). 가게마다 독립 실행.
- `preview_server.py`: 적용 전 로컬 미리보기(아래).

## 적용 순서(승인 뒤, 가게마다 독립)
1. (한 번) 개발 프로젝트에 migration `20261123000000_store_photos.sql` 적용 — 원격 DB 쓰기라 승인 후에만.
2. `python import_store_photos.py --package <수집 폴더> --check` (읽기 전용: UUID·이름·상태·파일 해시·경로 규칙, migration 적용 여부)
3. `--apply --yes-dev-project`: 가게마다 재확인 → 적용 전 백업(`backup/<가게>/<시각>-pre-apply/`: stores 행, store_photos 행, 기존 대표사진 파일, 출처 기록, 메뉴·주문 해시, 다른 가게 해시) → 사진 업로드(**실패하면 그 가게의 DB 변경 전에 멈춤**, 이번에 올린 새 파일만 정리) → DB 한 트랜잭션(`stores.image_ref` = 새 대표, `store_photos` 행, 출처 기록; 안에서 검증) → Guest 검증(get_store 대표·photos 순서, 공개 URL 해시)
4. `--verify`(쓰기 없음): 재실행 점검. 재실행해도 행 id가 같아 중복이 생기지 않는다.

## 복구(가게별)
`python import_store_photos.py --package <수집 폴더> --stores <키> --restore --yes-dev-project --backup-dir backup/<키>/<최초 적용 전 백업>` — `stores.image_ref`를 되돌리고 `store_photos` 행·출처 기록을 지우며 새 파일을 삭제한다. 기존 대표사진 파일은 지운 적이 없어 그대로 남는다. 적용 뒤에 만든 백업은 복구 기준이 아니다(거절).

## 적용 전 로컬 미리보기
```bash
python preview_server.py --package <수집 폴더>     # 0.0.0.0:8099
EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL=http://<내 컴퓨터 IP>:8099 npx expo start      # 개발 모드에서만 동작
```
목록 카드는 새 대표사진, 가게 상세는 갤러리(서버 응답에 `photos`가 없으면 미리보기 서버 목록으로 채움)로 보인다. 미리보기 대상이 아닌 가게는 원래 사진으로 돌려보낸다. DB·Storage에는 쓰지 않는다.

## 시험
```bash
STORE_PHOTOS_PACKAGE=<수집 폴더> python tests/test_store_photos_db.py     # 임시 Postgres, 21개
node --test tests/store/store-photos.test.cjs tests/store/store-photo-preview.test.cjs tests/store/image-url.test.cjs
```
