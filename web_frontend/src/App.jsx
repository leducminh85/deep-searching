import React from 'react';
import DataTable from './components/DataTable';

function App() {
  return (
    <div className="container">
      <header className="header">
        <h1>Data Explorer</h1>
      </header>

      <main>
        <DataTable />
      </main>
    </div>
  );
}

export default App;

