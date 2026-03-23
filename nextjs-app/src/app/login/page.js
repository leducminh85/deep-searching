'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import createGlobe from 'cobe';
import './login.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const canvasRef = useRef(null);
  
  const pointerInteracting = useRef(null);
  const pointerInteractionMovement = useRef(0);

  useEffect(() => {
    let phi = 4.8; // Starting angle (Asia)
    let globe;
    let resizeTimeout;

    const initGlobe = () => {
        if (!canvasRef.current) return;
        
        // Setup responsive size
        const container = canvasRef.current.parentElement;
        let containerWidth = container.clientWidth;
        
        if (containerWidth === 0) {
            resizeTimeout = setTimeout(initGlobe, 100);
            return;
        }

        // Calculate a square size so it gracefully overflows the container
        const size = Math.max(containerWidth * 1.3, 800); 

        // Force exactly square dimensions on the canvas to prevent any CSS stretch/squish
        canvasRef.current.style.width = `${size}px`;
        canvasRef.current.style.height = `${size}px`;

        if (globe) globe.destroy();

        globe = createGlobe(canvasRef.current, {
          devicePixelRatio: 2,
          width: size * 2, // Multiply by 2 for retina crispness
          height: size * 2,
          phi: 4.8,
          theta: 0.25,
          dark: 1, // Dark mode
          diffuse: 1.2, // Light diffusion
          mapSamples: 24000, // Dot density
          mapBrightness: 8,
          baseColor: [0.08, 0.08, 0.25], // Deep space blue/purple
          markerColor: [0.957, 0.247, 0.365], // Rose/Pink markers
          glowColor: [0.15, 0.15, 0.35], // Outer glow
          markers: [
            { location: [21.0285, 105.8542], size: 0.08 }, // Hanoi
            { location: [10.7626, 106.6602], size: 0.08 }, // HCM
            { location: [35.6895, 139.6917], size: 0.05 }, // Tokyo
            { location: [37.7749, -122.4194], size: 0.05 }, // SF
            { location: [51.5074, -0.1278], size: 0.04 }   // London
          ],
          onRender: (state) => {
            // Auto-rotate if not being dragged
            if (pointerInteracting.current === null) {
                phi += 0.003;
            }
            state.phi = phi + pointerInteractionMovement.current;
            
            // Critical for perfectly round globe without ellipsis distortion
            state.width = size * 2;
            state.height = size * 2;
          }
        });
    }

    initGlobe();

    const onResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(initGlobe, 200);
    };
    window.addEventListener('resize', onResize);

    return () => {
      if (globe) globe.destroy();
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', onResize);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError(data.error || 'Đã có lỗi xảy ra');
      }
    } catch (err) {
      setError('Lỗi kết nối tới máy chủ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* Background Decor */}
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>
      
      <div className="login-main">
        {/* Left Side: Branding with Earth Globe */}
        <div className="login-left">
          <div className="globe-container">
            <canvas 
              ref={canvasRef} 
              className="cobe-canvas"
              onPointerDown={(e) => {
                pointerInteracting.current = e.clientX - pointerInteractionMovement.current;
                e.target.style.cursor = 'grabbing';
              }}
              onPointerUp={(e) => {
                pointerInteracting.current = null;
                e.target.style.cursor = 'grab';
              }}
              onPointerOut={(e) => {
                pointerInteracting.current = null;
                e.target.style.cursor = 'grab';
              }}
              onPointerMove={(e) => {
                if (pointerInteracting.current !== null) {
                  const delta = e.clientX - pointerInteracting.current;
                  pointerInteractionMovement.current = delta / 180; // Slower drag for realism
                }
              }}
            />
          </div>
          <div className="brand-content">
            <div className="logo-wrapper-large">
              <img src="/logo.png" alt="Logo" />
            </div>
            <h1 className="brand-title">Wevic</h1>
            <p className="brand-subtitle">Deep Video Search Engine</p>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="login-right">
          <div className="login-form-container">
            <div className="form-header">
              <h2>Đăng nhập</h2>
              <p>Vui lòng nhập thông tin để truy cập</p>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group-modern">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group-modern">
                <label>Mật khẩu</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button 
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex="-1"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="login-error">
                  {error}
                </div>
              )}

              <button 
                type="submit" 
                className="login-btn-premium" 
                disabled={loading}
              >
                {loading ? (
                  'Đang xử lý...'
                ) : (
                  <>
                    <span>Đăng nhập ngay</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
