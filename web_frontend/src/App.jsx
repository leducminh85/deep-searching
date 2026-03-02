import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import DataTable from './components/DataTable';

function App() {
  return (
    <Router>
      <div className="container">
        <header className="header">
          <h1>Data Explorer</h1>
          <nav>
            <Link to="/" className="btn btn-secondary">Home</Link>
          </nav>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<DataTable />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
