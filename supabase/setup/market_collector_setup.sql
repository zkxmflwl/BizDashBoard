-- 경제지표·뉴스 수집기의 배포 환경 설정 (아직 적용하지 않음)
--
-- 이 파일은 마이그레이션이 아니다. 내용을 검토한 뒤 SQL Editor에서 직접 실행한다.
-- 비밀값이 들어가는 부분(<...>)은 실행할 때만 채우고 저장소에 커밋하지 않는다.
-- 2026-11-18 기준 이 프로젝트에는 pg_cron, pg_net이 설치되어 있지 않고 Storage 버킷도 없다.
--
-- 적용 순서
--   1) 함수 시크릿 등록 (터미널)
--        supabase secrets set MARKET_COLLECTOR_SECRET=<임의의 긴 문자열>
--        supabase secrets set EXIM_API_KEY=<...> ECOS_API_KEY=<...> FRED_API_KEY=<...>   -- 있는 것만
--   2) 함수 배포 (터미널). 새 형식 API 키는 JWT가 아니므로 JWT 검증을 끄고 함수 안에서 비밀값을 확인한다.
--        supabase functions deploy market-collector --no-verify-jwt
--      재배포할 때 이 옵션을 빠뜨리면 cron 호출이 401로 거부된다. 고정하려면 supabase/config.toml에
--        [functions.market-collector]
--        verify_jwt = false
--      를 추가한다(배포 설정 변경이므로 이번 작업에서는 넣지 않았다).
--   3) 아래 SQL 실행. 5)의 Vault 등록은 한 번만 실행한다(같은 이름으로 다시 실행하면 오류가 난다).
--
-- 운영 참고
--   cron 실행 기록(cron.job_run_details)이 하루 1440행씩 쌓이므로 주기적으로 정리한다.
--
-- 되돌리기
--   select cron.unschedule('market-collector-every-minute');
--   drop policy if exists market_cache_read_first_admin on storage.objects;
--   drop function if exists public.is_first_admin();
--   delete from vault.secrets where name in ('market_project_url', 'market_collector_secret');
--   버킷과 파일은 대시보드의 Storage 화면에서 삭제한다.

-- 1) 확장 ---------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2) 캐시 버킷 (비공개) ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('market-cache', 'market-cache', false)
on conflict (id) do nothing;

-- 3) 최초관리자 판별: 활성 ADMIN 가운데 created_at이 가장 이른 계정 ----------
--    화면(src/hooks/useIsFirstAdmin.ts)과 같은 기준이다.
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

-- 4) 캐시 파일 읽기 권한: 최초관리자만 ------------------------------------
--    쓰기는 Edge Function이 서비스 키로 수행하므로 정책을 두지 않는다.
drop policy if exists market_cache_read_first_admin on storage.objects;
create policy market_cache_read_first_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'market-cache' and public.is_first_admin());

-- 5) 호출에 쓸 값을 Vault에 저장 -----------------------------------------
select vault.create_secret('https://<project-ref>.supabase.co', 'market_project_url');
select vault.create_secret('<MARKET_COLLECTOR_SECRET과 같은 값>', 'market_collector_secret');

-- 6) 1분마다 수집기 호출 --------------------------------------------------
--    수집기는 캐시에 기록된 마지막 시도 시각을 보고 호출 여부를 정하므로
--    증시는 거래시간 안에서 분당 1회, 환율·금리는 하루 1회, 뉴스는 10분에 1회만 원천을 호출한다.
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
