'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const HQNav = () => (
  <nav className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-medium text-slate-400">
    <Link href="/hq" className="hover:text-accent transition-colors">Dashboard</Link>
    <Link href="/hq/event" className="text-accent font-semibold">Event Control</Link>
    <Link href="/hq/teams" className="hover:text-accent transition-colors">Teams & Students</Link>
    <Link href="/hq/selection" className="hover:text-accent transition-colors">Selection</Link>
    <Link href="/hq/standings" className="hover:text-accent transition-colors">Standings</Link>
    <Link href="/hq/round3" className="hover:text-accent transition-colors">Round 3</Link>
    <Link href="/hq/content" className="hover:text-accent transition-colors">Content</Link>
    <Link href="/hq/qr" className="hover:text-accent transition-colors">QR Locations</Link>
    <Link href="/hq/interventions" className="hover:text-accent transition-colors">Interventions</Link>
    <Link href="/hq/logs" className="hover:text-accent transition-colors">Log & Export</Link>
    <Link href="/hq/settings" className="hover:text-accent transition-colors">Settings</Link>
  </nav>
);

export default function EventControlPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [addMinutes, setAddMinutes] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<{ local: number; eventNow: number; paused: boolean }>({
    local: Date.now(),
    eventNow: Date.now(),
    paused: false,
  });
  const [clientEventNow, setClientEventNow] = useState<number>(Date.now());

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/admin/dashboard');
      const json = await res.json();
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
        setError(json.message || 'Failed to load event status');
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

  const phase = data?.state?.phase ?? 'setup';
  const paused = data?.clock?.paused ?? false;
  const breakEndMs = data?.state?.breakEndMs ?? null;
  const breakRemainingMs = breakEndMs ? Math.max(0, breakEndMs - clientEventNow) : 0;
  const breakRemainingTotalSec = Math.floor(breakRemainingMs / 1000);
  const breakMin = Math.floor(breakRemainingTotalSec / 60);
  const breakSec = breakRemainingTotalSec % 60;
  const breakMmSs = `${breakMin.toString().padStart(2, '0')}:${breakSec.toString().padStart(2, '0')}`;
  const isBreakActive = phase === 'r2_break' && breakRemainingMs > 0;

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="pb-4 border-b border-slate-700">
        <div>
          <span className="px-2 py-0.5 text-xs font-semibold uppercase bg-accent/20 text-accent rounded">HQ</span>
          <h1 className="text-xl font-bold text-slate-100 mt-1">Event Control</h1>
        </div>
        <HQNav />
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-950/60 border border-red-800 text-red-200 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Status Overview */}
      {data && (
        <div className="mt-6 p-5 rounded-xl bg-slate-800/90 border border-slate-700 shadow-md flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-wide text-slate-400">Current Phase</span>
            <div className="text-2xl font-black text-accent mt-0.5 uppercase tracking-wider">
              {phase.replace('_', ' ')}
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wide text-slate-400">Event Clock</span>
            <div className="flex items-center justify-end gap-2 mt-0.5">
              {paused && (
                <span className="px-2 py-0.5 text-xs font-bold uppercase bg-amber-500 text-slate-950 rounded animate-pulse">
                  PAUSED
                </span>
              )}
              <span className="font-mono text-xl font-bold text-slate-200">
                {new Date(clientEventNow).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Phase Transition Action */}
      {data && (
        <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-3">
            Primary Phase Transition
          </h2>
          {phase === 'r2_break' ? (
            <div>
              <button
                disabled={actionLoading}
                onClick={() => {
                  if (isBreakActive) {
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
                className="w-full py-3.5 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-base transition-colors disabled:opacity-40 shadow-lg"
              >
                {actionLoading
                  ? 'Processing...'
                  : isBreakActive
                  ? `Start Round 3 (break ends in ${breakMmSs})`
                  : 'Start Round 3'}
              </button>
            </div>
          ) : data.primaryAction ? (
            <div>
              <button
                disabled={!data.primaryAction.enabled || actionLoading}
                onClick={() =>
                  handleAction(
                    data.primaryAction.action,
                    undefined,
                    `Proceed with action: "${data.primaryAction.label}"?`
                  )
                }
                className="w-full py-3.5 px-4 rounded-lg bg-accent text-slate-950 hover:bg-amber-400 font-bold text-base transition-colors disabled:opacity-40 shadow-lg"
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
            <p className="text-xs text-slate-400">Event is completed. No further transitions available.</p>
          )}
        </div>
      )}

      {/* Clock Controls */}
      {data && (
        <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-3">
            Clock Controls
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="text-xs font-medium text-slate-300">Clock Pause / Resume</div>
                <p className="text-xs text-slate-400 mt-1">
                  Pausing freezes the event clock and shifts all deadlines.
                </p>
              </div>
              <div className="mt-3">
                {paused ? (
                  <button
                    disabled={actionLoading}
                    onClick={() => handleAction('resume', undefined, 'Resume event clock?')}
                    className="w-full py-2 px-3 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  >
                    Resume Event
                  </button>
                ) : (
                  <button
                    disabled={actionLoading || !['r1_running', 'r2_running', 'r2_break', 'r3_open'].includes(phase)}
                    onClick={() => handleAction('pause', undefined, 'Pause event clock?')}
                    className="w-full py-2 px-3 text-xs font-bold rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-40"
                  >
                    Pause Event
                  </button>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="text-xs font-medium text-slate-300">Add Time (Minutes)</div>
                <p className="text-xs text-slate-400 mt-1">
                  Pushes all deadlines later by adding to paused total ms.
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={addMinutes}
                  onChange={(e) => setAddMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 px-2.5 py-1.5 text-xs rounded bg-slate-800 text-slate-100 border border-slate-600 focus:outline-none focus:border-accent"
                />
                <button
                  disabled={actionLoading}
                  onClick={() =>
                    handleAction(
                      'add-time',
                      { minutes: addMinutes },
                      `Add ${addMinutes} minutes to all deadlines?`
                    )
                  }
                  className="flex-1 py-1.5 px-3 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 transition-colors"
                >
                  + Add Time
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone: Reset Event Data */}
      {data && (
        <div className="mt-6 p-5 rounded-xl bg-red-950/20 border border-red-900/60">
          <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-1">
            Danger Zone
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            Resetting truncates game attempt rows and resets phase to setup. Allowed only in setup, ended, or while paused.
          </p>

          <button
            disabled={actionLoading}
            onClick={() => {
              const val = window.prompt(
                'DANGER: This truncates all attempts, runs, and logs!\nType RESET to confirm:'
              );
              if (val === 'RESET') {
                handleAction('reset', { confirm: 'RESET' });
              } else if (val !== null) {
                alert('Reset cancelled: You must type exactly "RESET"');
              }
            }}
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold rounded bg-red-900/80 hover:bg-red-800 text-red-100 border border-red-700 transition-colors disabled:opacity-40"
          >
            Reset Event Data (Type RESET)
          </button>
        </div>
      )}
    </div>
  );
}
