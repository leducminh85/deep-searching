'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sun, Moon, Highlighter, LogOut, Languages, Captions, CircleHelp } from 'lucide-react';
import dynamic from 'next/dynamic';
import DataTable from '../components/DataTable';
import ProfileManager from '../components/ProfileManager';

const Joyride = dynamic(() => import('react-joyride'), { ssr: false });

export default function HomePageClient({ initialData, initialProfile = null }) {
  const [theme, setTheme] = useState('dark');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [searchMode, setSearchMode] = useState('or');
  const [translateEnabled, setTranslateEnabled] = useState(false);
  const [captionSearchEnabled, setCaptionSearchEnabled] = useState(false);
  const [activeProfile, setActiveProfile] = useState(initialProfile);
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);
  const [runTour, setRunTour] = useState(false);

  const tourSteps = [
    {
      target: '.tour-search-mode',
      title: 'Bước 1/9: Chế độ tìm kiếm',
      content: 'Chọn OR để tìm video khớp một trong các từ khoá, hoặc AND để chỉ lấy video khớp tất cả từ khoá. Đổi nút này không tự fetch lại dữ liệu.',
      disableBeacon: true,
    },
    {
      target: '.search-input',
      title: 'Bước 2/9: Nhập từ khoá',
      content: 'Nhập từ khoá rồi nhấn Enter hoặc dấu phẩy để tạo tag. Bấm nút tìm kiếm để áp dụng danh sách tag hiện tại.',
    },
    {
      target: '.tour-filter',
      title: 'Bước 3/9: Bộ lọc nâng cao',
      content: 'Mở bộ lọc để giới hạn kết quả theo lượt xem, ngày đăng hoặc kênh.',
    },
    {
      target: '.tour-profile',
      title: 'Bước 4/9: Usage Profile',
      content: 'Chọn profile để tự ẩn các video đã dùng. Dùng icon tròn rỗng màu đỏ để chuyển về trạng thái không dùng profile, hoặc vào “Quản lý profile” để tạo, sửa, sync và xoá profile.',
    },
    {
      target: '.tour-highlight',
      title: 'Bước 5/9: Highlight từ khoá',
      content: 'Bật/tắt highlight để làm nổi bật các từ khoá đang tìm trong tiêu đề và nội dung kết quả.',
    },
    {
      target: '.tour-translate',
      title: 'Bước 6/9: Dịch phân tích',
      content: 'Bật dịch rồi rê chuột vào phần phân tích/cốt truyện của video để xem bản dịch tiếng Việt.',
    },
    {
      target: '.tour-caption',
      title: 'Bước 7/9: Tìm trong phụ đề',
      content: 'Bật chế độ này để mở rộng tìm kiếm sang nội dung phụ đề/caption nếu video có dữ liệu caption.',
    },
    {
      target: '.tour-theme',
      title: 'Bước 8/9: Giao diện',
      content: 'Đổi nhanh giữa giao diện sáng và tối.',
    },
    {
      target: '.tour-add-channel',
      title: 'Bước 9/9: Thêm kênh mới',
      content: 'Gửi yêu cầu thêm kênh YouTube mới vào hệ thống để mở rộng nguồn tìm kiếm.',
    },
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

  const startTour = () => {
    setRunTour(false);
    window.setTimeout(() => setRunTour(true), 0);
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
        showSkipButton={true}
        showProgress={true}
        hideCloseButton={false}
        disableOverlayClose={false}
        disableCloseOnEsc={false}
        disableScrolling={true}
        disableScrollParentFix={true}
        scrollToFirstStep={false}
        spotlightPadding={8}
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
          },
          buttonSkip: {
            color: '#94a3b8',
          }
        }}
        locale={{
          back: 'Quay lại',
          close: 'Đóng',
          last: 'Hoàn thành',
          next: 'Tiếp theo',
          skip: 'Bỏ qua',
        }}
      />
      <header className="header">
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="Wevic Logo" style={{ width: '40px', height: '40px', borderRadius: '10px' }} />
          <h1>Deep Video Search</h1>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
          <button className="theme-toggle" onClick={startTour} title="Xem hướng dẫn">
            <CircleHelp size={20} />
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
          onToggleSearchMode={toggleSearchMode}
          translateEnabled={translateEnabled}
          captionSearchEnabled={captionSearchEnabled}
          hideUsedEnabled={true}
          activeProfile={activeProfile}
          profileControl={(
            <ProfileManager
              initialProfile={initialProfile}
              onActiveProfileChange={setActiveProfile}
              onUsageChanged={() => setUsageRefreshKey(prev => prev + 1)}
            />
          )}
          usageRefreshKey={usageRefreshKey}
          initialData={initialData}
        />
      </main>
    </div>
  );
}
