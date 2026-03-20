'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Youtube, ArrowUp, Search, Filter, X, Plus, Languages } from 'lucide-react';


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

const DataTable = ({ highlightEnabled, searchMode, translateEnabled }) => {

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    const [searchTags, setSearchTags] = useState([]);
    const [appliedTags, setAppliedTags] = useState([]);
    const [appliedFilters, setAppliedFilters] = useState({});
    const [isInitialized, setIsInitialized] = useState(false);
    const abortControllerRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const [inputValue, setInputValue] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'date_published', direction: 'desc' });
    const [visibleRows, setVisibleRows] = useState(50);
    const [showScrollTop, setShowScrollTop] = useState(false);

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalResults, setTotalResults] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const pageSize = 200; // Giảm xuống 200 để tối ưu RAM backend (512MB)

    // Advanced Filter state
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [minViews, setMinViews] = useState('');
    const [maxViews, setMaxViews] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [availableChannels, setAvailableChannels] = useState([]);
    const [selectedChannels, setSelectedChannels] = useState([]); // List of channels to INCLUDE

    const API_BASE = '';

    // Column resizing state
    const [columnWidths, setColumnWidths] = useState({});
    const resizingRef = useRef(null);
    const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
    const [newChannelUrl, setNewChannelUrl] = useState('');
    const [newChannelNote, setNewChannelNote] = useState('');
    const [isSubmittingChannel, setIsSubmittingChannel] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [urlError, setUrlError] = useState('');

    // Translation state
    const hoverTimeoutRef = useRef(null);
    const [activeTranslation, setActiveTranslation] = useState(null);

    const extractMainStory = (summary) => {
        if (!summary || typeof summary !== 'string') return "";
        // Match 1. MAIN STORY: ... until 2. or end
        const patterns = [
            /(?:MAIN STORY|Main Story|1\.\s*MAIN STORY):\s*([\s\S]+?)(?=\n\d\.|\n\*\*|$)/i,
            /\*\*1\.\s*MAIN STORY:\*\*\s*([\s\S]+?)(?=\n\d\.|\n\*\*|$)/i
        ];
        for (const pattern of patterns) {
            const match = summary.match(pattern);
            if (match) return match[1].trim();
        }
        return summary//.trim().substring(0, 500); // Fallback to first 500 chars
    };

    const handleMouseEnterSummary = (summary, mouseX, mouseY) => {
        if (!translateEnabled || !summary) return;

        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

        hoverTimeoutRef.current = setTimeout(async () => {
            const mainStory = extractMainStory(summary);
            setActiveTranslation({ loading: true, x: mouseX, y: mouseY });

            try {
                // Fetch translation directly from Google Translate free client (Frontend)
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(mainStory)}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    const translatedText = data[0].map(segment => segment[0]).join('');
                    setActiveTranslation({ content: translatedText, x: mouseX, y: mouseY });
                }
            } catch (err) {
                console.error("Translation failed on frontend", err);
                setActiveTranslation(null);
            }
        }, 1000);
    };

    const handleMouseLeaveSummary = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        setActiveTranslation(null);
    };

    // Gọi fetch khi trang, từ khóa hoặc sắp xếp thay đổi
    useEffect(() => {
        if (!isInitialized) return;
        const query = appliedTags.join(',');
        fetchData(query, page, sortConfig, searchMode, appliedFilters);
    }, [appliedTags, page, sortConfig, appliedFilters, isInitialized]);

    // Lấy danh sách kênh khi component mount
    useEffect(() => {
        fetchChannels();
    }, []);

    const fetchChannels = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/channels`);
            if (res.ok) {
                const data = await res.json();
                setAvailableChannels(data);
                setSelectedChannels(data);
                // Đồng bộ hóa appliedFilters để hiển thị đúng ngay lập tức
                setAppliedFilters(prev => ({ ...prev, selectedChannels: data }));
            }
        } catch (err) {
            console.error("Failed to fetch channels", err);
        } finally {
            setIsInitialized(true);
        }
    };

    const fetchData = async (query = '', pageNum = 1, sort = sortConfig, mode = 'or', filters = {}) => {
        // Chỉ abort request cũ khi tải trang 1 (tải lại từ đầu)
        if (pageNum === 1) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        }
        const controller = new AbortController();
        if (pageNum === 1) {
            abortControllerRef.current = controller;
        }
        const { signal } = controller;

        // Luôn dọn dẹp progress interval cũ trước khi tạo mới
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }

        if (pageNum === 1) {
            setLoading(true);
            setData([]);
            setProgress(0);

            // Giả lập tiến trình chạy từ 0 đến 60-80% trong 5 giây
            const targetP = Math.floor(Math.random() * (80 - 60 + 1)) + 60;
            const duration = 5000;
            const step = 100;
            const increment = targetP / (duration / step);

            let currentP = 0;
            progressIntervalRef.current = setInterval(() => {
                currentP += increment;
                if (currentP >= targetP) {
                    clearInterval(progressIntervalRef.current);
                    progressIntervalRef.current = null;
                    setProgress(targetP);
                } else {
                    setProgress(Math.floor(currentP));
                }
            }, step);
        } else {
            setLoadingMore(true);
        }
        setError(null);

        try {
            const sortParam = sort.key || 'created_at';
            const orderParam = sort.direction;

            // Build filter query params
            let filterParams = '';
            if (filters.minViews) filterParams += `&min_views=${filters.minViews}`;
            if (filters.maxViews) filterParams += `&max_views=${filters.maxViews}`;
            if (filters.startDate) filterParams += `&start_date=${filters.startDate}`;
            if (filters.endDate) filterParams += `&end_date=${filters.endDate}`;
            if (filters.selectedChannels && filters.selectedChannels.length > 0 && filters.selectedChannels.length < availableChannels.length) {
                filterParams += `&channels=${encodeURIComponent(filters.selectedChannels.join(','))}`;
            }

            const url = `${API_BASE}/api/data?page=${pageNum}&size=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}&sort=${encodeURIComponent(sortParam)}&order=${orderParam}&mode=${mode}${filterParams}`;
            const response = await fetch(url, { signal });

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
                if (progressIntervalRef.current) {
                    clearInterval(progressIntervalRef.current);
                    progressIntervalRef.current = null;
                }
                setProgress(100);
                setVisibleRows(50);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (pageNum === 1 && progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
            setError(`${err.message}`);
        } finally {
            if (signal.aborted) return;
            if (pageNum === 1) {
                setTimeout(() => {
                    if (!signal.aborted) setLoading(false);
                }, 400);
            } else {
                setLoadingMore(false);
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

    const toggleFilter = () => setIsFilterOpen(!isFilterOpen);

    const handleChannelToggle = (channel) => {
        setSelectedChannels(prev =>
            prev.includes(channel)
                ? prev.filter(c => c !== channel)
                : [...prev, channel]
        );
    };

    const handleSelectAllChannels = () => {
        setSelectedChannels([...availableChannels]);
    };

    const handleDeselectAllChannels = () => {
        setSelectedChannels([]);
    };

    const clearFilters = () => {
        setMinViews('');
        setMaxViews('');
        setStartDate('');
        setEndDate('');
        setSelectedChannels(availableChannels);
        setAppliedTags([]);
        setSearchTags([]);
        setPage(1);
        setAppliedFilters({});
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

    const applyAdvancedFilters = () => {
        setIsFilterOpen(false);
        const filters = {
            minViews,
            maxViews,
            startDate,
            endDate,
            selectedChannels
        };
        setPage(1);
        setAppliedFilters(filters);
    };

    const setDatePreset = (days) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);

        setStartDate(start.toISOString().split('T')[0]);
        setEndDate(end.toISOString().split('T')[0]);
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
                } else if (hasMore && !loading && !loadingMore) {
                    // Đã hiển thị hết data hiện có, tải thêm từ server
                    setPage(prev => prev + 1);
                }
            }
        };
        window.addEventListener('scroll', handleAutoLoad);
        return () => window.removeEventListener('scroll', handleAutoLoad);
    }, [visibleRows, sortedData.length, hasMore, loading, loadingMore]);

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

    const handleAddChannel = async (e) => {
        e.preventDefault();
        setUrlError('');

        if (!newChannelUrl.trim()) {
            setUrlError('Vui lòng nhập địa chỉ kênh');
            return;
        }

        // Simple URL validation
        try {
            new URL(newChannelUrl);
        } catch (_) {
            setUrlError('Vui lòng nhập một địa chỉ URL hợp lệ (ví dụ: https://youtube.com/...)');
            return;
        }

        setIsSubmittingChannel(true);
        try {
            const response = await fetch('/api/channel-sources', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channel_url: newChannelUrl,
                    note: newChannelNote
                }),
            });

            if (response.ok) {
                setNewChannelUrl('');
                setNewChannelNote('');
                setIsAddChannelOpen(false);
                setShowSuccessModal(true);
            } else {
                const errData = await response.json();
                alert(`Lỗi: ${errData.error || 'Không thể gửi yêu cầu'}`);
            }
        } catch (error) {
            console.error('Error adding channel:', error);
            alert('Lỗi hệ thống: Không thể kết nối tới máy chủ. Vui lòng thử lại sau.');
        } finally {
            setIsSubmittingChannel(false);
        }
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

        if (lowerHeader === 'summary' || header === 'Phân tích') {
            return (
                <div
                    onMouseEnter={(e) => {
                        const x = e.clientX;
                        const y = e.clientY;
                        handleMouseEnterSummary(value, x, y);
                    }}
                    onMouseLeave={handleMouseLeaveSummary}
                >
                    <Highlight text={value} searches={appliedTags} enabled={highlightEnabled} />
                </div>
            );
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
            <div
                className={`sidebar-overlay ${isFilterOpen ? 'visible' : ''}`}
                onClick={toggleFilter}
            />

            <div className={`filter-sidebar ${isFilterOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <h2>Bộ lọc nâng cao</h2>
                    <button onClick={toggleFilter} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                <div className="sidebar-content">
                    <div className="filter-group">
                        <label>Khoảng Lượt xem</label>
                        <div className="side-by-side">
                            <input
                                type="number"
                                placeholder="Tối thiểu"
                                value={minViews}
                                onChange={(e) => setMinViews(e.target.value)}
                            />
                            <input
                                type="number"
                                placeholder="Tối đa"
                                value={maxViews}
                                onChange={(e) => setMaxViews(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="filter-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <label style={{ margin: 0 }}>Khoảng Ngày đăng</label>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button
                                    onClick={() => setDatePreset(7)}
                                    style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-color)', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                >
                                    7 ngày
                                </button>
                                <button
                                    onClick={() => setDatePreset(30)}
                                    style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-color)', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                >
                                    30 ngày
                                </button>
                            </div>
                        </div>
                        <div className="date-inputs">
                            <div>
                                <span>Từ ngày:</span>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <span>Đến ngày:</span>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="filter-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <label style={{ margin: 0 }}>Chọn Kênh hiển thị</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={handleSelectAllChannels}
                                    style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-color)', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                >
                                    Tất cả
                                </button>
                                <button
                                    onClick={handleDeselectAllChannels}
                                    style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-color)', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                >
                                    Bỏ hết
                                </button>
                            </div>
                        </div>
                        <div className="channel-list">
                            {availableChannels.map(channel => (
                                <label key={channel} className="channel-item">
                                    <input
                                        type="checkbox"
                                        checked={selectedChannels.includes(channel)}
                                        onChange={() => handleChannelToggle(channel)}
                                    />
                                    <span>{channel}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="sidebar-footer">
                    <button onClick={applyAdvancedFilters} className="apply-btn">
                        Áp dụng bộ lọc
                    </button>
                    <button onClick={clearFilters} className="reset-btn">
                        Đặt lại mặc định
                    </button>
                </div>
            </div>

            <div className="table-container">
                {(appliedTags.length > 0 || Object.keys(appliedFilters).some(k => appliedFilters[k] && (Array.isArray(appliedFilters[k]) ? appliedFilters[k].length > 0 : true))) && (
                    <div style={{
                        padding: '0.5rem 1.25rem',
                        display: 'flex',
                        gap: '0.75rem',
                        alignItems: 'center',
                        background: 'rgba(99, 102, 241, 0.05)',
                        borderBottom: '1px solid var(--glass-border)',
                        flexWrap: 'wrap'
                    }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Bộ lọc:</span>

                        {appliedFilters.minViews && (
                            <div className="filter-tag" style={{ background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--primary-color)', color: 'var(--text-color)' }}>
                                Views ⏶ {Number(appliedFilters.minViews).toLocaleString()}
                            </div>
                        )}
                        {appliedFilters.maxViews && (
                            <div className="filter-tag" style={{ background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--primary-color)', color: 'var(--text-color)' }}>
                                Views ⏷ {Number(appliedFilters.maxViews).toLocaleString()}
                            </div>
                        )}
                        {appliedFilters.startDate && (
                            <div className="filter-tag" style={{ background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--primary-color)', color: 'var(--text-color)' }}>
                                Từ {appliedFilters.startDate}
                            </div>
                        )}
                        {appliedFilters.endDate && (
                            <div className="filter-tag" style={{ background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--primary-color)', color: 'var(--text-color)' }}>
                                Đến {appliedFilters.endDate}
                            </div>
                        )}
                        {appliedFilters.selectedChannels && appliedFilters.selectedChannels.length > 0 && (
                            <div className="filter-tag" style={{ background: 'var(--glass-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--primary-color)', color: 'var(--text-color)' }}>
                                Kênh ({appliedFilters.selectedChannels.length})
                            </div>
                        )}
                    </div>
                )}
                <div className="toolbar" style={{ gap: '1rem', flexWrap: 'wrap' }}>
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

                    <button
                        onClick={toggleFilter}
                        className={`theme-toggle tour-filter ${isFilterOpen ? 'active' : ''}`}
                        title="Bộ lọc nâng cao"
                    >
                        <Filter size={20} />
                    </button>

                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {appliedTags.length > 0
                            ? `Tìm thấy ${totalResults.toLocaleString()} kết quả`
                            : `Tổng cộng ${totalResults.toLocaleString()} video`
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
                    <>
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
                        {loadingMore && (
                            <div className="loading-more">
                                <div className="loader small"></div>
                                <span>Đang tải thêm video...</span>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="floating-actions">
                <button
                    className={`floating-btn scroll-to-top ${showScrollTop ? 'visible' : ''}`}
                    onClick={scrollToTop}
                    title="Scroll to Top"
                >
                    <ArrowUp size={24} />
                </button>
                <button
                    className="floating-btn"
                    onClick={() => setIsAddChannelOpen(true)}
                    title="Thêm kênh nguồn"
                >
                    <Plus size={24} />
                </button>
            </div>

            {isAddChannelOpen && (
                <div className="modal-overlay" onClick={() => !isSubmittingChannel && setIsAddChannelOpen(false)}>
                    <div className="modal-container" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Thêm kênh nguồn bổ sung</h2>
                        </div>
                        <form onSubmit={handleAddChannel} noValidate>
                            <div className="form-group">
                                <label>Địa chỉ kênh (URL)</label>
                                <input
                                    type="url"
                                    placeholder="https://www.youtube.com/@channel"
                                    value={newChannelUrl}
                                    onChange={(e) => {
                                        setNewChannelUrl(e.target.value);
                                        if (urlError) setUrlError('');
                                    }}
                                    className={urlError ? 'input-error' : ''}
                                    required
                                    disabled={isSubmittingChannel}
                                />
                                {urlError && (
                                    <div style={{
                                        color: '#f43f5e',
                                        fontSize: '0.75rem',
                                        marginTop: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}>
                                        <span>⚠️</span> {urlError}
                                    </div>
                                )}
                            </div>
                            <div className="form-group">
                                <label>Ghi chú</label>
                                <input
                                    type="text"
                                    placeholder="Nhập ghi chú nếu có..."
                                    value={newChannelNote}
                                    onChange={(e) => setNewChannelNote(e.target.value)}
                                    disabled={isSubmittingChannel}
                                />
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="modal-btn-cancel"
                                    onClick={() => setIsAddChannelOpen(false)}
                                    disabled={isSubmittingChannel}
                                >
                                    Hủy bỏ
                                </button>
                                <button
                                    type="submit"
                                    className="modal-btn-confirm"
                                    disabled={isSubmittingChannel || !newChannelUrl.trim()}
                                >
                                    {isSubmittingChannel ? 'Đang gửi...' : 'Xác nhận'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showSuccessModal && (
                <div className="modal-overlay" onClick={() => setShowSuccessModal(false)}>
                    <div className="modal-container success-popup" onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>✅</div>
                            <h2 style={{ marginBottom: '1rem', color: 'var(--text-color)' }}>Đã ghi nhận!</h2>
                            <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', fontSize: '0.95rem' }}>
                                Cảm ơn bạn! Kênh nguồn đã được ghi nhận vào hệ thống và sẽ được cập nhật sau ít ngày.
                            </p>
                            <button
                                className="modal-btn-confirm"
                                style={{ marginTop: '2rem', width: '100%' }}
                                onClick={() => setShowSuccessModal(false)}
                            >
                                Đóng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTranslation && (
                <div
                    className="translation-popover"
                    style={{
                        position: 'fixed',
                        top: activeTranslation.y + 350 > (typeof window !== 'undefined' ? window.innerHeight : 0)
                            ? activeTranslation.y - 330 // Shift up if it hits bottom
                            : activeTranslation.y + 15,
                        left: activeTranslation.x + 340 > (typeof window !== 'undefined' ? window.innerWidth : 0)
                            ? activeTranslation.x - 330 // Show on the left of mouse if it hits right edge
                            : activeTranslation.x + 15,
                        width: '320px',
                        padding: '1.25rem',
                        background: 'var(--glass-bg)',
                        backdropFilter: 'blur(30px)',
                        border: '1px solid var(--primary-color)',
                        borderRadius: '20px',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                        zIndex: 10001,
                        color: 'var(--text-color)',
                        fontSize: '0.9375rem',
                        lineHeight: '1.7',
                        animation: 'popoverFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        pointerEvents: 'none'
                    }}
                >
                    {activeTranslation.loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0.5rem 0' }}>
                            <div className="loader small" style={{ width: '20px', height: '20px' }}></div>
                            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Đang dịch thuật AI...</span>
                        </div>
                    ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                            {activeTranslation.content}
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default DataTable;
