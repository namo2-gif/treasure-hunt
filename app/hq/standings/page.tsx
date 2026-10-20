'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const HQNav = () => (
  <nav className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-medium text-slate-400">
    <Link href="/hq" className="hover:text-accent transition-colors">Dashboard</Link>
    <Link href="/hq/teams" className="hover:text-accent transition-colors">Teams & Students</Link>
    <Link href="/hq/selection" className="hover:text-accent transition-colors">Selection</Link>
    <Link href="/hq/standings" className="text-accent font-semibold">Standings</Link>
    <Link href="/hq/round3" className="hover:text-accent transition-colors">Round 3</Link>
    <Link href="/hq/content" className="hover:text-accent transition-colors">Content</Link>
    <Link href="/hq/qr" className="hover:text-accent transition-colors">QR Locations</Link>
    <Link href="/hq/interventions" className="hover:text-accent transition-colors">Interventions</Link>
    <Link href="/hq/logs" className="hover:text-accent transition-colors">Log & Export</Link>
    <Link href="/hq/settings" className="hover:text-accent transition-colors">Settings</Link>
  </nav>
);

interface StandingsTeam {
  rank: number;
  teamId: string;
  points: number;
  lastMs: number | null;
  adjustments: number;
}

export default function StandingsPage() {
  const [tab, setTab] = useState<'r1' | 'r2'>('r2');
  const [r1, setR1] = useState<StandingsTeam[]>([]);
  const [r2, setR2] = useState<StandingsTeam[]>([]);
  const [r2StartMs, setR2StartMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      const res = await fetch('/api/admin/standings');
      const data = await res.json();
      if (data.ok) {
        setR1(data.r1 || []);
        setR2(data.r2 || []);
        setR2StartMs(data.r2StartMs ?? null);
      }
    } catch (err) {
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

  const currentList = tab === 'r1' ? r1 : r2;

  function formatTime(lastMs: number | null): string {
    if (lastMs === null) return '-';
    if (tab === 'r2' && r2StartMs) {
      const elapsedMs = Math.max(0, lastMs - r2StartMs);
      const totalSec = Math.floor(elapsedMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `+${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return new Date(lastMs).toLocaleTimeString();
  }

  // Identify ties
  const rankCounts: Record<number, number> = {};
  for (const t of currentList) {
    rankCounts[t.rank] = (rankCounts[t.rank] || 0) + 1;
  }

  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="pb-4 border-b border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="px-2 py-0.5 text-xs font-semibold uppercase bg-accent/20 text-accent rounded">HQ</span>
          <h1 className="text-xl font-bold text-slate-100 mt-1">Official Standings</h1>
          <HQNav />
        </div>
        <div>
          <a
            href="/api/admin/export/standings"
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-colors"
          >
            📥 Download CSV
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex border-b border-slate-700 gap-4">
        <button
          onClick={() => setTab('r1')}
          className={`pb-2.5 text-sm font-semibold transition-colors border-b-2 ${
            tab === 'r1'
              ? 'border-accent text-accent'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Round 1 Standings ({r1.length} teams)
        </button>
        <button
          onClick={() => setTab('r2')}
          className={`pb-2.5 text-sm font-semibold transition-colors border-b-2 ${
            tab === 'r2'
              ? 'border-accent text-accent'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Round 2 Standings ({r2.length} teams)
        </button>
      </div>

      {/* Content */}
      <div className="mt-4 p-4 sm:p-5 rounded-xl bg-slate-800/80 border border-slate-700">
        <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
          <span>Ranking follows Section 5 order: points desc, last scoring attempt asc nulls last.</span>
          <span>Auto-updates every 5s</span>
        </div>

        {loading && currentList.length === 0 ? (
          <div className="text-xs text-slate-400 py-8 text-center">Loading standings...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-2 px-3">Rank</th>
                  <th className="py-2 px-3">Team</th>
                  <th className="py-2 px-3 text-right">Points</th>
                  {tab === 'r2' && <th className="py-2 px-3 text-right">Adjustments</th>}
                  <th className="py-2 px-3 text-right">Last Scoring Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {currentList.map((team) => {
                  const isTied = (rankCounts[team.rank] || 0) > 1;
                  return (
                    <tr
                      key={team.teamId}
                      className={`hover:bg-slate-700/30 transition-colors ${
                        isTied ? 'bg-amber-950/20' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-200">
                        #{team.rank}
                        {isTied && (
                          <span className="ml-1 px-1 py-0.2 text-[9px] uppercase font-bold bg-amber-500/20 text-amber-300 rounded border border-amber-600/40">
                            Tie
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-100">
                        {team.teamId}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-accent text-sm">
                        {team.points}
                      </td>
                      {tab === 'r2' && (
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {team.adjustments > 0 ? `+${team.adjustments}` : team.adjustments}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-right text-slate-400">
                        {formatTime(team.lastMs)}
                      </td>
                    </tr>
                  );
                })}
                {currentList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                      No attempts recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
