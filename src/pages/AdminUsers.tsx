import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { UserPlus, RotateCcw, Save, Undo2, Loader2 } from 'lucide-react';
import type { DashUser, RoleCode } from '@/contexts/AuthContext';

type UserRow = DashUser & { departments: { department_name: string } | null };

async function fetchAllUsers() {
  const { data, error } = await supabase
    .from('dash_users')
    .select('*, departments(department_name)')
    .order('user_name');
  if (error) throw error;
  return data as UserRow[];
}

async function callAdminAction(action: string, params: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, ...params },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

interface EditableUser {
  auth_user_id: string;
  role_code: RoleCode;
  department_code: string | null;
  is_active: boolean;
  /** 열람 허용된 제한 부서 코드 */
  restricted_dept_codes: string[];
  /** 접근 허용된 화면 기능 */
  feature_access: string[];
}

/** 화면 기능 권한 목록 (feature_access 값과 표시명). 영업 현황은 전원 공개로 바뀌어 현재 항목 없음 */
const FEATURES: { key: string; label: string }[] = [];

const sameSet = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');
const toggleIn = (list: string[], value: string, on: boolean) =>
  on ? Array.from(new Set([...list, value])) : list.filter(v => v !== value);

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const { dashUser: currentUser } = useAuth();
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers });
  const { data: departments = [] } = useDepartments();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetPwLoading, setResetPwLoading] = useState<string | null>(null);

  // Create form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newRole, setNewRole] = useState<RoleCode>('VIEWER');

  // Editable state: map of auth_user_id -> editable fields
  const [editMap, setEditMap] = useState<Record<string, EditableUser>>({});

  // Build original map from server data
  const originalMap = useMemo(() => {
    const m: Record<string, EditableUser> = {};
    for (const u of users) {
      m[u.auth_user_id] = {
        auth_user_id: u.auth_user_id,
        role_code: u.role_code as RoleCode,
        department_code: u.department_code,
        is_active: u.is_active,
        restricted_dept_codes: u.restricted_dept_codes ?? [],
        feature_access: u.feature_access ?? [],
      };
    }
    return m;
  }, [users]);

  // 제한 부서 목록 (ADMIN은 모든 부서를 볼 수 있으므로 여기서 바로 조회됨)
  const restrictedDepts = useMemo(() => departments.filter(d => d.is_restricted), [departments]);

  // Sync editMap when server data changes
  useEffect(() => {
    setEditMap({ ...originalMap });
  }, [originalMap]);

  // Dirty tracking
  const dirtyUsers = useMemo(() => {
    const dirty: string[] = [];
    for (const uid of Object.keys(editMap)) {
      const orig = originalMap[uid];
      const edit = editMap[uid];
      if (!orig || !edit) continue;
      if (
        orig.role_code !== edit.role_code ||
        orig.department_code !== edit.department_code ||
        orig.is_active !== edit.is_active ||
        !sameSet(orig.restricted_dept_codes, edit.restricted_dept_codes) ||
        !sameSet(orig.feature_access, edit.feature_access)
      ) {
        dirty.push(uid);
      }
    }
    return dirty;
  }, [editMap, originalMap]);

  const hasDirty = dirtyUsers.length > 0;

  const updateField = useCallback((uid: string, field: keyof EditableUser, value: any) => {
    setEditMap(prev => ({
      ...prev,
      [uid]: { ...prev[uid], [field]: value },
    }));
  }, []);

  const resetEdits = useCallback(() => {
    setEditMap({ ...originalMap });
  }, [originalMap]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  // Check which fields changed for a user
  const getChangedFields = (uid: string) => {
    const orig = originalMap[uid];
    const edit = editMap[uid];
    if (!orig || !edit) return { role: false, dept: false, active: false, perms: false };
    return {
      role: orig.role_code !== edit.role_code,
      dept: orig.department_code !== edit.department_code,
      active: orig.is_active !== edit.is_active,
      perms: !sameSet(orig.restricted_dept_codes, edit.restricted_dept_codes) || !sameSet(orig.feature_access, edit.feature_access),
    };
  };

  const handleSaveAll = async () => {
    if (!hasDirty) return;
    setSaving(true);
    const errors: string[] = [];
    try {
      for (const uid of dirtyUsers) {
        const changed = getChangedFields(uid);
        const edit = editMap[uid];
        if (changed.role) {
          try {
            await callAdminAction('change-role', { auth_user_id: uid, role_code: edit.role_code });
          } catch (e: any) { errors.push(`권한 변경(${uid}): ${e.message}`); }
        }
        if (changed.dept) {
          try {
            await callAdminAction('change-department', { auth_user_id: uid, department_code: edit.department_code });
          } catch (e: any) { errors.push(`부서 변경(${uid}): ${e.message}`); }
        }
        if (changed.active) {
          try {
            await callAdminAction('toggle-active', { auth_user_id: uid, is_active: edit.is_active });
          } catch (e: any) { errors.push(`상태 변경(${uid}): ${e.message}`); }
        }
        if (changed.perms) {
          // ADMIN은 RLS 정책(dash_users_update_admin)으로 직접 갱신 가능
          const { error } = await supabase
            .from('dash_users')
            .update({ restricted_dept_codes: edit.restricted_dept_codes, feature_access: edit.feature_access })
            .eq('auth_user_id', uid);
          if (error) errors.push(`권한 항목 변경(${uid}): ${error.message}`);
        }
      }
      if (errors.length > 0) {
        toast.error(`일부 저장 실패:\n${errors.join('\n')}`);
      } else {
        toast.success(`${dirtyUsers.length}건 저장 완료`);
      }
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim()) { toast.error('이메일과 이름을 입력해주세요.'); return; }
    setCreating(true);
    try {
      const res = await callAdminAction('create-user', {
        user_email: newEmail.trim(),
        user_name: newName.trim(),
        department_code: newDept || null,
        role_code: newRole,
      });
      toast.success(`사용자 생성 완료. 초기 비밀번호: ${res.defaultPassword}`);
      setNewEmail(''); setNewName(''); setNewDept(''); setNewRole('VIEWER'); setShowCreate(false);
      refresh();
    } catch (err: any) {
      toast.error(`생성 실패: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (auth_user_id: string) => {
    setResetPwLoading(auth_user_id);
    try {
      const res = await callAdminAction('reset-password', { auth_user_id });
      const msg = res?.defaultPassword ? `비밀번호 초기화 완료 (비밀번호: ${res.defaultPassword})` : '비밀번호 초기화 완료';
      toast.success(msg);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResetPwLoading(null);
    }
  };

  const isSelf = (uid: string) => currentUser?.auth_user_id === uid;

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">사용자 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">계정 생성, 권한 변경, 비밀번호 초기화</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
          <UserPlus className="h-4 w-4" /> 사용자 생성
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="glass-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">새 사용자 생성</h3>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground">이메일 *</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="user@company.com"
                className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">이름 *</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="홍길동"
                className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">권한</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as RoleCode)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
                <option value="VIEWER">VIEWER</option>
                <option value="MANAGER">MANAGER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">부서</label>
              <select value={newDept} onChange={(e) => setNewDept(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
                <option value="">-</option>
                {departments.map(d => <option key={d.department_code} value={d.department_code}>{d.department_name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : '생성'}
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">초기 비밀번호: 이메일 @앞부분 + "1234!" / 초기 권한: VIEWER / 첫 로그인 시 비밀번호 변경 필수</p>
        </div>
      )}

      {/* Save/Reset toolbar */}
      <div className="glass-card rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {hasDirty && (
            <span className="inline-flex items-center rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              수정 {dirtyUsers.length}건
            </span>
          )}
          {!hasDirty && (
            <span className="text-xs text-muted-foreground">변경사항 없음</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={resetEdits} disabled={!hasDirty}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Undo2 className="h-4 w-4" /> 되돌리기
          </button>
          <button onClick={handleSaveAll} disabled={!hasDirty || saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 저장
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">이메일</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">이름</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">권한</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">부서</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">상태</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground" title="제한 부서(자회사 등) 데이터 열람·입력 허용">제한 부서 열람</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground" title="특정 화면 접근 허용">화면 권한</th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted-foreground">관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const edit = editMap[u.auth_user_id];
                if (!edit) return null;
                const changed = getChangedFields(u.auth_user_id);
                const isDirty = changed.role || changed.dept || changed.active || changed.perms;
                const self = isSelf(u.auth_user_id);
                const isAdminRole = edit.role_code === 'ADMIN';

                return (
                  <tr key={u.auth_user_id}
                    className={`border-b border-border/30 transition-colors ${!edit.is_active ? 'opacity-50' : ''} ${isDirty ? 'bg-accent/20' : ''}`}
                    title={self ? '현재 접속 중인 본인 계정은 권한/상태를 변경할 수 없습니다.' : undefined}>
                    <td className="px-4 py-3 text-foreground">{u.user_email}</td>
                    <td className="px-4 py-3 text-foreground">
                      {u.user_name}
                      {self && <span className="ml-1.5 text-xs text-muted-foreground">(본인)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select value={edit.role_code}
                        onChange={(e) => updateField(u.auth_user_id, 'role_code', e.target.value)}
                        disabled={self}
                        className={`rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${changed.role ? 'ring-2 ring-primary/50' : ''}`}>
                        <option value="ADMIN">ADMIN</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select value={edit.department_code || ''}
                        onChange={(e) => updateField(u.auth_user_id, 'department_code', e.target.value || null)}
                        className={`rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none ${changed.dept ? 'ring-2 ring-primary/50' : ''}`}>
                        <option value="">-</option>
                        {departments.map(d => <option key={d.department_code} value={d.department_code}>{d.department_name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => !self && updateField(u.auth_user_id, 'is_active', !edit.is_active)}
                        disabled={self}
                        className={`rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${edit.is_active ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'} ${changed.active ? 'ring-2 ring-primary/50' : ''}`}>
                        {edit.is_active ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className={`px-4 py-3 ${changed.perms ? 'bg-primary/5' : ''}`}>
                      {isAdminRole ? (
                        <span className="text-xs text-muted-foreground">전체 (ADMIN)</span>
                      ) : restrictedDepts.length === 0 ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          {restrictedDepts.map(d => (
                            <label key={d.department_code} className="flex cursor-pointer items-center gap-1 text-xs text-foreground">
                              <input type="checkbox"
                                checked={edit.restricted_dept_codes.includes(d.department_code)}
                                onChange={(e) => updateField(u.auth_user_id, 'restricted_dept_codes', toggleIn(edit.restricted_dept_codes, d.department_code, e.target.checked))}
                                className="h-3.5 w-3.5 rounded border-border accent-primary" />
                              {d.department_name}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`px-4 py-3 ${changed.perms ? 'bg-primary/5' : ''}`}>
                      {isAdminRole ? (
                        <span className="text-xs text-muted-foreground">전체 (ADMIN)</span>
                      ) : FEATURES.length === 0 ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          {FEATURES.map(f => (
                            <label key={f.key} className="flex cursor-pointer items-center gap-1 text-xs text-foreground">
                              <input type="checkbox"
                                checked={edit.feature_access.includes(f.key)}
                                onChange={(e) => updateField(u.auth_user_id, 'feature_access', toggleIn(edit.feature_access, f.key, e.target.checked))}
                                className="h-3.5 w-3.5 rounded border-border accent-primary" />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleResetPassword(u.auth_user_id)}
                        disabled={resetPwLoading === u.auth_user_id}
                        className="flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        {resetPwLoading === u.auth_user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} 비밀번호 초기화
                      </button>
                    </td>
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
