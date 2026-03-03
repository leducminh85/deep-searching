import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Moon, Highlighter } from 'lucide-react';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [highlightEnabled, setHighlightEnabled] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <Router>
      <div className="container">
        <header className="header">
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/logo.png" alt="Wevic Logo" style={{ width: '40px', height: '40px', borderRadius: '10px' }} />
            <h1>Tổng hợp video nguồn</h1>

          </Link>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className="theme-toggle"
              onClick={() => setHighlightEnabled(!highlightEnabled)}
              title={highlightEnabled ? "Tắt Highlight" : "Bật Highlight"}
              style={{
                marginRight: '0.5rem',
                color: highlightEnabled ? 'var(--primary-color)' : 'inherit',
                borderColor: highlightEnabled ? 'var(--primary-color)' : 'var(--glass-border)'
              }}
            >
              <Highlighter size={20} />
            </button>
            <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện">
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <nav>
              {/* <Link to="/admin" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-color)', boxShadow: 'none', color: 'var(--text-color)' }}>Admin Panel</Link> */}
            </nav>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<DataTable highlightEnabled={highlightEnabled} />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;


