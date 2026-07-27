'use client';

import React, { useRef, useState } from 'react';
import { AlertTriangle, DatabaseBackup, Download, FileJson, Loader2, UploadCloud } from 'lucide-react';
import { Toast } from '../../../components/admin/AdminFeedback';

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
            const response = await fetch('/api/admin/backups/export');
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Không thể tạo file backup');
            }

            const blob = await response.blob();
            const disposition = response.headers.get('content-disposition') || '';
            const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `deep-video-search-backup-${Date.now()}.json`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            showToast('Đã tạo file backup');
        } catch (err) {
            showToast(err.message, 'danger');
        } finally {
            setExporting(false);
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
                    <h2>Sao lưu & phục hồi dữ liệu</h2>
                </div>
            </section>

            <section className="admin-backup-panels">
                <article className="admin-panel">
                    <div className="admin-panel-header">
                        <div>
                            <h3>Tạo bản sao lưu</h3>
                            <p>Export bảng channel_sources và videos thành một file JSON.</p>
                        </div>
                        <DatabaseBackup size={22} />
                    </div>
                    <div className="admin-backup-body">
                        <FileJson size={38} />
                        <div>
                            <strong>Database / Video list</strong>
                            <span>File chứa metadata backup, danh sách kênh và danh sách video hiện có.</span>
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
                            <p>Upload file JSON backup đã export từ hệ thống.</p>
                        </div>
                        <UploadCloud size={22} />
                    </div>

                    <form className="admin-form-grid" onSubmit={handleImport}>
                        <label className="admin-upload-zone">
                            <UploadCloud size={26} />
                            <span>{selectedFile ? selectedFile.name : 'Chọn file backup JSON'}</span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                            />
                        </label>

                        <div className="admin-alert warning">
                            <AlertTriangle size={17} />
                            Restore sẽ upsert dữ liệu: record trùng khóa được cập nhật, record mới được thêm. Hệ thống không tự xóa dữ liệu đang có.
                        </div>

                        <button className="admin-primary-btn" type="submit" disabled={importing || !selectedFile}>
                            {importing ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
                            Restore
                        </button>
                    </form>

                    {lastImport && (
                        <div className="admin-detail-list restore-result">
                            <div><span>Channel đã xử lý</span><strong>{Number(lastImport.imported_channel_sources || 0).toLocaleString('vi-VN')}</strong></div>
                            <div><span>Video đã xử lý</span><strong>{Number(lastImport.imported_videos || 0).toLocaleString('vi-VN')}</strong></div>
                        </div>
                    )}
                </article>
            </section>

            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
}
