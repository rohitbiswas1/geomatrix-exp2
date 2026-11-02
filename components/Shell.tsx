'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  BrainCircuit,
  Database,
  FileText,
  LayoutDashboard,
  Map,
  Search,
  ShieldCheck,
  Users,
  LogOut,
  Sun,
  Moon,
  Laptop,
  Clock,
  Cpu
} from 'lucide-react';
import { useEffect, useState } from 'react';

type ThemeMode = 'system' | 'light' | 'dark';

function formatIndiaDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.day} ${values.month} ${values.year} · ${values.hour}:${values.minute} IST`;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [userInfo, setUserInfo] = useState<{ role?: string; email?: string } | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [systemStatus, setSystemStatus] = useState<'checking' | 'operational' | 'degraded'>('checking');
  const [openAlertCount, setOpenAlertCount] = useState<number | null>(null);

  const [authError, setAuthError] = useState('');
  const login = path === '/login';

  useEffect(() => {
    if (login) { setUserInfo(null); return; }
    let active = true;
    const controller = new AbortController();
    const verify = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal });
        if (!active) return;
        if (response.status === 401) {
          setUserInfo(null);
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Sign-in service is unavailable. Please reload to retry.');
        const data = await response.json();
        if (active) { setUserInfo(data.user); setAuthError(''); }
      } catch (error) {
        if (active) { setUserInfo(null); setAuthError(error instanceof Error ? error.message : 'Could not verify sign-in.'); }
      }
    };
    void verify();
    const timer = window.setInterval(verify, 60000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [login, router]);

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    if (login || !userInfo) return;
    const apiBase = '';
    Promise.all([
      fetch(`${apiBase}/api/projects/dashboard-summary`, { cache: 'no-store' }),
      fetch(`${apiBase}/api/alerts/summary`, { cache: 'no-store' }),
    ])
      .then(async ([summaryResponse, alertsResponse]) => {
        if (!summaryResponse.ok || !alertsResponse.ok) throw new Error('Service health check failed');
        return Promise.all([summaryResponse.json(), alertsResponse.json()]);
      })
      .then(([summary, alertSummary]) => {
        if (!active) return;
        setSystemStatus(summary.data_available === false ? 'degraded' : 'operational');
        setOpenAlertCount(typeof alertSummary.open === 'number' ? alertSummary.open : null);
      })
      .catch(() => {
        if (active) setSystemStatus('degraded');
      });
    return () => { active = false; };
  }, [login, userInfo]);

  // Theme synchronization - default to light
  useEffect(() => {
    const saved = localStorage.getItem('geomatrix-theme') as ThemeMode | null;
    if (saved) {
      setThemeMode(saved);
    } else {
      setThemeMode('dark');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('geomatrix-theme', themeMode);
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const active = themeMode === 'system' ? (media.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.setAttribute('data-theme', active);
    };

    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themeMode]);

  if (login) return <>{children}</>;

  if (!userInfo) return <main role="status">{authError || 'Checking sign-in…'}</main>;

  const logout = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out failed. Please try again.');
      setUserInfo(null);
      router.replace('/login');
    } catch {
      setAuthError('Sign-out failed. Please try again.');
    }
  };

  const nav = [
    ['/dashboard', 'Command Center', LayoutDashboard],
    ['/projects', 'Projects', Users],
    ['/map', 'GIS Risk Map', Map],
    ['/alerts', 'Alerts', Bell],
    ['/analytics', 'Analytics', BrainCircuit],
    ['/reports', 'Reports', FileText],
    ['/data', 'Data Management', Database],
    ['/model', 'Model Intelligence', Cpu],
  ] as const;

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && q.trim()) {
      router.push('/projects?search=' + encodeURIComponent(q.trim()));
    }
  };

  const sectionName =
    path === '/dashboard'
      ? 'Command Center'
      : path.split('/')[1]?.charAt(0).toUpperCase() + path.split('/')[1]?.slice(1) || 'Dashboard';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            <Map size={19} />
          </div>
          <div>
            <b>GEOMATRIX</b>
            <small>LAND ACQUISITION AI</small>
          </div>
        </div>

        <nav className="nav">
          {nav.map(([href, label, Icon]) => {
            const isActive = path.startsWith(href);
            return (
              <Link key={href} href={href} className={isActive ? 'active' : ''}>
                <Icon size={16} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebottom">
          <div className="userline">
            <div>
              <b style={{ fontSize: 13 }}>{userInfo.role || 'Project Officer'}</b>
              <div className="role">{userInfo.email}</div>
            </div>
            <ShieldCheck size={16} color="#60a5fa" />
          </div>
          <button className="btn sidebar-logout" onClick={logout}>
            <LogOut size={13} /> Logout
          </button>
          {authError && <p role="alert">{authError}</p>}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            GovTech Decision Support / <strong>{sectionName}</strong>
          </div>

          <div className="search">
            <Search className="search-icon" size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={handleSearchSubmit}
              placeholder="Search project code, name, district, or agency…"
              aria-label="Search projects"
            />
            <span className="search-kbd">↵ Enter</span>
          </div>

          <div className="topright">
            <div className={`status-badge status-${systemStatus}`} title="Live API service status">
              <span className="pulse-dot" />
              <span>{systemStatus === 'operational' ? 'System Operational' : systemStatus === 'degraded' ? 'Service Degraded' : 'Checking Services'}</span>
            </div>

            <div className="topbar-date">
              <Clock size={13} />
              <span>{currentTime ? formatIndiaDateTime(currentTime) : '—'}</span>
            </div>

            <button
              className="topbar-icon-btn"
              title={openAlertCount == null ? 'Priority alerts unavailable' : `${openAlertCount} open priority alerts`}
              onClick={() => router.push('/alerts')}
              aria-label="View alerts"
            >
              <Bell size={15} />
              {openAlertCount != null && <span className="topbar-badge">{openAlertCount}</span>}
            </button>

            <div className="theme-switch-group" role="radiogroup" aria-label="Theme selector">
              <button
                type="button"
                className={`theme-switch-btn ${themeMode === 'light' ? 'active' : ''}`}
                onClick={() => setThemeMode('light')}
                title="Light mode"
                aria-checked={themeMode === 'light'}
              >
                <Sun size={13} />
              </button>
              <button
                type="button"
                className={`theme-switch-btn ${themeMode === 'dark' ? 'active' : ''}`}
                onClick={() => setThemeMode('dark')}
                title="Dark mode"
                aria-checked={themeMode === 'dark'}
              >
                <Moon size={13} />
              </button>
              <button
                type="button"
                className={`theme-switch-btn ${themeMode === 'system' ? 'active' : ''}`}
                onClick={() => setThemeMode('system')}
                title="Follow system theme"
                aria-checked={themeMode === 'system'}
              >
                <Laptop size={13} />
              </button>
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
