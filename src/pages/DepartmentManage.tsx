import { useState, useMemo, useCallback, useRef } from 'react';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuth } from '@/contexts/AuthContext';
import { useGridEditor, GridRow } from '@/hooks/useGridEditor';
import { Department } from '@/services/departmentService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, RotateCcw, Loader2, Search, RotateCw } from 'lucide-react';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { useColumnDragDrop } from '@/hooks/useColumnDragDrop';
import DraggableResizableHeader from '@/components/DraggableResizableHeader';

type SortDir = 'asc' | 'desc' | null;

interface ColDef {
  key: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export default function DepartmentManage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('ADMIN');
  const { data: departments = [], isLoading, refetch } = useDepartments();

  const { rows, addRow, updateCell, markDeleted, reset, forceSync, dirtyStats, hasDirty, getChanges } = useGridEditor<Department>(
    departments,
    {
      idField: 'department_code',
      newRowTemplate: () => ({
        department_code: '',
        department_name: '',
        sector_code: '',
        sector_name: '',
        is_active: true,
        sort_order: 100,
        predecessor_code: null,
        established_month: null,
        is_restricted: false,
      }),
    },
  );

  useUnsavedChangesGuard(hasDirty);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const columns: ColDef[] = [
    { key: 'sort_order', label: '정렬순서', type: 'text' },
    { key: 'sector_code', label: '부문코드', type: 'text' },
    { key: 'sector_name', label: '부문명', type: 'text' },
    { key: 'department_code', label: '부서코드', type: 'text' },
    { key: 'department_name', label: '부서명', type: 'text' },
    { key: 'predecessor_code', label: '모부서(분리 전)', type: 'select' },
    { key: 'established_month', label: '신설·분리월(YYYY-MM)', type: 'text' },
    { key: 'is_restricted', label: '제한 부서(권한자만 열람)', type: 'boolean' },
  ];

