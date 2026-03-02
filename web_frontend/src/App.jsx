import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

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
          <Link to="/" style={{ textDecoration: 'none' }}>
            <h1>Video cops nguồn</h1>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="theme-toggle" onClick={toggleTheme} title="Đổi giao diện">
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <nav>
              <Link to="/admin" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-color)', boxShadow: 'none' }}>Admin Panel</Link>
            </nav>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<DataTable />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;


