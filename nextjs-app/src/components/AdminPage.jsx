'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    BadgeCheck,
    CheckCircle2,
    Copyright,
    ExternalLink,
    Eye,
    EyeOff,
    Loader2,
    Lock,
    MoreVertical,
    Plus,
    RefreshCcw,
    Search,
    ShieldCheck,
    Trash2,
    Video,
    Youtube,
} from 'lucide-react';

const STATUS_OPTIONS = [
    { value: 'normal', label: 'Binh thuong' },
    { value: 'copyright', label: 'Ban quyen' },
];

function formatDate(value) {
    if (!value) return 'Chua co';
    try {
        return new Intl.DateTimeFormat('vi-VN', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return 'Chua co';
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
            <button className="admin-status-icon copyright" onClick={onClick} title="Ban quyen - bam de doi">
                <Copyright size={18} />
            </button>
        );
    }

    return (
        <button className="admin-status-icon normal" onClick={onClick} title="Binh thuong - bam de doi">
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
    const [openMenuId, setOpenMenuId] = useState(null);
    const [videosState, setVideosState] = useState({ loading: false, videos: [], total: 0, page: 1 });

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
            if (!response.ok) throw new Error(payload.error || 'Khong the tai danh sach kenh');
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
            if (!response.ok) throw new Error(payload.error || 'Khong the tai video');
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
        const closeMenu = () => setOpenMenuId(null);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

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
            setAuthError(payload.error || 'Mat khau khong dung');
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
            if (!response.ok) throw new Error(payload.error || 'Khong the them kenh');
            setNotice(payload.message || 'Da them kenh');
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
            if (!response.ok) throw new Error(payload.error || 'Khong the import data.xlsx');
            setChannels(payload.channels || []);
            setNotice(`Da import ${payload.imported || 0} kenh tu data.xlsx. Dang lay logo cho ${payload.metadata_jobs_started || 0} kenh thieu metadata.`);
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
            if (!response.ok) throw new Error(payload.error || 'Khong the cap nhat kenh');
            await loadChannels({ silent: true });
        } catch (err) {
            setChannels(previous);
            setError(err.message);
        }
    };

    const handleRefreshChannel = async (channel) => {
        setNotice('');
        setError('');
        try {
            const response = await fetch(`/api/admin/channels/${channel.id}`, { method: 'POST' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Khong the sync kenh');
            setNotice(payload.message || 'Da bat dau sync kenh');
            await loadChannels();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteChannel = async (channel) => {
        const confirmed = window.confirm(`Xoa kenh "${channel.channel_name}" va toan bo video thuoc kenh nay?`);
        if (!confirmed) return;

        setNotice('');
        setError('');
        try {
            const response = await fetch(`/api/admin/channels/${channel.id}`, { method: 'DELETE' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Khong the xoa kenh');
            setNotice(`Da xoa ${payload.deleted_videos || 0} video cua kenh ${channel.channel_name}`);
            setSelectedChannelId(null);
            setVideosState({ loading: false, videos: [], total: 0, page: 1 });
            await loadChannels();
        } catch (err) {
            setError(err.message);
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
                    <p>Nhap mat khau quan tri de truy cap kenh va du lieu video.</p>
                    <form onSubmit={handleLogin} className="admin-login-form">
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="Mat khau admin"
                            autoFocus
                        />
                        {authError && <div className="admin-alert danger"><AlertCircle size={16} />{authError}</div>}
                        <button className="admin-primary-btn" type="submit">
                            <ShieldCheck size={18} />
                            Truy cap
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
                    <p className="admin-eyebrow">Channel Operations</p>
                    <h2>Quan ly kenh</h2>
                </div>
                <div className="admin-metrics">
                    <div><span>{totals.channels.toLocaleString('vi-VN')}</span><small>Kenh</small></div>
                    <div><span>{totals.videos.toLocaleString('vi-VN')}</span><small>Video DB</small></div>
                    <div><span>{totals.copyright.toLocaleString('vi-VN')}</span><small>Ban quyen</small></div>
                    <div><span>{totals.hidden.toLocaleString('vi-VN')}</span><small>Dang an</small></div>
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
                    <select value={channelStatus} onChange={(event) => setChannelStatus(event.target.value)}>
                        {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <button className="admin-primary-btn" disabled={savingChannel || !channelUrl.trim()}>
                        {savingChannel ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                        Them kenh
                    </button>
                </form>
                <div className="admin-search">
                    <Search size={18} />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Tim kenh, URL, status"
                    />
                </div>
                <button className="admin-secondary-btn" type="button" onClick={handleImportWorkbook} disabled={importingChannels}>
                    {importingChannels ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                    Import XLSX
                </button>
            </section>

            {notice && <div className="admin-alert success"><CheckCircle2 size={16} />{notice}</div>}
            {error && <div className="admin-alert danger"><AlertCircle size={16} />{error}</div>}

            <div className="admin-grid">
            <section className="admin-panel">
                <div className="admin-panel-header">
                    <h3>Danh sach kenh</h3>
                    <button className="admin-icon-btn" onClick={() => loadChannels()} title="Tai lai">
                        {loadingChannels ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
                    </button>
                </div>

                <div className="admin-table-wrap">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Kenh</th>
                                <th>Status</th>
                                <th>Video</th>
                                <th>URL</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredChannels.map((channel) => {
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
                                                        ID: {channel.channel_id || 'chua co'}
                                                    </div>
                                                    <div className="admin-channel-meta">
                                                        {channel.hidden ? 'An khoi web' : 'Dang hien thi'}
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
                                                <a className="admin-youtube-link" href={channel.channel_url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} title="Mo kenh tren YouTube">
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
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setOpenMenuId((current) => current === channel.id ? null : channel.id);
                                                    }}
                                                    title="Thao tac"
                                                >
                                                    <MoreVertical size={18} />
                                                </button>
                                                {openMenuId === channel.id && (
                                                    <div className="admin-action-menu">
                                                        <button onClick={() => handleRefreshChannel(channel)}>
                                                            <RefreshCcw size={16} />
                                                            Sync
                                                        </button>
                                                        <button onClick={() => patchChannel(channel, { hidden: !channel.hidden }, { hidden: !channel.hidden })}>
                                                            {channel.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                                                            {channel.hidden ? 'Hien tren web' : 'An khoi web'}
                                                        </button>
                                                        <button
                                                            className="danger"
                                                            onClick={() => handleDeleteChannel(channel)}
                                                        >
                                                            <Trash2 size={16} />
                                                            Remove
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!filteredChannels.length && (
                                <tr>
                                    <td colSpan="5" className="admin-empty">Khong co kenh phu hop</td>
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
                                Tai lai
                            </button>
                        </div>
                        {videosState.loading ? (
                            <div className="admin-empty-state">
                                <Loader2 className="spin" size={28} />
                                <span>Dang tai video tu database</span>
                            </div>
                        ) : (
                            <>
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
                                            <span>Kenh nay chua co video trong database</span>
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
                                            Truoc
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
                            </>
                        )}
                    </>
                ) : (
                    <>
                        <div className="admin-panel-header">
                            <h3>Video trong DB</h3>
                        </div>
                        <div className="admin-empty-state">
                            <Video size={28} />
                            <span>Chon mot kenh de xem video co san trong database</span>
                        </div>
                    </>
                )}
            </section>
            </div>

        </div>
    );
}
