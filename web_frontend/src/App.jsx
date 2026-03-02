import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  return (
    <Router>
      <div className="container">
        <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>Video cops nguồn</h1>
          </Link>
          <nav>
            <Link to="/admin" style={{ textDecoration: 'none', color: '#3b82f6', fontWeight: 500 }}>Admin Panel</Link>
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


