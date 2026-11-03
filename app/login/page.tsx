"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Map, Sun, Moon, Laptop, Loader2, ArrowRight, Eye, EyeOff, Layers, ChartNoAxesCombined, Radar } from 'lucide-react';
import './login.css';

import { authErrorMessage } from '../../lib/authErrors';
import { loadGoogleIdentity } from '../../lib/googleIdentity';

type ThemeMode = 'system' | 'light' | 'dark';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
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
  const passwordAuthEnabled = process.env.NEXT_PUBLIC_PASSWORD_AUTH_ENABLED !== 'false';
  const googleSignInUrl = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_URL?.trim();
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const isGoogleAuthReady = Boolean(googleClientId) && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

  useEffect(() => {
    active.current = true;
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 145000);
    fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (disposed) return;
        const session = response.ok ? await response.json() : null;
        if (disposed) return;
        if (session?.user) {
          setSessionState('redirecting');
          window.location.replace('/dashboard');
        } else {
          setSessionState('signed-out');
        }
      })
      .catch(() => { if (!disposed) setSessionState('signed-out'); })
      .finally(() => window.clearTimeout(timer));
    return () => { disposed = true; active.current = false; controller.abort(); signInRequest.current?.abort(); window.clearTimeout(timer); };
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

  const authenticate = useCallback(async (endpoint: string, body: Record<string, string>) => {
    if (!active.current || inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    setError('');
    setNotice('');
    setSlowSignIn(false);
    const controller = new AbortController();
    signInRequest.current = controller;
    const slowTimer = window.setTimeout(() => { if (active.current) setSlowSignIn(true); }, 7000);
    const timeout = window.setTimeout(() => controller.abort(), 145000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(authErrorMessage(result, 'Sign-in could not be completed. Please try again.'));
      if (!result || typeof result.email !== 'string') throw new Error('The sign-in service returned an unexpected response. Please try again.');
      if (!active.current) return;
      setSessionState('redirecting');
      window.location.replace('/dashboard');
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

  const handleCredential = useCallback(({ credential }: { credential: string }) => {
    void authenticate('/api/auth/google', { credential });
  }, [authenticate]);

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'register' && password !== confirmation) { setError('Passwords do not match.'); return; }
    void authenticate(`/api/auth/${mode}`, { email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}) });
  }

  function switchMode(next: 'login' | 'register') {
    setMode(next); setPassword(''); setConfirmation(''); setShowPassword(false); setError(''); setNotice('');
  }

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

  const busy = isLoading || sessionState !== 'signed-out';
  const registering = mode === 'register';
  return (
    <div className={`login-page-wrapper theme-${effectiveTheme}`} data-theme={effectiveTheme}>
      <aside className="auth-story" aria-label="About GEOMATRIX">
        <a href="#main" className="auth-brand"><span className="auth-brand-icon"><Map size={23} /></span><span>GEOMATRIX<small>LAND ACQUISITION INTELLIGENCE</small></span></a>
        <div className="auth-story-content">
          <div className="auth-eyebrow"><span /> CLARITY AT EVERY STAGE</div>
          <h1>Better insight.<br />Stronger <em>decisions.</em></h1>
          <p>Bring your land acquisition projects into focus. Understand risk, track progress, and plan your next move.</p>
          <div className="auth-features">
            <div><span><Layers size={19} /></span><section><h2>One connected workspace</h2><p>Projects, milestones, and alerts in one place.</p></section></div>
            <div><span><ChartNoAxesCombined size={19} /></span><section><h2>Risk you can understand</h2><p>Explore the factors behind each prediction.</p></section></div>
            <div><span><Radar size={19} /></span><section><h2>Stay ahead of delays</h2><p>Spot issues early and act with context.</p></section></div>
          </div>
        </div>
        <div className="auth-story-footer"><span className="auth-status-dot" /> Built for informed infrastructure decisions</div>
      </aside>

      <div className="auth-panel">
        <header className="auth-panel-header">
          <a href="#main" className="auth-mobile-brand"><Map size={20} /> GEOMATRIX</a>
          <div className="auth-theme" role="radiogroup" aria-label="Theme mode selector">
            {([{ value: 'light', icon: Sun, label: 'Light' }, { value: 'dark', icon: Moon, label: 'Dark' }, { value: 'system', icon: Laptop, label: 'System' }] as const).map(({ value, icon: Icon, label }) => (
              <button key={value} type="button" role="radio" aria-checked={themeMode === value} aria-label={label} title={`${label} theme`} className={themeMode === value ? 'active' : ''} onClick={() => setThemeMode(value)}><Icon size={16} /></button>
            ))}
          </div>
        </header>

        <main id="main" className="auth-main">
          <div className="auth-form-card">
            <div className="auth-welcome-icon"><ShieldCheck size={25} /></div>
            <div className="auth-heading"><p className="auth-kicker">YOUR PROJECT COMMAND CENTER</p><h2>{registering ? 'Create your account' : 'Welcome back'}</h2><p>{registering ? 'A clearer view of your projects starts here.' : 'Sign in to continue to your workspace.'}</p></div>
            <div className="auth-tabs" aria-label="Account access">
              <button type="button" aria-pressed={!registering} disabled={busy} onClick={() => switchMode('login')}>Sign in</button>
              <button type="button" aria-pressed={registering} disabled={busy} onClick={() => switchMode('register')}>Create account</button>
            </div>

            {!passwordAuthEnabled && <p className="auth-availability" role="status">Email accounts are being set up. Continue with Google for now.</p>}
            {error && <div className="error-alert" role="alert">{error}</div>}
            <form onSubmit={submitPassword} aria-label={registering ? 'Create an account' : 'Sign in with email'}>
              <fieldset disabled={busy || !passwordAuthEnabled}>
                {registering && <div className="auth-field"><label htmlFor="auth-name">Full name</label><input id="auth-name" name="name" autoComplete="name" required maxLength={100} placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} /></div>}
                <div className="auth-field"><label htmlFor="auth-email">Email address <span>Your sign-in ID</span></label><input id="auth-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="auth-field"><label htmlFor="auth-password">Password</label><div className="auth-password"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 12 : 1} maxLength={128} required placeholder={registering ? 'Create a strong password' : 'Enter your password'} aria-describedby={registering ? 'password-help' : undefined} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{registering && <p id="password-help" className="auth-hint">Use 12–128 characters. A longer passphrase works well.</p>}</div>
                {registering && <div className="auth-field"><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} placeholder="Enter your password again" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>}
                <button className="auth-submit" type="submit">{busy ? <><Loader2 size={18} className="spinner" /> {sessionState === 'checking' ? 'Checking your session…' : sessionState === 'redirecting' ? 'Opening your dashboard…' : registering ? 'Creating your account…' : 'Signing you in…'}</> : <>{registering ? 'Create account' : 'Sign in'}<ArrowRight size={18} /></>}</button>
              </fieldset>
            </form>

            <div className="auth-divider"><span>or continue with Google</span></div>
            <div className="google-button-wrapper" aria-busy={busy || (isGoogleAuthReady && sdkState === 'loading')}>
              <div ref={googleButton} className="google-button" style={{ visibility: !busy && sdkState === 'ready' ? 'visible' : 'hidden' }} />
              {!busy && isGoogleAuthReady && sdkState === 'loading' && <div className="sign-in-loading" role="status"><Loader2 size={18} className="spinner" /> Loading Google sign-in…</div>}
              {!busy && !isGoogleAuthReady && (googleSignInUrl ? <a className="auth-google-link" href={googleSignInUrl}><span className="auth-google-letter" aria-hidden="true">G</span> Continue with Google<ArrowRight size={16} /></a> : <p className="auth-hint">Google sign-in is being configured. Please try again shortly.</p>)}
            </div>
            {!isGoogleAuthReady && googleSignInUrl && <p className="auth-hint auth-preview-note">Google sign-in opens the live GEOMATRIX site.</p>}
            {sdkState === 'error' && <button type="button" className="google-fallback-btn" disabled={busy} onClick={() => { setError(''); setSdkState('loading'); setRetry(value => value + 1); }}>Retry Google sign-in</button>}
            <p className="sign-in-notice" role="status" aria-live="polite">{slowSignIn ? 'The sign-in service is starting. This may take up to two minutes.' : notice}</p>
            <p className="auth-switch">{registering ? 'Already have an account?' : 'New to GEOMATRIX?'} <button type="button" disabled={busy} onClick={() => switchMode(registering ? 'login' : 'register')}>{registering ? 'Sign in' : 'Create an account'}</button></p>
            <div className="auth-security"><ShieldCheck size={14} /><span>Protected sign-in · Secure Google sign-in</span></div>
          </div>
        </main>
        <footer className="auth-panel-footer">GEOMATRIX <span>Land acquisition, with greater clarity.</span></footer>
      </div>
    </div>
  );
}
