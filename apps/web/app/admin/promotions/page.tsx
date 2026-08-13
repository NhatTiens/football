'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';

import {
  createAdminPromotion,
  deleteAdminPromotion,
  getAdminPromotions,
  setAdminPromotionEnabled,
  updateAdminPromotion,
  type AdminPromotion,
  type AdminPromotionDashboard,
  type AdminPromotionInput,
  type AdminPromotionType,
} from '../../../lib/admin';
import { getBillingPlans, type BillingPlan } from '../../../lib/billing';
import { formatAdminDate, formatAdminMoney } from '../../../lib/admin-format';

type FormState = {
  name: string;
  code: string;
  description: string;
  type: AdminPromotionType;
  value: string;
  automatic: boolean;
  planIds: number[];
  startAt: string;
  endAt: string;
  priority: string;
  maxUses: string;
  maxUsesPerUser: string;
  minimumDurationDays: string;
  newUsersOnly: boolean;
  firstPurchaseOnly: boolean;
  status: 'ACTIVE' | 'INACTIVE';
};

function dateTimeLocal(date: string | null): string {
  if (!date) return '';
  const value = new Date(date);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function emptyForm(): FormState {
  return {
    name: '',
    code: '',
    description: '',
    type: 'FIXED_PRICE',
    value: '',
    automatic: false,
    planIds: [],
    startAt: dateTimeLocal(new Date().toISOString()),
    endAt: '',
    priority: '50',
    maxUses: '',
    maxUsesPerUser: '1',
    minimumDurationDays: '',
    newUsersOnly: false,
    firstPurchaseOnly: false,
    status: 'INACTIVE',
  };
}

function nullableInteger(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function formInput(form: FormState): AdminPromotionInput {
  const numericValue = Number(form.value);
  return {
    name: form.name.trim(),
    code: form.code.trim() ? form.code.trim().toUpperCase() : null,
    description: form.description.trim() || null,
    type: form.type,
    discountValue: form.type === 'FIXED_PRICE' ? null : numericValue,
    fixedPriceVnd: form.type === 'FIXED_PRICE' ? numericValue : null,
    automatic: form.automatic,
    planIds: form.planIds,
    startAt: new Date(form.startAt).toISOString(),
    endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
    priority: Number(form.priority),
    maxUses: nullableInteger(form.maxUses),
    maxUsesPerUser: nullableInteger(form.maxUsesPerUser),
    minimumDurationDays: nullableInteger(form.minimumDurationDays),
    newUsersOnly: form.newUsersOnly,
    firstPurchaseOnly: form.firstPurchaseOnly,
    status: form.status,
  };
}

function editForm(row: AdminPromotion): FormState {
  return {
    name: row.name,
    code: row.code ?? '',
    description: row.description ?? '',
    type: row.type,
    value: String(
      row.type === 'FIXED_PRICE' ? (row.fixedPriceVnd ?? '') : (row.discountValue ?? ''),
    ),
    automatic: row.automatic,
    planIds: row.planIds,
    startAt: dateTimeLocal(row.startAt),
    endAt: dateTimeLocal(row.endAt),
    priority: String(row.priority),
    maxUses: row.maxUses == null ? '' : String(row.maxUses),
    maxUsesPerUser: row.maxUsesPerUser == null ? '' : String(row.maxUsesPerUser),
    minimumDurationDays: row.minimumDurationDays == null ? '' : String(row.minimumDurationDays),
    newUsersOnly: row.newUsersOnly,
    firstPurchaseOnly: row.firstPurchaseOnly,
    status: row.status,
  };
}

export default function AdminPromotionsPage() {
  const [dashboard, setDashboard] = useState<AdminPromotionDashboard | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [promotionData, pricing] = await Promise.all([getAdminPromotions(), getBillingPlans()]);
      setDashboard(promotionData);
      setPlans(pricing.plans);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được promotions.');
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

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const input = formInput(form);
      if (editingId) {
        await updateAdminPromotion(editingId, input);
        setSuccess('Đã cập nhật promotion và ghi audit log.');
      } else {
        await createAdminPromotion(input);
        setSuccess('Đã tạo promotion và ghi audit log.');
      }
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không lưu được promotion.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: AdminPromotion): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await setAdminPromotionEnabled(row.id, row.status !== 'ACTIVE');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không đổi được trạng thái.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AdminPromotion): Promise<void> {
    if (!window.confirm(`Soft-delete promotion “${row.name}”? Lịch sử order/usage vẫn được giữ.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminPromotion(row.id);
      setSuccess('Promotion đã được soft-delete.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không xóa được promotion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">PROMOTIONS</span>
          <h1>Pricing & Promotion</h1>
          <p>Quản lý coupon, automatic promotion, priority, eligibility và giới hạn sử dụng.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Làm mới
        </button>
      </header>

      {error ? <div className="admin-error-banner">{error}</div> : null}
      {success ? <div className="admin-success-banner">{success}</div> : null}

      <div className="admin-kpi-grid">
        <article>
          <span>Active</span>
          <strong>{dashboard?.activePromotions ?? '—'}</strong>
        </article>
        <article>
          <span>Scheduled</span>
          <strong>{dashboard?.scheduledPromotions ?? '—'}</strong>
        </article>
        <article>
          <span>Expired</span>
          <strong>{dashboard?.expiredPromotions ?? '—'}</strong>
        </article>
        <article>
          <span>Redemptions</span>
          <strong>{dashboard?.totalRedemptions ?? '—'}</strong>
        </article>
        <article>
          <span>Revenue</span>
          <strong>{formatAdminMoney(dashboard?.totalRevenue ?? 0)}</strong>
        </article>
        <article>
          <span>Discount given</span>
          <strong>{formatAdminMoney(dashboard?.totalDiscountGiven ?? 0)}</strong>
        </article>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <span className="eyebrow">{editingId ? 'EDIT' : 'CREATE'}</span>
            <h2>{editingId ? `Promotion #${editingId}` : 'Tạo promotion'}</h2>
          </div>
          {editingId ? (
            <button
              type="button"
              className="admin-action-button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
              }}
            >
              Hủy edit
            </button>
          ) : null}
        </div>
        <form className="admin-promotion-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Name</span>
            <input
              required
              minLength={2}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            <span>Code (trống nếu không cần)</span>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            <span>Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AdminPromotionType })}
            >
              <option value="FIXED_PRICE">FIXED_PRICE</option>
              <option value="FIXED_AMOUNT">FIXED_AMOUNT</option>
              <option value="PERCENTAGE">PERCENTAGE</option>
            </select>
          </label>
          <label>
            <span>
              {form.type === 'FIXED_PRICE'
                ? 'Fixed price (VND)'
                : form.type === 'PERCENTAGE'
                  ? 'Discount (%)'
                  : 'Discount (VND)'}
            </span>
            <input
              required
              type="number"
              min="0"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </label>
          <label>
            <span>Start</span>
            <input
              required
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => setForm({ ...form, endAt: e.target.value })}
            />
          </label>
          <label>
            <span>Priority</span>
            <input
              required
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })
              }
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </label>
          <label>
            <span>Max uses</span>
            <input
              type="number"
              min="1"
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
            />
          </label>
          <label>
            <span>Max/user</span>
            <input
              type="number"
              min="1"
              value={form.maxUsesPerUser}
              onChange={(e) => setForm({ ...form, maxUsesPerUser: e.target.value })}
            />
          </label>
          <label>
            <span>Minimum duration (days)</span>
            <input
              type="number"
              min="1"
              value={form.minimumDurationDays}
              onChange={(e) => setForm({ ...form, minimumDurationDays: e.target.value })}
            />
          </label>
          <label className="admin-promotion-wide">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <fieldset className="admin-promotion-wide">
            <legend>Applicable plans</legend>
            <div className="admin-plan-checkboxes">
              {plans.map((plan) => (
                <label key={plan.id}>
                  <input
                    type="checkbox"
                    checked={form.planIds.includes(plan.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        planIds: e.target.checked
                          ? [...form.planIds, plan.id]
                          : form.planIds.filter((id) => id !== plan.id),
                      })
                    }
                  />{' '}
                  {plan.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="admin-promotion-options admin-promotion-wide">
            <label>
              <input
                type="checkbox"
                checked={form.automatic}
                onChange={(e) => setForm({ ...form, automatic: e.target.checked })}
              />{' '}
              Automatic
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.newUsersOnly}
                onChange={(e) => setForm({ ...form, newUsersOnly: e.target.checked })}
              />{' '}
              New users only
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.firstPurchaseOnly}
                onChange={(e) => setForm({ ...form, firstPurchaseOnly: e.target.checked })}
              />{' '}
              First purchase only
            </label>
          </div>
          <button
            className="button primary"
            type="submit"
            disabled={busy || form.planIds.length === 0}
          >
            {busy ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Tạo promotion'}
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <span className="eyebrow">MANAGEMENT</span>
            <h2>Danh sách promotions</h2>
          </div>
          <span>{dashboard?.promotions.length ?? 0} bản ghi</span>
        </div>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name / code</th>
                <th>Type / value</th>
                <th>Plans</th>
                <th>Start / end</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Usage</th>
                <th>Revenue</th>
                <th>Discount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.promotions.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="admin-user-cell">
                      <strong>{row.name}</strong>
                      <code>{row.code ?? 'AUTOMATIC'}</code>
                    </div>
                  </td>
                  <td>
                    {row.type}
                    <br />
                    <strong>
                      {row.type === 'PERCENTAGE'
                        ? `${row.discountValue}%`
                        : formatAdminMoney(
                            row.type === 'FIXED_PRICE'
                              ? (row.fixedPriceVnd ?? 0)
                              : (row.discountValue ?? 0),
                          )}
                    </strong>
                  </td>
                  <td>{row.plans.map((plan) => plan.code).join(', ')}</td>
                  <td>
                    {formatAdminDate(row.startAt)}
                    <br />
                    {formatAdminDate(row.endAt)}
                  </td>
                  <td>
                    <span className={`admin-chip admin-chip-${row.effectiveStatus.toLowerCase()}`}>
                      {row.effectiveStatus}
                    </span>
                  </td>
                  <td>{row.priority}</td>
                  <td>
                    {row.statistics.redemptions} / {row.maxUses ?? '∞'}
                  </td>
                  <td>{formatAdminMoney(row.statistics.revenue)}</td>
                  <td>{formatAdminMoney(row.statistics.discount)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        className="admin-action-button"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(row.id);
                          setForm(editForm(row));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="admin-action-button admin-action-positive"
                        type="button"
                        disabled={busy}
                        onClick={() => void toggle(row)}
                      >
                        {row.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="admin-action-button admin-action-danger"
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </button>
                    </div>
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
