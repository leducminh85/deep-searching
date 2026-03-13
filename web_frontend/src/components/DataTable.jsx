import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Youtube, ArrowUp, Search } from 'lucide-react';


const removeAccents = (str) => {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

const Highlight = ({ text, searches, enabled }) => {
    if (!enabled || !searches || searches.length === 0) return <span>{text}</span>;

    const validSearches = searches.filter(s => s && s.trim());
    if (validSearches.length === 0) return <span>{text}</span>;

    // Sort validSearches by length descending to match longest terms first
    const sortedSearches = [...validSearches].sort((a, b) => b.length - a.length);
    
    // Create regex for words, escaping special chars
    const escapedSearches = sortedSearches.map(s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
    const regex = new RegExp(`(${escapedSearches})`, 'gi');
    
    const parts = String(text).split(regex);

    return (
        <span>
            {parts.map((part, i) => {
                // Better matching: check if part (without accents) matches any search term (without accents)
                const lowerPartNoAccent = removeAccents(part.toLowerCase());
                const originalIndex = searches.findIndex(s => {
                    const tagNoAccent = removeAccents(s.trim().toLowerCase());
                    return tagNoAccent === lowerPartNoAccent || s.trim().toLowerCase() === part.toLowerCase();
                });

                if (originalIndex !== -1) {
                    const color = `hsl(${(originalIndex * 137) % 360}, 70%, 50%)`;
                    return (
                        <mark 
                            key={i} 
                            style={{ 
                                backgroundColor: color, 
                                color: 'white',
                                padding: '0 2px',
                                borderRadius: '4px',
                                fontWeight: '600',
                                textShadow: '0 0 2px rgba(0,0,0,0.5)'
                            }}
                        >
                            {part}
                        </mark>
                    );
                }
                return (
                    <span key={i}>{part}</span>
                );
            })}
        </span>
    );
};

const DataTable = ({ highlightEnabled, searchMode }) => {

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    const [searchTags, setSearchTags] = useState([]);
    const [appliedTags, setAppliedTags] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [visibleRows, setVisibleRows] = useState(30);
    const [showScrollTop, setShowScrollTop] = useState(false);

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalResults, setTotalResults] = useState(0);
    const pageSize = 200; // Giảm xuống 200 để tối ưu RAM backend (512MB)

    const rawApiBase = import.meta.env.VITE_API_BASE_URL || '';
    const API_BASE = rawApiBase ? (rawApiBase.startsWith('http') ? rawApiBase : `https://${rawApiBase}`) : '';

    // Column resizing state
    const [columnWidths, setColumnWidths] = useState({});
    const resizingRef = useRef(null);

    // Gọi fetch khi trang, từ khóa hoặc sắp xếp thay đổi
    useEffect(() => {
        const query = appliedTags.join(',');
        fetchData(query, page, sortConfig, searchMode);
    }, [appliedTags, page, sortConfig, searchMode]);

    const fetchData = async (query = '', pageNum = 1, sort = sortConfig, mode = 'or') => {
        let progressInterval;
        if (pageNum === 1) {
            setLoading(true);
            setData([]); // Clear data to avoid showing stale results on error/timeout
            setProgress(0);

            // Giả lập tiến trình chạy từ 0 đến 60-80% trong 5 giây
            const targetP = Math.floor(Math.random() * (80 - 60 + 1)) + 60;
            const duration = 5000;
            const step = 100;
            const increment = targetP / (duration / step);

            let currentP = 0;
            progressInterval = setInterval(() => {
                currentP += increment;
                if (currentP >= targetP) {
                    clearInterval(progressInterval);
                    setProgress(targetP);
                } else {
                    setProgress(Math.floor(currentP));
                }
            }, step);
        }
        setError(null);

        try {
            const sortParam = sort.key || 'created_at';
            const orderParam = sort.direction;
            const url = `${API_BASE}/api/data?page=${pageNum}&size=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}&sort=${encodeURIComponent(sortParam)}&order=${orderParam}&mode=${mode}`;
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

            if (pageNum === 1) {
                clearInterval(progressInterval);
                setProgress(100);
            }
            if (pageNum === 1) setVisibleRows(30);
        } catch (err) {
            if (pageNum === 1) clearInterval(progressInterval);
            setError(`${err.message}`);
        } finally {
            if (pageNum === 1) {
                // Để người dùng thấy 100% một chút rồi mới tắt
                setTimeout(() => setLoading(false), 400);
            }
        }
    };

    const handleSearch = () => {
        let newTags = [...searchTags];
        if (inputValue.trim()) {
            const tag = inputValue.trim();
            if (!newTags.includes(tag)) {
                newTags.push(tag);
                setSearchTags(newTags);
            }
            setInputValue('');
        }
        setAppliedTags(newTags);
        setPage(1);
    };

    const addTag = (val) => {
        const tag = val.trim();
        if (tag && !searchTags.includes(tag)) {
            setSearchTags([...searchTags, tag]);
            setInputValue('');
        } else {
            setInputValue('');
        }
    };

    const removeTag = (tagToRemove) => {
        const newTags = searchTags.filter(tag => tag !== tagToRemove);
        setSearchTags(newTags);
        // Do NOT update appliedTags here to satisfy "only search on Enter/Icon"
        setPage(1);
    };

    const handleKeyDown = (e) => {
        if (e.key === ',') {
            e.preventDefault();
            addTag(inputValue);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        } else if (e.key === 'Backspace' && !inputValue && searchTags.length > 0) {
            removeTag(searchTags[searchTags.length - 1]);
        }
    };

    const sortData = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        setPage(1); // Reset về trang 1 khi đổi sắp xếp
    };

    const sortedData = useMemo(() => {
        return data; // Dữ liệu đã được Backend sắp xếp
    }, [data]);

    // Header translation mapping
    const headerTranslations = {
        'title': 'Tiêu đề',
        'url': 'Link',
        'link': 'Link',
        'views': 'Lượt xem',
        'thumbnail': 'Thumbnail',
        'caption': 'Phụ đề',
        'summary': 'Phân tích',
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
        return [
            'Title',
            'URL',
            'Views',
            'Thumbnail',
            'Caption',
            'Summary',
            'Date Published',
            'Channel Name'
        ];
    }, []);

    useEffect(() => {
        // Initial fetch handled by the other useEffect depending on appliedTags

        const handleGlobalScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };
        window.addEventListener('scroll', handleGlobalScroll);
        return () => window.removeEventListener('scroll', handleGlobalScroll);
    }, []);

    // Auto-scroll to first highlight in each cell when searching
    useEffect(() => {
        if (!highlightEnabled || appliedTags.length === 0 || loading) return;

        // Use requestAnimationFrame and a slightly longer timeout to ensure DOM is fully rendered and browsers have calculated offsets
        const timer = setTimeout(() => {
            const cells = document.querySelectorAll('.scroll-cell');
            cells.forEach(cell => {
                const firstHighlight = cell.querySelector('mark');
                if (firstHighlight) {
                    // OffsetTop relative to positioned parent (.scroll-cell itself)
                    cell.scrollTo({
                        top: firstHighlight.offsetTop - 15,
                        behavior: 'smooth'
                    });
                }
            });
        }, 300);

        return () => clearTimeout(timer);
    }, [appliedTags, visibleRows, highlightEnabled, loading, data]);

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
                        style={{ width: '100%', aspectRatio: '16/9', borderRadius: '4px', objectFit: 'cover', display: 'block' }}
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
                const d = date.getDate().toString().padStart(2, '0');
                const m = (date.getMonth() + 1).toString().padStart(2, '0');
                const y = date.getFullYear();
                return `${d}/${m}/${y}`;
            } catch (e) {
                return value;
            }
        }

        return <Highlight text={value} searches={appliedTags} enabled={highlightEnabled} />;
    };

    const getHeaderClass = (header) => {
        const low = header.toLowerCase();
        if (low === 'caption') return 'col-caption';
        if (low === 'summary') return 'col-summary';
        if (low === 'thumbnail') return 'col-thumbnail';
        return '';
    };

    return (
        <>
            <div className="table-container">
                <div className="toolbar" style={{ gap: '1rem' }}>
                    <div className="search-wrapper" style={{ 
                        flex: 1, 
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '4px 12px',
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '12px',
                        minHeight: '48px',
                        flexWrap: 'wrap'
                    }}>
                        {searchTags.map((tag, index) => (
                            <span key={index} style={{
                                background: `hsl(${(index * 137) % 360}, 70%, 50%)`,
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontWeight: '600'
                            }}>
                                {tag}
                                <button 
                                    onClick={() => removeTag(tag)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'white',
                                        cursor: 'pointer',
                                        padding: '0 2px',
                                        fontSize: '1rem',
                                        lineHeight: 1,
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                        <input
                            type="text"
                            className="search-input"
                            placeholder={searchTags.length === 0 ? "Nhập từ khóa tìm kiếm (dùng dấu phẩy để tách tag)..." : ""}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            style={{
                                flex: 1,
                                minWidth: '150px',
                                border: 'none',
                                background: 'transparent',
                                outline: 'none',
                                color: 'var(--text-color)',
                                padding: '4px 0',
                                height: 'auto'
                            }}
                        />
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginLeft: 'auto'
                        }}>
                            <span style={{
                                fontSize: '0.65rem',
                                color: 'var(--text-muted)',
                                opacity: 0.6,
                                fontStyle: 'italic',
                                pointerEvents: 'none'
                            }}>
                                nhấn , hoặc Enter ↵
                            </span>
                            <button
                                onClick={handleSearch}
                                style={{
                                    background: 'var(--primary-color)',
                                    border: 'none',
                                    borderRadius: '8px',
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: 'white'
                                }}
                            >
                                <Search size={18} />
                            </button>
                        </div>
                    </div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {appliedTags.length > 0
                            ? `Tìm thấy ${totalResults.toLocaleString()} kết quả`
                            : `Tổng cộng ${totalResults.toLocaleString()} video`
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
