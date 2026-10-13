-- =====================================================================
-- 되돌리기: 20261013113000_dept_lineage_restricted_access
-- 실행 방법: 이 파일 전체를 DB에서 실행한 뒤
--   npx supabase migration repair --status reverted 20261013113000
-- 으로 이력에서 제거하고, 마이그레이션 파일을 레포에서 삭제한다.
-- 기존 데이터(KSPI 부서 제외)는 손대지 않는다.
-- =====================================================================

-- 5) 데이터 되돌리기
update public.dash_users set feature_access        = array_remove(feature_access, 'sales_overview');
update public.dash_users set restricted_dept_codes = array_remove(restricted_dept_codes, 'KSPI');
update public.departments set predecessor_code = null, established_month = null
 where department_code in ('AIP', 'DC');

-- KSPI 부서는 참조 데이터가 없을 때만 삭제 (있으면 비활성화)
do $$
begin
  if not exists (select 1 from public.department_sales_summary where department_code = 'KSPI')
     and not exists (select 1 from public.business_projects      where department_code = 'KSPI')
     and not exists (select 1 from public.tangible_assets        where department_code = 'KSPI')
     and not exists (select 1 from public.intangible_assets      where department_code = 'KSPI')
     and not exists (select 1 from public.sector_project         where department_code = 'KSPI')
     and not exists (select 1 from public.dash_users             where department_code = 'KSPI') then
    delete from public.departments where department_code = 'KSPI';
  else
    update public.departments set is_active = false where department_code = 'KSPI';
  end if;
end $$;

-- 4) RLS 정책을 baseline(20261001064940) 상태로 복원
drop policy if exists departments_select_authenticated on public.departments;
drop policy if exists departments_insert_authenticated on public.departments;
drop policy if exists departments_update_authenticated on public.departments;
drop policy if exists departments_delete_authenticated on public.departments;
create policy departments_select_authenticated on public.departments for select to authenticated using (is_active = true);
create policy departments_insert_authenticated on public.departments for insert to authenticated with check (true);
create policy departments_update_authenticated on public.departments for update to authenticated using (true);
create policy departments_delete_authenticated on public.departments for delete to authenticated using (true);

drop policy if exists dss_select on public.department_sales_summary;
drop policy if exists dss_insert on public.department_sales_summary;
drop policy if exists dss_update on public.department_sales_summary;
drop policy if exists dss_delete on public.department_sales_summary;
create policy "authenticated full access" on public.department_sales_summary for all to authenticated using (true) with check (true);

drop policy if exists bp_select on public.business_projects;
drop policy if exists bp_insert on public.business_projects;
drop policy if exists bp_update on public.business_projects;
drop policy if exists bp_delete on public.business_projects;
create policy "authenticated full access" on public.business_projects for all to authenticated using (true) with check (true);

drop policy if exists ta_select on public.tangible_assets;
drop policy if exists ta_insert on public.tangible_assets;
drop policy if exists ta_update on public.tangible_assets;
drop policy if exists ta_delete on public.tangible_assets;
create policy "authenticated full access" on public.tangible_assets for all to authenticated using (true) with check (true);

drop policy if exists ia_select on public.intangible_assets;
drop policy if exists ia_insert on public.intangible_assets;
drop policy if exists ia_update on public.intangible_assets;
drop policy if exists ia_delete on public.intangible_assets;
create policy "authenticated full access" on public.intangible_assets for all to authenticated using (true) with check (true);

drop policy if exists auth_select_sector_project on public.sector_project;
drop policy if exists auth_insert_sector_project on public.sector_project;
drop policy if exists auth_update_sector_project on public.sector_project;
drop policy if exists auth_delete_sector_project on public.sector_project;
create policy auth_select_sector_project on public.sector_project for select to authenticated using (true);
create policy auth_insert_sector_project on public.sector_project for insert to authenticated with check (true);
create policy auth_update_sector_project on public.sector_project for update to authenticated using (true);
create policy auth_delete_sector_project on public.sector_project for delete to authenticated using (true);

-- 3) 함수 제거
drop function if exists public.has_feature(text);
drop function if exists public.can_view_department(text);

-- 2) dash_users 컬럼 제거
alter table public.dash_users
  drop column if exists feature_access,
  drop column if exists restricted_dept_codes;

-- 1) departments 컬럼 제거
alter table public.departments
  drop column if exists is_restricted,
  drop column if exists established_month,
  drop column if exists predecessor_code;
