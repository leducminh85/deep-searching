'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
    DatabaseBackup,
    Loader2,
    Lock,
    LogOut,
    Moon,
    ShieldCheck,
    Sun,
    Users,
    Youtube,
} from 'lucide-react';

const NAV_ITEMS = [
    { href: '/admin/channels', label: 'Kênh & Video', description: 'Nguồn dữ liệu', icon: Youtube },
    { href: '/admin/accounts', label: 'Tài khoản', description: 'Quản trị viên', icon: Users },
    { href: '/admin/backups', label: 'Sao lưu', description: 'Phục hồi dữ liệu', icon: DatabaseBackup },
];

export default function AdminLayoutClient({ children }) {
    const pathname = usePathname();
    const router = useRouter();
    const [theme, setTheme] = useState('dark');
    const [checkingSession, setCheckingSession] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);

    const activeNav = useMemo(() => {
        return NAV_ITEMS.find((item) => (
            pathname?.startsWith(item.href)
        )) || NAV_ITEMS[0];
    }, [pathname]);

    useEffect(() => {
        const saved = localStorage.getItem('theme') || 'dark';
        setTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        let active = true;
        fetch('/api/admin/session')
            .then((res) => res.json())
            .then((payload) => {
                if (active) setAuthenticated(Boolean(payload.authenticated));
            })
            .catch(() => {
                if (active) setAuthenticated(false);
            })
            .finally(() => {
                if (active) setCheckingSession(false);
            });

        return () => { active = false; };
    }, []);

    const handleLogin = async (event) => {
        event.preventDefault();
        setLoggingIn(true);
        setAuthError('');

        try {
            const response = await fetch('/api/admin/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const payload = await response.json();

            if (!response.ok) {
                setAuthError(payload.error || 'Mật khẩu admin không đúng');
                return;
            }

            setAuthenticated(true);
            setPassword('');
            router.refresh();
        } catch {
            setAuthError('Không thể đăng nhập lúc này. Vui lòng thử lại sau.');
        } finally {
            setLoggingIn(false);
        }
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/admin/session', { method: 'DELETE' });
        } finally {
            setAuthenticated(false);
            router.push('/admin');
            router.refresh();
        }
    };

    const toggleTheme = () => {
        setTheme((current) => (current === 'light' ? 'dark' : 'light'));
    };

    if (checkingSession) {
        return (
            <div className="container admin-page">
                <div className="admin-shell admin-centered">
                    <Loader2 className="spin" size={24} />
                </div>
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="container admin-page">
                <div className="admin-shell admin-centered">
                    <section className="admin-login-panel">
                        <div className="admin-login-icon"><Lock size={24} /></div>
                        <h2>Khu vực quản trị</h2>
                        <p>Nhập mật khẩu admin để truy cập khu vực quản trị.</p>
                        <form onSubmit={handleLogin} className="admin-login-form">
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                placeholder="Mật khẩu"
                                autoComplete="current-password"
                                autoFocus
                            />
                            {authError && <div className="admin-alert danger">{authError}</div>}
                            <button className="admin-primary-btn" type="submit" disabled={loggingIn || !password}>
                                {loggingIn ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
                                Truy cập
                            </button>
                        </form>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <div className="container admin-page">
            <div className="admin-app-shell">
                <aside className="admin-sidebar">
                    <Link href="/" className="admin-brand">
                        <img src="/logo.png" alt="Deep Video Search" />
                        <span className="admin-brand-copy">
                            <strong>Deep Video Search</strong>
                            <small>Admin workspace</small>
                        </span>
                    </Link>
                    <div className="admin-sidebar-section">Điều hướng</div>
                    <nav className="admin-sidebar-nav" aria-label="Điều hướng quản trị">
                        {NAV_ITEMS.map(({ href, label, description, icon: Icon }) => {
                            const active = pathname?.startsWith(href);
                            return (
                                <Link key={href} href={href} className={active ? 'active' : ''}>
                                    <Icon size={19} />
                                    <span>
                                        <strong>{label}</strong>
                                        <small>{description}</small>
                                    </span>
                                </Link>
                            );
                        })}
                    </nav>
                </aside>

                <div className="admin-main">
                    <header className="admin-topbar">
                        <div>
                            <p className="admin-eyebrow">Admin / {activeNav.description}</p>
                            <h1>{activeNav.label}</h1>
                        </div>
                        <div className="admin-topbar-actions">
                            <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện" aria-label="Đổi giao diện">
                                {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                            </button>
                            <button className="theme-toggle admin-logout-btn" onClick={handleLogout} title="Đăng xuất" aria-label="Đăng xuất">
                                <LogOut size={20} />
                            </button>
                        </div>
                    </header>
                    <main className="admin-content">{children}</main>
                </div>
            </div>
        </div>
    );
}
