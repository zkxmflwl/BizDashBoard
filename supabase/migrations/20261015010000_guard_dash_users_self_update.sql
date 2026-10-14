-- =====================================================================
-- dash_users 자기 행 갱신 범위 제한
-- 2026-10-15
-- 배경: dash_users_update_own 정책은 자기 행의 모든 컬럼 갱신을 허용하므로
--       일반 사용자가 role_code·feature_access·restricted_dept_codes 등을
--       스스로 바꿀 수 있었다. RLS는 컬럼 단위 제한이 불가능하므로
--       BEFORE UPDATE 트리거로 권한 컬럼 변경을 거부한다.
-- 통과 조건:
--   - auth.uid()가 null인 실행 (service_role 엣지 함수, 마이그레이션, SQL 편집기)
--   - public.is_admin() = true 인 사용자 (사용자 관리 화면)
-- 일반 사용자가 바꿀 수 있는 컬럼: must_change_password 등 아래 목록 외 컬럼
-- 되돌리기: supabase/rollback/20261015_guard_dash_users_self_update_down.sql
-- =====================================================================

create or replace function public.guard_dash_users_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 사용자 JWT가 없는 실행(서비스 롤·관리 작업)은 제한하지 않음
  if auth.uid() is null then
    return new;
  end if;

  -- ADMIN은 모든 컬럼 갱신 가능 (dash_users_update_admin 정책과 짝)
  if public.is_admin() then
    return new;
  end if;

  if new.auth_user_id          is distinct from old.auth_user_id
  or new.user_email            is distinct from old.user_email
  or new.user_name             is distinct from old.user_name
  or new.role_code             is distinct from old.role_code
  or new.department_code       is distinct from old.department_code
  or new.is_active             is distinct from old.is_active
  or new.restricted_dept_codes is distinct from old.restricted_dept_codes
  or new.feature_access        is distinct from old.feature_access
  then
    raise exception 'permission denied: 권한·소속 정보는 ADMIN만 변경할 수 있습니다'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_dash_users_update() from public;

drop trigger if exists trg_dash_users_guard_update on public.dash_users;
create trigger trg_dash_users_guard_update
  before update on public.dash_users
  for each row execute function public.guard_dash_users_update();

comment on trigger trg_dash_users_guard_update on public.dash_users
  is '일반 사용자가 자기 행의 권한·소속 컬럼을 바꾸지 못하게 막는다 (ADMIN·service_role 제외)';
