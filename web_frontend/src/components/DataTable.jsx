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

    // Filter out unusable headers (empty strings or all-null columns)
    const headers = useMemo(() => {
        if (data.length === 0) return [];
        return Object.keys(data[0]).filter(h => h && !h.startsWith('__EMPTY') && !h.startsWith('Unnamed'));
    }, [data]);

    // Helper to extract YouTube ID
    const getYouTubeID = (url) => {
        if (!url) return null;
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    };

    // Helper to render cell value
    const renderCell = (header, value, row) => {
        const lowerHeader = header.toLowerCase();

        // 1. If column is thumbnail or we want to show a thumbnail
        if (lowerHeader === 'thumbnail') {
            let src = value;
            // If empty, try to get from URL
            if (!src || src === '#') {
                const videoUrl = row['URL'] || row['url'] || row['Link'];
                const videoId = getYouTubeID(videoUrl);
                if (videoId) {
                    src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                }
            }

            if (src) {
                return (
                    <img
                        src={src}
                        alt="Thumbnail"
                        style={{ width: '120px', height: 'auto', borderRadius: '4px', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                );
            }
            return null;
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
                    type="text"
                    className="search-input"
                    placeholder="Search all columns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ flex: 1 }}
                />
                <span style={{ fontSize: '0.875rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {searchTerm
                        ? `${filteredData.length} / ${data.length} videos`
                        : `${data.length} videos`
                    }
                </span>
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
                                                    {renderCell(header, row[header], row)}
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
