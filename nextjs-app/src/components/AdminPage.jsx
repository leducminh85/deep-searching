'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    ArrowUpDown,
    BadgeCheck,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Copyright,
    ExternalLink,
    Eye,
    EyeOff,
    Loader2,
    Lock,
    MoreVertical,
    Pencil,
    Plus,
    RefreshCcw,
    Search,
    ShieldCheck,
    Trash2,
    Video,
    Youtube,
} from 'lucide-react';

const STATUS_OPTIONS = [
    { value: 'normal', label: 'Bình thường' },
    { value: 'copyright', label: 'Bản quyền' },
];

const STATUS_RANK = {
    normal: 0,
    copyright: 1,
};

function formatDate(value) {
    if (!value) return 'Chưa có';
    try {
        return new Intl.DateTimeFormat('vi-VN', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return 'Chưa có';
    }
}

function initials(name = '') {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'CH';
}

function channelImage(channel) {
    return channel.channel_thumbnail || '';
}

function StatusIcon({ status, onClick }) {
    if (status === 'copyright') {
        return (
            <button className="admin-status-icon copyright" onClick={onClick} title="Bản quyền - bấm để đổi">
                <Copyright size={18} />
            </button>
        );
    }

    return (
        <button className="admin-status-icon normal" onClick={onClick} title="Bình thường - bấm để đổi">
            <BadgeCheck size={18} />
        </button>
    );
}

export default function AdminPage() {
    const [authenticated, setAuthenticated] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [channels, setChannels] = useState([]);
    const [loadingChannels, setLoadingChannels] = useState(false);
    const [channelUrl, setChannelUrl] = useState('');
    const [channelStatus, setChannelStatus] = useState('normal');
    const [savingChannel, setSavingChannel] = useState(false);
    const [importingChannels, setImportingChannels] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [selectedChannelId, setSelectedChannelId] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [openMenuId, setOpenMenuId] = useState(null);
    const [menuPosition, setMenuPosition] = useState(null);
    const [editingChannel, setEditingChannel] = useState(null);
    const [editChannelUrl, setEditChannelUrl] = useState('');
    const [savingChannelUrl, setSavingChannelUrl] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [videosState, setVideosState] = useState({ loading: false, videos: [], total: 0, page: 1 });

    const toast = error
        ? { type: 'danger', icon: <AlertCircle size={18} />, message: error }
        : notice
            ? { type: 'success', icon: <CheckCircle2 size={18} />, message: notice }
            : null;

    const selectedChannel = useMemo(
        () => channels.find((channel) => String(channel.id) === String(selectedChannelId)) || null,
        [channels, selectedChannelId]
    );

    const filteredChannels = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return channels;
        return channels.filter((channel) => (
            channel.channel_name?.toLowerCase().includes(keyword)
            || channel.channel_url?.toLowerCase().includes(keyword)
            || channel.status?.toLowerCase().includes(keyword)
        ));
    }, [channels, query]);

    const sortedChannels = useMemo(() => {
        if (!sortConfig.key) return filteredChannels;

        const direction = sortConfig.direction === 'desc' ? -1 : 1;
        return [...filteredChannels].sort((left, right) => {
            if (sortConfig.key === 'name') {
                return direction * String(left.channel_name || '').localeCompare(
                    String(right.channel_name || ''),
                    'vi',
                    { sensitivity: 'base' }
                );
            }

            if (sortConfig.key === 'status') {
                const leftRank = STATUS_RANK[left.status] ?? 99;
                const rightRank = STATUS_RANK[right.status] ?? 99;
                if (leftRank !== rightRank) return direction * (leftRank - rightRank);
                return direction * String(left.channel_name || '').localeCompare(String(right.channel_name || ''), 'vi', { sensitivity: 'base' });
            }

            if (sortConfig.key === 'videos') {
                const videoDiff = Number(left.video_count || 0) - Number(right.video_count || 0);
                if (videoDiff !== 0) return direction * videoDiff;
                return String(left.channel_name || '').localeCompare(String(right.channel_name || ''), 'vi', { sensitivity: 'base' });
            }

            return 0;
        });
    }, [filteredChannels, sortConfig]);

    const totals = useMemo(() => channels.reduce((acc, channel) => {
        acc.channels += 1;
        acc.videos += Number(channel.video_count || 0);
        if (channel.status === 'copyright') acc.copyright += 1;
        if (channel.hidden) acc.hidden += 1;
        return acc;
    }, { channels: 0, videos: 0, copyright: 0, hidden: 0 }), [channels]);

    const loadChannels = async ({ silent = false } = {}) => {
        if (!silent) setLoadingChannels(true);
        setError('');
        try {
            const response = await fetch('/api/admin/channels');
            if (response.status === 401) {
                setAuthenticated(false);
                return;
            }
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể tải danh sách kênh');
            setChannels(payload.channels || []);
            if (!selectedChannelId && payload.channels?.length) {
                setSelectedChannelId(payload.channels[0].id);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            if (!silent) setLoadingChannels(false);
        }
    };

    const loadVideos = async (channelId, page = 1) => {
        if (!channelId) return;
        setVideosState((prev) => ({ ...prev, loading: true }));
        try {
            const response = await fetch(`/api/admin/channels/${channelId}/videos?page=${page}&size=12`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể tải video');
            setVideosState({
                loading: false,
                videos: payload.videos || [],
                total: payload.total || 0,
                page: payload.page || 1,
            });
        } catch (err) {
            setVideosState({ loading: false, videos: [], total: 0, page: 1 });
            setError(err.message);
        }
    };

    useEffect(() => {
        let active = true;
        fetch('/api/admin/session')
            .then((res) => res.json())
            .then((payload) => {
                if (!active) return;
                setAuthenticated(Boolean(payload.authenticated));
                if (payload.authenticated) loadChannels();
            })
            .finally(() => {
                if (active) setCheckingSession(false);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (authenticated && selectedChannelId) {
            loadVideos(selectedChannelId, 1);
        }
    }, [authenticated, selectedChannelId]);

    useEffect(() => {
        if (!authenticated) return undefined;
        const timer = window.setInterval(() => loadChannels({ silent: true }), 8000);
        return () => window.clearInterval(timer);
    }, [authenticated, selectedChannelId]);

    useEffect(() => {
        const closeMenu = () => {
            setOpenMenuId(null);
            setMenuPosition(null);
        };
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    useEffect(() => {
        if (!notice && !error) return undefined;
        const timer = window.setTimeout(() => {
            setNotice('');
            setError('');
        }, error ? 5200 : 4200);
        return () => window.clearTimeout(timer);
    }, [notice, error]);

    const openChannelMenu = (event, channel) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const width = 208;
        const height = 184;
        const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
        const top = rect.bottom + height > window.innerHeight - 12
            ? Math.max(12, rect.top - height - 8)
            : rect.bottom + 8;

        setMenuPosition({ top, left });
        setOpenMenuId((current) => current === channel.id ? null : channel.id);
    };

    const openEditChannel = (channel) => {
        setOpenMenuId(null);
        setMenuPosition(null);
        setEditingChannel(channel);
        setEditChannelUrl(channel.channel_url || channel.source_channel_url || '');
    };

    const handleSort = (key) => {
        setSortConfig((current) => {
            if (current.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: key === 'videos' ? 'desc' : 'asc' };
        });
    };

    const sortIcon = (key) => {
        if (sortConfig.key !== key) return <ArrowUpDown size={14} />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={15} /> : <ChevronDown size={15} />;
    };

    const handleLogin = async (event) => {
        event.preventDefault();
        setAuthError('');
        const response = await fetch('/api/admin/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const payload = await response.json();
        if (!response.ok) {
            setAuthError(payload.error || 'Mật khẩu không đúng');
            return;
        }
        setAuthenticated(true);
        setPassword('');
        loadChannels();
    };

    const handleAddChannel = async (event) => {
        event.preventDefault();
        setSavingChannel(true);
        setNotice('');
        setError('');
        try {
            const response = await fetch('/api/admin/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel_url: channelUrl,
                    status: channelStatus,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể thêm kênh');
            setNotice(payload.message || 'Đã thêm kênh');
            setChannelUrl('');
            setSelectedChannelId(payload.channel?.id || selectedChannelId);
            await loadChannels();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingChannel(false);
        }
    };

    const handleImportWorkbook = async () => {
        setImportingChannels(true);
        setNotice('');
        setError('');
        try {
            const response = await fetch('/api/admin/channels/import', { method: 'POST' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể import data.xlsx');
            setChannels(payload.channels || []);
            setNotice(`Đã import ${payload.imported || 0} kênh từ data.xlsx. Đang lấy logo cho ${payload.metadata_jobs_started || 0} kênh thiếu metadata.`);
        } catch (err) {
            setError(err.message);
        } finally {
            setImportingChannels(false);
        }
    };

    const patchChannel = async (channel, body, optimistic) => {
        setError('');
        const previous = channels;
        if (optimistic) {
            setChannels((items) => items.map((item) => (
                item.id === channel.id ? { ...item, ...optimistic } : item
            )));
        }
        try {
            const response = await fetch(`/api/admin/channels/${channel.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể cập nhật kênh');
            await loadChannels({ silent: true });
        } catch (err) {
            setChannels(previous);
            setError(err.message);
        }
    };

    const handleSaveChannelUrl = async (event) => {
        event.preventDefault();
        if (!editingChannel) return;

        setSavingChannelUrl(true);
        setNotice('');
        setError('');
        try {
            const response = await fetch(`/api/admin/channels/${editingChannel.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_url: editChannelUrl }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể cập nhật URL kênh');
            setNotice('Đã cập nhật URL. Đang fetch lại logo, tên kênh và ID.');
            setEditingChannel(null);
            setEditChannelUrl('');
            await loadChannels();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingChannelUrl(false);
        }
    };

    const handleRefreshChannel = async (channel) => {
        setOpenMenuId(null);
        setMenuPosition(null);
        setNotice('');
        setError('');
        try {
            const response = await fetch(`/api/admin/channels/${channel.id}`, { method: 'POST' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Không thể sync kênh');
            setNotice(payload.message || 'Đã bắt đầu sync kênh');
            await loadChannels();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteChannel = async (channel) => {
        setOpenMenuId(null);
        setMenuPosition(null);
        setConfirmModal({
            title: 'Xóa kênh?',
            message: `Xóa kênh "${channel.channel_name}" và toàn bộ video thuộc kênh này?`,
            confirmLabel: 'Xóa kênh',
            danger: true,
            onConfirm: async () => {
                setNotice('');
                setError('');
                const response = await fetch(`/api/admin/channels/${channel.id}`, { method: 'DELETE' });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Không thể xóa kênh');
                setNotice(`Đã xóa ${payload.deleted_videos || 0} video của kênh ${channel.channel_name}`);
                setSelectedChannelId(null);
                setVideosState({ loading: false, videos: [], total: 0, page: 1 });
                await loadChannels();
            },
        });
    };

    const runConfirmAction = async () => {
        if (!confirmModal?.onConfirm) return;
        setConfirmBusy(true);
        try {
            await confirmModal.onConfirm();
            setConfirmModal(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setConfirmBusy(false);
        }
    };

    if (checkingSession) {
        return (
            <div className="admin-shell admin-centered">
                <Loader2 className="spin" size={24} />
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="admin-shell admin-centered">
                <section className="admin-login-panel">
                    <div className="admin-login-icon"><Lock size={24} /></div>
                    <h2>Admin Console</h2>
                    <p>Nhập mật khẩu quản trị để truy cập kênh và dữ liệu video.</p>
                    <form onSubmit={handleLogin} className="admin-login-form">
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="Mật khẩu admin"
                            autoFocus
                        />
                        {authError && <div className="admin-alert danger"><AlertCircle size={16} />{authError}</div>}
                        <button className="admin-primary-btn" type="submit">
                            <ShieldCheck size={18} />
                            Truy cập
                        </button>
                    </form>
                </section>
            </div>
        );
    }

    return (
        <div className="admin-console">
            <section className="admin-overview">
                <div>
                    <p className="admin-eyebrow">Admin</p>
                    <h2>Quản lý kênh</h2>
                </div>
                <div className="admin-metrics">
                    <div><span>{totals.channels.toLocaleString('vi-VN')}</span><small>Kênh</small></div>
                    <div><span>{totals.videos.toLocaleString('vi-VN')}</span><small>Video DB</small></div>
                    <div><span>{totals.copyright.toLocaleString('vi-VN')}</span><small>Bản quyền</small></div>
                    <div><span>{totals.hidden.toLocaleString('vi-VN')}</span><small>Đang ẩn</small></div>
                </div>
            </section>

            <section className="admin-actions-band">
                <form onSubmit={handleAddChannel} className="admin-add-channel">
                    <Youtube size={20} />
                    <input
                        value={channelUrl}
                        onChange={(event) => setChannelUrl(event.target.value)}
                        placeholder="https://www.youtube.com/@channel"
                    />
                    {/* <select value={channelStatus} onChange={(event) => setChannelStatus(event.target.value)}>
                        {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select> */}
                    <button className="admin-primary-btn" disabled={savingChannel || !channelUrl.trim()}>
                        {savingChannel ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                        Thêm kênh
                    </button>
                </form>
                <div className="admin-search">
                    <Search size={18} />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Tìm kênh, URL, trạng thái"
                    />
                </div>
                {/* <button className="admin-secondary-btn" type="button" onClick={handleImportWorkbook} disabled={importingChannels}>
                    {importingChannels ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                    Import XLSX
                </button> */}
            </section>

            {toast && (
                <div className={`admin-toast ${toast.type}`} role="status" aria-live="polite">
                    {toast.icon}
                    <span>{toast.message}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setNotice('');
                            setError('');
                        }}
                        aria-label="Đóng thông báo"
                    >
                        ×
                    </button>
                </div>
            )}

            <div className="admin-grid">
            <section className="admin-panel">
                <div className="admin-panel-header">
                    <h3>Danh sách kênh</h3>
                    <button className="admin-icon-btn" onClick={() => loadChannels()} title="Tải lại">
                        {loadingChannels ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
                    </button>
                </div>

                <div className="admin-table-wrap">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>
                                    <button className={`admin-sort-header ${sortConfig.key === 'name' ? 'active' : ''}`} type="button" onClick={() => handleSort('name')}>
                                        Kênh
                                        {sortIcon('name')}
                                    </button>
                                </th>
                                <th>
                                    <button className={`admin-sort-header ${sortConfig.key === 'status' ? 'active' : ''}`} type="button" onClick={() => handleSort('status')}>
                                        Trạng thái
                                        {sortIcon('status')}
                                    </button>
                                </th>
                                <th>
                                    <button className={`admin-sort-header ${sortConfig.key === 'videos' ? 'active' : ''}`} type="button" onClick={() => handleSort('videos')}>
                                        Video
                                        {sortIcon('videos')}
                                    </button>
                                </th>
                                <th>URL</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedChannels.map((channel) => {
                                const avatar = channelImage(channel);
                                return (
                                    <tr
                                        key={channel.id}
                                        className={`${String(selectedChannelId) === String(channel.id) ? 'selected' : ''} ${channel.hidden ? 'is-hidden' : ''}`}
                                        onClick={() => setSelectedChannelId(channel.id)}
                                    >
                                        <td>
                                            <div className="admin-channel-cell">
                                                <div className="admin-channel-avatar">
                                                    {avatar ? <img src={avatar} alt="" /> : <span>{initials(channel.channel_name)}</span>}
                                                </div>
                                                <div>
                                                    <div className="admin-channel-name">{channel.channel_name}</div>
                                                    <div className="admin-channel-meta">
                                                        {channel.channel_id || 'chưa có'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td onClick={(event) => event.stopPropagation()}>
                                            <StatusIcon
                                                status={channel.status}
                                                onClick={() => patchChannel(
                                                    channel,
                                                    { status: channel.status === 'copyright' ? 'normal' : 'copyright' },
                                                    { status: channel.status === 'copyright' ? 'normal' : 'copyright' }
                                                )}
                                            />
                                        </td>
                                        <td>{Number(channel.video_count || 0).toLocaleString('vi-VN')}</td>
                                        <td>
                                            {channel.channel_url ? (
                                                <a className="admin-youtube-link" href={channel.channel_url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} title="Mở kênh trên YouTube">
                                                    <ExternalLink size={17} />
                                                </a>
                                            ) : (
                                                <span className="admin-muted">-</span>
                                            )}
                                        </td>
                                        <td>
                                            <div className="admin-menu-wrap" onClick={(event) => event.stopPropagation()}>
                                                <button
                                                    className="admin-icon-btn"
                                                    onClick={(event) => openChannelMenu(event, channel)}
                                                    title="Thao tác"
                                                >
                                                    <MoreVertical size={18} />
                                                </button>
                                                {openMenuId === channel.id && (
                                                    <div className="admin-action-menu" style={menuPosition || undefined}>
                                                        <button type="button" onClick={() => openEditChannel(channel)}>
                                                            <Pencil size={16} />
                                                            Sửa
                                                        </button>
                                                        <button type="button" onClick={() => handleRefreshChannel(channel)}>
                                                            <RefreshCcw size={16} />
                                                            Đồng bộ
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setOpenMenuId(null);
                                                                setMenuPosition(null);
                                                                patchChannel(channel, { hidden: !channel.hidden }, { hidden: !channel.hidden });
                                                            }}
                                                        >
                                                            {channel.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                                                            {channel.hidden ? 'Hiện trên web' : 'Ẩn khỏi web'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="danger"
                                                            onClick={() => handleDeleteChannel(channel)}
                                                        >
                                                            <Trash2 size={16} />
                                                            Xóa
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!sortedChannels.length && (
                                <tr>
                                    <td colSpan="5" className="admin-empty">Không có kênh phù hợp</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="admin-panel admin-video-panel">
                {selectedChannel ? (
                    <>
                        <div className="admin-panel-header">
                            <div>
                                <h3>Video trong DB</h3>
                                <p>{selectedChannel.channel_name} - {videosState.total.toLocaleString('vi-VN')} video</p>
                            </div>
                            <button className="admin-secondary-btn" onClick={() => loadVideos(selectedChannel.id, videosState.page)}>
                                <RefreshCcw size={16} />
                                Tải lại
                            </button>
                        </div>
                        {videosState.loading ? (
                            <div className="admin-video-body">
                            <div className="admin-empty-state">
                                <Loader2 className="spin" size={28} />
                                <span>Đang tải video từ database</span>
                            </div>
                            </div>
                        ) : (
                            <div className="admin-video-body">
                                <div className="admin-video-list compact">
                                    {videosState.videos.map((video) => (
                                        <a key={video.id} className="admin-video-row" href={video.url} target="_blank" rel="noopener noreferrer">
                                            <img src={video.thumbnail || '/logo.png'} alt="" />
                                            <div>
                                                <strong>{video.title || 'Untitled'}</strong>
                                                <span>{Number(video.views || 0).toLocaleString('vi-VN')} views - {formatDate(video.date_published)}</span>
                                            </div>
                                            <ExternalLink size={15} />
                                        </a>
                                    ))}
                                    {!videosState.videos.length && (
                                        <div className="admin-empty-state">
                                            <Video size={28} />
                                            <span>Kênh này chưa có video trong database</span>
                                        </div>
                                    )}
                                </div>
                                {videosState.total > 12 && (
                                    <div className="admin-pagination">
                                        <button
                                            className="admin-secondary-btn"
                                            disabled={videosState.page <= 1}
                                            onClick={() => loadVideos(selectedChannel.id, videosState.page - 1)}
                                        >
                                            Trước
                                        </button>
                                        <span>Trang {videosState.page}</span>
                                        <button
                                            className="admin-secondary-btn"
                                            disabled={videosState.page * 12 >= videosState.total}
                                            onClick={() => loadVideos(selectedChannel.id, videosState.page + 1)}
                                        >
                                            Sau
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <div className="admin-panel-header">
                            <h3>Video trong DB</h3>
                        </div>
                        <div className="admin-video-body">
                        <div className="admin-empty-state">
                            <Video size={28} />
                            <span>Chọn một kênh để xem video có sẵn trong database</span>
                        </div>
                        </div>
                    </>
                )}
            </section>
            </div>

            {editingChannel && (
                <div className="modal-overlay admin-modal-overlay" onClick={() => setEditingChannel(null)}>
                    <form className="modal-container admin-modal" onSubmit={handleSaveChannelUrl} onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header admin-modal-header">
                            <h2>Sửa URL kênh</h2>
                            <p>{editingChannel.channel_name}</p>
                        </div>
                        <label className="admin-field">
                            <span>URL kênh YouTube</span>
                            <input
                                value={editChannelUrl}
                                onChange={(event) => setEditChannelUrl(event.target.value)}
                                placeholder="https://www.youtube.com/@channel"
                                autoFocus
                            />
                        </label>
            
                        <div className="modal-footer">
                            <button className="modal-btn-cancel" type="button" onClick={() => setEditingChannel(null)}>
                                Hủy
                            </button>
                            <button className="modal-btn-confirm" type="submit" disabled={savingChannelUrl || !editChannelUrl.trim()}>
                                {savingChannelUrl ? <Loader2 className="spin" size={16} /> : null}
                                Lưu
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {confirmModal && (
                <div className="modal-overlay admin-modal-overlay" onClick={() => !confirmBusy && setConfirmModal(null)}>
                    <section className="modal-container admin-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header admin-modal-header">
                            <h2>{confirmModal.title}</h2>
                            <p>{confirmModal.message}</p>
                        </div>
                        <div className="modal-footer">
                            <button className="modal-btn-cancel" type="button" disabled={confirmBusy} onClick={() => setConfirmModal(null)}>
                                Hủy
                            </button>
                            <button
                                className={`modal-btn-confirm ${confirmModal.danger ? 'danger' : ''}`}
                                type="button"
                                disabled={confirmBusy}
                                onClick={runConfirmAction}
                            >
                                {confirmBusy ? <Loader2 className="spin" size={16} /> : null}
                                {confirmModal.confirmLabel || 'Xác nhận'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
