import React, { useState, useEffect, useMemo } from 'react';
import { Youtube } from 'lucide-react';

const DataTable = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [visibleRows, setVisibleRows] = useState(30);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/data');
            if (!response.ok) throw new Error('Failed to fetch data from server');
            const result = await response.json();
            setData(result.data || []);
            setVisibleRows(30);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('password', 'admin');
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upload failed');
            }

            // After uploading, fetch the latest data from server
            await fetchData();
        } catch (err) {
            setError(err.message || 'Error uploading file. Please try again.');
        } finally {
            setLoading(false);
            e.target.value = null; // reset input
        }
    };

    const sortData = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredData = useMemo(() => {
        if (!searchTerm) return data;
        return data.filter(item =>
            Object.keys(item).some(key => {
                if (item[key] == null) return false;
                return String(item[key]).toLowerCase().includes(searchTerm.toLowerCase());
            })
        );
    }, [data, searchTerm]);

    const sortedData = useMemo(() => {
        let sortableItems = [...filteredData];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (aValue === null || aValue === undefined) aValue = '';
                if (bValue === null || bValue === undefined) bValue = '';

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig]);

    const handleScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 50) {
            if (visibleRows < sortedData.length) {
                setVisibleRows(prev => Math.min(prev + 30, sortedData.length));
            }
        }
    };

    const visibleData = sortedData.slice(0, visibleRows);
    const headers = data.length > 0 ? Object.keys(data[0]) : [];

    // Helper to render cell value
    const renderCell = (header, value) => {
        if (!value) return value;
        const lowerHeader = header.toLowerCase();

        // 1. If column is thumbnail
        if (lowerHeader === 'thumbnail') {
            return (
                <img
                    src={value}
                    alt="Thumbnail"
                    style={{ maxWidth: '120px', maxHeight: '90px', borderRadius: '4px', objectFit: 'cover' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                />
            );
        }

        // 2. If column string is a URL containing http
        if (typeof value === 'string' && value.startsWith('http')) {
            return (
                <a href={value} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Youtube color="red" size={24} />
                </a>
            );
        }

        return value;
    };

    return (
        <div className="table-container">
            <div className="toolbar" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="file-input"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem', cursor: 'pointer' }}
                    title="Upload new Data File to server"
                />
                <input
                    type="text"
                    className="search-input"
                    placeholder="Search all columns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ flex: 1 }}
                />
            </div>

            {loading && <div className="empty-state"><div className="loader"></div> <p style={{ marginTop: '1rem', color: '#6b7280' }}>Loading data...</p></div>}
            {error && <div className="empty-state error-message">Error: {error}</div>}

            {!loading && !error && (
                <div className="table-wrapper" onScroll={handleScroll} style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                    <table>
                        <thead>
                            <tr>
                                {headers.map(header => (
                                    <th key={header}>
                                        <div className="th-content">
                                            <span onClick={() => sortData(header)} style={{ flex: 1 }}>{header}</span>
                                            {sortConfig.key === header && (
                                                <span className="sort-icon" onClick={() => sortData(header)}>
                                                    {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleData.length > 0 ? (
                                visibleData.map((row, index) => (
                                    <tr key={index}>
                                        {headers.map(header => (
                                            <td key={header}>
                                                <div className="scroll-cell">
                                                    {renderCell(header, row[header])}
                                                </div>
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={headers.length || 1} className="empty-state">
                                        No data available.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default DataTable;