  const getDisplayValue = useCallback((row: GridRow<Department>, col: ColDef): string => {
    const val = (row.data as any)[col.key];
    if (col.type === 'boolean') return val ? 'Y' : '';
    return val == null ? '' : String(val);
  }, []);

  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(r => columns.some(col => getDisplayValue(r, col).toLowerCase().includes(s)));
    }
    if (sortKey && sortDir) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = getDisplayValue(a, columns.find(c => c.key === sortKey)!);
        const bVal = getDisplayValue(b, columns.find(c => c.key === sortKey)!);
        const cmp = aVal.localeCompare(bVal, 'ko', { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return filtered;
  }, [rows, search, sortKey, sortDir, getDisplayValue]);

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(null); setSortDir(null); }
  };

  // ── Column drag & drop ──
  const { orderedColumns, dragState, onDragStart, onDragOver, onDragEnd, resetOrder } = useColumnDragDrop(columns);

  // ── Column & row resizing ──
  const { columnSizing, getRowHeight, onColResizeStart, onRowResizeStart, resetSizing } = useResizableColumns();

  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const displayColumns = useMemo(() => orderedColumns(columns), [orderedColumns, columns]);

  const handleRowResizeMouseDown = (e: React.MouseEvent, tempId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const trEl = rowRefs.current.get(tempId);
    const currentHeight = trEl?.getBoundingClientRect().height || 32;
    onRowResizeStart(tempId, e.clientY, currentHeight);
  };

  const handleSave = async () => {
    const { inserts, updates, deletes } = getChanges();
    for (const r of [...inserts, ...updates]) {
      if (!r.department_code?.trim() || !r.department_name?.trim()) {
        toast.error('부서코드와 부서명은 필수입니다.');
        return;
      }
      if (r.established_month && !MONTH_KEY_RE.test(r.established_month)) {
        toast.error(`신설·분리월은 YYYY-MM 형식이어야 합니다. (${r.department_code})`);
        return;
      }
      if (r.predecessor_code && r.predecessor_code === r.department_code) {
        toast.error(`모부서는 자기 자신일 수 없습니다. (${r.department_code})`);
        return;
      }
    }

    // 승계·제한 컬럼 공통 payload
    const lineagePayload = (r: Department) => ({
      predecessor_code: r.predecessor_code || null,
      established_month: r.established_month || null,
      is_restricted: !!r.is_restricted,
    });

    setSaving(true);
    try {
      if (inserts.length > 0) {
        const insertData = inserts.map(r => ({
          department_code: r.department_code,
          department_name: r.department_name,
          sector_code: r.sector_code || null,
          sector_name: r.sector_name || null,
          is_active: true,
          sort_order: r.sort_order ?? 100,
          ...lineagePayload(r),
        }));
        const { error } = await supabase.from('departments').insert(insertData);
        if (error) throw error;
      }
      for (const r of updates) {
        // tempId holds the original department_code
        const originalCode = rows.find(row => row.data === r)?.tempId;
        const updatePayload: any = {
          department_name: r.department_name,
          sector_code: r.sector_code || null,
          sector_name: r.sector_name || null,
          sort_order: r.sort_order ?? 100,
          ...lineagePayload(r),
        };
        // If department_code changed, update it too (CASCADE will propagate)
        if (originalCode && originalCode !== r.department_code) {
          updatePayload.department_code = r.department_code;
        }
        const { error } = await supabase.from('departments')
          .update(updatePayload)
          .eq('department_code', originalCode || r.department_code);
        if (error) throw error;
      }
      if (deletes.length > 0) {
        for (const r of deletes) {
          const originalCode = rows.find(row => row.data === r)?.tempId;
          const { error } = await supabase.from('departments').delete().eq('department_code', originalCode || r.department_code);
          if (error) throw error;
        }
      }
      toast.success(`저장 완료 (추가 ${inserts.length} / 수정 ${updates.length} / 삭제 ${deletes.length})`);
      setSelectedIds(new Set());
      await refetch();
      forceSync();
    } catch (err: any) {
      toast.error(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) { toast.warning('삭제할 행을 선택해주세요.'); return; }
    markDeleted(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const toggleSelect = (tempId: string) => {
    setSelectedIds(prev => { const s = new Set(prev); s.has(tempId) ? s.delete(tempId) : s.add(tempId); return s; });
  };
  const toggleSelectAll = () => {
    selectedIds.size === visibleRows.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleRows.map(r => r.tempId)));
  };

  const renderCell = (row: GridRow<Department>, col: ColDef) => {
    const val = (row.data as any)[col.key];
    const disabled = !canEdit || row.status === 'deleted';

    if (!canEdit) {
      return <span className="text-xs text-foreground">{getDisplayValue(row, col) || '-'}</span>;
    }

    if (col.type === 'boolean') {
      return (
        <input type="checkbox" checked={!!val} disabled={disabled}
          onChange={(e) => updateCell(row.tempId, col.key as any, e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-primary disabled:opacity-40" />
      );
    }

    if (col.type === 'select') {
      return (
        <select value={val ?? ''} disabled={disabled}
          onChange={(e) => updateCell(row.tempId, col.key as any, e.target.value || null)}
          className="w-full min-w-[110px] bg-transparent px-1 py-0.5 text-xs text-foreground disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-primary rounded">
          <option value="">-</option>
          {departments
            .filter(d => d.department_code !== row.data.department_code)
            .map(d => <option key={d.department_code} value={d.department_code}>{d.department_name}</option>)}
        </select>
      );
    }

    return (
      <input type="text" value={val ?? ''} disabled={disabled}
        onChange={(e) => updateCell(row.tempId, col.key as any, e.target.value)}
        className="w-full min-w-[80px] bg-transparent px-1 py-0.5 text-xs text-foreground disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-primary rounded" />
    );
  };

  const rowBg = (status: string) => {
    if (status === 'new') return 'bg-emerald-50';
    if (status === 'updated') return 'bg-amber-50';
    if (status === 'deleted') return 'bg-red-50 opacity-60 line-through';
    return '';
  };

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">부서 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">부문/부서 코드 및 명칭 관리</p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addRow} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            <Plus className="h-3.5 w-3.5" /> 행 추가
          </button>
          <button onClick={handleDelete} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> 삭제
          </button>
          <button onClick={handleSave} disabled={!hasDirty || saving} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
          </button>
          <button onClick={() => { reset(); setSelectedIds(new Set()); }} disabled={!hasDirty} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
            <RotateCcw className="h-3.5 w-3.5" /> 새로고침
          </button>
          {hasDirty && (
            <div className="flex gap-2 text-xs">
              {dirtyStats.added > 0 && <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">추가 {dirtyStats.added}</span>}
              {dirtyStats.updated > 0 && <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">수정 {dirtyStats.updated}</span>}
              {dirtyStats.deleted > 0 && <span className="rounded bg-red-100 px-2 py-1 text-red-700">삭제 {dirtyStats.deleted}</span>}
            </div>
          )}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색..."
          className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors" />
      </div>

      <div className="flex items-center gap-2">
        <div className="text-xs text-muted-foreground">전체 {departments.length}건 / 표시 {visibleRows.length}건</div>
        <button
          onClick={() => { resetOrder(); resetSizing(); }}
          className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          title="컬럼 순서 및 크기 초기화"
        >
          <RotateCw className="h-3 w-3" /> 레이아웃 초기화
        </button>
      </div>

      <div className="glass-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto scrollbar-thin" style={{ maxHeight: '70vh' }}>
          <table className="w-max text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted">
                {canEdit && (
                  <th className="w-8 border-r border-border/50 px-2 py-2.5">
                    <input type="checkbox" checked={visibleRows.length > 0 && selectedIds.size === visibleRows.length} onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-border accent-primary" />
                  </th>
                )}
                {displayColumns.map(col => (
                  <DraggableResizableHeader
                    key={col.key}
                    colKey={col.key}
                    label={col.label}
                    width={columnSizing[col.key]}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    onResizeStart={onColResizeStart}
                    isDragging={dragState.draggingKey === col.key}
                    isDragOver={dragState.overKey === col.key}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td colSpan={displayColumns.length + (canEdit ? 1 : 0)} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : visibleRows.map((row) => {
                const customHeight = getRowHeight(row.tempId);
                return (
                  <tr
                    key={row.tempId}
                    ref={(el) => { if (el) rowRefs.current.set(row.tempId, el); else rowRefs.current.delete(row.tempId); }}
                    style={customHeight ? { height: `${customHeight}px` } : undefined}
                    className={`relative border-b border-border/50 transition-colors hover:bg-muted/30 ${rowBg(row.status)}`}
                  >
                    {canEdit && (
                      <td className="w-8 border-r border-border/50 px-2 py-1.5">
                        <input type="checkbox" checked={selectedIds.has(row.tempId)} onChange={() => toggleSelect(row.tempId)}
                          className="h-3.5 w-3.5 rounded border-border accent-primary" />
                      </td>
                    )}
                    {displayColumns.map((col, colIdx) => (
                      <td
                        key={col.key}
                        style={columnSizing[col.key] ? { width: `${columnSizing[col.key]}px`, minWidth: `${columnSizing[col.key]}px`, maxWidth: `${columnSizing[col.key]}px` } : undefined}
                        className="border-r border-border/50 last:border-r-0 px-3 py-1.5 overflow-hidden"
                      >
                        {renderCell(row, col)}
                        {colIdx === displayColumns.length - 1 && (
                          <div
                            onMouseDown={(e) => handleRowResizeMouseDown(e, row.tempId)}
                            className="absolute bottom-0 left-0 h-1 w-full cursor-row-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors z-[1]"
                            style={{ touchAction: 'none' }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
