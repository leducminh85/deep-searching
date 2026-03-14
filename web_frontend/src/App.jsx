import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Moon, Highlighter } from 'lucide-react';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [searchMode, setSearchMode] = useState('or'); // 'or' or 'and'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleSearchMode = () => {
    setSearchMode(prev => (prev === 'or' ? 'and' : 'or'));
  };

  return (
    <Router>
      <div className="container">
        <header className="header">
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
            <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện">
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<DataTable highlightEnabled={highlightEnabled} searchMode={searchMode} />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;


