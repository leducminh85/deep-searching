'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, Edit3, ExternalLink, Eye, Plus, RefreshCw, Trash2, X } from 'lucide-react';

export default function ProfileManager({ initialProfile = null, onActiveProfileChange, onUsageChanged }) {
    const [profiles, setProfiles] = useState(initialProfile ? [initialProfile] : []);
    const [activeProfile, setActiveProfile] = useState(initialProfile);
    const [isOpen, setIsOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncingId, setSyncingId] = useState(null);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ name: '', google_sheet_url: '', tab_scope: 'current' });
    const [usedModalProfile, setUsedModalProfile] = useState(null);
    const [usedVideos, setUsedVideos] = useState([]);
    const [usedTotal, setUsedTotal] = useState(0);
    const [usedSearch, setUsedSearch] = useState('');
    const [usedLoading, setUsedLoading] = useState(false);
    const [profileToDelete, setProfileToDelete] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [syncProgress, setSyncProgress] = useState(null);
    const menuRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const progressTimeoutRef = useRef(null);
    const autoSyncStartedRef = useRef(false);
    const usedSearchDebounceRef = useRef(null);

    const notifyActiveProfile = (profile) => {
        setActiveProfile(profile);
        onActiveProfileChange?.(profile);
    };

    const clearProgressTimers = () => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        if (progressTimeoutRef.current) {
            clearTimeout(progressTimeoutRef.current);
            progressTimeoutRef.current = null;
        }
    };

    const startSyncProgress = (label, profileId = null) => {
        clearProgressTimers();
        setSyncProgress({
            profileId,
            label,
            percent: 8,
            message: '',
            status: 'running',
        });

        progressIntervalRef.current = setInterval(() => {
            setSyncProgress((prev) => {
                if (!prev || prev.status !== 'running') return prev;
                const increment = Math.max(1, Math.round((92 - prev.percent) * 0.12));
                return {
                    ...prev,
                    percent: Math.min(92, prev.percent + increment),
                };
            });
        }, 450);
    };

    const finishSyncProgress = (message, status = 'success') => {
        clearProgressTimers();
        setSyncProgress((prev) => prev ? {
            ...prev,
            percent: 100,
            message,
            status,
        } : null);

        progressTimeoutRef.current = setTimeout(() => {
            setSyncProgress(null);
        }, status === 'failed' ? 3200 : 1800);
    };

    const formatSyncSummary = (payload) => {
        if (!payload) return 'Sync xong';

        const usedCount = Number(payload.used_count || 0).toLocaleString('vi-VN');
        const refreshed = Number(payload.refreshed_doc_count || 0).toLocaleString('vi-VN');
        const skipped = Number(payload.skipped_doc_count || 0).toLocaleString('vi-VN');
        const warnings = Number(payload.warning_count || 0);

        if (warnings > 0) {
            return `Xong ${usedCount} video, doc moi/sua: ${refreshed}, bo qua: ${skipped}, can xem ${warnings} canh bao.`;
        }

        return `Xong ${usedCount} video, doc moi/sua: ${refreshed}, bo qua ${skipped} doc khong doi.`;
    };

    const formatSyncAllSummary = (payload) => {
        if (!payload) return 'Auto sync xong';

        const results = payload.results || [];
        const refreshed = results.reduce((sum, item) => sum + Number(item.refreshed_doc_count || 0), 0);
        const skipped = results.reduce((sum, item) => sum + Number(item.skipped_doc_count || 0), 0);
        const skippedProfiles = Number(payload.skipped_count || 0);
        const failed = Number(payload.failed_count || 0);

        if (failed > 0) {
            return `Auto sync xong ${payload.synced_count || 0}/${payload.profile_count || 0} profile, bo qua ${skippedProfiles}, ${failed} profile loi.`;
        }

        if (skippedProfiles > 0 && Number(payload.synced_count || 0) === 0) {
            return `Auto sync bo qua ${skippedProfiles} profile vi Google Sheet khong doi.`;
        }

        return `Auto sync xong ${payload.synced_count || 0} profile, bo qua ${skippedProfiles} profile, doc moi/sua: ${refreshed}, bo qua doc: ${skipped}.`;
    };

    const fetchProfiles = async ({ showLoading = true, notifyParent = false } = {}) => {
        if (showLoading) setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/profiles');
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Không thể tải profile');
            }
            const payload = await response.json();
            setProfiles(payload.profiles || []);
            setActiveProfile(payload.activeProfile || null);
            if (notifyParent) {
                onActiveProfileChange?.(payload.activeProfile || null);
            }
            return payload;
        } catch (err) {
            setError(err.message);
            return null;
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const loadAndSync = async () => {
            const payload = await fetchProfiles();
            if (cancelled || autoSyncStartedRef.current || !payload?.profiles?.length) return;

            autoSyncStartedRef.current = true;
            await syncAllProfiles({ notifyUsageChanged: false });
        };

        loadAndSync();

        return () => {
            cancelled = true;
            clearProgressTimers();
        };
    }, []);

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    const resetForm = () => {
        setEditingId(null);
        setForm({ name: '', google_sheet_url: '', tab_scope: 'current' });
        setIsFormOpen(false);
    };

    const startEdit = (profile) => {
        setEditingId(profile.id);
        setForm({
            name: profile.name || '',
            google_sheet_url: profile.google_sheet_url || '',
            tab_scope: profile.tab_scope || 'current',
        });
        setIsFormOpen(true);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');

        try {
            const isEditing = Boolean(editingId);
            const url = editingId ? `/api/profiles/${editingId}` : '/api/profiles';
            const response = await fetch(url, {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể lưu profile');

            const createdProfile = !isEditing ? payload.profile : null;
            resetForm();
            await fetchProfiles({ notifyParent: true });

            if (createdProfile) {
                setSaving(false);
                await syncProfile(createdProfile, {
                    label: `Dang kiem tra link va sync ${createdProfile.name}`,
                });
            }
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
            setIsMenuOpen(false);
            onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        }
    };

    const clearActiveProfile = async () => {
        setError('');
        try {
            const response = await fetch('/api/profiles/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile_id: null }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể bỏ chọn profile');

            notifyActiveProfile(null);
            setIsMenuOpen(false);
            onUsageChanged?.();
        } catch (err) {
            setError(err.message);
        }
    };

    const deleteProfile = async (profile) => {
        setProfileToDelete(profile);
    };

    const confirmDeleteProfile = async () => {
        if (!profileToDelete) return;

        const profile = profileToDelete;
        setDeletingId(profile.id);
        setError('');
        try {
            const response = await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể xoá profile');

            if (editingId === profile.id) resetForm();
            setProfileToDelete(null);
            await fetchProfiles({ notifyParent: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setDeletingId(null);
        }
    };

    const syncProfile = async (profile, options = {}) => {
        setSyncingId(profile.id);
        setError('');
        startSyncProgress(options.label || `Đồng bộ ${profile.name}`, profile.id);
        try {
            const response = await fetch(`/api/profiles/${profile.id}/sync`, { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Không thể sync profile');

            await fetchProfiles({ notifyParent: true });
            if (activeProfile?.id === profile.id) onUsageChanged?.();
            finishSyncProgress(formatSyncSummary(payload), payload.warning_count > 0 ? 'warning' : 'success');
            return payload;
        } catch (err) {
            setError(err.message);
            finishSyncProgress(err.message, 'failed');
            return null;
        } finally {
            setSyncingId(null);
        }
    };

    const syncAllProfiles = async ({ notifyUsageChanged = true } = {}) => {
        setSyncingId('all');
        setError('');
        startSyncProgress('Đang tự động đồng bộ các profile', 'all');

        try {
            const response = await fetch('/api/profiles/sync-all', { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Lỗi đồng bộ profile');

            await fetchProfiles({ showLoading: false });
            if (notifyUsageChanged && Number(payload.synced_count || 0) > 0) onUsageChanged?.();
            finishSyncProgress(formatSyncAllSummary(payload), Number(payload.failed_count || 0) > 0 ? 'warning' : 'success');
            return payload;
        } catch (err) {
            setError(err.message);
            finishSyncProgress(err.message, 'failed');
            return null;
        } finally {
            setSyncingId(null);
        }
    };

    const openUsedVideos = async (profile) => {
        setUsedModalProfile(profile);
        setUsedSearch('');
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

    useEffect(() => {
        if (!usedModalProfile) return;

        if (usedSearchDebounceRef.current) {
            clearTimeout(usedSearchDebounceRef.current);
        }

        usedSearchDebounceRef.current = setTimeout(async () => {
            setUsedLoading(true);
            setError('');

            try {
                const query = usedSearch.trim();
                const searchParam = query ? `&q=${encodeURIComponent(query)}` : '';
                const response = await fetch(`/api/profiles/${usedModalProfile.id}/used-videos?size=100${searchParam}`);
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || 'Khong the tai video da dung');

                setUsedVideos(payload.data || []);
                setUsedTotal(payload.total || 0);
            } catch (err) {
                setError(err.message);
            } finally {
                setUsedLoading(false);
            }
        }, 300);

        return () => {
            if (usedSearchDebounceRef.current) {
                clearTimeout(usedSearchDebounceRef.current);
                usedSearchDebounceRef.current = null;
            }
        };
    }, [usedSearch, usedModalProfile]);

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

    const renderUsedVideoSkeletons = () => (
        <div className="used-video-list" aria-label="Dang tai video da dung">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={`used-video-skeleton-${index}`} className="used-video-item used-video-skeleton">
                    <div className="used-video-thumb skeleton-block" />
                    <div className="used-video-body">
                        <div className="skeleton-line title" />
                        <div className="skeleton-line url" />
                        <div className="used-video-occurrences">
                            <span className="skeleton-pill" />
                            <span className="skeleton-pill short" />
                            <span className="skeleton-pill" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    const isAnySyncing = syncingId !== null;

    return (
        <>
            <div className="profile-menu-wrap" ref={menuRef}>
                <button
                    className={`profile-chip tour-profile ${isAnySyncing ? 'syncing' : ''}`}
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                    title="Chọn Usage Profile"
                >
                    <span className="profile-chip-label">Profile:</span>
                    <span className="profile-chip-name">{activeProfile?.name || 'Không'}</span>
                    {isAnySyncing ? <RefreshCw size={15} className="spin-icon" /> : <ChevronDown size={15} />}
                </button>

                {isMenuOpen && (
                    <div className="profile-dropdown">
                        <button
                            className={`profile-dropdown-item profile-dropdown-none ${!activeProfile ? 'active' : ''}`}
                            onClick={clearActiveProfile}
                            title="Không dùng profile"
                            aria-label="Không dùng profile"
                        >
                            <Circle size={15} className="profile-none-icon" />
                        </button>

                        {profiles.map((profile) => (
                            <button
                                key={profile.id}
                                className={`profile-dropdown-item ${activeProfile?.id === profile.id ? 'active' : ''}`}
                                onClick={() => selectProfile(profile)}
                            >
                                {activeProfile?.id === profile.id && <Check size={14} />}
                                <span>{profile.name}</span>
                            </button>
                        ))}

                        <div className="profile-dropdown-separator" />

                        <button
                            className="profile-dropdown-item manage"
                            onClick={() => {
                                setIsMenuOpen(false);
                                setIsOpen(true);
                            }}
                        >
                            <Edit3 size={14} />
                            <span>Quản lý profile</span>
                        </button>
                    </div>
                )}
            </div>

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

                        {syncProgress && (
                            <div className={`profile-sync-progress status-${syncProgress.status}`}>
                                <div className="profile-sync-progress-head">
                                    <RefreshCw size={16} className={syncProgress.status === 'running' ? 'spin-icon' : ''} />
                                    <div>
                                        <strong>{syncProgress.label}</strong>
                                        <span>{syncProgress.message || `${syncProgress.percent}%`}</span>
                                    </div>
                                    <b>{syncProgress.percent}%</b>
                                </div>
                                <div className="profile-sync-bar">
                                    <span style={{ width: `${syncProgress.percent}%` }} />
                                </div>
                            </div>
                        )}

                        {!isFormOpen ? (
                            <button
                                type="button"
                                className="profile-create-toggle"
                                onClick={() => setIsFormOpen(true)}
                            >
                                <Plus size={18} />
                                Tạo profile
                            </button>
                        ) : (
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
                        )}

                        <div className="profile-list">
                            {loading && <div className="profile-empty">Đang tải profile...</div>}
                            {!loading && profiles.length === 0 && (
                                <div className="profile-empty">
                                    <Plus size={20} />
                                    Chưa có profile nào. Bấm “Tạo profile” để thêm profile đầu tiên.
                                </div>
                            )}

                            {profiles.map((profile) => {
                                const isSyncing = syncingId === profile.id;

                                return (
                                    <div key={profile.id} className="profile-card">
                                        <div className="profile-card-main">
                                            <div className="profile-card-title">
                                                <span>{profile.name}</span>
                                            </div>
                                            <a href={profile.google_sheet_url} target="_blank" rel="noopener noreferrer" className="profile-sheet-link">
                                                Google Sheet <ExternalLink size={13} />
                                            </a>
                                            <div className="profile-meta">
                                                <span>{Number(profile.used_count || 0).toLocaleString('vi-VN')} videos</span>
                                                <span>{profile.tab_scope === 'all' ? 'Tất cả tabs' : 'Tab hiện tại'}</span>
                                                <span>Sync: {formatDateTime(profile.last_sync_at)}</span>
                                                <span className={`profile-sync-status status-${profile.sync_status}`}>{profile.sync_status}</span>
                                            </div>
                                            {profile.sync_error && <div className="profile-warning">{profile.sync_error}</div>}
                                        </div>
                                        <div className="profile-card-actions">
                                            <button onClick={() => syncProfile(profile)} disabled={isAnySyncing} title="Sync Google Sheet/Docs">
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

            {profileToDelete && (
                <div className="modal-overlay" onClick={() => setProfileToDelete(null)}>
                    <div className="modal-container profile-delete-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="profile-delete-icon">
                            <Trash2 size={24} />
                        </div>
                        <div className="modal-header profile-delete-header">
                            <h2>Xoá profile?</h2>
                            <p>
                                Profile <strong>{profileToDelete.name}</strong> sẽ bị xoá cùng cache video đã dùng của profile này.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="modal-btn-cancel"
                                onClick={() => setProfileToDelete(null)}
                                disabled={deletingId === profileToDelete.id}
                            >
                                Huỷ
                            </button>
                            <button
                                type="button"
                                className="modal-btn-confirm modal-btn-danger"
                                onClick={confirmDeleteProfile}
                                disabled={deletingId === profileToDelete.id}
                            >
                                {deletingId === profileToDelete.id ? 'Đang xoá...' : 'Xoá profile'}
                            </button>
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

                        <div className="used-video-search">
                            <input
                                value={usedSearch}
                                onChange={(event) => setUsedSearch(event.target.value)}
                                placeholder="Tim theo title, URL, video key hoac Google Doc..."
                                autoFocus
                            />
                            {usedSearch && (
                                <button type="button" onClick={() => setUsedSearch('')} title="Xoa tim kiem">
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        {usedLoading && renderUsedVideoSkeletons()}

                        {!usedLoading && usedVideos.length === 0 ? (
                            <div className="profile-empty">Không tìm thấy</div>
                        ) : !usedLoading ? (
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
                        ) : null}

                        {false && (usedLoading ? (
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
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
