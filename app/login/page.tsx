"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Map, Sun, Moon, Laptop, Loader2 } from 'lucide-react';

import { loadGoogleIdentity } from '../../lib/googleIdentity';

type ThemeMode = 'system' | 'light' | 'dark';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark');
  const [sessionState, setSessionState] = useState<'checking' | 'signed-out' | 'redirecting'>('checking');
  const [sdkState, setSdkState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  const [slowSignIn, setSlowSignIn] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const googleInitRef = useRef(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  const signInRequest = useRef<AbortController | null>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const isGoogleAuthReady = Boolean(googleClientId) && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 75000);
    fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!active.current) return;
        if (response.ok && (await response.json()).user) {
          setSessionState('redirecting');
          router.replace('/dashboard');
        } else {
          setSessionState('signed-out');
        }
      })
      .catch(() => { if (active.current) setSessionState('signed-out'); })
      .finally(() => window.clearTimeout(timer));
    return () => { active.current = false; controller.abort(); signInRequest.current?.abort(); window.clearTimeout(timer); };
  }, [router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('geomatrix-theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') setThemeMode(saved);
    } catch { /* The system theme works when browser storage is unavailable. */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('geomatrix-theme', themeMode); } catch { /* Theme remains usable. */ }
    if (themeMode !== 'system') { setEffectiveTheme(themeMode); return; }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setEffectiveTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [themeMode]);

  const handleCredential = useCallback(async ({ credential }: { credential: string }) => {
    if (!active.current || inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    setError('');
    setNotice('');
    setSlowSignIn(false);
    const controller = new AbortController();
    signInRequest.current = controller;
    const slowTimer = window.setTimeout(() => { if (active.current) setSlowSignIn(true); }, 7000);
    const timeout = window.setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Sign-in could not be completed. Please try again.');
      if (!active.current) return;
      setSessionState('redirecting');
      router.replace('/dashboard');
      router.refresh();
    } catch (signInError) {
      if (active.current) {
        setError(controller.signal.aborted ? 'Sign-in took too long. Please try again.' :
          signInError instanceof Error ? signInError.message : 'Sign-in could not be completed. Please try again.');
        setIsLoading(false);
        setSlowSignIn(false);
      }
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
      inFlight.current = false;
      signInRequest.current = null;
    }
  }, [router]);

  useEffect(() => {
    if (!isGoogleAuthReady || sessionState !== 'signed-out') return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    setSdkState('loading');
    loadGoogleIdentity().then((google) => {
      if (disposed || !googleButton.current) return;
      if (!googleInitRef.current) {
        google.accounts.id.initialize({ client_id: googleClientId || '', callback: handleCredential });
        googleInitRef.current = true;
      }
      let lastWidth = 0;
      const draw = () => {
        const element = googleButton.current;
        if (disposed || !element) return;
        const width = Math.max(200, Math.min(400, Math.floor(element.clientWidth)));
        if (width === lastWidth) return;
        lastWidth = width;
        element.replaceChildren();
        google.accounts.id.renderButton(element, {
          theme: effectiveTheme === 'dark' ? 'filled_blue' : 'outline',
          size: 'large', width, text: 'continue_with',
          click_listener: () => { setError(''); setNotice('Choose your Google account to continue.'); },
        });
      };
      draw();
      observer = new ResizeObserver(draw);
      observer.observe(googleButton.current);
      setSdkState('ready');
    }).catch((sdkError: unknown) => {
      if (disposed) return;
      setSdkState('error');
      setError(sdkError instanceof Error ? sdkError.message : 'Google sign-in could not load. Please try again.');
    });
    return () => { disposed = true; observer?.disconnect(); };
  }, [isGoogleAuthReady, sessionState, googleClientId, effectiveTheme, handleCredential, retry]);

  return (
    <div className={`login-page-wrapper theme-${effectiveTheme}`} data-theme={effectiveTheme}>
      <style>{`
        .login-page-wrapper {
          --bg-overlay-dark: radial-gradient(circle at 50% 30%, rgba(15, 23, 42, 0.72) 0%, rgba(5, 18, 38, 0.92) 80%);
          --bg-overlay-light: radial-gradient(circle at 50% 30%, rgba(15, 23, 42, 0.55) 0%, rgba(5, 18, 38, 0.85) 80%);
          
          --card-bg-dark: rgba(11, 27, 49, 0.78);
          --card-bg-light: rgba(255, 255, 255, 0.88);
          
          --card-border-dark: rgba(255, 255, 255, 0.14);
          --card-border-light: rgba(255, 255, 255, 0.7);

          --card-shadow-dark: 0 24px 60px -12px rgba(0, 0, 0, 0.65), 0 0 35px rgba(37, 99, 235, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.12);
          --card-shadow-light: 0 24px 60px -12px rgba(5, 25, 48, 0.3), 0 0 35px rgba(37, 99, 235, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9);

          --text-main-dark: #f8fafc;
          --text-main-light: #0f172a;

          --text-muted-dark: #94a3b8;
          --text-muted-light: #475569;

          --input-bg-dark: rgba(15, 23, 42, 0.65);
          --input-bg-light: rgba(248, 250, 252, 0.9);

          --input-border-dark: rgba(255, 255, 255, 0.15);
          --input-border-light: rgba(203, 213, 225, 0.9);

          --chip-bg-dark: rgba(30, 41, 59, 0.7);
          --chip-bg-light: rgba(241, 245, 249, 0.9);

          --chip-border-dark: rgba(255, 255, 255, 0.12);
          --chip-border-light: rgba(203, 213, 225, 0.8);
          
          position: relative;
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: var(--text-main);
          box-sizing: border-box;
          overflow-x: hidden;
          background: #051930 url('/geomatrix-landscape.png') center / cover no-repeat fixed;
        }

        .login-page-wrapper.theme-dark {
          --text-main: var(--text-main-dark);
          --text-muted: var(--text-muted-dark);
          --card-bg: var(--card-bg-dark);
          --card-border: var(--card-border-dark);
          --card-shadow: var(--card-shadow-dark);
          --input-bg: var(--input-bg-dark);
          --input-border: var(--input-border-dark);
          --chip-bg: var(--chip-bg-dark);
          --chip-border: var(--chip-border-dark);
        }

        .login-page-wrapper.theme-light {
          --text-main: var(--text-main-light);
          --text-muted: var(--text-muted-light);
          --card-bg: var(--card-bg-light);
          --card-border: var(--card-border-light);
          --card-shadow: var(--card-shadow-light);
          --input-bg: var(--input-bg-light);
          --input-border: var(--input-border-light);
          --chip-bg: var(--chip-bg-light);
          --chip-border: var(--chip-border-light);
        }

        /* Dark overlay layer behind content — strong enough to suppress bg watermark text */
        .login-backdrop-overlay {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: radial-gradient(ellipse at 50% 40%, rgba(8, 18, 36, 0.80) 0%, rgba(4, 14, 30, 0.97) 100%),
                      linear-gradient(180deg, rgba(5, 18, 38, 0.55) 0%, rgba(5, 18, 38, 0.88) 100%);
          pointer-events: none;
        }

        .login-page-wrapper *, .login-page-wrapper *::before, .login-page-wrapper *::after { box-sizing: border-box; }

        /* Top Navigation / Brand Header */
        .login-header-bar {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 24px 40px;
          gap: 16px;
          flex-wrap: wrap;
        }

        .brand-link {
          display: flex;
          align-items: center;
          gap: 14px;
          text-decoration: none;
          color: #ffffff;
        }

        .brand-icon-box {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.35), rgba(29, 78, 216, 0.15));
          border: 1px solid rgba(147, 197, 253, 0.35);
          display: grid;
          place-items: center;
          color: #60a5fa;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          flex-shrink: 0;
        }

        .brand-text-col {
          display: flex;
          flex-direction: column;
          line-height: 1.15;
        }

        .brand-title {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #ffffff;
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .brand-sub {
          font-size: 10px;
          font-weight: 600;
          color: #93c5fd;
          letter-spacing: 0.08em;
          margin-top: 3px;
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 14px;
        }



        /* Theme Selector Pill */
        .theme-pill-group {
          display: flex;
          align-items: center;
          padding: 3px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 9999px;
          backdrop-filter: blur(10px);
        }

        .theme-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 9999px;
          border: none;
          background: transparent;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .theme-btn:hover {
          color: #ffffff;
        }

        .theme-btn.active {
          background: rgba(37, 99, 235, 0.85);
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
        }

        .theme-btn:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: 1px;
        }

        /* Main Center Workspace */
        .login-center-container {
          position: relative;
          z-index: 10;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px 20px 60px;
          width: 100%;
          max-width: 1100px;
          margin: 0 auto;
        }

        /* Hero Text Header above card */
        .hero-header {
          text-align: center;
          margin-bottom: 24px;
          max-width: 600px;
        }

        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #60a5fa;
          margin-bottom: 8px;
        }

        .hero-headline {
          font-size: 26px;
          font-weight: 800;
          color: #ffffff;
          line-height: 1.25;
          margin: 0 0 8px;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
        }

        .hero-description {
          font-size: 13px;
          color: #cbd5e1;
          line-height: 1.5;
          margin: 0;
        }

        /* Blended Glass Card */
        .glass-card {
          width: min(440px, 100%);
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          box-shadow: var(--card-shadow);
          border-radius: 20px;
          padding: 36px 32px;
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .card-header {
          margin-bottom: 24px;
          text-align: center;
        }

        .card-header h2 {
          font-size: 20px;
          font-weight: 700;
          margin: 0 0 6px;
          color: var(--text-main);
        }

        .card-header p {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        /* Demo Account Quick Chips */
        .demo-chips-section {
          margin-bottom: 20px;
          padding: 12px;
          border-radius: 12px;
          background: var(--chip-bg);
          border: 1px solid var(--chip-border);
        }

        .demo-chips-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .demo-chips-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }

        .demo-chip-btn {
          padding: 7px 4px;
          border-radius: 8px;
          border: 1px solid var(--chip-border);
          background: var(--input-bg);
          color: var(--text-main);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .demo-chip-btn:hover {
          border-color: #3b82f6;
          background: rgba(37, 99, 235, 0.15);
          color: #3b82f6;
          transform: translateY(-1px);
        }

        .demo-chip-btn.active {
          border-color: #2563eb;
          background: rgba(37, 99, 235, 0.2);
          color: #60a5fa;
        }

        .demo-chip-role {
          font-size: 11px;
          font-weight: 700;
        }

        .demo-chip-sub {
          font-size: 8px;
          color: var(--text-muted);
          font-weight: 500;
        }

        /* Form Inputs */
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 20px;
        }

        .field-unit {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-main);
          display: flex;
          justify-content: space-between;
        }

        .input-relative {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          color: var(--text-muted);
          pointer-events: none;
          transition: color 0.2s ease;
        }

        .text-input {
          width: 100%;
          height: 44px;
          padding: 0 14px 0 42px;
          border-radius: 10px;
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-main);
          font-size: 13px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .text-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
          background: var(--card-bg);
        }

        .text-input:focus + .input-icon,
        .input-relative:focus-within .input-icon {
          color: #3b82f6;
        }

        /* Error Alert */
        .error-alert {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 16px;
        }

        /* Primary Submit Button */
        .submit-btn {
          width: 100%;
          height: 44px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
          transition: all 0.2s ease;
        }

        .submit-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
          box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
          transform: translateY(-1px);
        }

        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-btn:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: 2px;
        }

        .submit-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* Divider */
        .divider-line {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 18px 0;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 500;
        }

        .divider-line::before,
        .divider-line::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--input-border);
        }

        /* Google Login Button */
        .google-button-wrapper {
          position: relative;
          width: 100%;
          min-height: 44px;
          display: flex;
          justify-content: center;
        }

        .google-button {
          width: 100%;
          min-width: 0;
          min-height: 44px;
        }

        .sign-in-loading {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-main);
        }

        .sign-in-unavailable { position: absolute; margin: 0; font-size: 12px; text-align: center; }
        .sign-in-notice { min-height: 18px; margin: 12px 0 0; font-size: 12px; line-height: 1.5; text-align: center; color: var(--text-muted); }

        .google-fallback-btn {
          width: 100%;
          height: 44px;
          border-radius: 10px;
          border: 1px solid var(--input-border);
          background: var(--input-bg);
          color: var(--text-main);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: all 0.2s ease;
        }

        .google-fallback-btn:hover:not(:disabled) {
          border-color: #3b82f6;
          background: var(--chip-bg);
          transform: translateY(-1px);
        }

        .google-fallback-btn:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: 2px;
        }

        /* Card Footer Disclaimer */
        .card-footer {
          margin-top: 22px;
          padding-top: 14px;
          border-top: 1px solid var(--input-border);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
        }

        /* Spinning loader animation */
        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* Responsive Breakpoints */
        @media (max-width: 640px) {
          .login-header-bar {
            padding: 16px 20px;
          }

          .sih-badge {
            display: none;
          }

          .hero-headline {
            font-size: 21px;
          }

          .hero-description {
            font-size: 12px;
          }

          .login-center-container {
            padding: 10px 16px 40px;
          }

          .glass-card {
            padding: 26px 22px;
            border-radius: 16px;
          }

          .brand-title {
            font-size: 16px;
          }

          .brand-sub {
            font-size: 9px;
          }
        }
      `}</style>

      {/* Dark overlay over background landscape image */}
      <div className="login-backdrop-overlay" aria-hidden="true" />

      {/* Header bar */}
      <header className="login-header-bar">
        <a href="#main" className="brand-link">
          <div className="brand-icon-box">
            <Map size={20} />
          </div>
          <div className="brand-text-col">
            <span className="brand-title">GEOMATRIX</span>
            <span className="brand-sub">LAND ACQUISITION AI</span>
          </div>
        </a>

        <div className="header-controls">
          <div className="theme-pill-group" role="radiogroup" aria-label="Theme mode selector">
            <button
              type="button"
              className={`theme-btn ${themeMode === 'light' ? 'active' : ''}`}
              onClick={() => setThemeMode('light')}
              aria-checked={themeMode === 'light'}
              role="radio"
              title="Light theme"
            >
              <Sun size={13} />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={`theme-btn ${themeMode === 'dark' ? 'active' : ''}`}
              onClick={() => setThemeMode('dark')}
              aria-checked={themeMode === 'dark'}
              role="radio"
              title="Dark theme"
            >
              <Moon size={13} />
              <span>Dark</span>
            </button>
            <button
              type="button"
              className={`theme-btn ${themeMode === 'system' ? 'active' : ''}`}
              onClick={() => setThemeMode('system')}
              aria-checked={themeMode === 'system'}
              role="radio"
              title="System theme"
            >
              <Laptop size={13} />
              <span>System</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Center Content */}
      <main id="main" className="login-center-container">
        {/* Hero headline above card */}
        <div className="hero-header">
          <div className="hero-eyebrow">
            <span>Predict</span> · <span>Explain</span> · <span>Prioritize</span> · <span>Act</span>
          </div>
          <h1 className="hero-headline">Land Acquisition Risk Intelligence</h1>
          <p className="hero-description">
            Early-warning risk scoring, XAI factor diagnostics, and decision automation for infrastructure projects.
          </p>
        </div>

        {/* Centered Blended Glass Card */}
        <div className="glass-card">
          <div className="card-header">
            <h2>Command Center Sign In</h2>
            <p>Sign in with your Google account to continue.</p>
          </div>

          {error && (
            <div className="error-alert" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="google-button-wrapper" aria-busy={sessionState !== 'signed-out' || isLoading || (isGoogleAuthReady && sdkState === 'loading')}>
            <div ref={googleButton} className="google-button"
              style={{ visibility: sessionState === 'signed-out' && sdkState === 'ready' && !isLoading ? 'visible' : 'hidden' }} />
            {(sessionState !== 'signed-out' || isLoading || (isGoogleAuthReady && sdkState === 'loading')) && (
              <div className="sign-in-loading" role="status">
                <Loader2 size={18} className="spinner" aria-hidden="true" />
                <span>{sessionState === 'checking' ? 'Checking your session…' : sessionState === 'redirecting' ? 'Opening your dashboard…' : isLoading ? 'Signing you in…' : 'Loading Google sign-in…'}</span>
              </div>
            )}
            {sessionState === 'signed-out' && !isGoogleAuthReady && (
              <p className="sign-in-unavailable" role="status">Google sign-in is currently unavailable. Please contact the administrator.</p>
            )}
          </div>
          {sdkState === 'error' && (
            <button type="button" className="google-fallback-btn" onClick={() => { setError(''); setSdkState('loading'); setRetry((value) => value + 1); }}>
              Retry Google sign-in
            </button>
          )}
          <p className="sign-in-notice" role="status" aria-live="polite">
            {slowSignIn ? 'The sign-in service is starting. This may take up to a minute.' : notice}
          </p>

          <div className="card-footer">
            <ShieldCheck size={14} style={{ color: '#10b981' }} />
            <span>Secure Google sign-in</span>
          </div>
        </div>
      </main>
    </div>
  );
}
