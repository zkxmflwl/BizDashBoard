-- =====================================================================
-- 되돌리기: 20261015010000_guard_dash_users_self_update
-- 실행 방법: 이 파일 전체를 DB에서 실행한 뒤
--   npx supabase migration repair --status reverted 20261015010000
-- 으로 이력에서 제거하고, 마이그레이션 파일을 레포에서 삭제한다.
-- 데이터는 손대지 않는다.
-- =====================================================================

drop trigger if exists trg_dash_users_guard_update on public.dash_users;
drop function if exists public.guard_dash_users_update();
