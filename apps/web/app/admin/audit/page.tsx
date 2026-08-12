'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getAdminAudit,
  type AdminAuditRow,
} from '../../../lib/admin';
import {
  adminMetadataText,
  formatAdminDate,
} from '../../../lib/admin-format';

// ADMIN_UI_REAL_V1
export default function AdminAuditPage() {
  const [rows, setRows] = useState<AdminAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await getAdminAudit(100)).rows);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được audit log.',
      );
    }
  }, []);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) void load();
    });

    return () => {
      active = false;
    };
  }, [load]);

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">AUDIT</span>
          <h1>Admin audit log</h1>
          <p>
            Lịch sử bootstrap, status changes, grant/revoke PRO và session revoke.
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Làm mới
        </button>
      </header>

      <section className="admin-panel">
        {error ? <div className="admin-error-banner">{error}</div> : null}

        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatAdminDate(row.createdAt)}</td>
                  <td>#{row.adminUserId}</td>
                  <td><strong>{row.action}</strong></td>
                  <td>
                    {row.targetType} {row.targetId ? `#${row.targetId}` : ''}
                  </td>
                  <td>
                    <code className="admin-metadata">
                      {adminMetadataText(row.metadata)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
