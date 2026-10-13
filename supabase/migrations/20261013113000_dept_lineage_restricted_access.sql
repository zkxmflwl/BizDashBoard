-- =====================================================================
-- 부서 승계 정보 + 제한 부서(KSPI) 접근 제어 + 화면 기능 권한
-- 2026-10-13
--  1) departments: predecessor_code, established_month, is_restricted
--  2) dash_users : restricted_dept_codes, feature_access
--  3) 판정 함수  : can_view_department(code), has_feature(name)
--  4) RLS 정책   : 부서 데이터 테이블에 can_view_department 조건 적용
--  5) 데이터     : AIP(IX 승계, 2026-01), DC(신설 2026-01), KSPI 부서,
--                  심보연·김용회 KSPI 열람, 심보연 영업 현황 접근
-- 되돌리기: supabase/rollback/20261013_dept_lineage_restricted_access_down.sql
-- =====================================================================

-- 1) departments 컬럼 ---------------------------------------------------
alter table public.departments
  add column if not exists predecessor_code text
    references public.departments(department_code) on update cascade on delete set null,
  add column if not exists established_month text
    check (established_month is null or established_month ~ '^\d{4}-\d{2}$'),
  add column if not exists is_restricted boolean not null default false;

comment on column public.departments.predecessor_code  is '분리 전 모부서 코드 (예: AIP -> IX). 전년 비교 시 모부서에 합산';
comment on column public.departments.established_month is '신설·분리 시점(YYYY-MM). 이 시점 이전 데이터가 없는 것이 정상';
comment on column public.departments.is_restricted     is 'true면 restricted_dept_codes 보유자 또는 ADMIN만 조회·입력 가능';

-- 2) dash_users 권한 컬럼 -----------------------------------------------
alter table public.dash_users
  add column if not exists restricted_dept_codes text[] not null default '{}',
  add column if not exists feature_access        text[] not null default '{}';

comment on column public.dash_users.restricted_dept_codes is '열람 허용된 제한 부서 코드 목록 (예: {KSPI})';
comment on column public.dash_users.feature_access        is '접근 허용된 화면 기능 목록 (예: {sales_overview}). ADMIN은 전부 허용';

-- 3) 판정 함수 ----------------------------------------------------------
create or replace function public.can_view_department(p_code text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    -- 부서 코드가 없거나(자산 등 null) 제한 부서가 아니면 누구나
    coalesce((select not d.is_restricted from public.departments d where d.department_code = p_code), true)
    -- 제한 부서면 ADMIN 또는 명시 허용 사용자만
    or exists (
      select 1 from public.dash_users u
      where u.auth_user_id = auth.uid()
        and u.is_active
        and (u.role_code = 'ADMIN' or p_code = any(u.restricted_dept_codes))
    );
$$;

create or replace function public.has_feature(p_feature text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dash_users u
    where u.auth_user_id = auth.uid()
      and u.is_active
      and (u.role_code = 'ADMIN' or p_feature = any(u.feature_access))
  );
$$;

revoke all on function public.can_view_department(text) from public;
revoke all on function public.has_feature(text)          from public;
grant execute on function public.can_view_department(text) to authenticated, service_role;
grant execute on function public.has_feature(text)          to authenticated, service_role;

-- 4) RLS 정책 교체 ------------------------------------------------------
-- departments
drop policy if exists departments_select_authenticated on public.departments;
drop policy if exists departments_insert_authenticated on public.departments;
drop policy if exists departments_update_authenticated on public.departments;
drop policy if exists departments_delete_authenticated on public.departments;
create policy departments_select_authenticated on public.departments
  for select to authenticated using (is_active = true and public.can_view_department(department_code));
create policy departments_insert_authenticated on public.departments
  for insert to authenticated with check (true);
create policy departments_update_authenticated on public.departments
  for update to authenticated using (public.can_view_department(department_code));
create policy departments_delete_authenticated on public.departments
  for delete to authenticated using (public.can_view_department(department_code));

-- department_sales_summary
drop policy if exists "authenticated full access" on public.department_sales_summary;
create policy dss_select on public.department_sales_summary
  for select to authenticated using (public.can_view_department(department_code));
