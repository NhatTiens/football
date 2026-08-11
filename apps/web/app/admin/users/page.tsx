'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createAdminUser,
  deleteAdminUser,
  grantAdminPro,
  listAdminUsers,
  revokeAdminPro,
  revokeAdminSessions,
  setAdminUserStatus,
  type AdminUserSummary,
  type AdminUserStatus,
} from '../../../lib/admin';
import {
  adminUserStatusLabel,
  formatAdminDate,
} from '../../../lib/admin-format';

// ADMIN_UI_REAL_V1
// ADMIN_USER_MANAGEMENT_V1
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [days, setDays] = useState(30);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q = appliedQuery) => {
    setError(null);
    try {
      const payload = await listAdminUsers(q, 100);
      setUsers(
        payload.users.filter(
          (user) => !user.email.toLowerCase().endsWith('@deleted.invalid'),
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được users.');
    }
  }, [appliedQuery]);

  useEffect(() => {
    void load('');
  }, [load]);

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.status === 'ACTIVE').length,
      pro: users.filter((user) => user.plan === 'PRO').length,
      admin: users.filter((user) => user.role === 'ADMIN').length,
    }),
    [users],
  );

  async function runFor(
    userId: number,
    action: () => Promise<unknown>,
    success?: string,
  ): Promise<void> {
    setBusyUserId(userId);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Admin action failed.');
    } finally {
      setBusyUserId(null);
    }
  }

  function nextStatus(user: AdminUserSummary): AdminUserStatus {
    if (user.status !== 'DISABLED') return 'DISABLED';
    return user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (createPassword.length < 12) {
      setError('Mật khẩu tạm phải có ít nhất 12 ký tự.');
      return;
    }

    setCreating(true);
    try {
      const result = await createAdminUser({
        name: createName,
        email: createEmail,
        temporaryPassword: createPassword,
      });
      setCreateName('');
      setCreateEmail('');
      setCreatePassword('');
      setNotice(
        `Đã tạo ${result.user.email}. User phải đổi mật khẩu sau lần đăng nhập đầu tiên.`,
      );
      await load('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tạo được user.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">USERS</span>
          <h1>Quản lý người dùng</h1>
          <p>
            Thêm, khóa/mở, xóa an toàn, revoke sessions và nâng/hạ gói PRO.
            ADMIN role không đồng nghĩa với PRO plan.
          </p>
        </div>
      </header>

      <div className="admin-mini-kpis">
        <span>Tổng <strong>{counts.total}</strong></span>
        <span>Active <strong>{counts.active}</strong></span>
        <span>PRO <strong>{counts.pro}</strong></span>
        <span>ADMIN <strong>{counts.admin}</strong></span>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <span className="eyebrow">CREATE USER</span>
            <h2>Thêm người dùng</h2>
          </div>
          <span className="admin-muted">Tạo USER / FREE / ACTIVE</span>
        </div>

        <form className="admin-create-user-grid" onSubmit={submitCreate}>
          <label>
            <span>Tên</span>
            <input
              required
              minLength={2}
              maxLength={80}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Tên người dùng"
            />
          </label>

          <label>
            <span>Email</span>
            <input
              required
              type="email"
              maxLength={255}
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
              placeholder="user@example.com"
            />
          </label>

          <label>
            <span>Mật khẩu tạm</span>
            <input
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              placeholder="Tối thiểu 12 ký tự"
            />
          </label>

          <button className="button primary" type="submit" disabled={creating}>
            {creating ? 'Đang tạo...' : 'Thêm user'}
          </button>
        </form>

        <p className="admin-form-note">
          Mật khẩu tạm không được lưu ở giao diện. User sẽ bị yêu cầu đổi mật khẩu
          sau lần đăng nhập đầu tiên.
        </p>
      </section>

      <section className="admin-panel">
        <div className="admin-toolbar">
          <form
            className="admin-search"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedQuery(query.trim());
              void load(query.trim());
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm email hoặc tên..."
            />
            <button className="button secondary" type="submit">
              Tìm
            </button>
            {appliedQuery ? (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setQuery('');
                  setAppliedQuery('');
                  void load('');
                }}
              >
                Xóa lọc
              </button>
            ) : null}
          </form>

          <label className="admin-days-control">
            <span>Số ngày nâng PRO</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) =>
                setDays(
                  Math.min(
                    3650,
                    Math.max(1, Number(event.target.value) || 30),
                  ),
                )
              }
            />
          </label>
        </div>

        {notice ? <div className="admin-success-banner">{notice}</div> : null}
        {error ? <div className="admin-error-banner">{error}</div> : null}

        <div className="table-scroll">
          <table className="admin-table admin-users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role / Plan</th>
                <th>Status</th>
                <th>PRO expiry</th>
                <th>Sessions</th>
                <th>Tạo lúc</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const busy = busyUserId === user.id;
                const isAdmin = user.role === 'ADMIN';

                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                        <small>#{user.id}</small>
                      </div>
                    </td>
                    <td>
                      <div className="admin-inline-chips">
                        <span className="admin-chip">{user.role}</span>
                        <span
                          className={`admin-chip ${
                            user.plan === 'PRO' ? 'admin-chip-pro' : ''
                          }`}
                        >
                          {user.plan}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`admin-chip admin-user-${user.status.toLowerCase()}`}
                      >
                        {adminUserStatusLabel(user.status)}
                      </span>
                    </td>
                    <td>{formatAdminDate(user.proExpiresAt)}</td>
                    <td>{user.sessionCount ?? 0}</td>
                    <td>{formatAdminDate(user.createdAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action-button"
                          disabled={busy || isAdmin}
                          title={isAdmin ? 'Không quản lý trạng thái ADMIN tại đây' : undefined}
                          onClick={() => {
                            const target = nextStatus(user);
                            const text =
                              target === 'DISABLED'
                                ? `Block ${user.email}? Tất cả session hiện tại sẽ bị revoke.`
                                : `Mở lại tài khoản ${user.email}?`;
                            if (!window.confirm(text)) return;
                            void runFor(
                              user.id,
                              () => setAdminUserStatus(user.id, target),
                              target === 'DISABLED'
                                ? `Đã block ${user.email}.`
                                : `Đã mở lại ${user.email}.`,
                            );
                          }}
                        >
                          {user.status === 'DISABLED' ? 'Unblock' : 'Block'}
                        </button>

                        <button
                          type="button"
                          className="admin-action-button"
                          disabled={busy || isAdmin}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Revoke toàn bộ session của ${user.email}?`,
                              )
                            ) return;

                            void runFor(
                              user.id,
                              () => revokeAdminSessions(user.id),
                              `Đã revoke sessions của ${user.email}.`,
                            );
                          }}
                        >
                          Revoke sessions
                        </button>

                        {!isAdmin && user.plan !== 'PRO' ? (
                          <button
                            type="button"
                            className="admin-action-button admin-action-positive"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Nâng ${user.email} lên PRO trong ${days} ngày?`,
                                )
                              ) return;

                              void runFor(
                                user.id,
                                () => grantAdminPro(user.id, days),
                                `Đã nâng ${user.email} lên PRO ${days} ngày.`,
                              );
                            }}
                          >
                            Nâng PRO
                          </button>
                        ) : null}

                        {!isAdmin && user.plan === 'PRO' ? (
                          <button
                            type="button"
                            className="admin-action-button admin-action-danger"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Thu hồi PRO của ${user.email}? Active subscription sẽ chuyển REVOKED.`,
                                )
                              ) return;

                              void runFor(
                                user.id,
                                () => revokeAdminPro(user.id),
                                `Đã thu hồi PRO của ${user.email}.`,
                              );
                            }}
                          >
                            Hạ FREE
                          </button>
                        ) : null}

                        {!isAdmin ? (
                          <button
                            type="button"
                            className="admin-action-button admin-action-danger"
                            disabled={busy}
                            onClick={() => {
                              const answer = window.prompt(
                                `Xóa ${user.email}?\n\nDữ liệu thanh toán/audit sẽ được giữ lại và danh tính user sẽ được ẩn danh.\nNhập DELETE để xác nhận.`,
                              );
                              if (answer !== 'DELETE') return;

                              void runFor(
                                user.id,
                                () => deleteAdminUser(user.id),
                                `Đã xóa an toàn ${user.email}.`,
                              );
                            }}
                          >
                            Xóa
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
