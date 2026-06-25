'use client';

import React, { useEffect, useState } from 'react';
import { Check, Edit3, ExternalLink, Eye, Plus, RefreshCw, Trash2, X } from 'lucide-react';

export default function ProfileManager({ initialProfile = null, onActiveProfileChange, onUsageChanged }) {
    const [profiles, setProfiles] = useState(initialProfile ? [initialProfile] : []);
    const [activeProfile, setActiveProfile] = useState(initialProfile);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncingId, setSyncingId] = useState(null);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ name: '', google_sheet_url: '', tab_scope: 'current' });
    const [usedModalProfile, setUsedModalProfile] = useState(null);
    const [usedVideos, setUsedVideos] = useState([]);
    const [usedTotal, setUsedTotal] = useState(0);
    const [usedLoading, setUsedLoading] = useState(false);

    const notifyActiveProfile = (profile) => {
        setActiveProfile(profile);
        onActiveProfileChange?.(profile);
    };

    const fetchProfiles = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/profiles');
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Không thể tải profile');
            }
            const payload = await response.json();
            setProfiles(payload.profiles || []);
            notifyActiveProfile(payload.activeProfile || null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfiles();
    }, []);

    const resetForm = () => {
        setEditingId(null);
        setForm({ name: '', google_sheet_url: '', tab_scope: 'current' });
    };

    const startEdit = (profile) => {
        setEditingId(profile.id);
        setForm({
            name: profile.name || '',
            google_sheet_url: profile.google_sheet_url || '',
            tab_scope: profile.tab_scope || 'current',
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');

        try {
            const url = editingId ? `/api/profiles/${editingId}` : '/api/profiles';
            const response = await fetch(url, {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể lưu profile');

            const savedProfile = payload.profile;
            if (!editingId && savedProfile?.id) {
                await fetch(`/api/profiles/${savedProfile.id}/select`, { method: 'POST' });
            }

            resetForm();
            await fetchProfiles();
            onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const selectProfile = async (profile) => {
        setError('');
        try {
            const response = await fetch(`/api/profiles/${profile.id}/select`, { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể chọn profile');

            notifyActiveProfile(payload.profile || profile);
            onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        }
    };

    const deleteProfile = async (profile) => {
        if (!window.confirm(`Xoá profile "${profile.name}"? Dữ liệu video đã dùng cache của profile này cũng sẽ bị xoá.`)) {
            return;
        }

        setError('');
        try {
            const response = await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể xoá profile');

            await fetchProfiles();
            onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        }
    };

    const syncProfile = async (profile) => {
        setSyncingId(profile.id);
        setError('');
        try {
            const response = await fetch(`/api/profiles/${profile.id}/sync`, { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể sync profile');

            await fetchProfiles();
            if (activeProfile?.id === profile.id) onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncingId(null);
        }
    };

    const openUsedVideos = async (profile) => {
        setUsedModalProfile(profile);
        setUsedVideos([]);
        setUsedTotal(0);
        setUsedLoading(true);
        setError('');

        try {
            const response = await fetch(`/api/profiles/${profile.id}/used-videos?size=100`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể tải video đã dùng');

            setUsedVideos(payload.data || []);
            setUsedTotal(payload.total || 0);
        } catch (err) {
            setError(err.message);
        } finally {
            setUsedLoading(false);
        }
    };

    const formatDateTime = (value) => {
        if (!value) return 'Chưa sync';
        try {
            return new Intl.DateTimeFormat('vi-VN', {
                dateStyle: 'short',
                timeStyle: 'short',
            }).format(new Date(value));
        } catch {
            return value;
        }
    };

    return (
        <>
            <button
                className="profile-chip"
                onClick={() => setIsOpen(true)}
                title="Quản lý Usage Profile"
            >
                <span className="profile-chip-label">Profile:</span>
                <span className="profile-chip-name">{activeProfile?.name || 'Chưa chọn'}</span>
            </button>

            {isOpen && (
                <div className="modal-overlay" onClick={() => setIsOpen(false)}>
                    <div className="modal-container profile-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header profile-modal-header">
                            <div>
                                <h2>Profiles</h2>
                                <p>Ẩn các video đã được dùng trong Google Sheets</p>
                            </div>
                            <button className="close-btn" onClick={() => setIsOpen(false)}>
                                <X size={22} />
                            </button>
                        </div>

                        {error && <div className="profile-error">{error}</div>}

                        <form className="profile-form" onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Tên profile</label>
                                <input
                                    value={form.name}
                                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                                    placeholder="VD: Kênh US, Team A, Client X..."
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Google Sheet URL</label>
                                <input
                                    value={form.google_sheet_url}
                                    onChange={(event) => setForm((prev) => ({ ...prev, google_sheet_url: event.target.value }))}
                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Phạm vi tab</label>
                                <div className="profile-scope-toggle">
                                    <button
                                        type="button"
                                        className={form.tab_scope === 'current' ? 'active' : ''}
                                        onClick={() => setForm((prev) => ({ ...prev, tab_scope: 'current' }))}
                                    >
                                        Tab hiện tại
                                    </button>
                                    <button
                                        type="button"
                                        className={form.tab_scope === 'all' ? 'active' : ''}
                                        onClick={() => setForm((prev) => ({ ...prev, tab_scope: 'all' }))}
                                    >
                                        Tất cả tabs
                                    </button>
                                </div>
                                <p className="profile-field-help">
                                    Tab hiện tại dùng <code>gid=</code> trong Sheet URL; Tất cả tabs quét toàn bộ tab.
                                </p>
                            </div>
                            <div className="profile-form-actions">
                                {editingId && (
                                    <button type="button" className="modal-btn-cancel" onClick={resetForm}>
                                        Huỷ sửa
                                    </button>
                                )}
                                <button className="modal-btn-confirm" disabled={saving || !form.name.trim() || !form.google_sheet_url.trim()}>
                                    {saving ? 'Đang lưu...' : editingId ? 'Lưu profile' : 'Tạo profile'}
                                </button>
                            </div>
                        </form>

                        <div className="profile-list">
                            {loading && <div className="profile-empty">Đang tải profile...</div>}
                            {!loading && profiles.length === 0 && (
                                <div className="profile-empty">
                                    <Plus size={20} />
                                    Chưa có profile nào. Tạo profile đầu tiên bằng form phía trên.
                                </div>
                            )}

                            {profiles.map((profile) => {
                                const isActive = activeProfile?.id === profile.id;
                                const isSyncing = syncingId === profile.id;

                                return (
                                    <div key={profile.id} className={`profile-card ${isActive ? 'active' : ''}`}>
                                        <div className="profile-card-main">
                                            <div className="profile-card-title">
                                                {isActive && <Check size={16} />}
                                                <span>{profile.name}</span>
                                            </div>
                                            <a href={profile.google_sheet_url} target="_blank" rel="noopener noreferrer" className="profile-sheet-link">
                                                Google Sheet <ExternalLink size={13} />
                                            </a>
                                            <div className="profile-meta">
                                                <span>{Number(profile.used_count || 0).toLocaleString('vi-VN')} video đã dùng</span>
                                                <span>{profile.tab_scope === 'all' ? 'Tất cả tabs' : 'Tab hiện tại'}</span>
                                                <span>Sync: {formatDateTime(profile.last_sync_at)}</span>
                                                <span className={`profile-sync-status status-${profile.sync_status}`}>{profile.sync_status}</span>
                                            </div>
                                            {profile.sync_error && <div className="profile-warning">{profile.sync_error}</div>}
                                        </div>
                                        <div className="profile-card-actions">
                                            <button onClick={() => selectProfile(profile)} disabled={isActive} title="Chọn profile">
                                                <Check size={16} />
                                            </button>
                                            <button onClick={() => syncProfile(profile)} disabled={isSyncing} title="Sync Google Sheet/Docs">
                                                <RefreshCw size={16} className={isSyncing ? 'spin-icon' : ''} />
                                            </button>
                                            <button onClick={() => openUsedVideos(profile)} title="Xem video đã dùng">
                                                <Eye size={16} />
                                            </button>
                                            <button onClick={() => startEdit(profile)} title="Sửa profile">
                                                <Edit3 size={16} />
                                            </button>
                                            <button onClick={() => deleteProfile(profile)} title="Xoá profile">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {usedModalProfile && (
                <div className="modal-overlay" onClick={() => setUsedModalProfile(null)}>
                    <div className="modal-container used-videos-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header profile-modal-header">
                            <div>
                                <h2>Video đã dùng: {usedModalProfile.name}</h2>
                                <p>Hiển thị tối đa 100 dòng mới nhất / tổng {usedTotal.toLocaleString('vi-VN')} video.</p>
                            </div>
                            <button className="close-btn" onClick={() => setUsedModalProfile(null)}>
                                <X size={22} />
                            </button>
                        </div>

                        {usedLoading ? (
                            <div className="profile-empty">Đang tải video đã dùng...</div>
                        ) : usedVideos.length === 0 ? (
                            <div className="profile-empty">Profile này chưa có video đã dùng. Hãy bấm Sync now.</div>
                        ) : (
                            <div className="used-video-list">
                                {usedVideos.map((video) => (
                                    <div key={video.video_key} className="used-video-item">
                                        {video.thumbnail ? (
                                            <img src={video.thumbnail} alt="" className="used-video-thumb" />
                                        ) : (
                                            <div className="used-video-thumb placeholder" />
                                        )}
                                        <div className="used-video-body">
                                            <a href={video.url} target="_blank" rel="noopener noreferrer" className="used-video-title">
                                                {video.title || video.url}
                                            </a>
                                            <div className="used-video-url">{video.url}</div>
                                            <div className="used-video-occurrences">
                                                {(video.occurrences || []).slice(0, 3).map((occurrence, index) => (
                                                    <a
                                                        key={`${video.video_key}-${index}`}
                                                        href={occurrence.docUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        {occurrence.docTitle || 'Google Doc'} · {occurrence.sheetTab || 'Sheet'}!{occurrence.cell || '?'}
                                                    </a>
                                                ))}
                                                {(video.occurrences || []).length > 3 && (
                                                    <span>+{video.occurrences.length - 3} nguồn khác</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
