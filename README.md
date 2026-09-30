# SaveEats

Expo(SDK 57) + Expo Router 기반 React Native 앱과 Supabase 백엔드로 구성된 프로젝트입니다.

- 언어: TypeScript
- 패키지 매니저: npm (`package-lock.json`)
- 라우팅: Expo Router — `src/app/` 안의 파일이 곧 화면

## 설치 및 실행

Node.js LTS가 필요합니다.

```bash
npm install          # 의존성 설치
npm start            # 개발 서버 시작 (npx expo start)
npm run android      # Android 에뮬레이터/기기
npm run ios          # iOS 시뮬레이터 (macOS)
npm run web          # 웹 브라우저
```

개발 서버가 뜨면 QR 코드를 Expo Go 앱으로 스캔해 실기기에서 확인할 수 있습니다.

패키지를 추가할 때는 `npm install` 대신 SDK 호환 버전을 골라주는 명령을 사용합니다.

```bash
npx expo install <package>
```

검증 명령:

```bash
npx tsc --noEmit     # 타입 검사
npm run lint         # 린트 (expo lint)
```

> `npm run reset-project`는 템플릿 초기화 스크립트로, `src/`를 통째로 옮깁니다. 실행하지 마세요.

## 환경변수 설정

```bash
cp .env.example .env
```

`.env`를 열어 값을 채웁니다. 값은 Supabase 대시보드 → Project Settings → API에서 확인합니다(혜지에게 요청).

| 변수 | 설명 |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 공개 클라이언트 키 (publishable 또는 레거시 anon 키) |

- Expo가 `.env`를 자동으로 읽고, `EXPO_PUBLIC_`로 시작하는 변수만 앱에 포함합니다.
- 코드에서는 `process.env.EXPO_PUBLIC_SUPABASE_URL`처럼 **점 표기법으로만** 읽습니다.
- `.env`, `.env.*`는 Git에서 제외됩니다(`.env.example`만 커밋).
- `EXPO_PUBLIC_` 값은 앱 안에 평문으로 들어갑니다. **`service_role`/secret 키 같은 서버 비밀키는 절대 넣지 마세요.** 서버 비밀키는 Supabase Edge Function 시크릿으로만 관리합니다.
- `.env`를 바꾼 뒤에는 개발 서버를 재시작하세요.

## 폴더 구조

```
docs/                     기획서·PRD·개발 명세·디자인 자료
src/
  app/                    Expo Router 라우트(화면)와 _layout.tsx — 로직은 두지 않음
  features/<기능>/         기능별 앱 코드 (화면 구성 요소, 훅, 로직)
  components/             공통 컴포넌트
    ui/                   공통 UI 컴포넌트 (버튼, 입력창 등)
  theme/                  디자인 토큰 — import from '@/theme' (현재 Expo 템플릿 기본값)
  services/supabase/      Supabase 클라이언트·호출 코드
  contracts/              FE/BE 공통 요청·응답·오류 타입
  mocks/                  개발용 Mock 데이터
  hooks/                  공통 훅
  utils/                  공통 유틸
supabase/
  config.toml             로컬 Supabase 설정
  migrations/             DB migration (SQL)
  functions/              Edge Functions (서버 함수)
  seed.sql                로컬 개발용 시드 데이터 (필요할 때 생성)
assets/                   이미지·아이콘·폰트
```

기준 문서:

- `docs/SaveEats-service-plan.md` — 서비스 기획서
- `docs/SaveEats-PRD.md` — PRD
- `docs/SaveEats-development-spec.md` — 개발 명세
- `docs/design.md` — 디자인 시스템·페이지 디자인 (**아직 없음**)

디자인 시스템은 현재 Claude Design에서 관리합니다. 디자인 자료가 전달되면 `docs/design.md`로 연결하고, 그때 `src/theme/` 디자인 토큰과 `src/components/ui/` 공통 UI를 구현합니다. 그 전에는 디자인 토큰·공통 UI를 임의로 만들지 않습니다.

## 팀원별 담당 영역

| 팀원 | 역할 | 주 담당 경로 |
| --- | --- | --- |
| 서정 | 기획·디자인 시스템·페이지 디자인 | `docs/`, 디자인 자료, `src/theme/` 토큰 값 |
| 지우 | React Native 프론트엔드 | `src/` 앱 코드, `package.json`·`package-lock.json`·`app.json` 등 앱 설정 |
| 혜지 | Supabase 백엔드 | `supabase/` (migration, Edge Functions, seed) |

- **`src/contracts/`**: FE/BE가 함께 쓰는 약속입니다. 지우·혜지가 PR 또는 이슈에서 먼저 합의한 뒤, **한 사람이** 수정합니다.
- **`package.json`·lockfile**: 지우가 관리합니다. 패키지가 필요하면 지우에게 요청하세요. 여러 브랜치에서 동시에 바꾸면 lockfile 충돌이 나기 쉽습니다.
- 다른 사람 담당 영역을 고쳐야 하면 PR에서 담당자를 리뷰어로 지정합니다.

## 협업 흐름

모두 같은 저장소에서 작업하며, `main`에 직접 push하지 않습니다.

1. 최신 `main` 받기
   ```bash
   git switch main
   git pull
   ```
2. 기능 브랜치 만들기 — `<종류>/<짧은-설명>`
   ```bash
   git switch -c feat/login-screen
   ```
   종류: `feat`(기능), `fix`(버그), `docs`(문서), `design`(디자인), `db`(Supabase), `chore`(설정)
3. 작업 후 검증: `npx tsc --noEmit`, `npm run lint`
4. 커밋하고 push
   ```bash
   git add <파일>
   git commit -m "feat: 로그인 화면 추가"
   git push -u origin feat/login-screen
   ```
5. GitHub에서 `main` 대상으로 PR 생성 → 관련 담당자 리뷰
6. 리뷰 승인 후 `main`에 병합하고 브랜치 삭제
7. 다른 사람 PR이 병합되면 내 브랜치에 `main`을 반영
   ```bash
   git switch main && git pull
   git switch feat/login-screen && git merge main
   ```

### Claude Code 사용

각자 Claude Code를 사용합니다. 프로젝트 규칙은 `CLAUDE.md`(및 `AGENTS.md`)에 있으며 Claude Code가 자동으로 읽습니다. 팀 규칙이 바뀌면 `CLAUDE.md`도 PR로 함께 수정하세요.

## Supabase 로컬 개발 (혜지)

`supabase/config.toml`은 `supabase init`으로 생성된 로컬 설정입니다. 로컬 실행에는 Docker가 필요합니다.

```bash
npx supabase start          # 로컬 Supabase 실행
npx supabase migration new <이름>   # 새 migration 파일 생성
npx supabase db reset       # 로컬 DB를 migration + seed로 재구성
npx supabase stop
```

원격 프로젝트 연결(`supabase link`)과 원격 DB 반영(`supabase db push`)·함수 배포는 팀 합의 후 진행합니다.
