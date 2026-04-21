'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, Moon, Highlighter, LogOut, Languages, Captions } from 'lucide-react';
import dynamic from 'next/dynamic';
import DataTable from '../components/DataTable';

const Joyride = dynamic(() => import('react-joyride'), { ssr: false });

export default function HomePageClient({ initialData }) {
  const [theme, setTheme] = useState('dark');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [searchMode, setSearchMode] = useState('or');
  const [translateEnabled, setTranslateEnabled] = useState(false);
  const [captionSearchEnabled, setCaptionSearchEnabled] = useState(false);
  const [runTour, setRunTour] = useState(false);

  const tourSteps = [
    {
      target: '.tour-search-mode',
      title: 'Bước 1/8: Chế độ Tìm kiếm',
      content: 'Chuyển đổi chế độ tìm kiếm: Một trong (OR) hoặc Tất cả (AND).',
      disableBeacon: true,
      disableScrolling: true,
    },
    {
      target: '.tour-highlight',
      title: 'Bước 2/8: Nổi bật Từ khóa',
      content: 'Bật/tắt tính năng làm nổi bật từ khóa trong kết quả',
      disableScrolling: true,
    },
    {
      target: '.tour-translate',
      title: 'Bước 3/8: Dịch Phân tích',
      content: 'Bật dịch Cốt truyện. Hãy bật lên và trỏ chuột vào cột phân tích của video.',
      disableScrolling: true,
    },
    {
      target: '.tour-caption',
      title: 'Bước 4/8: Tìm trong Phụ đề',
      content: 'Bật để tìm kiếm mở rộng bao gồm nội dung phụ đề (caption).',
      disableScrolling: true,
    },
    {
      target: '.tour-theme',
      title: 'Bước 5/8: Giao diện Tùy chỉnh',
      content: 'Đổi màu nền sáng/tối.',
      disableScrolling: true,
    },
    {
      target: '.search-input',
      title: 'Bước 6/8: Nhập Tìm kiếm',
      content: 'Nhập từ khóa và nhấn Enter (hoặc phẩy) để gộp nhiều từ khóa tìm kiếm.',
      disableScrolling: true,
    },
    {
      target: '.tour-filter',
      title: 'Bước 7/8: Bộ lọc Nâng cao',
      content: 'Lọc kết quả nâng cao.',
      disableScrolling: true,
    },
    {
      target: '.tour-add-channel',
      title: 'Bước 8/8: Thêm Kênh mới',
      content: 'Gửi yêu cầu thêm kênh YouTube mới vào hệ thống.',
      disableScrolling: true,
    }
  ];

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedHighlight = localStorage.getItem('highlightEnabled');
    const savedSearchMode = localStorage.getItem('searchMode');
    const savedTranslate = localStorage.getItem('translateEnabled');
    const savedCaptionSearch = localStorage.getItem('captionSearchEnabled');

    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    if (savedHighlight !== null) setHighlightEnabled(savedHighlight === 'true');
    if (savedSearchMode) setSearchMode(savedSearchMode);
    if (savedTranslate !== null) setTranslateEnabled(savedTranslate === 'true');
    if (savedCaptionSearch !== null) setCaptionSearchEnabled(savedCaptionSearch === 'true');

    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour) {
      setTimeout(() => setRunTour(true), 1000); // Wait for components to load
    }
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

  useEffect(() => {
    localStorage.setItem('captionSearchEnabled', captionSearchEnabled);
  }, [captionSearchEnabled]);

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

  const handleJoyrideCallback = (data) => {
    const { status } = data;
    const finishedStatuses = ['finished', 'skipped'];
    if (finishedStatuses.includes(status)) {
      setRunTour(false);
      localStorage.setItem('hasSeenTour', 'true');
    }
  };

  return (
    <div className="container">
      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous={true}
        showSkipButton={false}
        showProgress={false}
        hideCloseButton={true}
        disableOverlayClose={true}
        disableCloseOnEsc={true}
        disableScrollParentFix={true}
        callback={handleJoyrideCallback}
        styles={{
          options: {
            primaryColor: '#6366f1',
            zIndex: 10000,
            overlayColor: 'rgba(0, 0, 0, 0.7)',
          },
          tooltipContainer: {
            textAlign: 'left'
          },
          buttonNext: {
            borderRadius: '8px',
          },
          buttonBack: {
            marginRight: 10
          }
        }}
        locale={{
          back: 'Quay lại',
          close: 'Đóng',
          last: 'Hoàn thành',
          next: 'Tiếp theo',
        }}
      />
      <header className="header">
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="Wevic Logo" style={{ width: '40px', height: '40px', borderRadius: '10px' }} />
          <h1>Deep Video Search</h1>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="theme-toggle tour-search-mode"
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
            className="theme-toggle tour-highlight"
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
            className="theme-toggle tour-translate"
            onClick={() => setTranslateEnabled(!translateEnabled)}
            title={translateEnabled ? "Tắt Dịch Phân Tích" : "Bật Dịch Phân Tích (Hover 2s)"}
            style={{
              color: translateEnabled ? '#10b981' : 'inherit',
              borderColor: translateEnabled ? '#10b981' : 'var(--glass-border)'
            }}
          >
            <Languages size={20} />
          </button>
          <button
            className="theme-toggle tour-caption"
            onClick={() => setCaptionSearchEnabled(!captionSearchEnabled)}
            title={captionSearchEnabled ? "Tắt tìm trong Phụ đề" : "Bật tìm trong Phụ đề"}
            style={{
              color: captionSearchEnabled ? '#f59e0b' : 'inherit',
              borderColor: captionSearchEnabled ? '#f59e0b' : 'var(--glass-border)'
            }}
          >
            <Captions size={20} />
          </button>
          <button className="theme-toggle tour-theme" onClick={toggleTheme} title="Đổi giao diện">
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
          captionSearchEnabled={captionSearchEnabled}
          initialData={initialData}
        />
      </main>
    </div>
  );
}
