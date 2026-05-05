'use client';

import React, { useState, useEffect, useRef } from 'react';

/**
 * SearchCat — A cute animated cat assistant that sits above the search bar
 * and gives suggestions WHILE TYPING:
 * - Keywords are too long (>= 3 words) → suggests splitting
 * - Keywords might have typos → identifies the misspelled word (without guessing)
 */

import { initSpellChecker, checkSpelling } from '@/lib/dictionary';

const SearchCat = ({ inputValue, searchTags, knownWords = new Set(), anchorRef, inputRef }) => {
    const [message, setMessage] = useState(null);
    const [visible, setVisible] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [isCheckerReady, setIsCheckerReady] = useState(false);
    const hideTimeoutRef = useRef(null);
    const prevTagsRef = useRef([]);

    // Initialize spell checker
    useEffect(() => {
        initSpellChecker().then(() => setIsCheckerReady(true));
    }, []);

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
        const prevLen = prevTagsRef.current.length;
        const currLen = searchTags.length;

        // No change in tags count = user is typing, not completing a tag
        if (currLen === prevLen) {
            // If the user is typing, hide the cat so it doesn't block
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

        // Tags were REMOVED — just update ref and hide, do NOT check
        if (currLen < prevLen) {
            prevTagsRef.current = [...searchTags];
            setVisible(false);
            setMessage(null);
            return;
        }

        // Tags were ADDED — this is when we check
        prevTagsRef.current = [...searchTags];

        const lastTag = searchTags[currLen - 1];
        let newMessage = null;

        // Rule 1: Keyword too long (>= 3 words)
        const words = lastTag.split(/\s+/).filter(w => w);
        if (words.length >= 3) {
            newMessage = {
                type: 'long',
                text: `Meo~! Từ khóa "${lastTag}" hơi dài đó 🐱 Lần sau thử tách nhỏ ra sẽ tìm chính xác hơn nha!`,
            };
        }

        // Rule 2: Spell check using typo-js (only if no long-keyword warning)
        if (!newMessage && isCheckerReady) {
            for (const word of words) {
                const lowerWord = word.toLowerCase();
                // Skip very short words and numbers
                if (lowerWord.length < 3 || /^\d+$/.test(lowerWord)) continue;

                // If the keyword was ever seen in autocomplete suggestions, it's valid
                if (knownWords.has(lowerWord)) continue;

                // Check actual spelling via typo-js dictionary
                if (!checkSpelling(lowerWord)) {
                    newMessage = {
                        type: 'typo',
                        text: `Meo~? Hình như từ "${word}" bị viết sai chính tả rồi kìa 😿`,
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
