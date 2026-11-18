import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBusinessProjects, BusinessProjectRow } from '@/services/businessProjectService';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Search, X, Handshake, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 10;

/**
 * 영업 현황 (사업부 간 영업 현황 공유 · 협업 발견)
 * - 접근: 로그인한 모든 사용자. 제한 부서(자회사) 건은 RLS로 자동 제외
 * - 구성: 영업 진행 중 건수 · 검색 · 영업 단계/사업부 클릭 필터 → 프로젝트 목록 → 고객사 × 사업부 접점표
 *         필터와 검색은 프로젝트 목록에만 적용된다 (기본: 영업 단계 '영업 중' + 사업부 전체)
 *         접점표는 전용 검색(고객사명)과 접점 있음/없음 필터를 가지며, 행을 누르면 그 고객사의 접점 요약이 모달로 열린다
 *         고객사 헤더를 누르면 가나다 정렬, 사업부 헤더를 누르면 그 사업부 접점이 많은 순으로 정렬된다
 * - 금액(매출·매입)은 표시하지 않는다
 * - 담당자·최종 수정자는 표시하지 않는다. 사업부가 보이므로 그쪽으로 연락하면 된다
 */

type Stage = 'selling' | 'performing' | 'done' | 'closed';
const STAGE_LABEL: Record<Stage, string> = { selling: '영업 중', performing: '수행 중', done: '완료', closed: '과거 접촉' };
const STAGE_ORDER: Stage[] = ['selling', 'performing', 'done', 'closed'];
const STAGE_CELL: Record<Stage, string> = {
  selling: 'bg-blue-100 text-blue-700',
  performing: 'bg-emerald-100 text-emerald-700',
  done: 'bg-gray-200 text-gray-700',
  closed: 'bg-gray-100 text-gray-400',
};
const STATUS_STYLE: Record<string, string> = {
  '기회 식별': 'bg-slate-100 text-slate-700',
  '영업 중': 'bg-blue-100 text-blue-700',
  '수주 완료': 'bg-violet-100 text-violet-700',
  '프로젝트 중': 'bg-emerald-100 text-emerald-700',
  '프로젝트 완료': 'bg-gray-100 text-gray-600',
  '영업 종결': 'bg-red-100 text-red-600',
  '기타': 'bg-amber-100 text-amber-700',
  '비활성': 'bg-gray-100 text-gray-500',
};
const STATUS_ORDER = ['기회 식별', '영업 중', '수주 완료', '프로젝트 중', '프로젝트 완료', '영업 종결', '기타', '비활성'];

const isClosedStatus = (s: string) => s === '영업 종결' || s === '기타' || s === '비활성';
/** 종결·비활성 건은 과거 접촉으로 분류 */
const stageOf = (p: BusinessProjectRow): Stage => {
  if (!p.is_active || isClosedStatus(p.project_status)) return 'closed';
  if (p.project_status === '기회 식별' || p.project_status === '영업 중') return 'selling';
  if (p.project_status === '수주 완료' || p.project_status === '프로젝트 중') return 'performing';
  if (p.project_status === '프로젝트 완료') return 'done';
  return 'closed';
};
const statusOf = (p: BusinessProjectRow) => (!p.is_active && !isClosedStatus(p.project_status) ? '비활성' : p.project_status);
const statusRank = (s: string) => { const i = STATUS_ORDER.indexOf(s); return i < 0 ? 99 : i; };
const normClient = (s: string | null) => (s || '').trim() || '(고객사 미입력)';

interface ClientGroup {
  client: string;
  all: BusinessProjectRow[];
  depts: string[];
  byStage: Record<Stage, number>;
}

