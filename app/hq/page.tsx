'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

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

export default function AdminHQDashboard() {
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
      const json: DashboardData = await adminFetch<DashboardData>('/api/admin/dashboard');
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
      if (err instanceof AdminFetchError && err.status === 401) return;
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
      const result = await adminFetch<any>(`/api/admin/event/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
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
    <div className="w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
              HQ Live Telemetry
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Operations Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchDashboard()}
            disabled={loading}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={fetchDashboard} />

      {/* Top Row: Phase, Clock & Action Controls */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Card 1: Phase & Event Clock */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Current Phase
                </span>
                <div className="text-xl sm:text-2xl font-black text-accent mt-0.5 uppercase tracking-wide truncate">
                  {phase.replace('_', ' ')}
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Event Clock
                </span>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  {data.clock.paused && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-amber-500 text-slate-950 rounded animate-pulse">
                      PAUSED
                    </span>
                  )}
                  <span className="font-mono text-base sm:text-lg font-bold text-slate-100">
                    {new Date(clientEventNow).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>

            {countdown && (
              <div className="mt-3 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  {countdown.label}
                </span>
                <span className="font-mono text-lg sm:text-xl font-extrabold text-accent">
                  {countdown.text}
                </span>
              </div>
            )}
          </div>

          {/* Card 2: Primary Action Card */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Phase Transition
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                Advance event to the next scheduled stage.
              </p>
            </div>

            <div className="mt-4">
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
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-xs sm:text-sm transition-all disabled:opacity-40 shadow active:scale-[0.99]"
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
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-xs sm:text-sm transition-all disabled:opacity-40 shadow active:scale-[0.99]"
                  >
                    {actionLoading ? 'Processing...' : data.primaryAction.label}
                  </button>
                  {data.primaryAction.reason && (
                    <p className="text-xs text-amber-400 mt-1.5 text-center">
                      Notice: {data.primaryAction.reason}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-400 text-center py-2.5 font-medium rounded-lg bg-slate-950/60 border border-slate-800">
                  Event Completed
                </div>
              )}
            </div>
          </div>

          {/* Card 3: Quick Clock Interventions */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between md:col-span-2 xl:col-span-1">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Clock Adjustment
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                Pause or extend all countdowns.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {data.clock.paused ? (
                <button
                  disabled={actionLoading}
                  onClick={() => handleAction('resume', undefined, 'Resume event clock?')}
                  className="flex-1 min-h-[42px] py-2 px-3 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow"
                >
                  Resume Clock
                </button>
              ) : (
                <button
                  disabled={
                    actionLoading ||
                    !['r1_running', 'r2_running', 'r2_break', 'r3_open'].includes(phase)
                  }
                  onClick={() => handleAction('pause', undefined, 'Pause event clock?')}
                  className="flex-1 min-h-[42px] py-2 px-3 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-40 shadow"
                >
                  Pause Clock
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={addMinutes}
                  onChange={(e) =>
                    setAddMinutes(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="w-16 h-[42px] px-2 text-xs rounded-lg bg-slate-950 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent text-center font-mono"
                  aria-label="Add minutes"
                />
                <button
                  disabled={actionLoading}
                  onClick={() =>
                    handleAction(
                      'add-time',
                      { minutes: addMinutes },
                      `Add ${addMinutes}m to all event timers?`
                    )
                  }
                  className="min-h-[42px] px-3.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:scale-95 transition-all whitespace-nowrap shadow"
                >
                  +Time
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Teams Overview (Fluid Left) + QR Counts (320px Right) */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          {/* Teams Overview */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Teams Overview
                </h2>
                <span className="text-xs text-slate-400">
                  {data.stats.totalTeams} total squads &bull; {data.stats.qualifiedTeams} qualified
                </span>
              </div>
              <input
                type="text"
                placeholder="Search team ID or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-60 min-h-[38px] px-3 py-1.5 text-xs rounded-lg bg-slate-950 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
              />
            </div>

            {/* Phone View: Card List (< 768px) */}
            <div className="block md:hidden space-y-3">
              {filteredTeams.map((team) => (
                <div
                  key={team.id}
                  className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 text-xs font-mono font-bold bg-accent/20 text-accent rounded border border-accent/30 shrink-0">
                        {team.id}
                      </span>
                      <span className="font-semibold text-slate-100 text-sm truncate">
                        {team.name}
                      </span>
                    </div>

                    <div className="shrink-0">
                      {team.withdrawn ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/20 text-red-400 border border-red-500/30">
                          Withdrawn
                        </span>
                      ) : team.qualified ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Qualified
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] text-slate-500 bg-slate-900 rounded">
                          R1
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80">
                    <div className="bg-slate-900/60 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                        R2 Rank
                      </span>
                      <span className="font-bold text-slate-200 text-xs sm:text-sm">
                        {team.r2Rank ? `#${team.r2Rank}` : '-'}
                      </span>
                    </div>

                    <div className="bg-slate-900/60 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                        R2 Pts
                      </span>
                      <span className="font-bold text-accent text-xs sm:text-sm">
                        {team.r2Points !== null && team.r2Points !== undefined
                          ? team.r2Points
                          : '-'}
                      </span>
                    </div>

                    <div className="bg-slate-900/60 p-2 rounded-lg text-center">
                      <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                        Last Score
                      </span>
                      <span className="font-mono text-slate-300 text-[11px]">
                        {formatTime(team.r2LastMs)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>Members: <strong className="text-slate-300">{team.n}</strong></span>
                    {team.runs && team.runs.length > 0 && (
                      <span className="text-[10px] text-accent/80 font-mono">
                        Run {team.runs[team.runs.length - 1].run} active
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {filteredTeams.length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs bg-slate-950/40 rounded-xl border border-slate-800">
                  No matching teams found.
                </div>
              )}
            </div>

            {/* Laptop / Tablet View: Wide Table (>= 768px) */}
            <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-950/90 backdrop-blur z-10">
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-3">Team</th>
                    <th className="py-3 px-3">Members</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">R2 Rank</th>
                    <th className="py-3 px-3 text-right">R2 Points</th>
                    <th className="py-3 px-3 text-right">Last Scoring</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/40 font-mono">
                  {filteredTeams.map((team) => (
                    <tr
                      key={team.id}
                      className="hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-sans font-bold text-slate-100">
                        <span className="px-1.5 py-0.5 text-xs bg-accent/20 text-accent rounded mr-2 font-mono">
                          {team.id}
                        </span>
                        <span>{team.name}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-sans">
                        {team.n}
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        {team.withdrawn ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/20 text-red-400 border border-red-500/30">
                            Withdrawn
                          </span>
                        ) : team.qualified ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Qualified
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-200">
                        {team.r2Rank ? `#${team.r2Rank}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-accent">
                        {team.r2Points !== null && team.r2Points !== undefined
                          ? team.r2Points
                          : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400">
                        {formatTime(team.r2LastMs)}
                      </td>
                    </tr>
                  ))}
                  {filteredTeams.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-slate-400 font-sans text-xs"
                      >
                        No matching teams found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* QR Locations (320px Side Column on Laptop, Stacked on Mobile) */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  QR Capacity
                </h2>
                <span className="text-[11px] text-slate-400">
                  {data.stats.activeQRs} of {data.qrs.length} active
                </span>
              </div>
              <Link
                href="/hq/qr"
                className="text-xs font-semibold text-accent hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                <span>Manage</span>
                <span>→</span>
              </Link>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[500px] lg:max-h-[640px] pr-1">
              {data.qrs.map((qr) => (
                <div
                  key={qr.id}
                  className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          qr.active
                            ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                            : 'bg-red-500'
                        }`}
                      />
                      <span className="font-semibold text-slate-200 text-xs truncate">
                        {qr.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
                      Cap: {qr.capacity}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-900 font-mono">
                    <span>
                      Run 1: <strong className="text-slate-200">{qr.run1Count}</strong>
                    </span>
                    <span>
                      Run 2: <strong className="text-slate-200">{qr.run2Count}</strong>
                    </span>
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
