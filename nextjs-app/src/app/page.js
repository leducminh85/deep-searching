'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, Moon, Highlighter, LogOut, Languages } from 'lucide-react';
import DataTable from '../components/DataTable';

export default function HomePage() {
  const [theme, setTheme] = useState('dark');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [searchMode, setSearchMode] = useState('or');
  const [translateEnabled, setTranslateEnabled] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedHighlight = localStorage.getItem('highlightEnabled');
    const savedSearchMode = localStorage.getItem('searchMode');
    const savedTranslate = localStorage.getItem('translateEnabled');

    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    if (savedHighlight !== null) setHighlightEnabled(savedHighlight === 'true');
    if (savedSearchMode) setSearchMode(savedSearchMode);
    if (savedTranslate !== null) setTranslateEnabled(savedTranslate === 'true');
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('highlightEnabled', highlightEnabled);
  }, [highlightEnabled]);

  useEffect(() => {
    localStorage.setItem('searchMode', searchMode);
  }, [searchMode]);

  useEffect(() => {
    localStorage.setItem('translateEnabled', translateEnabled);
  }, [translateEnabled]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleSearchMode = () => {
    setSearchMode(prev => (prev === 'or' ? 'and' : 'or'));
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
          <button
            className="theme-toggle"
            onClick={toggleSearchMode}
            title={searchMode === 'or' ? "Chế độ tìm kiếm: Một trong các từ khóa (OR)" : "Chế độ tìm kiếm: Tất cả từ khóa (AND)"}
            style={{
              fontSize: '0.75rem',
              fontWeight: 'bold',
              padding: '0 0.75rem',
              minWidth: '60px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: searchMode === 'and' ? 'var(--primary-color)' : 'transparent',
              color: searchMode === 'and' ? 'white' : 'var(--text-color)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {searchMode.toUpperCase()}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setHighlightEnabled(!highlightEnabled)}
            title={highlightEnabled ? "Tắt Highlight" : "Bật Highlight"}
            style={{
              color: highlightEnabled ? 'var(--primary-color)' : 'inherit',
              borderColor: highlightEnabled ? 'var(--primary-color)' : 'var(--glass-border)'
            }}
          >
            <Highlighter size={20} />
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTranslateEnabled(!translateEnabled)}
            title={translateEnabled ? "Tắt Dịch Phân Tích" : "Bật Dịch Phân Tích (Hover 2s)"}
            style={{
              color: translateEnabled ? '#10b981' : 'inherit',
              borderColor: translateEnabled ? '#10b981' : 'var(--glass-border)'
            }}
          >
            <Languages size={20} />
          </button>
          <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện">
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button className="theme-toggle" onClick={handleLogout} title="Đăng xuất" style={{ color: 'var(--accent-color)', borderColor: 'rgba(244, 63, 94, 0.2)' }}>
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main>
        <DataTable 
          highlightEnabled={highlightEnabled} 
          searchMode={searchMode} 
          translateEnabled={translateEnabled} 
        />
      </main>
    </div>
  );
}