create policy dss_insert on public.department_sales_summary
  for insert to authenticated with check (public.can_view_department(department_code));
create policy dss_update on public.department_sales_summary
  for update to authenticated using (public.can_view_department(department_code))
                              with check (public.can_view_department(department_code));
create policy dss_delete on public.department_sales_summary
  for delete to authenticated using (public.can_view_department(department_code));

-- business_projects
drop policy if exists "authenticated full access" on public.business_projects;
create policy bp_select on public.business_projects
  for select to authenticated using (public.can_view_department(department_code));
create policy bp_insert on public.business_projects
  for insert to authenticated with check (public.can_view_department(department_code));
create policy bp_update on public.business_projects
  for update to authenticated using (public.can_view_department(department_code))
                              with check (public.can_view_department(department_code));
create policy bp_delete on public.business_projects
  for delete to authenticated using (public.can_view_department(department_code));

-- tangible_assets (department_code null 허용: null이면 누구나)
drop policy if exists "authenticated full access" on public.tangible_assets;
create policy ta_select on public.tangible_assets
  for select to authenticated using (public.can_view_department(department_code));
create policy ta_insert on public.tangible_assets
  for insert to authenticated with check (public.can_view_department(department_code));
create policy ta_update on public.tangible_assets
  for update to authenticated using (public.can_view_department(department_code))
                              with check (public.can_view_department(department_code));
create policy ta_delete on public.tangible_assets
  for delete to authenticated using (public.can_view_department(department_code));

-- intangible_assets
drop policy if exists "authenticated full access" on public.intangible_assets;
create policy ia_select on public.intangible_assets
  for select to authenticated using (public.can_view_department(department_code));
create policy ia_insert on public.intangible_assets
  for insert to authenticated with check (public.can_view_department(department_code));
create policy ia_update on public.intangible_assets
  for update to authenticated using (public.can_view_department(department_code))
                              with check (public.can_view_department(department_code));
create policy ia_delete on public.intangible_assets
  for delete to authenticated using (public.can_view_department(department_code));

-- sector_project
drop policy if exists auth_select_sector_project on public.sector_project;
drop policy if exists auth_insert_sector_project on public.sector_project;
drop policy if exists auth_update_sector_project on public.sector_project;
drop policy if exists auth_delete_sector_project on public.sector_project;
create policy auth_select_sector_project on public.sector_project
  for select to authenticated using (public.can_view_department(department_code));
create policy auth_insert_sector_project on public.sector_project
  for insert to authenticated with check (public.can_view_department(department_code));
create policy auth_update_sector_project on public.sector_project
  for update to authenticated using (public.can_view_department(department_code))
                              with check (public.can_view_department(department_code));
create policy auth_delete_sector_project on public.sector_project
  for delete to authenticated using (public.can_view_department(department_code));

-- 5) 데이터 등록 --------------------------------------------------------
-- AIP: IX에서 2026-01 분리 / DC: 2026-01 신설
update public.departments set predecessor_code = 'IX', established_month = '2026-01'
 where department_code = 'AIP';
update public.departments set predecessor_code = null, established_month = '2026-01'
 where department_code = 'DC';

-- KSPI: 자회사 부문, 제한 부서
insert into public.departments
  (department_code, department_name, sector_code, sector_name, sort_order, is_active, is_restricted)
values ('KSPI', 'KSPI', 'SUB', '자회사', 50, true, true)
on conflict (department_code) do update
  set sector_code   = excluded.sector_code,
      sector_name   = excluded.sector_name,
      is_restricted = true;

-- KSPI 열람: 심보연, 김용회 (ADMIN은 함수에서 자동 허용)
update public.dash_users
   set restricted_dept_codes = array_append(array_remove(restricted_dept_codes, 'KSPI'), 'KSPI')
 where user_name in ('심보연', '김용회');

-- 영업 현황 화면: 심보연 (심규남 대표님은 계정 생성 후 사용자 관리 화면에서 부여)
update public.dash_users
   set feature_access = array_append(array_remove(feature_access, 'sales_overview'), 'sales_overview')
 where user_name in ('심보연');
