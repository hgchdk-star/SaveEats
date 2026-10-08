@AGENTS.md

# SaveEats 팀 규칙

## 기준 문서

작업 전 관련 문서를 먼저 읽고, 문서와 다르게 구현해야 하면 임의로 결정하지 말고 사용자에게 확인하세요.

- 서비스 기획서: `docs/SaveEats-service-plan.md`
- PRD: `docs/SaveEats-PRD.md`
- 개발 명세: `docs/SaveEats-development-spec.md`
- 디자인 시스템·페이지 디자인: `docs/design.md` (Claude Design 정본 링크, 토큰 규칙, 앱으로 옮기지 않는 것)
  - 디자인 토큰 값을 새로 만들거나 바꾸지 마세요. 디자인에 없는 화면·컴포넌트를 임의로 디자인해 채우지 말고, 필요하면 사용자에게 디자인 자료를 요청하세요.

제품 정책은 최신 서비스 기획서를 최상위 기준으로 합니다. PRD와 개발 명세는 기획서를 구체화하는 문서입니다.

- 문서끼리 충돌하면 충돌 위치와 구현 영향을 사용자에게 알리고, 해당 부분의 구현을 보류하세요. 독립적인 작업은 계속 진행하세요.
- 미결정 사항과 기술 검증 필요 항목을 임의로 확정하지 마세요.
- 기준 문서가 없거나 경로가 다르면 실제 위치를 확인하고, 내용을 추정하지 마세요.

## 스택

- Expo SDK 57 + Expo Router (라우트는 `src/app/`), TypeScript strict, npm (`package-lock.json`)
- 경로 별칭: `@/*` → `src/*`, `@/assets/*` → `assets/*`
- 백엔드: Supabase (`supabase/`)

## 폴더 역할

- `src/app/` — 라우트(화면)와 `_layout.tsx`만. 로직·컴포넌트는 두지 않음
- `src/features/<기능>/` — 기능별 화면 구성 요소·훅·로직
- `src/components/ui/` — 기능에 종속되지 않는 공통 UI 컴포넌트
- `src/theme/` — 디자인 토큰 (`@/theme`). 값은 디자인 시스템 `tokens.json`을 그대로 옮긴 것 (`tokens.ts`)
- `src/config/` — 앱 설정 한 곳. 미결정 항목의 현재 값, 한도·상수, 확정 전 초안 문구
- `src/services/supabase/` — Supabase 클라이언트·호출 코드
- `src/contracts/` — FE/BE 공통 요청·응답·오류 타입
- `src/mocks/` — 개발용 Mock 데이터
- `src/hooks/`, `src/utils/` — 공통 훅·유틸
- `supabase/` — `config.toml`, `migrations/`, `functions/`, `seed.sql`

## 담당 영역

- 서정: `docs/`, 디자인 자료, `src/theme/` 토큰 값
- 지우: 앱 코드(`src/`), `package.json`·lockfile·`app.json` 등 앱 설정
- 혜지: `supabase/` (migration, Edge Functions, seed)
- `src/contracts/`: 지우·혜지가 먼저 합의한 뒤 한 사람만 수정

다른 사람 담당 영역의 파일을 바꿔야 하면 변경을 진행하기 전에 사용자에게 알리세요.

## 반드시 지킬 것

- Supabase `service_role`/secret 키 등 서버 비밀키를 앱 코드나 `EXPO_PUBLIC_` 환경변수에 넣지 않기
- Expo 앱의 환경변수는 `process.env.EXPO_PUBLIC_*` 점 표기법으로 읽기. 앱에 포함돼도 되는 공개 설정만 사용하기
- Supabase Edge Functions의 서버 환경변수는 `Deno.env.get(...)`으로 읽기
- 새 환경변수는 해당 환경의 예시 파일에 이름과 설명 추가하기. 앱은 루트 `.env.example`, Edge Functions는 `supabase/functions/.env.example` 사용하기
- 실제 값이 담긴 환경변수 파일은 커밋하지 않기. 예시 파일에는 비밀값을 넣지 않기
- 원격 Supabase 연결(`supabase link`)·DB 반영(`db push`)·배포는 사용자가 명시적으로 요청할 때만
- 앱 패키지 추가는 `npx expo install <package>` 사용
- `npm run reset-project` 실행 금지 (`src/` 전체를 옮겨버림)
- `main`에 직접 커밋하지 말고 기능 브랜치 → PR로 작업

## 검증과 완료 보고

- 앱 코드 변경 시 `npx tsc --noEmit`, `npm run lint` 실행
- 백엔드 변경 시 관련 migration·RLS·Edge Functions 검증 수행
- 로컬 환경이 없어 실행하지 못한 검증은 이유와 함께 보고
- 앱 타입 검사·lint 통과를 DB·권한·서버 동작 검증 완료로 표현하지 않기
- 완료 보고에 변경 파일, 검증 결과, 남은 문제를 짧게 정리하기

## 지침 파일 관리

이 파일은 저장소 루트의 `CLAUDE.md`로 사용합니다. `AGENTS.md`도 함께 관리한다면 공통 규칙이 서로 충돌하지 않도록 같은 변경을 반영하세요.
