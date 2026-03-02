import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import DataTable from './components/DataTable';
import AdminPage from './components/AdminPage';

function App() {
  return (
    <Router>
      <div className="container">
        <header className="header">
          <h1>Data Explorer</h1>
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


