'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface DashboardData {
  ok: boolean;
  clock: {
    serverNowMs: number;
    eventNowMs: number;
    paused: boolean;
    pausedAt: string | null;
    pausedTotalMs: number;
  };
  state: {
    phase: string;
    pausedAt: string | null;
    pausedTotalMs: number;
    r1EndMs: number | null;
    r2StartMs: number | null;
    run2OpenMs: number | null;
    r2HardEndMs: number | null;
    breakEndMs: number | null;
  };
  primaryAction: {
    action: string;
    label: string;
    enabled: boolean;
    reason?: string;
  } | null;
  stats: {
    totalTeams: number;
    qualifiedTeams: number;
    activeQRs: number;
  };
  teams: Array<{
    id: string;
    name: string;
    n: number;
    qualified: boolean;
    withdrawn: boolean;
    r3_eligible: boolean;
    runs?: any[];
    r2Points?: number | null;
    r2Rank?: number | null;
    r2LastMs?: number | null;
  }>;
  qrs: Array<{
    id: number;
    name: string;
    capacity: number;
    active: boolean;
    run1Count: number;
    run2Count: number;
  }>;
}

const HQNav = ({ active }: { active: string }) => {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '/hq', label: 'Dashboard' },
    { href: '/hq/event', label: 'Event Control' },
    { href: '/hq/teams', label: 'Teams & Students' },
    { href: '/hq/selection', label: 'Selection' },
    { href: '/hq/standings', label: 'Standings' },
    { href: '/hq/round3', label: 'Round 3' },
    { href: '/hq/content', label: 'Content' },
    { href: '/hq/qr', label: 'QR Locations' },
    { href: '/hq/interventions', label: 'Interventions' },
    { href: '/hq/logs', label: 'Log & Export' },
    { href: '/hq/settings', label: 'Settings' },
  ];

  return (
    <div>
      {/* Mobile Menu Button */}
      <div className="lg:hidden mt-2">
        <button
          onClick={() => setOpen(!open)}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-800 text-slate-200 border border-slate-700 flex items-center gap-2"
        >
          <span>☰ Menu</span>
          <span className="text-accent">{links.find((l) => l.href === active)?.label || 'Navigation'}</span>
        </button>
        {open && (
          <div className="mt-2 p-3 rounded-lg bg-slate-900 border border-slate-700 flex flex-col gap-2">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`text-xs py-1 px-2 rounded ${
                  active === l.href ? 'bg-accent/20 text-accent font-bold' : 'text-slate-300 hover:text-accent'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Navigation */}
      <nav className="hidden lg:flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-medium text-slate-400">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`hover:text-accent transition-colors ${
              active === l.href ? 'text-accent font-semibold' : ''
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
};

export default function AdminHQDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [addMinutes, setAddMinutes] = useState(5);
  const [searchTerm, setSearchTerm] = useState('');
  const lastFetchRef = useRef<{ local: number; eventNow: number; paused: boolean }>({
    local: Date.now(),
    eventNow: Date.now(),
    paused: false,
  });
  const [clientEventNow, setClientEventNow] = useState<number>(Date.now());

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/admin/dashboard');
      if (res.status === 401) {
        router.push('/hq/login');
        return;
      }
      const json: DashboardData = await res.json();
      if (json.ok) {
        setData(json);
        setError(null);
        lastFetchRef.current = {
          local: Date.now(),
          eventNow: json.clock.eventNowMs,
          paused: json.clock.paused,
        };
        setClientEventNow(json.clock.eventNowMs);
      } else {
        setError(json.primaryAction?.reason || 'Failed to load dashboard');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const clockInterval = setInterval(() => {
      const { local, eventNow, paused } = lastFetchRef.current;
      if (paused) {
        setClientEventNow(eventNow);
      } else {
        const elapsed = Date.now() - local;
        setClientEventNow(eventNow + elapsed);
      }
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  async function handleAction(action: string, payload?: any, confirmText?: string) {
    if (confirmText) {
      const confirmed = window.confirm(confirmText);
      if (!confirmed) return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/event/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      const result = await res.json();
      if (!result.ok) {
        alert(`Action failed: ${result.message || result.code}`);
      } else {
        await fetchDashboard();
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/hq/login');
    router.refresh();
  }

  function getDeadlineCountdown(): { label: string; text: string } | null {
    if (!data) return null;
    const { phase, r1EndMs, r2HardEndMs, breakEndMs } = data.state;
    let deadline: number | null = null;
    let label = '';

    if (phase === 'r1_running' && r1EndMs) {
      deadline = r1EndMs;
      label = 'R1 Closes in';
    } else if (phase === 'r2_running' && r2HardEndMs) {
      deadline = r2HardEndMs;
      label = 'R2 Hard End in';
    } else if (phase === 'r2_break' && breakEndMs) {
      deadline = breakEndMs;
      label = 'Break ends in';
    }

    if (!deadline) return null;

    const diffMs = Math.max(0, deadline - clientEventNow);
    const totalSec = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return {
      label,
      text: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
    };
  }

  const countdown = getDeadlineCountdown();

  function formatTime(lastMs: number | null | undefined): string {
    if (!lastMs) return '-';
    if (data?.state.r2StartMs) {
      const elapsed = Math.max(0, lastMs - data.state.r2StartMs);
      const totalSec = Math.floor(elapsed / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `+${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return new Date(lastMs).toLocaleTimeString();
  }

  const filteredTeams = (data?.teams || []).filter(
    (t) =>
      t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const phase = data?.state.phase ?? 'setup';
  const isBreak = phase === 'r2_break';
  const breakOver = !data?.state.breakEndMs || clientEventNow >= data.state.breakEndMs;
  const breakRemainingMs = data?.state.breakEndMs ? Math.max(0, data.state.breakEndMs - clientEventNow) : 0;
  const breakSec = Math.floor(breakRemainingMs / 1000);
  const breakMmSs = `${Math.floor(breakSec / 60).toString().padStart(2, '0')}:${(breakSec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="w-full max-w-7xl mx-auto py-6 px-4">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-semibold uppercase bg-accent/20 text-accent rounded">
              HQ Control
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 mt-1">Campus Treasure Hunt</h1>
          <HQNav active="/hq" />
        </div>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 transition-colors"
        >
          Logout
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-950/60 border border-red-800 text-red-200 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Top Row: Phase, Clock & Action Controls */}
      {data && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Phase & Clock Card */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-800/90 border border-slate-700 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wide text-slate-400">Current Phase</span>
                <div className="text-xl sm:text-2xl font-black text-accent mt-0.5 uppercase tracking-wider">
                  {phase.replace('_', ' ')}
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs uppercase tracking-wide text-slate-400">Event Clock</span>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  {data.clock.paused && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-amber-500 text-slate-950 rounded animate-pulse">
                      PAUSED
                    </span>
                  )}
                  <span className="font-mono text-lg sm:text-xl font-bold text-slate-200">
                    {new Date(clientEventNow).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>

            {countdown && (
              <div className="mt-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-700/80 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300 uppercase">{countdown.label}</span>
                <span className="font-mono text-xl font-extrabold text-accent">{countdown.text}</span>
              </div>
            )}
          </div>

          {/* Primary Action Card */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-800/90 border border-slate-700 flex flex-col justify-between">
            <div>
              <span className="text-xs uppercase tracking-wide text-slate-400">Phase Transition</span>
              <p className="text-xs text-slate-400 mt-1">Advance event to the next scheduled stage.</p>
            </div>

            <div className="mt-3">
              {isBreak ? (
                <button
                  disabled={actionLoading}
                  onClick={() => {
                    if (!breakOver) {
                      const confirmForce = window.confirm('The break is not over. Start now?');
                      if (confirmForce) {
                        handleAction('open-r3', { force: true });
                      }
                    } else {
                      const confirmStart = window.confirm('Start Round 3 now?');
                      if (confirmStart) {
                        handleAction('open-r3', { force: false });
                      }
                    }
                  }}
                  className="w-full py-3 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-sm transition-colors disabled:opacity-40 shadow-md active:scale-[0.99]"
                >
                  {actionLoading
                    ? 'Processing...'
                    : !breakOver
                    ? `Start Round 3 (break ends in ${breakMmSs})`
                    : 'Start Round 3'}
                </button>
              ) : data.primaryAction ? (
                <div>
                  <button
                    disabled={!data.primaryAction.enabled || actionLoading}
                    onClick={() =>
                      handleAction(
                        data.primaryAction!.action,
                        undefined,
                        `Proceed with action: "${data.primaryAction!.label}"?`
                      )
                    }
                    className="w-full py-3 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-sm transition-colors disabled:opacity-40 shadow-md active:scale-[0.99]"
                  >
                    {actionLoading ? 'Processing...' : data.primaryAction.label}
                  </button>
                  {data.primaryAction.reason && (
                    <p className="text-xs text-amber-400 mt-1 text-center">
                      Notice: {data.primaryAction.reason}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-400 text-center py-2">Event completed</div>
              )}
            </div>
          </div>

          {/* Quick Clock Interventions */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-800/90 border border-slate-700 flex flex-col justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-400">Clock Adjustment</span>
            <div className="mt-2 flex items-center gap-2">
              {data.clock.paused ? (
                <button
                  disabled={actionLoading}
                  onClick={() => handleAction('resume', undefined, 'Resume event clock?')}
                  className="flex-1 py-2 px-3 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  Resume
                </button>
              ) : (
                <button
                  disabled={actionLoading || !['r1_running', 'r2_running', 'r2_break', 'r3_open'].includes(phase)}
                  onClick={() => handleAction('pause', undefined, 'Pause event clock?')}
                  className="flex-1 py-2 px-3 text-xs font-bold rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-40"
                >
                  Pause
                </button>
              )}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={addMinutes}
                  onChange={(e) => setAddMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-14 px-2 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
                />
                <button
                  disabled={actionLoading}
                  onClick={() =>
                    handleAction('add-time', { minutes: addMinutes }, `Add ${addMinutes}m?`)
                  }
                  className="py-1.5 px-2.5 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"
                >
                  +Time
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Teams Table (Laptop full width, mobile overflow-x-auto) + QR Counts */}
      {data && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Teams Table (3 Columns) */}
          <div className="lg:col-span-3 p-4 sm:p-5 rounded-xl bg-slate-800/80 border border-slate-700 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
                  Teams Overview ({data.stats.totalTeams} total, {data.stats.qualifiedTeams} qualified)
                </h2>
                <span className="text-xs text-slate-400">Shows Round 2 live scores and rank</span>
              </div>
              <input
                type="text"
                placeholder="Search team ID or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-56 px-3 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-2.5">Team</th>
                    <th className="py-2 px-2.5">Members</th>
                    <th className="py-2 px-2.5">Status</th>
                    <th className="py-2 px-2.5 text-right">R2 Rank</th>
                    <th className="py-2 px-2.5 text-right">R2 Points</th>
                    <th className="py-2 px-2.5 text-right">Last Scoring</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredTeams.map((team) => (
                    <tr key={team.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="py-2.5 px-2.5 font-sans font-bold text-slate-100">
                        <span className="text-accent mr-1.5">{team.id}</span>
                        <span>{team.name}</span>
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-300 font-sans">{team.n}</td>
                      <td className="py-2.5 px-2.5 font-sans">
                        {team.withdrawn ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/20 text-red-400">
                            Withdrawn
                          </span>
                        ) : team.qualified ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400">
                            Qualified
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-slate-200">
                        {team.r2Rank ? `#${team.r2Rank}` : '-'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-accent">
                        {team.r2Points !== null && team.r2Points !== undefined ? team.r2Points : '-'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-400">
                        {formatTime(team.r2LastMs)}
                      </td>
                    </tr>
                  ))}
                  {filteredTeams.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400 font-sans">
                        No matching teams found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* QR Locations (1 Column Side) */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-800/80 border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
                QR Capacity ({data.stats.activeQRs} active)
              </h2>
              <Link href="/hq/qr" className="text-xs font-semibold text-accent hover:underline">
                Manage →
              </Link>
            </div>
            <div className="space-y-2">
              {data.qrs.map((qr) => (
                <div
                  key={qr.id}
                  className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-700 text-xs"
                >
                  <div className="min-w-0 pr-1">
                    <span className="font-semibold text-slate-200 block truncate">{qr.name}</span>
                    <span className="text-[10px] text-slate-400">Cap: {qr.capacity}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400">
                      R1: <b className="text-slate-200">{qr.run1Count}</b>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      R2: <b className="text-slate-200">{qr.run2Count}</b>
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        qr.active ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
