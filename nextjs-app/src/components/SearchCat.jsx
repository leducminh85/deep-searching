'use client';

import React, { useState, useEffect, useRef } from 'react';

/**
 * SearchCat — A cute animated cat assistant that sits above the search bar
 * and gives suggestions WHILE TYPING:
 * - Keywords are too long (>= 3 words) → suggests splitting
 * - Keywords might have typos → identifies the misspelled word (without guessing)
 */

const COMMON_SEARCH_WORDS = [
    'video', 'music', 'news', 'tutorial', 'review', 'react', 'gaming', 'movie',
    'trailer', 'comedy', 'drama', 'anime', 'vlog', 'podcast', 'interview',
    'documentary', 'live', 'stream', 'highlight', 'compilation', 'analysis',
    'breakdown', 'explained', 'summary', 'technology', 'science', 'history',
    'politics', 'economy', 'finance', 'crypto', 'bitcoin', 'stock', 'market',
    'trump', 'biden', 'china', 'russia', 'ukraine', 'war', 'peace', 'trade',
    'tariff', 'election', 'debate', 'congress', 'senate', 'president',
    'inflation', 'recession', 'investment', 'startup', 'artificial', 'intelligence',
    'machine', 'learning', 'deep', 'search', 'youtube', 'channel', 'subscribe',
    'world', 'global', 'international', 'national', 'breaking', 'update',
    'latest', 'today', 'week', 'month', 'year', 'best', 'worst', 'top',
];

function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function isLikelyTypo(word) {
    const lowerWord = word.toLowerCase();
    if (lowerWord.length < 3) return false;
    
    // If it's in dictionary, it's correct
    if (COMMON_SEARCH_WORDS.includes(lowerWord)) return false;

    // If it's VERY close to a dictionary word (distance 1 or 2), it's likely a typo
    for (const dictWord of COMMON_SEARCH_WORDS) {
        const dist = levenshteinDistance(lowerWord, dictWord);
        if (dist > 0 && dist <= 2) {
            return true;
        }
    }
    return false;
}

const SearchCat = ({ inputValue, searchTags, anchorRef, inputRef }) => {
    const [message, setMessage] = useState(null);
    const [visible, setVisible] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const hideTimeoutRef = useRef(null);
    const prevTagsRef = useRef([]);

    // Update position based on inputRef (near the input)
    useEffect(() => {
        if (!visible || !inputRef?.current) return;

        const updatePosition = () => {
            const rect = inputRef.current.getBoundingClientRect();
            setPosition({
                top: rect.top,
                left: rect.left + 20,
            });
        };

        updatePosition();
        window.addEventListener('scroll', updatePosition, { passive: true });
        window.addEventListener('resize', updatePosition, { passive: true });
        return () => {
            window.removeEventListener('scroll', updatePosition);
            window.removeEventListener('resize', updatePosition);
        };
    }, [visible, inputRef]);

    // Analyze searchTags when they change
    useEffect(() => {
        // Only trigger if tags changed (not typing)
        if (searchTags.length === prevTagsRef.current.length) {
            // However, if the user is typing, we might want to hide the cat
            if (inputValue.trim().length > 0 && visible) {
                setIsLeaving(true);
                if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = setTimeout(() => {
                    setVisible(false);
                    setMessage(null);
                }, 500);
            }
            return;
        }

        prevTagsRef.current = searchTags;

        if (searchTags.length === 0) {
            setVisible(false);
            setMessage(null);
            return;
        }

        const lastTag = searchTags[searchTags.length - 1];
        let newMessage = null;

        // Rule 1: Keyword too long (>= 3 words)
        const words = lastTag.split(/\s+/).filter(w => w);
        if (words.length >= 3) {
            newMessage = {
                type: 'long',
                text: `Meo~! Từ khóa "${lastTag}" hơi dài đó 🐱 Lần sau thử tách nhỏ ra sẽ tìm chính xác hơn nha!`,
            };
        }

        // Rule 2: Spell check (Identify only)
        if (!newMessage) {
            for (const word of words) {
                if (isLikelyTypo(word)) {
                    newMessage = {
                        type: 'typo',
                        text: `Meo~? Hình như từ "${word}" trong từ khóa bạn vừa nhập bị viết sai chính tả rồi kìa 😿`,
                    };
                    break;
                }
            }
        }

        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
        }

        if (newMessage) {
            setIsLeaving(false);
            setMessage(newMessage);
            setVisible(true);
            
            // Auto hide after 8 seconds
            hideTimeoutRef.current = setTimeout(() => {
                setIsLeaving(true);
                setTimeout(() => {
                    setVisible(false);
                    setMessage(null);
                }, 500);
            }, 8000);
        } else {
            setVisible(false);
            setMessage(null);
        }
    }, [searchTags, inputValue]);

    if (!visible || !message) return null;

    return (
        <div
            className={`search-cat-container ${isLeaving ? 'leaving' : 'entering'}`}
            style={{
                position: 'fixed',
                top: `${position.top}px`,
                left: `${position.left}px`,
            }}
        >
            {/* The Cat First */}
            <div className="cat-character">
                <div className="cat-body">
                    <div className="cat-ear cat-ear-left" />
                    <div className="cat-ear cat-ear-right" />
                    <div className="cat-head">
                        <div className="cat-eyes">
                            <div className="cat-eye"><div className="cat-pupil" /></div>
                            <div className="cat-eye"><div className="cat-pupil" /></div>
                        </div>
                        <div className="cat-nose" />
                        <div className="cat-mouth" />
                        <div className="cat-whiskers-left">
                            <div className="whisker" /><div className="whisker" /><div className="whisker" />
                        </div>
                        <div className="cat-whiskers-right">
                            <div className="whisker" /><div className="whisker" /><div className="whisker" />
                        </div>
                    </div>
                    <div className="cat-paws">
                        <div className="cat-paw cat-paw-left" />
                        <div className="cat-paw cat-paw-right" />
                    </div>
                </div>
                <div className="cat-tail" />
            </div>

            {/* Speech Bubble Second (to the right) */}
            <div className="cat-speech-bubble">
                <p>{message.text}</p>
                <div className="speech-bubble-tail" />
            </div>
        </div>
    );
};

export default SearchCat;
