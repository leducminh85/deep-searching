'use client';

import React, { useState, useEffect, useRef } from 'react';

/**
 * SearchCat — A futuristic holographic cat assistant
 * Translucent blue with glowing effects and rich animations
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

        // Scan ALL tags for issues
        for (const tag of searchTags) {
            const words = tag.split(/\s+/).filter(w => w);

            if (words.length >= 3) {
                newMessage = {
                    type: 'long',
                    text: `Từ khóa "${tag}" dài nên sẽ hơi khó tìm kiếm đó 🐱 Nên chia nó ra thành nhiều từ nhỏ nhé!`,
                };
                break;
            }

            if (isCheckerReady) {
                for (const word of words) {
                    const lowerWord = word.toLowerCase();
                    if (lowerWord.length < 3 || /^\d+$/.test(lowerWord)) continue;
                    if (knownWords.has(lowerWord)) continue;

                    if (!checkSpelling(lowerWord)) {
                        newMessage = {
                            type: 'typo',
                            text: `Từ "${word}" đang bị sai chính tả kìa, sửa lại đi nhé 😿`,
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
            {/* Holographic Cat */}
            <div className="holo-cat">
                {/* Glow base */}
                <div className="holo-cat-glow" />

                {/* Scan line overlay */}
                <div className="holo-cat-scanlines" />

                {/* Ears */}
                <div className="holo-ear holo-ear-left">
                    <div className="holo-ear-inner" />
                </div>
                <div className="holo-ear holo-ear-right">
                    <div className="holo-ear-inner" />
                </div>

                {/* Head */}
                <div className="holo-head">
                    {/* Eyes */}
                    <div className="holo-eyes">
                        <div className="holo-eye">
                            <div className="holo-eye-glow" />
                            <div className="holo-pupil" />
                        </div>
                        <div className="holo-eye">
                            <div className="holo-eye-glow" />
                            <div className="holo-pupil" />
                        </div>
                    </div>

                    {/* Nose */}
                    <div className="holo-nose" />

                    {/* Mouth */}
                    <div className="holo-mouth">
                        <div className="holo-mouth-line" />
                    </div>

                    {/* Whiskers */}
                    <div className="holo-whiskers holo-whiskers-left">
                        <span /><span /><span />
                    </div>
                    <div className="holo-whiskers holo-whiskers-right">
                        <span /><span /><span />
                    </div>
                </div>

                {/* Paws */}
                <div className="holo-paws">
                    <div className="holo-paw" />
                    <div className="holo-paw" />
                </div>

                {/* Tail */}
                <div className="holo-tail" />

                {/* Floating particles */}
                <div className="holo-particles">
                    <span className="particle p1" />
                    <span className="particle p2" />
                    <span className="particle p3" />
                    <span className="particle p4" />
                    <span className="particle p5" />
                </div>
            </div>

            {/* Holographic Speech Bubble */}
            <div className="holo-speech-bubble">
                <div className="holo-bubble-border" />
                <p>{message.text}</p>
                <div className="holo-bubble-tail" />
                <div className="holo-bubble-scanlines" />
            </div>
        </div>
    );
};

export default SearchCat;
