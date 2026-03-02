import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  return (
    <Router>
      <div className="container">
        <header className="header">
          <Link to="/" style={{ textDecoration: 'none' }}>
            <h1>Video cops nguồn</h1>
          </Link>
          <nav>
            <Link to="/admin" className="btn" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'none' }}>Admin Panel</Link>
          </nav>
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


