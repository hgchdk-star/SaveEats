@AGENTS.md

# SaveEats 팀 규칙

## 기준 문서

작업 전 관련 문서를 먼저 읽고, 문서와 다르게 구현해야 하면 임의로 결정하지 말고 사용자에게 확인하세요.

- 서비스 기획서: `docs/SaveEats-service-plan.md`
- PRD: `docs/SaveEats-PRD.md`
- 개발 명세: `docs/SaveEats-development-spec.md`
- 디자인 시스템·페이지 디자인: **현재 저장소에 없음.** 디자인 시스템은 Claude Design에서 관리하며, 디자인 자료가 전달되면 `docs/design.md`로 연결할 예정입니다.
  - 그 전까지 디자인 토큰·공통 UI 컴포넌트·화면 디자인을 임의로 만들거나 추측하지 마세요. 필요하면 사용자에게 디자인 자료를 요청하세요.

## 스택

- Expo SDK 57 + Expo Router (라우트는 `src/app/`), TypeScript strict, npm (`package-lock.json`)
- 경로 별칭: `@/*` → `src/*`, `@/assets/*` → `assets/*`
- 백엔드: Supabase (`supabase/`)

## 폴더 역할

- `src/app/` — 라우트(화면)와 `_layout.tsx`만. 로직·컴포넌트는 두지 않음
- `src/features/<기능>/` — 기능별 화면 구성 요소·훅·로직
- `src/components/ui/` — 기능에 종속되지 않는 공통 UI 컴포넌트
- `src/theme/` — 디자인 토큰 (`@/theme`). 현재 `index.ts`는 Expo 템플릿 기본값이며 SaveEats 디자인이 아님. 디자인 자료 전달 후 교체
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
- 환경변수는 `process.env.EXPO_PUBLIC_*` 점 표기법으로만 읽기. 새 변수는 `.env.example`에 이름과 설명 추가
- 원격 Supabase 연결(`supabase link`)·DB 반영(`db push`)·배포는 사용자가 명시적으로 요청할 때만
- 패키지 추가는 `npx expo install <package>` 사용
- `npm run reset-project` 실행 금지 (`src/` 전체를 옮겨버림)
- `main`에 직접 커밋하지 말고 기능 브랜치 → PR로 작업
- 작업 완료 전 `npx tsc --noEmit`, `npm run lint` 실행
