'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Link,
  Loader2,
  Plus,
  Shield,
  UserCog,
  UserPlus,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

type Role = {
  id: string;
  name: string;
  permissions: string[];
};

type Employee = {
  userId: string;
  roleId: string;
  user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: string;
  };
  role: {
    id: string;
    name: string;
  };
};

type Invitation = {
  id: string;
  email: string;
  name?: string | null;
  expiresAt: string;
  acceptedAt?: string | null;
  role: {
    id: string;
    name: string;
  };
};

type PermissionPayload = {
  permissions: string[];
};

function hasPermission(permissions: string[], required: string) {
  if (permissions.includes('ALL') || permissions.includes(required)) return true;
  const parts = required.split(':');
  const resource = parts[0];
  const action = parts[parts.length - 1];
  return permissions.includes(`${resource}:*`) || permissions.includes(`*:${action}`);
}

function makePassword() {
  return `OneERP-${Math.random().toString(36).slice(2, 8)}-${Date.now()
    .toString(36)
    .slice(-4)}`;
}

export function EmployeeManagement() {
  const { currentCompanyId } = useAuthStore();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: makePassword(),
    roleId: '',
    isActive: true,
  });
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    roleId: '',
    expiresInHours: 72,
  });

  const roleOptions = useMemo(
    () => roles.filter((role) => role.name !== 'SuperAdmin'),
    [roles],
  );

  const canCreate = hasPermission(permissions, 'user:create');
  const canInvite = hasPermission(permissions, 'user:invite');
  const canUpdate = hasPermission(permissions, 'user:update');
  const canReset = hasPermission(permissions, 'user:reset-password');

  const load = async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const permissionResp = await api.get('/users/permissions/me');
      const loadedPermissions =
        (permissionResp.data as PermissionPayload).permissions ?? [];
      const canReadRoles = hasPermission(loadedPermissions, 'role:read');
      const canReadInvitations = hasPermission(loadedPermissions, 'user:invite');
      const [employeeResp, roleResp, invitationResp] = await Promise.all([
        api.get('/users'),
        canReadRoles ? api.get('/users/roles') : Promise.resolve({ data: [] }),
        canReadInvitations
          ? api.get('/users/invitations')
          : Promise.resolve({ data: [] }),
      ]);
      const loadedRoles = (roleResp.data as Role[]) ?? [];
      setEmployees((employeeResp.data as Employee[]) ?? []);
      setRoles(loadedRoles);
      setInvitations((invitationResp.data as Invitation[]) ?? []);
      setPermissions(loadedPermissions);
      const fallbackRole = loadedRoles.find((role) => role.name === 'Readonly') ?? loadedRoles[0];
      setForm((prev) => ({ ...prev, roleId: prev.roleId || fallbackRole?.id || '' }));
      setInviteForm((prev) => ({
        ...prev,
        roleId: prev.roleId || fallbackRole?.id || '',
      }));
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '员工账号数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [currentCompanyId]);

  const createEmployee = async () => {
    setError('');
    setMessage('');
    try {
      await api.post('/users', form);
      setMessage('员工账号已创建');
      setForm((prev) => ({
        ...prev,
        name: '',
        email: '',
        password: makePassword(),
      }));
      await load();
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '员工账号创建失败');
    }
  };

  const createInvitation = async () => {
    setError('');
    setMessage('');
    setInviteUrl('');
    try {
      const response = await api.post('/users/invitations', inviteForm);
      const path = String(response.data?.invitePath ?? '');
      const url = `${window.location.origin}${path}`;
      setInviteUrl(url);
      setMessage('邀请链接已生成');
      setInviteForm((prev) => ({ ...prev, name: '', email: '' }));
      await load();
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '邀请链接生成失败');
    }
  };

  const updateRole = async (userId: string, roleId: string) => {
    setError('');
    try {
      await api.put(`/users/${userId}/role`, { roleId });
      await load();
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '角色更新失败');
    }
  };

  const toggleActive = async (userId: string) => {
    setError('');
    try {
      await api.put(`/users/${userId}/toggle-active`);
      await load();
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '启用状态更新失败');
    }
  };

  const resetPassword = async (userId: string) => {
    const password = makePassword();
    setError('');
    try {
      await api.post(`/users/${userId}/reset-password`, { password });
      setMessage(`临时密码已重置：${password}`);
    } catch (reason: any) {
      setError(reason?.response?.data?.message || '密码重置失败');
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setMessage('邀请链接已复制');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">员工账号与权限</h3>
          <p className="text-sm text-slate-500">创建员工、分配角色、生成邀请链接并控制账号状态。</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
          刷新
        </button>
      </div>

      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <UserPlus className="h-4 w-4" />
            创建员工账号
          </div>
          <div className="grid gap-3">
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="员工姓名"
            />
            <input
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="登录邮箱"
            />
            <input
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="临时密码"
            />
            <select
              value={form.roleId}
              onChange={(event) => setForm((prev) => ({ ...prev, roleId: event.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                }
              />
              创建后立即启用
            </label>
            <button
              type="button"
              disabled={!canCreate || !form.name || !form.email || !form.password || !form.roleId}
              onClick={() => void createEmployee()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              创建员工
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Link className="h-4 w-4" />
            生成邀请链接
          </div>
          <div className="grid gap-3">
            <input
              value={inviteForm.name}
              onChange={(event) =>
                setInviteForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="员工姓名，可选"
            />
            <input
              value={inviteForm.email}
              onChange={(event) =>
                setInviteForm((prev) => ({ ...prev, email: event.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="员工邮箱"
            />
            <select
              value={inviteForm.roleId}
              onChange={(event) =>
                setInviteForm((prev) => ({ ...prev, roleId: event.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={720}
              value={inviteForm.expiresInHours}
              onChange={(event) =>
                setInviteForm((prev) => ({
                  ...prev,
                  expiresInHours: Number(event.target.value),
                }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="有效期小时数"
            />
            <button
              type="button"
              disabled={!canInvite || !inviteForm.email || !inviteForm.roleId}
              onClick={() => void createInvitation()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Link className="h-4 w-4" />
              生成邀请
            </button>
            {inviteUrl && (
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800"
              >
                <Copy className="h-3.5 w-3.5" />
                {inviteUrl}
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
          当前员工
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">员工</th>
                <th className="px-4 py-2 font-medium">角色</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.userId} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{employee.user.name}</div>
                    <div className="text-xs text-slate-500">{employee.user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={employee.roleId}
                      disabled={!canUpdate}
                      onChange={(event) => void updateRole(employee.userId, event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                        employee.user.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {employee.user.isActive ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canUpdate}
                        onClick={() => void toggleActive(employee.userId)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      >
                        {employee.user.isActive ? '禁用' : '启用'}
                      </button>
                      <button
                        type="button"
                        disabled={!canReset}
                        onClick={() => void resetPassword(employee.userId)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                      >
                        <KeyRound className="h-3 w-3" />
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
          邀请记录
        </div>
        <div className="divide-y divide-slate-100">
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-slate-900">{invitation.email}</div>
                <div className="text-xs text-slate-500">
                  {invitation.role.name} · 过期 {new Date(invitation.expiresAt).toLocaleString()}
                </div>
              </div>
              <div className="inline-flex items-center gap-1 text-xs text-slate-600">
                <Shield className="h-3.5 w-3.5" />
                {invitation.acceptedAt ? '已接受' : '待接受'}
              </div>
            </div>
          ))}
          {!invitations.length && (
            <div className="px-4 py-6 text-sm text-slate-500">暂无邀请记录。</div>
          )}
        </div>
      </section>
    </div>
  );
}
