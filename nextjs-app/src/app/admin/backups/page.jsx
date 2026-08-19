'use client';

import React, { useRef, useState } from 'react';
import { AlertTriangle, DatabaseBackup, Download, FileJson, Loader2, UploadCloud } from 'lucide-react';
import { Toast } from '../../../components/admin/AdminFeedback';

function RestoreMetric({ label, value }) {
    return (
        <div>
            <span>{label}</span>
            <strong>{Number(value || 0).toLocaleString('vi-VN')}</strong>
        </div>
    );
}

export default function AdminBackupsPage() {
    const fileInputRef = useRef(null);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [lastImport, setLastImport] = useState(null);
    const [toast, setToast] = useState(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), type === 'danger' ? 5200 : 3600);
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const link = document.createElement('a');
            link.href = `/api/admin/backups/export?t=${Date.now()}`;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Đang tải file backup');
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            window.setTimeout(() => setExporting(false), 1200);
        }
    };

    const handleImport = async (event) => {
        event.preventDefault();
        if (!selectedFile) return;
        setImporting(true);
        setLastImport(null);

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const response = await fetch('/api/admin/backups/import', {
                method: 'POST',
                body: formData,
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể import backup');

            setLastImport(payload);
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            showToast('Đã phục hồi dữ liệu từ backup');
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="admin-management-page">
            <section className="admin-page-hero">
                <div>
                    <p className="admin-eyebrow">Sao lưu</p>
                    <h2>Sao lưu & phục hồi toàn bộ dữ liệu</h2>
                </div>
            </section>

            <section className="admin-backup-panels">
                <article className="admin-panel">
                    <div className="admin-panel-header">
                        <div>
                            <h3>Tạo bản sao lưu đầy đủ</h3>
                            <p>Export user, channel list, channel queue, video list và usage profile thành một file JSONL.</p>
                        </div>
                        <DatabaseBackup size={22} />
                    </div>
                    <div className="admin-backup-body">
                        <FileJson size={38} />
                        <div>
                            <strong>Full database backup</strong>
                            <span>File gồm Supabase Auth users, admin accounts, channel list, video data, profile và used-video cache.</span>
                        </div>
                    </div>
                    <button className="admin-primary-btn" type="button" onClick={handleExport} disabled={exporting}>
                        {exporting ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
                        Tải xuống backup
                    </button>
                </article>

                <article className="admin-panel">
                    <div className="admin-panel-header">
                        <div>
                            <h3>Phục hồi dữ liệu</h3>
                            <p>Upload file JSONL backup đã export từ hệ thống. File JSON cũ vẫn được hỗ trợ.</p>
                        </div>
                        <UploadCloud size={22} />
                    </div>

                    <form className="admin-form-grid" onSubmit={handleImport}>
                        <label className="admin-upload-zone">
                            <UploadCloud size={26} />
                            <span>{selectedFile ? selectedFile.name : 'Chọn file backup JSONL'}</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,application/x-ndjson,.json,.jsonl,.ndjson"
                                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                            />
                        </label>

                        <div className="admin-alert warning">
                            <AlertTriangle size={17} />
                            Restore sẽ upsert dữ liệu: record trùng khóa được cập nhật, record mới được thêm. Hệ thống không tự xóa dữ liệu đang có. Password Supabase Auth không thể khôi phục từ backup; user restored cần reset password.
                        </div>

                        <button className="admin-primary-btn" type="submit" disabled={importing || !selectedFile}>
                            {importing ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
                            Restore
                        </button>
                    </form>

                    {lastImport && (
                        <div className="admin-detail-list restore-result">
                            <RestoreMetric label="Users đã xử lý" value={lastImport.imported_users} />
                            <RestoreMetric label="Users mới" value={lastImport.created_users} />
                            <RestoreMetric label="Users cập nhật" value={lastImport.updated_users} />
                            <RestoreMetric label="Admin accounts" value={lastImport.imported_admin_accounts} />
                            <RestoreMetric label="Channels" value={lastImport.imported_channel_sources} />
                            <RestoreMetric label="Channel queue" value={lastImport.imported_channel_source_queue} />
                            <RestoreMetric label="Videos" value={lastImport.imported_videos} />
                            <RestoreMetric label="Usage profiles" value={lastImport.imported_usage_profiles} />
                            <RestoreMetric label="Used videos" value={lastImport.imported_profile_used_videos} />
                            <RestoreMetric label="Doc sync cache" value={lastImport.imported_profile_doc_syncs} />
                            <RestoreMetric label="User settings" value={lastImport.imported_usage_user_settings} />
                            {lastImport.user_restore_error && (
                                <div>
                                    <span>Cảnh báo restore user</span>
                                    <strong>{lastImport.user_restore_error}</strong>
                                </div>
                            )}
                        </div>
                    )}
                </article>
            </section>

            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
}
