import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Youtube, ArrowUp } from 'lucide-react';


const Highlight = ({ text, search, enabled }) => {
    if (!enabled || !search || !search.trim()) return <span>{text}</span>;

    // Properly escape search term for regex
    const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    const parts = String(text).split(regex);

    return (
        <span>
            {parts.map((part, i) =>
                part.toLowerCase() === search.toLowerCase() ? (
                    <mark key={i} className="highlight">{part}</mark>
                ) : (
                    part
                )
            )}
        </span>
    );
};

const DataTable = ({ highlightEnabled }) => {

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [inputValue, setInputValue] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [visibleRows, setVisibleRows] = useState(30);
    const [showScrollTop, setShowScrollTop] = useState(false);

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalResults, setTotalResults] = useState(0);
    const pageSize = 200; // Tải 200 video mỗi lần cuộn để mượt mà

    const rawApiBase = import.meta.env.VITE_API_BASE_URL || '';
    const API_BASE = rawApiBase ? (rawApiBase.startsWith('http') ? rawApiBase : `https://${rawApiBase}`) : '';

    // Column resizing state
    const [columnWidths, setColumnWidths] = useState({});
    const resizingRef = useRef(null);

    // Debounce search effect to prevent lag while typing
    useEffect(() => {
        const handler = setTimeout(() => {
            setSearchTerm(inputValue);
            setPage(1); // Reset về trang 1 khi search mới
        }, 500);

        return () => clearTimeout(handler);
    }, [inputValue]);

    const fetchData = async (query = '', pageNum = 1) => {
        if (pageNum === 1) {
            setLoading(true);
            setProgress(0);
        }
        setError(null);

        try {
            const url = `${API_BASE}/api/data?page=${pageNum}&size=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
            const response = await fetch(url);

            if (!response.ok) throw new Error('Failed to fetch data');

            const result = await response.json();
            const newData = result.data || [];

            if (pageNum === 1) {
                setData(newData);
            } else {
                setData(prev => [...prev, ...newData]);
            }

            setTotalResults(result.total || 0);
            setHasMore(newData.length === pageSize);
            setProgress(100);
            if (pageNum === 1) setVisibleRows(30);
        } catch (err) {
            setError(`${err.message}`);
        } finally {
            if (pageNum === 1) setTimeout(() => setLoading(false), 200);
        }
    };

    // Theo dõi cuộn trang để tải thêm (Infinite Scroll)
    useEffect(() => {
        const handleScroll = () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !loading && hasMore) {
                setPage(prev => prev + 1);
            }
            setShowScrollTop(window.scrollY > 400);
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [loading, hasMore]);

    // Gọi fetch khi trang hoặc từ khóa thay đổi
    useEffect(() => {
        fetchData(searchTerm, page);
    }, [searchTerm, page]);

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

    // Auto-scroll to first highlight in each cell when searching
    useEffect(() => {
        if (!highlightEnabled || !searchTerm) return;

        // Use requestAnimationFrame or setTimeout to ensure DOM is rendered with new highlights
        const timer = setTimeout(() => {
            const cells = document.querySelectorAll('.scroll-cell');
            cells.forEach(cell => {
                const firstHighlight = cell.querySelector('.highlight');
                if (firstHighlight) {
                    // Scroll cell container to make highlight visible
                    // We scroll to slightly above the highlight (15px) for better visibility
                    cell.scrollTo({
                        top: firstHighlight.offsetTop - 15,
                        behavior: 'smooth'
                    });
                }
            });
        }, 100);

        return () => clearTimeout(timer);
    }, [searchTerm, visibleRows, highlightEnabled]);

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

        return <Highlight text={value} search={searchTerm} enabled={highlightEnabled} />;
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
                    <div className="search-wrapper" style={{ flex: 1, position: 'relative' }}>
                        {highlightEnabled && inputValue && (
                            <div className="search-highlight-mirror" style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                padding: '0 1.25rem', // Matches search-input padding
                                pointerEvents: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                zIndex: 1
                            }}>
                                <span style={{
                                    backgroundColor: '#facc15',
                                    color: 'transparent', // Don't show text, only background
                                    padding: '0.125rem 0.5rem',
                                    margin: '0 -0.5rem',
                                    borderRadius: '6px',
                                    fontSize: '0.9375rem',
                                    fontWeight: '700',
                                    whiteSpace: 'pre',
                                    fontFamily: 'inherit',
                                    display: 'inline-block'
                                }}>
                                    {inputValue}
                                </span>
                            </div>
                        )}
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Tìm kiếm nhanh trong toàn bộ các cột..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            style={{
                                width: '100%',
                                position: 'relative',
                                zIndex: 2,
                                background: 'transparent',
                                color: (highlightEnabled && inputValue) ? '#000' : 'var(--text-color)',
                                caretColor: (highlightEnabled && inputValue) ? '#000' : 'var(--text-color)',
                                opacity: 1 // Ensure cursor is visible
                            }}
                        />
                    </div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {searchTerm
                            ? `Tìm thấy ${totalResults} kết quả (đã tải ${data.length})`
                            : `Tổng cộng ${totalResults} video (đã tải ${data.length})`
                        }
                    </span>
                </div>

                {loading && page > 1 && (
                    <div style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--primary-color)', fontSize: '0.875rem' }}>
                        Đang tải thêm video...
                    </div>
                )}

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
