# Supabase DB 테스트

`supabase/tests/database/*.test.sql`은 pgTAP 테스트다. 각 파일은 `begin` … `rollback`으로 감싸져 있어 실행 후 DB가 바뀌지 않는다.

## 실행

로컬에 Docker가 있을 때:

```bash
supabase start
supabase db reset      # migration + seed.sql 적용
supabase test db       # supabase/tests/database 전체 실행
```

Docker가 없으면 GitHub Actions(`.github/workflows/supabase-db.yml`)가 `supabase/**` 변경 PR에서 같은 순서로 실행한다.

## 규칙

- 테스트는 seed가 적용된 DB를 전제로 한다. 개수 기대값은 seed에 하드코딩하지 않고 가시성 규칙으로 직접 계산한다.
- 권한·RLS 변경에는 반드시 허용/거절 테스트를 함께 추가한다. 관리자(postgres)로 성공한 테스트로 앱 권한을 대신 검증하지 않는다.
  `set local role anon|authenticated`와 `request.jwt.claims`(sub)로 실제 역할을 흉내 낸다.
- 새 Guest 조회 RPC를 만들면 `001_catalog_public_read.test.sql`의 "Guest가 실행할 수 있는 public 함수" 목록을 함께 갱신한다.
- 오류 확인은 테스트 파일 안의 `public.test_err(sql, sqlstate, 메시지 일부)` 도우미를 쓴다(트랜잭션 롤백으로 사라진다).
- `ON DELETE RESTRICT` 위반의 SQLSTATE는 `23001`이다 (`NO ACTION`의 `23503`과 다르다).

## 검증 상태

이 테스트는 지금까지 로컬 대체 DB(PGlite, pgTAP 함수 일부를 흉내 낸 실행기)로만 돌려봤다.
**실제 Supabase + 진짜 pgTAP에서 처음 실행한 결과는 GitHub Actions에서 확인한다.**
