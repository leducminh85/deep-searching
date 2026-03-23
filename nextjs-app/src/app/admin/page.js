'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sun, Moon, LogOut } from 'lucide-react';
import AdminPage from '../../components/AdminPage';

export default function AdminPageRoute() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login';
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="Wevic Logo" style={{ width: '40px', height: '40px', borderRadius: '10px' }} />
          <h1>Deep Video Search</h1>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện">
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button className="theme-toggle" onClick={handleLogout} title="Đăng xuất" style={{ color: 'var(--accent-color)', borderColor: 'rgba(244, 63, 94, 0.2)' }}>
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main>
        <AdminPage />
      </main>
    </div>
  );
}
