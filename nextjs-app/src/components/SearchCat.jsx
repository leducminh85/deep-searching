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
    const appearTimeRef = useRef(0);

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
        if (searchTags.length === 0) {
            setVisible(false);
            setMessage(null);
            prevTagsRef.current = [];
            return;
        }

        prevTagsRef.current = [...searchTags];
        let newMessage = null;

        // Scan ALL tags for issues, prioritizing the first one found
        for (const tag of searchTags) {
            const words = tag.split(/\s+/).filter(w => w);

            // Rule 1: Keyword too long (>= 3 words)
            if (words.length >= 3) {
                newMessage = {
                    type: 'long',
                    text: `Meo~! Từ khóa "${tag}" vẫn còn hơi dài đó 🐱 Hãy chia nhỏ nó ra nhé!`,
                };
                break;
            }

            // Rule 2: Spell check using typo-js
            if (isCheckerReady) {
                for (const word of words) {
                    const lowerWord = word.toLowerCase();
                    if (lowerWord.length < 3 || /^\d+$/.test(lowerWord)) continue;
                    if (knownWords.has(lowerWord)) continue;

                    if (!checkSpelling(lowerWord)) {
                        newMessage = {
                            type: 'typo',
                            text: `Meo~? Từ "${word}" đang bị sai chính tả kìa, sửa lại đi nhé 😿`,
                        };
                        break;
                    }
                }
            }
            if (newMessage) break;
        }

        if (newMessage) {
            setIsLeaving(false);
            setMessage(newMessage);
            setVisible(true);
            appearTimeRef.current = Date.now();
        } else {
            // No issues found in any tags -> hide
            setIsLeaving(true);
            setTimeout(() => {
                setVisible(false);
                setMessage(null);
            }, 500);
        }
    }, [searchTags.join('|'), isCheckerReady, knownWords]);

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
