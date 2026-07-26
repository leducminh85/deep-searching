'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export function Toast({ toast, onClose }) {
    if (!toast?.message) return null;

    const type = toast.type || 'success';
    const Icon = type === 'danger' ? AlertCircle : CheckCircle2;

    return (
        <div className={`admin-toast ${type}`} role="status" aria-live="polite">
            {toast.icon || <Icon size={18} />}
            <span>{toast.message}</span>
            {onClose && (
                <button type="button" onClick={onClose} aria-label="Đóng thông báo">
                    <X size={16} />
                </button>
            )}
        </div>
    );
}

export function ConfirmModal({ modal, busy = false, onCancel, onConfirm }) {
    if (!modal) return null;

    return (
        <div className="modal-overlay admin-modal-overlay" onClick={() => !busy && onCancel?.()}>
            <section className="modal-container admin-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header admin-modal-header">
                    <div>
                        <h3>{modal.title}</h3>
                        {modal.description && <p>{modal.description}</p>}
                    </div>
                </div>
                {modal.body && <div className="admin-modal-note">{modal.body}</div>}
                <div className="modal-footer">
                    <button className="modal-btn-cancel" type="button" disabled={busy} onClick={onCancel}>
                        Hủy
                    </button>
                    <button
                        className={`modal-btn-confirm ${modal.variant === 'danger' ? 'danger' : ''}`}
                        type="button"
                        disabled={busy}
                        onClick={onConfirm}
                    >
                        {busy ? 'Đang xử lý...' : modal.confirmText || 'Xác nhận'}
                    </button>
                </div>
            </section>
        </div>
    );
}
