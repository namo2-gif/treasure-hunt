'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

interface RankedTeam {
  rank: number;
  teamId: string;
  name: string;
  n: number;
  points: number;
  lastMs: number | null;
  qualified: boolean;
  withdrawn: boolean;
}

export default function SelectionPage() {
  const [teams, setTeams] = useState<RankedTeam[]>([]);
  const [phase, setPhase] = useState<string>('setup');
  const [topN, setTopN] = useState<number>(25);
  const [loading, setLoading] = useState(true);
  const [updatingTeam, setUpdatingTeam] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState('');

  async function loadData() {
    try {
      const data = await adminFetch<any>('/api/admin/selection');
      if (data.ok) {
        setTeams(data.teams || []);
        setPhase(data.phase || 'setup');
        setTopN(data.topN || 25);
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleToggleQualified(teamId: string, currentQualified: boolean) {
    if (phase !== 'r1_closed') {
      setMsg({
        text: 'Qualification can only be edited while phase is "r1_closed". Current phase: ' + phase,
        ok: false,
      });
      return;
    }

    setUpdatingTeam(teamId);
    setMsg(null);
    try {
      const data = await adminFetch<any>('/api/admin/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, qualified: !currentQualified }),
      });
      if (data.ok) {
        setTeams((prev) =>
          prev.map((t) => (t.teamId === teamId ? { ...t, qualified: !currentQualified } : t))
        );
      } else {
        setMsg({ text: data.message || data.code || 'Failed to update qualification', ok: false });
      }
    } catch (e: any) {
      setMsg({ text: e.message || 'Network error', ok: false });
    } finally {
      setUpdatingTeam(null);
    }
  }

  async function handleAutoSelectTopN() {
    if (phase !== 'r1_closed') {
      setMsg({ text: 'Selection changes are only allowed in "r1_closed" phase.', ok: false });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      // Teams with rank <= topN are qualified, others false
      let successCount = 0;
      for (const t of teams) {
        const shouldBeQualified = t.rank <= topN && !t.withdrawn;
        if (t.qualified !== shouldBeQualified) {
          const res = await fetch('/api/admin/selection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: t.teamId, qualified: shouldBeQualified }),
          });
          const d = await res.json();
          if (d.ok) successCount++;
        }
      }
      setMsg({ text: `Auto-selected top ${topN} teams (${successCount} changes made).`, ok: true });
      await loadData();
    } catch (e: any) {
      setMsg({ text: e.message || 'Auto-select failed', ok: false });
    } finally {
      setLoading(false);
    }
  }

  const qualifiedCount = teams.filter((t) => t.qualified && !t.withdrawn).length;

  const filteredTeams = filter.trim()
    ? teams.filter(
        (t) =>
          t.teamId.toLowerCase().includes(filter.toLowerCase()) ||
          t.name.toLowerCase().includes(filter.toLowerCase())
      )
    : teams;

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="pb-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Advancement & Cutoff
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Round 2 Team Selection
          </h1>
        </div>
      </div>

      {/* Info & Banner */}
      <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                Event Phase:
              </span>
              <span className="font-mono text-xs font-bold text-accent uppercase">{phase}</span>
              {phase !== 'r1_closed' && (
                <span className="text-[11px] text-amber-400 font-medium">
                  (Qualification edits are locked until Round 1 ends)
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-slate-200 mt-1">
              Qualified Teams for Round 2:{' '}
              <span className="text-accent font-bold text-base">{qualifiedCount}</span>
              <span className="text-xs text-slate-400 font-normal ml-2">
                (Target top N: {topN})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoSelectTopN}
              disabled={phase !== 'r1_closed' || loading}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-accent text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors shadow-sm"
            >
              Auto-select Top {topN}
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`mt-4 p-2.5 rounded text-xs border ${
              msg.ok
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-red-950/60 border-red-800 text-red-200'
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {/* Standings Table */}
      <div className="mt-6 p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
              Round 1 Standings & Qualification
            </h2>
            <p className="text-xs text-slate-400">
              Ranked by points (desc) then earliest point-earning submission (asc). Ties get equal rank.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search team ID or name..."
            className="px-3 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading && teams.length === 0 ? (
          <div className="text-xs text-slate-400 py-8 text-center">Loading standings...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 uppercase text-[10px]">
                  <th className="py-2.5 px-3">Qualified</th>
                  <th className="py-2.5 px-3">Rank</th>
                  <th className="py-2.5 px-3">Team ID</th>
                  <th className="py-2.5 px-3">Team Name</th>
                  <th className="py-2.5 px-3 text-center">Size (N)</th>
                  <th className="py-2.5 px-3 text-right">R1 Points</th>
                  <th className="py-2.5 px-3 text-right">Last Point Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredTeams.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No matching teams found.
                    </td>
                  </tr>
                ) : (
                  filteredTeams.map((team) => {
                    const isTopN = team.rank <= topN;
                    return (
                      <tr
                        key={team.teamId}
                        className={`hover:bg-slate-800/50 transition-colors ${
                          team.qualified ? 'bg-emerald-950/20' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={team.qualified}
                            disabled={phase !== 'r1_closed' || updatingTeam === team.teamId || team.withdrawn}
                            onChange={() => handleToggleQualified(team.teamId, team.qualified)}
                            className="w-4 h-4 rounded accent-amber-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-bold font-mono">
                          <span
                            className={
                              isTopN
                                ? 'text-accent'
                                : 'text-slate-500'
                            }
                          >
                            #{team.rank}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-200">
                          {team.teamId}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200">
                          {team.name}
                          {team.withdrawn && (
                            <span className="ml-2 text-[10px] uppercase font-bold text-red-400 bg-red-950/60 border border-red-800 px-1.5 py-0.2 rounded">
                              Withdrawn
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-400">
                          {team.n}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100">
                          {team.points}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-400">
                          {team.lastMs
                            ? new Date(Number(team.lastMs)).toLocaleTimeString([], {
                                hour12: false,
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