export default function SalesOverview() {
  const { dashUser } = useAuth();
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['business-projects'], queryFn: fetchBusinessProjects });
  const { data: departments = [] } = useDepartments();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState<Stage | ''>('selling');
  const [deptFilter, setDeptFilter] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  // 접점표 전용: 고객사명 검색 · 접점 필터(2개 이상 사업부) · 정렬
  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixFilter, setMatrixFilter] = useState<'' | 'multi' | 'single'>('');
  const [matrixSort, setMatrixSort] = useState<{ key: 'client' | string; dir: 'asc' | 'desc' } | null>(null);

  const myDept = dashUser?.department_code ?? null;

  const deptName = useMemo(() => {
    const m = new Map(departments.map(d => [d.department_code, d.department_name]));
    return (code: string) => m.get(code) || code;
  }, [departments]);
  const deptOrder = useMemo(() => new Map(departments.map((d, i) => [d.department_code, i])), [departments]);

  // 고객사 그룹 (전체 이력)
  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const p of projects) {
      const key = normClient(p.client_name);
      if (!map.has(key)) map.set(key, { client: key, all: [], depts: [], byStage: { selling: 0, performing: 0, done: 0, closed: 0 } });
      const g = map.get(key)!;
      g.all.push(p);
      g.byStage[stageOf(p)] += 1;
      if (!g.depts.includes(p.department_code)) g.depts.push(p.department_code);
    }
    for (const g of map.values()) g.depts.sort((a, b) => (deptOrder.get(a) ?? 999) - (deptOrder.get(b) ?? 999));
    return map;
  }, [projects, deptOrder]);

  // 접점표에 쓸 사업부 열: 프로젝트가 하나라도 있는 사업부
  const columns = useMemo(() => departments.filter(d => projects.some(p => p.department_code === d.department_code)), [departments, projects]);

  // 프로젝트 목록: 검색 · 영업 단계 · 사업부 필터 적용
  const listed = useMemo(() => {
    const s = search.trim().toLowerCase();
    return projects
      .filter(p => {
        if (stageFilter && stageOf(p) !== stageFilter) return false;
        if (deptFilter && p.department_code !== deptFilter) return false;
        if (s) {
          const hay = [normClient(p.client_name), p.project_name, p.project_summary, p.category, p.sales_schedule_note, p.note].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) =>
        statusRank(statusOf(a)) - statusRank(statusOf(b))
        || normClient(a.client_name).localeCompare(normClient(b.client_name), 'ko')
        || (deptOrder.get(a.department_code) ?? 999) - (deptOrder.get(b.department_code) ?? 999)
        || b.updated_at.localeCompare(a.updated_at));
  }, [projects, search, stageFilter, deptFilter, deptOrder]);

  // 접점표 행: 고객사명 검색 · 접점 있음/없음 필터 · 정렬 (프로젝트 목록 필터와는 독립)
  const rows = useMemo(() => {
    const s = matrixSearch.trim().toLowerCase();
    const list = Array.from(groups.values()).filter(g => {
      if (s && !g.client.toLowerCase().includes(s)) return false;
      if (matrixFilter === 'multi' && g.depts.length < 2) return false;
      if (matrixFilter === 'single' && g.depts.length >= 2) return false;
      return true;
    });
    const byDefault = (a: ClientGroup, b: ClientGroup) =>
      (b.byStage.selling > 0 ? 1 : 0) - (a.byStage.selling > 0 ? 1 : 0)
      || b.depts.length - a.depts.length
      || b.all.length - a.all.length
      || a.client.localeCompare(b.client, 'ko');
    if (!matrixSort) return list.sort(byDefault);
    if (matrixSort.key === 'client') {
      return list.sort((a, b) => (matrixSort.dir === 'asc' ? 1 : -1) * a.client.localeCompare(b.client, 'ko'));
    }
    // 사업부 헤더: 그 사업부의 접점(건수) 많은 순. 같으면 기본 정렬
    const countIn = (g: ClientGroup) => g.all.filter(p => p.department_code === matrixSort.key).length;
    return list.sort((a, b) => (matrixSort.dir === 'desc' ? 1 : -1) * (countIn(b) - countIn(a)) || byDefault(a, b));
  }, [groups, matrixSearch, matrixFilter, matrixSort]);

  /** 헤더 클릭: 고객사는 가나다 → 역순 → 해제, 사업부는 많은 순 → 적은 순 → 해제 */
  const toggleMatrixSort = (key: 'client' | string) => {
    setMatrixSort(prev => {
      const first: 'asc' | 'desc' = key === 'client' ? 'asc' : 'desc';
      const second: 'asc' | 'desc' = first === 'asc' ? 'desc' : 'asc';
      if (!prev || prev.key !== key) return { key, dir: first };
      if (prev.dir === first) return { key, dir: second };
      return null;
    });
  };
  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (matrixSort?.key === colKey) return matrixSort.dir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  };

  const sellingCount = useMemo(() => projects.filter(p => stageOf(p) === 'selling').length, [projects]);
  const sellingClients = useMemo(() => new Set(projects.filter(p => stageOf(p) === 'selling').map(p => normClient(p.client_name))).size, [projects]);

  const detail = selectedClient ? groups.get(selectedClient) ?? null : null;

  // 프로젝트 목록 페이징 (필터·검색이 바뀌면 1페이지로)
  const pageCount = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = listed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, stageFilter, deptFilter]);

  // Esc로 모달 닫기
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedClient(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const chip = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-foreground">영업 현황</h1>

      {/* 건수 · 검색 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="glass-card flex items-center gap-3 rounded-xl px-4 py-2.5">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Handshake className="h-4 w-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">영업 진행 중</p>
            <p className="text-lg font-bold leading-tight text-foreground">{sellingCount}건 <span className="text-xs font-normal text-muted-foreground">고객사 {sellingClients}개</span></p>
          </div>
        </div>
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="고객사명, 프로젝트, 영업 내용 검색"
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="검색 지우기">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 클릭 필터: 영업 단계 · 사업부 */}
      <div className="glass-card space-y-2 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">영업 단계</span>
          <button onClick={() => setStageFilter('')} className={chip(stageFilter === '')}>전체</button>
          {STAGE_ORDER.map(st => (
            <button key={st} onClick={() => setStageFilter(prev => prev === st ? '' : st)} className={chip(stageFilter === st)}>{STAGE_LABEL[st]}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">사업부</span>
          <button onClick={() => setDeptFilter('')} className={chip(deptFilter === '')}>전체</button>
          {columns.map(d => (
            <button key={d.department_code} onClick={() => setDeptFilter(prev => prev === d.department_code ? '' : d.department_code)} className={chip(deptFilter === d.department_code)}>
              {d.department_name}{d.department_code === myDept ? ' (내 사업부)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* 프로젝트 목록 (필터 적용) */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            프로젝트 <span className="ml-1 text-sm font-normal text-muted-foreground">{listed.length}건</span>
            {(stageFilter || deptFilter || search) && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {[stageFilter ? STAGE_LABEL[stageFilter] : null, deptFilter ? deptName(deptFilter) : null, search ? `"${search.trim()}"` : null].filter(Boolean).join(' · ')}
              </span>
            )}
          </h2>
          <span className="text-[11px] text-muted-foreground">행을 누르면 그 고객사의 접점 요약이 열립니다</span>
        </div>
        {listed.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">조건에 맞는 프로젝트가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">고객사</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">사업부</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">프로젝트 · 내용</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">상태</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">진행사항</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">기회식별일</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">기간</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const client = normClient(p.client_name);
                  const g = groups.get(client);
                  const note = (p.sales_schedule_note || '').trim();
                  return (
                    <tr key={p.id} onClick={() => setSelectedClient(client)} className="cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-primary/5">
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="font-medium text-foreground">{client}</span>
                        {g && g.depts.length >= 2 && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800" title="이 고객사를 다룬 사업부 수">{g.depts.length}개 사업부</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${p.department_code === myDept ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground'}`}>{deptName(p.department_code)}</span>
                      </td>
                      <td className="min-w-[220px] px-3 py-2">
                        <p className="text-foreground">{p.project_name}</p>
                        {p.project_summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.project_summary}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[statusOf(p)] || 'bg-muted text-foreground'}`}>{statusOf(p)}</span>
                      </td>
                      <td className="min-w-[200px] max-w-[420px] whitespace-pre-wrap px-3 py-2 text-foreground">
                        {note || (stageOf(p) === 'selling' ? <span className="text-red-600">미입력</span> : <span className="text-muted-foreground">-</span>)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.base_date || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.start_date || '-'} ~ {p.end_date || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pageCount > 1 && (
              <div className="relative mt-3 flex items-center justify-center text-xs text-muted-foreground">
                <span className="absolute left-0">{(safePage - 1) * PAGE_SIZE + 1}~{Math.min(safePage * PAGE_SIZE, listed.length)} / {listed.length}건</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                    className="rounded-md border border-border p-1 hover:bg-muted disabled:opacity-40" aria-label="이전 페이지">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === pageCount || Math.abs(n - safePage) <= 2)
                    .map((n, i, arr) => (
                      <span key={n} className="flex items-center">
                        {i > 0 && arr[i - 1] !== n - 1 && <span className="px-1">…</span>}
                        <button onClick={() => setPage(n)}
                          className={`min-w-[28px] rounded-md px-2 py-1 ${n === safePage ? 'bg-primary text-primary-foreground' : 'hover:bg-muted hover:text-foreground'}`}>
                          {n}
                        </button>
                      </span>
                    ))}
                  <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage === pageCount}
                    className="rounded-md border border-border p-1 hover:bg-muted disabled:opacity-40" aria-label="다음 페이지">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 고객사 × 사업부 접점표 (전용 검색·필터·정렬) */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">고객사 × 사업부 접점표 <span className="ml-1 text-sm font-normal text-muted-foreground">{rows.length}개 고객사</span></h2>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {STAGE_ORDER.map(st => <span key={st} className={`rounded px-1.5 py-0.5 ${STAGE_CELL[st]}`}>{STAGE_LABEL[st]}</span>)}
            <span>숫자는 건수 · 행을 누르면 접점 요약</span>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {([['', '전체'], ['multi', '접점 있음'], ['single', '접점 없음']] as ['' | 'multi' | 'single', string][]).map(([k, label]) => (
              <button key={k} onClick={() => setMatrixFilter(k)}
                title={k === 'multi' ? '2개 이상 사업부가 다룬 고객사' : k === 'single' ? '한 사업부만 다룬 고객사' : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${matrixFilter === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={matrixSearch} onChange={(e) => setMatrixSearch(e.target.value)} placeholder="고객사명 검색"
              className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
            {matrixSearch && (
              <button onClick={() => setMatrixSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="검색 지우기">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {matrixSort && (
            <button onClick={() => setMatrixSort(null)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> 정렬 해제
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">조건에 맞는 고객사가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold text-foreground">
                    <button onClick={() => toggleMatrixSort('client')} className="flex items-center gap-1 transition-colors hover:text-primary" title="가나다 순 정렬">
                      고객사 <SortIcon colKey="client" />
                    </button>
                  </th>
                  {columns.map(d => (
                    <th key={d.department_code} className={`whitespace-nowrap px-2 py-2 text-center font-semibold ${matrixSort?.key === d.department_code ? 'text-primary' : 'text-foreground'}`}>
                      <button onClick={() => toggleMatrixSort(d.department_code)} className="mx-auto flex items-center gap-1 transition-colors hover:text-primary" title={`${d.department_name} 접점 많은 순 정렬`}>
                        {d.department_name} <SortIcon colKey={d.department_code} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(g => (
                  <tr key={g.client} onClick={() => setSelectedClient(g.client)}
                    className="cursor-pointer border-b border-border/50 transition-colors hover:bg-primary/5">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2">
                      <span className="font-medium text-foreground">{g.client}</span>
                      {g.depts.length >= 2 && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{g.depts.length}개 사업부</span>}
                    </td>
                    {columns.map(d => {
                      const cells = STAGE_ORDER
                        .map(st => [st, g.all.filter(p => p.department_code === d.department_code && stageOf(p) === st).length] as [Stage, number])
                        .filter(([, n]) => n > 0);
                      if (cells.length === 0) return <td key={d.department_code} className="px-2 py-2 text-center text-muted-foreground/30">·</td>;
                      return (
                        <td key={d.department_code} className="px-2 py-2 text-center">
                          <span className="inline-flex gap-0.5">
                            {cells.map(([st, n]) => (
                              <span key={st} className={`min-w-[20px] rounded px-1 py-0.5 text-[10px] font-medium ${STAGE_CELL[st]}`} title={STAGE_LABEL[st]}>{n}</span>
                            ))}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 접점 요약 모달: X · 바깥 클릭 · Esc로 닫힘 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedClient(null)}>
          <div role="dialog" aria-modal="true" aria-label={`${detail.client} 접점 요약`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs text-muted-foreground">고객사 접점</p>
                <h2 className="text-lg font-bold text-foreground">{detail.client}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.depts.map(code => {
                    const parts = STAGE_ORDER
                      .map(st => [st, detail.all.filter(p => p.department_code === code && stageOf(p) === st).length] as [Stage, number])
                      .filter(([, n]) => n > 0);
                    return (
                      <span key={code} className={`rounded-md border px-2 py-1 text-xs ${code === myDept ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                        <span className="font-medium text-foreground">{deptName(code)}</span>
                        <span className="ml-1.5 text-muted-foreground">{parts.map(([st, n]) => `${STAGE_LABEL[st]} ${n}`).join(' · ')}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => setSelectedClient(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-110px)] overflow-y-auto px-5 py-4 scrollbar-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-foreground">사업부</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-foreground">프로젝트 · 내용</th>
                    <th className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-foreground">상태</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-foreground">진행사항</th>
                    <th className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-foreground">기간</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.all]
                    .sort((a, b) => statusRank(statusOf(a)) - statusRank(statusOf(b)) || (deptOrder.get(a.department_code) ?? 999) - (deptOrder.get(b.department_code) ?? 999) || b.updated_at.localeCompare(a.updated_at))
                    .map(p => {
                      const note = (p.sales_schedule_note || '').trim();
                      return (
                        <tr key={p.id} className="border-b border-border/50 align-top">
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${p.department_code === myDept ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground'}`}>{deptName(p.department_code)}</span>
                          </td>
                          <td className="min-w-[200px] px-3 py-2">
                            <p className="text-foreground">{p.project_name}</p>
                            {p.project_summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.project_summary}</p>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[statusOf(p)] || 'bg-muted text-foreground'}`}>{statusOf(p)}</span>
                          </td>
                          <td className="min-w-[160px] max-w-[320px] whitespace-pre-wrap px-3 py-2 text-foreground">
                            {note || (stageOf(p) === 'selling' ? <span className="text-red-600">미입력</span> : <span className="text-muted-foreground">-</span>)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.start_date || '-'} ~ {p.end_date || '-'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-muted-foreground">담당자·필요한 도움·도움 제안은 다음 단계에서 추가됩니다. 지금은 해당 사업부에 직접 연락해 주세요.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
