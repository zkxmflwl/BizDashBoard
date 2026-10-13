-- =====================================================================
-- ADMIN이 사용자 관리 화면에서 dash_users의 권한 컬럼을 직접 갱신할 수 있도록 허용
-- (restricted_dept_codes, feature_access). 엣지 함수 수정 없이 RLS로 처리.
-- 되돌리기: drop policy dash_users_update_admin; drop function public.is_admin();
-- =====================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dash_users u
    where u.auth_user_id = auth.uid() and u.is_active and u.role_code = 'ADMIN'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

drop policy if exists dash_users_update_admin on public.dash_users;
create policy dash_users_update_admin on public.dash_users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
