import { supabase } from '@/integrations/supabase/client';

export interface Department {
  department_code: string;
  department_name: string;
  sector_code: string | null;
  sector_name: string | null;
  is_active: boolean;
  sort_order: number;
  /** 분리 전 모부서 코드 (예: AIP → IX). 전년 비교 시 모부서에 합산 */
  predecessor_code: string | null;
  /** 신설·분리 시점 (YYYY-MM). 이 시점 이전 데이터가 없는 것이 정상 */
  established_month: string | null;
  /** true면 열람 권한이 있는 사용자(또는 ADMIN)에게만 조회됨 (예: 자회사 KSPI) */
  is_restricted: boolean;
}

export async function fetchDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .select('department_code, department_name, sector_code, sector_name, is_active, sort_order, predecessor_code, established_month, is_restricted')
    .eq('is_active', true)
    .order('sort_order')
    .order('department_name');
  if (error) throw error;
  return data as Department[];
}
