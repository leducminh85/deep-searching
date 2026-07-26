'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { ConfirmModal, Toast } from '../../../components/admin/AdminFeedback';

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Intl.DateTimeFormat('vi-VN', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return '-';
    }
}

const emptyForm = {
    email: '',
    password: '',
    emailConfirm: true,
};

export default function AdminAccountsPage() {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [createOpen, setCreateOpen] = useState(false);
    const [resetTarget, setResetTarget] = useState(null);
    const [resetPassword, setResetPassword] = useState('');
    const [confirmModal, setConfirmModal] = useState(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [toast, setToast] = useState(null);

    const confirmedCount = useMemo(() => (
        accounts.filter((account) => account.email_confirmed_at || account.confirmed_at).length
    ), [accounts]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), type === 'danger' ? 5200 : 3600);
    };

    const closeCreateModal = () => {
        if (saving) return;
        setCreateOpen(false);
        setForm(emptyForm);
    };

    const loadAccounts = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể tải danh sách người dùng');
            setAccounts(payload.accounts || []);
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAccounts();
    }, []);

    const handleCreate = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const response = await fetch('/api/admin/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể tạo người dùng');
            setAccounts((current) => [payload.account, ...current]);
            setForm(emptyForm);
            setCreateOpen(false);
            showToast('Đã tạo người dùng');
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const askDelete = (account) => {
        setConfirmModal({
            title: 'Xóa người dùng',
            description: `Bạn đang xóa ${account.email}.`,
            body: 'Người dùng này sẽ không thể đăng nhập vào website nữa.',
            confirmText: 'Xóa người dùng',
            variant: 'danger',
            onConfirm: async () => {
                const response = await fetch(`/api/admin/accounts/${account.id}`, { method: 'DELETE' });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Không thể xóa người dùng');
                setAccounts((current) => current.filter((item) => item.id !== account.id));
                showToast('Đã xóa người dùng');
            },
        });
    };

    const confirmAction = async () => {
        if (!confirmModal?.onConfirm) return;
        setConfirmBusy(true);
        try {
            await confirmModal.onConfirm();
            setConfirmModal(null);
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setConfirmBusy(false);
        }
    };

    const handleResetPassword = async (event) => {
        event.preventDefault();
        if (!resetTarget) return;
        setSaving(true);
        try {
            const response = await fetch(`/api/admin/accounts/${resetTarget.id}/reset-password`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: resetPassword }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể đặt lại mật khẩu');
            setAccounts((current) => current.map((account) => (
                account.id === payload.account.id ? payload.account : account
            )));
            setResetTarget(null);
            setResetPassword('');
            showToast('Đã đặt lại mật khẩu');
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="admin-management-page accounts-page">
            <section className="admin-page-hero">
                <div>
                    <p className="admin-eyebrow">Tài khoản</p>
                    <h2>Quản lý người dùng</h2>
                </div>
                <div className="admin-hero-actions">
                    <button className="admin-secondary-btn" type="button" onClick={loadAccounts}>
                        <RefreshCcw size={17} />
                        Tải lại
                    </button>
                    <button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}>
                        <Plus size={18} />
                        Thêm người dùng
                    </button>
                </div>
            </section>

            <section className="admin-dashboard-grid compact">
                <article className="admin-metric-card">
                    <div className="admin-metric-icon"><Users size={20} /></div>
                    <span>{accounts.length.toLocaleString('vi-VN')}</span>
                    <strong>Tổng người dùng</strong>
                </article>
                <article className="admin-metric-card">
                    <div className="admin-metric-icon"><UserPlus size={20} /></div>
                    <span>{confirmedCount.toLocaleString('vi-VN')}</span>
                    <strong>Đã xác thực</strong>
                </article>
            </section>

            <article className="admin-panel accounts-list-panel">
                <div className="admin-panel-header">
                    <div>
                        <h3>Danh sách người dùng</h3>
                        <p>Email, trạng thái xác thực và lần đăng nhập gần nhất.</p>
                    </div>
                </div>
                <div className="admin-table-wrap accounts-table accounts-table-scroll">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Trạng thái</th>
                                <th>Đăng nhập gần nhất</th>
                                <th>Ngày tạo</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="5" className="admin-empty">Đang tải người dùng...</td></tr>
                            ) : accounts.length ? accounts.map((account) => {
                                const confirmed = account.email_confirmed_at || account.confirmed_at;
                                return (
                                    <tr key={account.id}>
                                        <td><strong>{account.email || '-'}</strong></td>
                                        <td>
                                            <span className={`admin-status-pill ${confirmed ? 'completed' : 'idle'}`}>
                                                {confirmed ? 'Đã xác thực' : 'Chưa xác thực'}
                                                </span>
                                            </td>
                                            <td>{formatDate(account.last_sign_in_at)}</td>
                                            <td>{formatDate(account.created_at)}</td>
                                            <td>
                                            <div className="admin-row-actions">
                                                <button className="admin-icon-btn" type="button" title="Đặt lại mật khẩu" aria-label="Đặt lại mật khẩu" onClick={() => setResetTarget(account)}>
                                                    <KeyRound size={17} />
                                                </button>
                                                <button className="admin-icon-btn danger" type="button" title="Xóa người dùng" aria-label="Xóa người dùng" onClick={() => askDelete(account)}>
                                                    <Trash2 size={17} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr><td colSpan="5" className="admin-empty">Chưa có người dùng nào.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </article>

            {createOpen && (
                <div className="modal-overlay admin-modal-overlay" onClick={closeCreateModal}>
                    <form className="modal-container admin-modal account-create-modal" onSubmit={handleCreate} onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header admin-modal-header">
                            <div>
                                <h3>Thêm người dùng</h3>
                            </div>
                        </div>
                        <div className="admin-form-grid">
                            <label className="admin-field">
                                <span>Email</span>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                                    placeholder="user@example.com"
                                    autoComplete="email"
                                    autoFocus
                                />
                            </label>
                            <label className="admin-field">
                                <span>Mật khẩu</span>
                                <input
                                    type="password"
                                    value={form.password}
                                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                                    placeholder="Ít nhất 8 ký tự"
                                    autoComplete="new-password"
                                />
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="modal-btn-cancel" type="button" disabled={saving} onClick={closeCreateModal}>
                                Hủy
                            </button>
                            <button className="modal-btn-confirm" type="submit" disabled={saving || !form.email || !form.password}>
                                {saving ? <Loader2 className="spin" size={16} /> : null}
                                Thêm người dùng
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {resetTarget && (
                <div className="modal-overlay admin-modal-overlay" onClick={() => setResetTarget(null)}>
                    <form className="modal-container admin-modal" onSubmit={handleResetPassword} onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header admin-modal-header">
                            <div>
                                <h3>Đặt lại mật khẩu</h3>
                                <p>{resetTarget.email}</p>
                            </div>
                        </div>
                        <label className="admin-field">
                            <span>Mật khẩu mới</span>
                            <input
                                type="password"
                                value={resetPassword}
                                onChange={(event) => setResetPassword(event.target.value)}
                                placeholder="Ít nhất 8 ký tự"
                                autoComplete="new-password"
                                autoFocus
                            />
                        </label>
                        <div className="modal-footer">
                            <button className="modal-btn-cancel" type="button" onClick={() => setResetTarget(null)}>
                                Hủy
                            </button>
                            <button className="modal-btn-confirm" type="submit" disabled={saving || resetPassword.length < 8}>
                                Đặt lại
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <ConfirmModal
                modal={confirmModal}
                busy={confirmBusy}
                onCancel={() => setConfirmModal(null)}
                onConfirm={confirmAction}
            />
            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
}
