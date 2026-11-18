# BizDashboard

사내 경영 현황 대시보드입니다. 부서별 매출·매입·인원, 사업부 프로젝트, 부문 프로젝트 진행률, IT 유형·무형자산을 Supabase에 저장하고 역할(ADMIN / MANAGER / VIEWER)에 따라 조회·편집합니다.

## 기술 스택

- Vite + React 18 + TypeScript
- shadcn-ui (Radix), Tailwind CSS, Recharts
- Supabase (PostgreSQL, Auth, Edge Functions)
- TanStack React Query

## 로컬 실행

```sh
npm install
cp .env.example .env   # 값을 실제 Supabase 프로젝트 정보로 채웁니다
npm run dev            # http://localhost:8080
```

## 환경변수 (.env)

| 변수 | 설명 |
|---|---|
| `VITE_SUPABASE_PROJECT_ID` | Supabase 프로젝트 ref |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 공개용 publishable 키 (`sb_publishable_...`) |

`.env`는 git에 포함하지 않습니다. 배포 환경에서는 동일한 변수를 호스팅 설정에 등록합니다.

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 (`dist/`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

## Supabase

- 스키마: `supabase/migrations/`
- 엣지 함수: `supabase/functions/admin-users` (관리자 전용 사용자 생성·관리, 서비스 롤 키 사용)
- 프로젝트 ref: `supabase/config.toml`

## 경제지표·뉴스 테스트 화면

최초관리자(활성 ADMIN 중 가장 먼저 생성된 계정)에게만 보이는 화면입니다(`/market-test`). 브라우저는 외부 사이트를 호출하지 않고, 수집기가 기록한 캐시 JSON만 60초마다 읽습니다.

```sh
npm run market:collector                  # 로컬 수집기 (http://127.0.0.1:8787/market.json), Node 24 이상
npm run market:collector -- --simulate    # 지수 원천을 호출하지 않고 모의 값으로 1분 갱신 확인
npm run dev                               # 다른 터미널에서 화면 실행
```

- 수집기 코드: `supabase/functions/_shared/market/` (소스별 provider는 `providers/`, 등록은 `providers/index.ts`)
- 외부 링크와 표시 이름: `src/config/marketConfig.ts`
- API 키(`EXIM_API_KEY`, `ECOS_API_KEY`, `FRED_API_KEY`)는 `.env.local`에 둡니다. 키가 있는 항목은 공식 API를 하루 1회 읽고, 키가 없는 항목은 네이버 증권 시장지표 JSON(비공식)의 실제 값을 1시간마다 읽습니다. 그 소스가 막히면 샘플로 표시됩니다.
- 배포 환경용 수집기(`supabase/functions/market-collector`)와 설정 SQL(`supabase/setup/market_collector_setup.sql`)은 작성만 된 상태이며 아직 적용하지 않았습니다.

## 화면 구성

- 대시보드: 월별 YTD 매출·매입·순매출, 전년 대비, 부서별 그리드와 월별 차트
- 사업부: 월간 보고, 월별 데이터 입력(엑셀 업로드), 프로젝트 데이터
- 전략: 부문 프로젝트 현황·관리
- 총무: IT 유형자산·무형자산 관리
- 관리자: 부서 관리, 사용자 관리
