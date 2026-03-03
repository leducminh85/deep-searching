import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Youtube, ArrowUp } from 'lucide-react';

const DataTable = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [visibleRows, setVisibleRows] = useState(30);
    const [showScrollTop, setShowScrollTop] = useState(false);

    const rawApiBase = import.meta.env.VITE_API_BASE_URL || '';
    const API_BASE = rawApiBase ? (rawApiBase.startsWith('http') ? rawApiBase : `https://${rawApiBase}`) : '';

    // Column resizing state
    const [columnWidths, setColumnWidths] = useState({});
    const resizingRef = useRef(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        setProgress(0);

        // Simulation for the "waiting/loading" phase
        // Targets a random point between 60-80% over approximately 20 seconds
        const targetPercent = Math.floor(Math.random() * 21) + 60;
        const duration = 20000; // 20 seconds
        const startTime = Date.now();

        const simTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const calculatedProgress = Math.floor((elapsed / duration) * targetPercent);

            setProgress(prev => {
                if (calculatedProgress > prev && prev < targetPercent) {
                    return calculatedProgress;
                }
                return prev;
            });

            if (elapsed >= duration) clearInterval(simTimer);
        }, 500);


        try {
            const response = await fetch(`${API_BASE}/api/data`);
            clearInterval(simTimer); // Stop simulation once server starts responding

            if (!response.ok) throw new Error('Failed to fetch data from server');

            // Track download progress
            const reader = response.body.getReader();
            const contentLength = +response.headers.get('Content-Length');

            let receivedLength = 0;
            let chunks = [];

            // Ensure progress doesn't jump back if simulation was further along
            setProgress(prev => Math.max(prev, 25));

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                receivedLength += value.length;

                if (contentLength && contentLength > 0) {
                    let actualProgress = Math.round((receivedLength / contentLength) * 100);
                    // Clamp to 100% to avoid exceeding due to Gzip decompression mismatches
                    setProgress(prev => Math.min(Math.max(prev, actualProgress), 100));
                } else {
                    // Simulation for chunked or unknown size
                    setProgress(prev => Math.min(prev + 1, 99));
                }

            }


            // Concatenate chunks
            let chunksAll = new Uint8Array(receivedLength);
            let position = 0;
            for (let chunk of chunks) {
                chunksAll.set(chunk, position);
                position += chunk.length;
            }

            // Decode and parse
            const text = new TextDecoder("utf-8").decode(chunksAll);
            const result = JSON.parse(text);

            setData(result.data || []);
            setProgress(100);
            setVisibleRows(30);
        } catch (err) {
            setError(`${err.message} (URL: ${API_BASE || 'chưa có API_BASE'}/api/data)`);
        } finally {
            // Delay closing the loader slightly to let user see 100%
            setTimeout(() => setLoading(false), 200);
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

    // Header translation mapping
    const headerTranslations = {
        'title': 'Tiêu đề',
        'url': 'Liên kết',
        'link': 'Liên kết',
        'views': 'Lượt xem',
        'thumbnail': 'Ảnh thu nhỏ',
        'caption': 'Phụ đề',
        'summary': 'Tóm tắt',
        'date published': 'Ngày đăng',
        'published': 'Ngày đăng',
        'channel name': 'Tên kênh',
        'channel': 'Tên kênh'
    };

    const getTranslation = (header) => {
        if (!header) return header;
        const normalized = header.toLowerCase().trim();
        return headerTranslations[normalized] || header;
    };

    const headers = useMemo(() => {
        if (data.length === 0) return [];
        return Object.keys(data[0]).filter(h => h && !h.startsWith('__EMPTY') && !h.startsWith('Unnamed'));
    }, [data]);

    useEffect(() => {
        fetchData();

        const handleGlobalScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };
        window.addEventListener('scroll', handleGlobalScroll);
        return () => window.removeEventListener('scroll', handleGlobalScroll);
    }, []);

    // Infinite scroll effect
    useEffect(() => {
        const handleAutoLoad = () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
                if (visibleRows < sortedData.length) {
                    setVisibleRows(prev => Math.min(prev + 30, sortedData.length));
                }
            }
        };
        window.addEventListener('scroll', handleAutoLoad);
        return () => window.removeEventListener('scroll', handleAutoLoad);
    }, [visibleRows, sortedData.length]);

    const handleScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 50) {
            if (visibleRows < sortedData.length) {
                setVisibleRows(prev => Math.min(prev + 30, sortedData.length));
            }
        }
    };

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Resizing logic
    const startResizing = (header, e) => {
        e.preventDefault();
        resizingRef.current = {
            header,
            startX: e.clientX,
            startWidth: e.target.parentElement.offsetWidth
        };

        document.addEventListener('mousemove', handleResizing);
        document.addEventListener('mouseup', stopResizing);
    };

    const handleResizing = (e) => {
        if (!resizingRef.current) return;
        const { header, startX, startWidth } = resizingRef.current;
        const newWidth = Math.max(50, startWidth + (e.clientX - startX));
        setColumnWidths(prev => ({ ...prev, [header]: newWidth }));
    };

    const stopResizing = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleResizing);
        document.removeEventListener('mouseup', stopResizing);
    };

    const visibleData = sortedData.slice(0, visibleRows);


    const getYouTubeID = (url) => {
        if (!url || typeof url !== 'string') return null;
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    };

    const renderCell = (header, value, row) => {
        const lowerHeader = header.toLowerCase();

        if (lowerHeader === 'thumbnail') {
            let src = value;
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

        if (typeof value === 'string' && value.startsWith('http')) {
            return (
                <a href={value} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Youtube color="red" size={24} />
                </a>
            );
        }

        if (lowerHeader === 'views' || header === 'Lượt xem') {
            return new Intl.NumberFormat('vi-VN').format(value || 0);
        }

        if (lowerHeader === 'date published' || header === 'Ngày đăng') {
            try {
                const date = new Date(value);
                if (isNaN(date.getTime())) return value;
                return date.toLocaleDateString('vi-VN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch (e) {
                return value;
            }
        }

        return value;
    };

    const getHeaderClass = (header) => {
        const low = header.toLowerCase();
        if (low === 'caption') return 'col-caption';
        if (low === 'summary') return 'col-summary';
        return '';
    };

    return (
        <>
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
                        <span className="progress-label">{progress}%</span>
                        <div className="progress-container">
                            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            Đang tải toàn bộ thư viện video...
                        </p>
                    </div>
                )}

                {error && <div className="empty-state" style={{ color: 'var(--accent-color)' }}>Lỗi: {error}</div>}

                {!loading && !error && (
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    {headers.map(header => (
                                        <th
                                            key={header}
                                            className={getHeaderClass(header)}
                                            style={columnWidths[header] ? { width: `${columnWidths[header]}px`, minWidth: 'auto', maxWidth: 'none' } : {}}
                                        >
                                            <div className="th-content" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span onClick={() => sortData(header)} style={{ cursor: 'pointer', flex: 1 }}>
                                                    {getTranslation(header)}
                                                </span>
                                                <span style={{ color: sortConfig.key === header ? 'var(--primary-color)' : 'transparent', fontSize: '0.65rem' }}>
                                                    {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                                </span>
                                            </div>
                                            <div className="resize-handle" onMouseDown={(e) => startResizing(header, e)}></div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {visibleData.length > 0 ? (
                                    visibleData.map((row, index) => (
                                        <tr key={index}>
                                            {headers.map(header => (
                                                <td key={header} className={getHeaderClass(header)}>
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
                                            Không tìm thấy dữ liệu phù hợp.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <button
                className={`scroll-to-top ${showScrollTop ? 'visible' : ''}`}
                onClick={scrollToTop}
                title="Scroll to Top"
            >
                <ArrowUp size={24} />
            </button>
        </>
    );
};

export default DataTable;
