-- 경제지표·뉴스 수집기의 배포 환경 설정
--
-- 이 파일은 마이그레이션이 아니다. Supabase 대시보드의 SQL Editor에서 직접 실행한다.
-- 비밀값이 들어가는 부분(<...>)은 실행할 때만 채우고 저장소에 커밋하지 않는다.
--
-- 전체 순서
--   A. [SQL] 이 파일의 1단계 실행 (확장, 버킷, 최초관리자 함수, 읽기 정책)
--   B. [터미널] 함수 시크릿 등록
--        npx supabase secrets set MARKET_COLLECTOR_SECRET=<임의의 긴 문자열> --project-ref cnzqegrezwrkcabaztoq
--        (선택) EXIM_API_KEY, ECOS_API_KEY, FRED_API_KEY도 같은 방식으로 등록
--   C. [터미널] 함수 배포. 새 형식 API 키는 JWT가 아니므로 JWT 검증을 끄고 함수 안에서 비밀값을 확인한다.
--        npx supabase functions deploy market-collector --no-verify-jwt --project-ref cnzqegrezwrkcabaztoq
--      재배포할 때 이 옵션을 빠뜨리면 cron 호출이 401로 거부된다.
--   D. [터미널] 함수를 한 번 직접 호출해 200 응답과 Storage의 market.json 생성을 확인
--   E. [SQL] 이 파일의 2단계 실행 (Vault 등록, 1분 주기 예약). Vault 등록은 한 번만 실행한다.
--
-- 되돌리기
--   select cron.unschedule('market-collector-every-minute');
--   delete from vault.secrets where name in ('market_project_url', 'market_collector_secret');
--   drop policy if exists market_cache_read_first_admin on storage.objects;
--   drop function if exists public.is_first_admin();
--   버킷과 파일은 대시보드의 Storage 화면에서 삭제한다.
--
-- 운영 참고
--   cron 실행 기록(cron.job_run_details)이 하루 1440행씩 쌓이므로 주기적으로 정리한다.
--     delete from cron.job_run_details where end_time < now() - interval '7 days';


-- =====================================================================
-- 1단계: 확장, 버킷, 권한 (함수 배포 전에 실행)
-- =====================================================================

-- 1-1) 확장. 대시보드의 Integrations > Cron, Database > Extensions에서 켜도 된다.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net with schema extensions;

-- 1-2) 캐시 버킷 (비공개). 수집기가 market.json 파일 하나를 여기에 저장한다.
insert into storage.buckets (id, name, public)
values ('market-cache', 'market-cache', false)
on conflict (id) do nothing;

-- 1-3) 최초관리자 판별: 활성 ADMIN 가운데 created_at이 가장 이른 계정.
--      화면(src/hooks/useIsFirstAdmin.ts)과 같은 기준이다.
create or replace function public.is_first_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select u.auth_user_id = auth.uid()
      from public.dash_users u
      where u.role_code = 'ADMIN' and u.is_active
      order by u.created_at asc, u.auth_user_id asc
      limit 1
    ),
    false
  );
$$;

revoke all on function public.is_first_admin() from public, anon;
grant execute on function public.is_first_admin() to authenticated;

-- 1-4) 캐시 파일 읽기 권한: 최초관리자만.
--      쓰기는 Edge Function이 서비스 키로 수행하므로 정책을 두지 않는다.
drop policy if exists market_cache_read_first_admin on storage.objects;
create policy market_cache_read_first_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'market-cache' and public.is_first_admin());


-- =====================================================================
-- 2단계: 1분 주기 예약 (함수 배포와 직접 호출 확인이 끝난 뒤에 실행)
-- =====================================================================

-- 2-1) 호출에 쓸 값을 Vault에 저장. 두 번째 값은 B에서 등록한 MARKET_COLLECTOR_SECRET과 같아야 한다.
select vault.create_secret('https://cnzqegrezwrkcabaztoq.supabase.co', 'market_project_url');
select vault.create_secret('<MARKET_COLLECTOR_SECRET과 같은 값>', 'market_collector_secret');

-- 2-2) 1분마다 수집기 호출.
--      수집기는 캐시에 기록된 마지막 시도 시각을 보고 호출 여부를 정하므로
--      증시는 거래시간 안에서 분당 1회, 환율·금리는 시간당 1회, 뉴스는 10분에 1회만 원천을 호출한다.
select cron.schedule(
  'market-collector-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'market_project_url')
           || '/functions/v1/market-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'market_collector_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);


-- =====================================================================
-- 확인용 조회 (2단계 실행 2~3분 뒤)
-- =====================================================================

-- 예약이 등록되었는지
-- select jobid, jobname, schedule, active from cron.job;

-- 매분 실행되고 있는지
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;

-- 함수가 200으로 응답하는지 (403이면 비밀값 불일치, 500이면 content의 오류 문구 확인)
-- select status_code, left(content, 200) as content, created from net._http_response order by created desc limit 5;
