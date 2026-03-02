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
                        style={{ width: '100%', height: 'auto', borderRadius: '4px', objectFit: 'cover', display: 'block' }}
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
            <div className="toolbar">
                <input
                    type="text"
                    className="search-input"
                    placeholder="Tìm kiếm nhanh trong toàn bộ các cột..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {searchTerm
                        ? `Tìm thấy ${filteredData.length} / ${data.length}`
                        : `${data.length} video`
                    }
                </span>
            </div>

            {loading && (
                <div className="empty-state">
                    <div className="loader" style={{ margin: '0 auto 1.5rem' }}></div>
                    <p>Đang tải dữ liệu từ Excel...</p>
                </div>
            )}
            {error && <div className="empty-state" style={{ color: 'var(--accent-color)' }}>Lỗi: {error}</div>}

            {!loading && !error && (
                <div className="table-wrapper" onScroll={handleScroll}>
                    <table>
                        <thead>
                            <tr>
                                {headers.map(header => (
                                    <th key={header} onClick={() => sortData(header)}>
                                        <div className="th-content" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span>{header}</span>
                                            <span style={{ color: sortConfig.key === header ? 'var(--primary-color)' : 'transparent', fontSize: '0.65rem' }}>
                                                {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                            </span>
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
