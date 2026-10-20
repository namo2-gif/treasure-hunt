'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

interface ZoneData {
  id: number;
  name: string;
  token: string;
  findRiddle: string;
}

interface BoxRiddleData {
  zone: number;
  box: number;
  text: string;
}

interface R3Config {
  code: string;
  hintText: string;
}

interface R2TeamData {
  id: string;
  name: string;
  rank: number;
  points: number;
  lastMs: number | null;
  eligible: boolean;
  zone: number | null;
  tiedAtCutoff: boolean;
}

interface WrongValue {
  value: string;
  at: string;
}

interface GridBox {
  box: number;
  status: 'open' | 'solved' | 'locked';
  solvedAt: string | null;
  solvedMs: number | null;
  credited: boolean;
  triesUsed: number;
  wrongValues: WrongValue[];
}

interface GridTeam {
  rank: number;
  teamId: string;
  teamName: string;
  zoneName: string;
  scan: { at: string; ms: number; by: string; credited: boolean } | null;
  boxes: GridBox[];
  milestones: number;
  state: 'searching' | 'solving' | 'finished';
}

interface Round3DashboardData {
  phase: string;
  startMs: number | null;
  endMs: number | null;
  result: {
    winnerTeamId: string | null;
    winnerTeamName?: string;
    reason: string;
    decidedMs: number;
    decidedAt: string;
  } | null;
  codeSet: boolean;
  teams: GridTeam[];
}

export default function Round3AdminPage() {
  const [activeTab, setActiveTab] = useState<'setup' | 'teams' | 'live'>('live');
  const [phase, setPhase] = useState<string>('setup');
  const [r3Data, setR3Data] = useState<Round3DashboardData | null>(null);

  // Setup state
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [riddles, setRiddles] = useState<BoxRiddleData[]>([]);
  const [config, setConfig] = useState<R3Config>({ code: '', hintText: '' });
  const [codeValid, setCodeValid] = useState(true);
  const [savingSetup, setSavingSetup] = useState(false);
  const [setupMsg, setSetupMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Teams selection state
  const [r2Teams, setR2Teams] = useState<R2TeamData[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [teamsMsg, setTeamsMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Dialog / Overrides state
  const [overrideModal, setOverrideModal] = useState<{
    open: boolean;
    action: 'credit-scan' | 'credit-box' | 'reset-box' | 'reassign-zone';
    teamId: string;
    teamName: string;
    box?: number;
    zone?: number;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [selectedReassignZone, setSelectedReassignZone] = useState<number>(1);
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Wrong values modal
  const [selectedTeamWrongs, setSelectedTeamWrongs] = useState<GridTeam | null>(null);

  // Fetch Live Grid and Dashboard
  const fetchDashboard = useCallback(async () => {
    try {
      const data = await adminFetch<any>('/api/admin/dashboard');
      if (data.ok) {
        setPhase(data.state?.phase || 'setup');
        if (data.round3) {
          setR3Data(data.round3);
        }
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      console.error(err);
    }
  }, []);

  // Fetch Setup Content
  const fetchSetup = useCallback(async () => {
    try {
      const data = await adminFetch<any>('/api/admin/round3/zones');
      if (data.ok) {
        setZones(data.zones || []);
        setRiddles(data.riddles || []);
        if (data.config) {
          setConfig(data.config);
          setCodeValid(/^[1-9][A-Z]{3}$/.test(data.config.code));
        }
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      console.error(err);
    }
  }, []);

  // Fetch Teams
  const fetchTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const data = await adminFetch<any>('/api/admin/round3/teams');
      if (data.ok) {
        setR2Teams(data.teams || []);
      }
    } catch (err: any) {
      if (err instanceof AdminFetchError && err.status === 401) return;
      console.error(err);
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchSetup();
    fetchTeams();
  }, [fetchDashboard, fetchSetup, fetchTeams]);

  // Polling: 3s in r3_open, 5s otherwise
  useEffect(() => {
    const pollInterval = phase === 'r3_open' ? 3000 : 5000;
    const interval = setInterval(() => {
      fetchDashboard();
      if (activeTab === 'teams') fetchTeams();
    }, pollInterval);
    return () => clearInterval(interval);
  }, [phase, activeTab, fetchDashboard, fetchTeams]);

  // Setup placeholder counter
  const placeholderCount =
    (config.code.startsWith('[PLACEHOLDER]') ? 1 : 0) +
    zones.filter((z) => z.findRiddle.startsWith('[PLACEHOLDER]')).length +
    riddles.filter((r) => r.text.startsWith('[PLACEHOLDER]')).length;

  // Format Elapsed mm:ss
  function formatElapsed(solvedMs: number | null, startMs: number | null): string {
    if (!solvedMs || !startMs || solvedMs < startMs) return '--:--';
    const totalSec = Math.floor((solvedMs - startMs) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Format Time HH:MM:SS
  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Handle Save Code & Hint
  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingSetup(true);
    setSetupMsg(null);
    try {
      const data = await adminFetch<any>('/api/admin/round3/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: config.code.toUpperCase(), hintText: config.hintText }),
      });
      if (data.ok) {
        setSetupMsg({ text: 'Round 3 code & hint saved', ok: true });
        fetchSetup();
      } else {
        setSetupMsg({ text: data.message || 'Error saving config', ok: false });
      }
    } catch (err: any) {
      setSetupMsg({ text: err.message || 'Network error', ok: false });
    } finally {
      setSavingSetup(false);
    }
  }

  // Handle Save Zone
  async function handleSaveZone(id: number, name: string, findRiddle: string) {
    try {
      const data = await adminFetch<any>(`/api/admin/round3/zones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, findRiddle }),
      });
      if (data.ok) {
        setSetupMsg({ text: `Zone ${id} updated`, ok: true });
        fetchSetup();
      } else {
        setSetupMsg({ text: data.message || 'Error updating zone', ok: false });
      }
    } catch (err: any) {
      setSetupMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Regenerate Zone Token
  async function handleRegenerateToken(id: number) {
    if (!confirm(`Are you sure you want to regenerate the start token for Zone ${id}? Any existing printed QR codes for this zone will stop working.`)) return;
    try {
      const data = await adminFetch<any>(`/api/admin/round3/zones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate-token' }),
      });
      if (data.ok) {
        setSetupMsg({ text: `Zone ${id} token regenerated`, ok: true });
        fetchSetup();
      } else {
        setSetupMsg({ text: data.message || 'Error regenerating token', ok: false });
      }
    } catch (err: any) {
      setSetupMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Save Riddle
  async function handleSaveRiddle(zone: number, box: number, text: string) {
    try {
      const data = await adminFetch<any>(`/api/admin/round3/riddles/${zone}/${box}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (data.ok) {
        setSetupMsg({ text: `Zone ${zone} Box ${box} riddle updated`, ok: true });
        fetchSetup();
      } else {
        setSetupMsg({ text: data.message || 'Error updating riddle', ok: false });
      }
    } catch (err: any) {
      setSetupMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Toggle Eligible
  async function handleToggleEligible(teamId: string, current: boolean) {
    setTeamsMsg(null);
    try {
      const data = await adminFetch<any>('/api/admin/round3/eligible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, eligible: !current }),
      });
      if (data.ok) {
        fetchTeams();
      } else {
        setTeamsMsg({ text: data.message || 'Error updating eligibility', ok: false });
      }
    } catch (err: any) {
      setTeamsMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Assign Zone
  async function handleAssignZone(teamId: string, zoneNum: number) {
    setTeamsMsg(null);
    try {
      const data = await adminFetch<any>('/api/admin/round3/assign-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, zone: zoneNum }),
      });
      if (data.ok) {
        fetchTeams();
      } else {
        setTeamsMsg({ text: data.message || 'Error assigning zone', ok: false });
      }
    } catch (err: any) {
      setTeamsMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Randomize Zones
  async function handleRandomizeZones() {
    setTeamsMsg(null);
    try {
      const data = await adminFetch<any>('/api/admin/round3/randomize', {
        method: 'POST',
      });
      if (data.ok) {
        setTeamsMsg({ text: 'Zones randomized successfully', ok: true });
        fetchTeams();
      } else {
        setTeamsMsg({ text: data.message || 'Error randomizing zones', ok: false });
      }
    } catch (err: any) {
      setTeamsMsg({ text: err.message || 'Network error', ok: false });
    }
  }

  // Handle Submit Override
  async function handleSubmitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideModal) return;
    if (!overrideReason.trim()) {
      setOverrideError('A reason is required for every override.');
      return;
    }

    setSubmittingOverride(true);
    setOverrideError(null);

    const payload: any = {
      teamId: overrideModal.teamId,
      reason: overrideReason.trim(),
    };
    if (overrideModal.box) payload.box = overrideModal.box;
    if (overrideModal.action === 'reassign-zone') payload.zone = selectedReassignZone;

    try {
      const data = await adminFetch<any>(`/api/admin/round3/override/${overrideModal.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (data.ok) {
        setOverrideModal(null);
        setOverrideReason('');
        fetchDashboard();
      } else {
        setOverrideError(data.message || 'Override failed');
      }
    } catch (err: any) {
      setOverrideError(err.message || 'Network error');
    } finally {
      setSubmittingOverride(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Round 3 Management</h1>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                phase === 'r3_open'
                  ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-700/50'
                  : phase === 'ended'
                  ? 'bg-purple-900/60 text-purple-400 border border-purple-700/50'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {phase}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Setup zones & riddles, select & assign the 5 eligible teams, and monitor live box progress.
          </p>
        </div>

        {/* Links & Quick Actions */}
        <div className="flex items-center gap-2">
          <Link
            href="/hq/round3/qr-sheet"
            target="_blank"
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Print QR Sheet
          </Link>
          <Link
            href="/api/admin/export/r3"
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-medium transition-colors"
          >
            Export CSV
          </Link>
          <Link
            href="/hq"
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-xs font-medium transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 my-4 gap-2">
        <button
          onClick={() => setActiveTab('live')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'live'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Live Grid & Results
        </button>
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'teams'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Teams & Zones ({r2Teams.filter((t) => t.eligible).length}/5)
        </button>
        <button
          onClick={() => setActiveTab('setup')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'setup'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Setup & Riddles
          {placeholderCount > 0 && (
            <span className="bg-rose-900/80 text-rose-300 text-xs px-2 py-0.5 rounded-full font-mono">
              {placeholderCount}
            </span>
          )}
        </button>
      </div>

      {/* ========================================================= */}
      {/* SECTION 1: LIVE GRID & RESULTS */}
      {/* ========================================================= */}
      {activeTab === 'live' && (
        <div className="space-y-6">
          {/* Winner / Ended Result Banner */}
          {r3Data?.result && (
            <div className="p-4 rounded-lg bg-emerald-950/60 border border-emerald-600/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
              <div>
                <div className="text-xs uppercase tracking-widest text-emerald-400 font-bold">
                  Round 3 Decided &bull; {r3Data.result.reason.toUpperCase()}
                </div>
                <div className="text-xl font-black text-white mt-0.5">
                  Winner: {r3Data.result.winnerTeamName || r3Data.result.winnerTeamId || 'None'}
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  Decided at: {formatTime(r3Data.result.decidedAt)} ({r3Data.result.reason === 'code' ? 'Solved all 4 boxes' : 'Furthest progress at time expiry'})
                </div>
              </div>
              <div className="px-3 py-1.5 bg-emerald-900/80 border border-emerald-500/50 rounded text-emerald-200 text-xs font-semibold">
                EVENT ENDED
              </div>
            </div>
          )}

          {/* Grid Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-900 rounded border border-slate-800">
              <div className="text-xs text-slate-400">Status</div>
              <div className="text-base font-bold text-slate-100 capitalize">{phase.replace('_', ' ')}</div>
            </div>
            <div className="p-3 bg-slate-900 rounded border border-slate-800">
              <div className="text-xs text-slate-400">Code Form</div>
              <div className="text-base font-bold text-slate-100">
                {r3Data?.codeSet ? (
                  <span className="text-emerald-400">Valid Code Configured</span>
                ) : (
                  <span className="text-amber-400">Placeholder Code</span>
                )}
              </div>
            </div>
            <div className="p-3 bg-slate-900 rounded border border-slate-800">
              <div className="text-xs text-slate-400">Eligible Teams</div>
              <div className="text-base font-bold text-slate-100">
                {r3Data?.teams?.length || 0} / 5
              </div>
            </div>
            <div className="p-3 bg-slate-900 rounded border border-slate-800">
              <div className="text-xs text-slate-400">Live Polling</div>
              <div className="text-base font-bold text-cyan-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                {phase === 'r3_open' ? 'Active (3s)' : 'Idle (5s)'}
              </div>
            </div>
          </div>

          {/* Teams Live Grid Table */}
          <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden shadow">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Live Leaderboard & Box Matrix</h2>
                <p className="text-xs text-slate-400">Click a team row to inspect wrong answers.</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse min-w-[760px]">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <th className="py-2.5 px-3 w-12 text-center">Rank</th>
                    <th className="py-2.5 px-3">Team</th>
                    <th className="py-2.5 px-3">Zone</th>
                    <th className="py-2.5 px-3 text-center">Scan</th>
                    <th className="py-2.5 px-3 text-center">Box 1</th>
                    <th className="py-2.5 px-3 text-center">Box 2</th>
                    <th className="py-2.5 px-3 text-center">Box 3</th>
                    <th className="py-2.5 px-3 text-center">Box 4</th>
                    <th className="py-2.5 px-3 text-center">Milestones</th>
                    <th className="py-2.5 px-3 text-center">State</th>
                    <th className="py-2.5 px-3 text-center">Overrides</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {(!r3Data?.teams || r3Data.teams.length === 0) && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-500">
                        No eligible teams participating in Round 3 yet.
                      </td>
                    </tr>
                  )}
                  {r3Data?.teams?.map((team, idx) => {
                    const isLeader = idx === 0 && team.milestones > 0;
                    return (
                      <tr
                        key={team.teamId}
                        onClick={() => setSelectedTeamWrongs(team)}
                        className={`cursor-pointer transition-colors ${
                          isLeader ? 'bg-cyan-950/20 hover:bg-cyan-950/30' : 'hover:bg-slate-800/50'
                        }`}
                      >
                        {/* Rank */}
                        <td className="py-3 px-3 text-center font-bold">
                          {isLeader ? (
                            <span className="text-cyan-400">#{team.rank}</span>
                          ) : (
                            <span className="text-slate-400">#{team.rank}</span>
                          )}
                        </td>

                        {/* Team Name */}
                        <td className="py-3 px-3 font-semibold text-slate-100">
                          {team.teamName}
                          <div className="text-[10px] text-slate-400 font-mono">{team.teamId}</div>
                        </td>

                        {/* Zone */}
                        <td className="py-3 px-3 text-slate-300 font-medium">
                          {team.zoneName || <span className="text-slate-500 italic">Unassigned</span>}
                        </td>

                        {/* Scan (Milestone 0) */}
                        <td className="py-3 px-3 text-center">
                          {team.scan ? (
                            <div className="flex flex-col items-center">
                              <span className="text-emerald-400 font-mono font-semibold">
                                {formatElapsed(team.scan.ms, r3Data?.startMs)}
                              </span>
                              <span className="text-[10px] text-slate-400">{formatTime(team.scan.at)}</span>
                              {team.scan.credited && (
                                <span className="text-[9px] px-1 bg-amber-900/60 text-amber-300 rounded border border-amber-700/50">
                                  Credited
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600 font-mono">--:--</span>
                          )}
                        </td>

                        {/* Boxes 1 - 4 */}
                        {[1, 2, 3, 4].map((boxNum) => {
                          const boxData = team.boxes.find((b) => b.box === boxNum);
                          if (!boxData) return <td key={boxNum} className="py-3 px-3 text-center text-slate-600">-</td>;

                          if (boxData.status === 'solved') {
                            return (
                              <td key={boxNum} className="py-3 px-3 text-center bg-emerald-950/20">
                                <div className="flex flex-col items-center">
                                  <span className="text-emerald-400 font-mono font-bold">
                                    {formatElapsed(boxData.solvedMs, r3Data?.startMs)}
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {formatTime(boxData.solvedAt)}
                                  </span>
                                  {boxData.credited && (
                                    <span className="text-[9px] px-1 bg-amber-900/60 text-amber-300 rounded border border-amber-700/50">
                                      Credited
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          if (boxData.status === 'locked') {
                            return (
                              <td key={boxNum} className="py-3 px-3 text-center bg-rose-950/30">
                                <span className="px-1.5 py-0.5 rounded bg-rose-900/80 text-rose-300 text-[10px] font-bold border border-rose-700/50">
                                  LOCKED (2/2)
                                </span>
                              </td>
                            );
                          }

                          return (
                            <td key={boxNum} className="py-3 px-3 text-center">
                              <span className="text-slate-400 font-mono">
                                {boxData.triesUsed}/2 tries
                              </span>
                            </td>
                          );
                        })}

                        {/* Milestones */}
                        <td className="py-3 px-3 text-center font-bold text-slate-100">
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs">
                            {team.milestones}/5
                          </span>
                        </td>

                        {/* State */}
                        <td className="py-3 px-3 text-center">
                          {team.state === 'finished' ? (
                            <span className="px-2 py-0.5 rounded bg-purple-900/80 text-purple-200 font-bold text-[10px] tracking-wider uppercase border border-purple-700">
                              FINISHED
                            </span>
                          ) : team.state === 'solving' ? (
                            <span className="px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-300 font-semibold text-[10px] uppercase">
                              Solving
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] uppercase">
                              Searching
                            </span>
                          )}
                        </td>

                        {/* Overrides Menu */}
                        <td
                          className="py-3 px-3 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1">
                            {!team.scan && (
                              <button
                                onClick={() =>
                                  setOverrideModal({
                                    open: true,
                                    action: 'credit-scan',
                                    teamId: team.teamId,
                                    teamName: team.teamName,
                                  })
                                }
                                title="Credit start QR scan"
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] border border-slate-700"
                              >
                                Scan
                              </button>
                            )}
                            <div className="relative group">
                              <button className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700">
                                Box &darr;
                              </button>
                              <div className="absolute right-0 top-full mt-1 w-32 bg-slate-900 border border-slate-700 rounded shadow-xl py-1 z-20 hidden group-hover:block">
                                {[1, 2, 3, 4].map((b) => (
                                  <div key={b} className="px-2 py-1 border-b border-slate-800 last:border-0">
                                    <div className="text-[10px] font-bold text-slate-400">Box {b}</div>
                                    <div className="flex gap-1 mt-0.5">
                                      <button
                                        onClick={() =>
                                          setOverrideModal({
                                            open: true,
                                            action: 'credit-box',
                                            teamId: team.teamId,
                                            teamName: team.teamName,
                                            box: b,
                                          })
                                        }
                                        className="text-[9px] text-amber-400 hover:underline"
                                      >
                                        Credit
                                      </button>
                                      <span className="text-slate-600">|</span>
                                      <button
                                        onClick={() =>
                                          setOverrideModal({
                                            open: true,
                                            action: 'reset-box',
                                            teamId: team.teamId,
                                            teamName: team.teamName,
                                            box: b,
                                          })
                                        }
                                        className="text-[9px] text-rose-400 hover:underline"
                                      >
                                        Reset
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedReassignZone(1);
                                setOverrideModal({
                                  open: true,
                                  action: 'reassign-zone',
                                  teamId: team.teamId,
                                  teamName: team.teamName,
                                });
                              }}
                              title="Reassign Zone"
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] border border-slate-700"
                            >
                              Zone
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 2: TEAMS & ZONE ASSIGNMENTS */}
      {/* ========================================================= */}
      {activeTab === 'teams' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Round 2 Teams Selection & Zone Allocation</h2>
              <p className="text-xs text-slate-400">
                Tick 1 to 5 teams to qualify for Round 3. Preselected automatically by Round 2 rank.
              </p>
            </div>
            <button
              onClick={handleRandomizeZones}
              className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Randomize Zones
            </button>
          </div>

          {teamsMsg && (
            <div
              className={`p-3 rounded text-xs ${
                teamsMsg.ok ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
              }`}
            >
              {teamsMsg.text}
            </div>
          )}

          <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden shadow">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <th className="py-2.5 px-3 w-10 text-center">R3</th>
                    <th className="py-2.5 px-3 w-12 text-center">R2 Rank</th>
                    <th className="py-2.5 px-3">Team Name</th>
                    <th className="py-2.5 px-3 text-center">R2 Points</th>
                    <th className="py-2.5 px-3 text-center">Assigned Zone</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {loadingTeams && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Loading teams...
                      </td>
                    </tr>
                  )}
                  {!loadingTeams && r2Teams.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No Round 2 teams found.
                      </td>
                    </tr>
                  )}
                  {!loadingTeams &&
                    r2Teams.map((t) => (
                      <tr
                        key={t.id}
                        className={`hover:bg-slate-800/50 ${
                          t.eligible ? 'bg-slate-800/30' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={t.eligible}
                            onChange={() => handleToggleEligible(t.id, t.eligible)}
                            className="w-4 h-4 rounded text-cyan-500 focus:ring-0 bg-slate-800 border-slate-700 cursor-pointer"
                          />
                        </td>

                        {/* Rank */}
                        <td className="py-3 px-3 text-center font-bold text-slate-300">
                          #{t.rank}
                        </td>

                        {/* Name */}
                        <td className="py-3 px-3 font-semibold text-slate-100">
                          {t.name}
                          <span className="text-[10px] text-slate-400 font-mono ml-2">({t.id})</span>
                          {t.tiedAtCutoff && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold">
                              TIED AT CUTOFF
                            </span>
                          )}
                        </td>

                        {/* R2 Points */}
                        <td className="py-3 px-3 text-center font-mono text-slate-300">
                          {t.points} pts
                        </td>

                        {/* Zone dropdown */}
                        <td className="py-3 px-3 text-center">
                          {t.eligible ? (
                            <select
                              value={t.zone || ''}
                              onChange={(e) => handleAssignZone(t.id, parseInt(e.target.value, 10))}
                              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:border-cyan-500 focus:outline-none"
                            >
                              <option value="">Select Zone...</option>
                              {zones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  Zone {z.id}: {z.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3">
                          {t.eligible ? (
                            <span className="text-emerald-400 font-medium">Eligible</span>
                          ) : (
                            <span className="text-slate-500">Not selected</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 3: SETUP, CONTENT & RIDDLES */}
      {/* ========================================================= */}
      {activeTab === 'setup' && (
        <div className="space-y-6">
          {/* Placeholder Warning Banner */}
          {placeholderCount > 0 && (
            <div className="p-4 rounded-lg bg-rose-950/80 border border-rose-600 flex items-center justify-between gap-3 text-rose-200 text-xs">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  <strong>Attention:</strong> There are <strong>{placeholderCount}</strong> items still containing <code>[PLACEHOLDER]</code> text. Round 3 cannot open with blank or placeholder content!
                </span>
              </div>
            </div>
          )}

          {setupMsg && (
            <div
              className={`p-3 rounded text-xs ${
                setupMsg.ok ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
              }`}
            >
              {setupMsg.text}
            </div>
          )}

          {/* Config: Code & Hint */}
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-5 shadow">
            <h2 className="text-sm font-semibold text-slate-100 mb-1">Final Secret Code & Hint</h2>
            <p className="text-xs text-slate-400 mb-4">
              4 characters: 1 digit (1-9) then 3 letters (e.g. <code>1DAI</code>). Box 1 = 1st char, Box 2 = 2nd char, etc.
            </p>

            <form onSubmit={handleSaveConfig} className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Master Code
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={config.code}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setConfig({ ...config, code: val });
                    setCodeValid(/^[1-9][A-Z]{3}$/.test(val));
                  }}
                  className={`w-40 font-mono tracking-widest text-lg px-3 py-1.5 rounded bg-slate-950 border ${
                    codeValid ? 'border-slate-700 text-white' : 'border-rose-500 text-rose-300'
                  } focus:outline-none focus:border-cyan-500`}
                />
                {!codeValid && (
                  <p className="text-xs text-rose-400 mt-1">Must be 1 digit (1-9) followed by 3 letters.</p>
                )}
                <p className="text-[11px] text-amber-400 font-medium mt-1">
                  &bull; Warning: Change the physical cards too when altering this code.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Cipher Hint Text (Optional)
                </label>
                <input
                  type="text"
                  value={config.hintText}
                  onChange={(e) => setConfig({ ...config, hintText: e.target.value })}
                  placeholder="e.g. Letter shift +2, or coordinate map"
                  className="w-full text-xs px-3 py-2 rounded bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <button
                type="submit"
                disabled={savingSetup || !codeValid}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded text-xs font-semibold transition-colors"
              >
                {savingSetup ? 'Saving...' : 'Save Master Code & Hint'}
              </button>
            </form>
          </div>

          {/* Zones & Start Riddles */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">Physical Zones & Start Riddles</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {zones.map((z) => (
                <div key={z.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3 shadow">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                      Zone {z.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRegenerateToken(z.id)}
                      className="text-[10px] text-slate-400 hover:text-rose-400"
                    >
                      Regenerate Token
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Zone Name</label>
                    <input
                      type="text"
                      defaultValue={z.name}
                      onBlur={(e) => {
                        if (e.target.value !== z.name) {
                          handleSaveZone(z.id, e.target.value, z.findRiddle);
                        }
                      }}
                      className="w-full text-xs px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Start Riddle (Points to Start QR)
                    </label>
                    <textarea
                      rows={3}
                      defaultValue={z.findRiddle}
                      onBlur={(e) => {
                        if (e.target.value !== z.findRiddle) {
                          handleSaveZone(z.id, z.name, e.target.value);
                        }
                      }}
                      className="w-full text-xs px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white font-mono"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-mono">Token: {z.token.substring(0, 10)}...</span>
                    <Link
                      href={`/s/${z.token}`}
                      target="_blank"
                      className="text-cyan-400 hover:underline"
                    >
                      QR Link &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 20 Box Riddles Editor */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Box Riddles (20 items: 5 zones &times; 4 boxes)</h2>
              <p className="text-xs text-slate-400">
                Each zone has 4 physical boxes hidden nearby. Authoring rule: Box 1 must produce Character 1 of the code, Box 2 Character 2, etc.
              </p>
            </div>

            <div className="space-y-4">
              {zones.map((zone) => (
                <div key={zone.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <h3 className="text-xs font-bold text-slate-200 mb-3 uppercase tracking-wider">
                    Zone {zone.id}: {zone.name}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((boxNum) => {
                      const riddle = riddles.find((r) => r.zone === zone.id && r.box === boxNum);
                      const currentText = riddle?.text || '';
                      return (
                        <div key={boxNum} className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1.5">
                          <div className="flex justify-between items-center text-[11px] font-semibold">
                            <span className="text-slate-300">Box {boxNum}</span>
                            <span className="text-cyan-400 font-mono">Char {boxNum}</span>
                          </div>
                          <textarea
                            rows={3}
                            defaultValue={currentText}
                            placeholder="Enter riddle text..."
                            onBlur={(e) => {
                              if (e.target.value !== currentText) {
                                handleSaveRiddle(zone.id, boxNum, e.target.value);
                              }
                            }}
                            className="w-full text-xs p-2 rounded bg-slate-900 border border-slate-700 text-white font-mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: OVERRIDES */}
      {/* ========================================================= */}
      {overrideModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-100">
              Admin Override: {overrideModal.action.replace('-', ' ').toUpperCase()}
            </h3>
            <p className="text-xs text-slate-400">
              Target: <strong className="text-slate-200">{overrideModal.teamName}</strong> ({overrideModal.teamId})
              {overrideModal.box && <span> &bull; Box {overrideModal.box}</span>}
            </p>

            {overrideModal.action === 'reassign-zone' && (
              <div>
                <label className="block text-xs text-slate-300 mb-1">New Zone</label>
                <select
                  value={selectedReassignZone}
                  onChange={(e) => setSelectedReassignZone(parseInt(e.target.value, 10))}
                  className="w-full text-xs px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      Zone {z.id}: {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <form onSubmit={handleSubmitOverride} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Reason for Override <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Phone malfunction / Physical card damaged"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {overrideError && (
                <div className="p-2.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                  {overrideError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOverrideModal(null);
                    setOverrideReason('');
                    setOverrideError(null);
                  }}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingOverride}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold shadow transition-colors"
                >
                  {submittingOverride ? 'Submitting...' : 'Apply Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: TEAM WRONG ANSWERS DETAILS */}
      {/* ========================================================= */}
      {selectedTeamWrongs && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-white">
                  {selectedTeamWrongs.teamName} — Box Attempts
                </h3>
                <p className="text-xs text-slate-400">Team ID: {selectedTeamWrongs.teamId} &bull; Zone: {selectedTeamWrongs.zoneName}</p>
              </div>
              <button
                onClick={() => setSelectedTeamWrongs(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {[1, 2, 3, 4].map((boxNum) => {
                const b = selectedTeamWrongs.boxes.find((box) => box.box === boxNum);
                return (
                  <div key={boxNum} className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-200">Box {boxNum}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          b?.status === 'solved'
                            ? 'bg-emerald-950 text-emerald-400'
                            : b?.status === 'locked'
                            ? 'bg-rose-950 text-rose-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {b?.status.toUpperCase()} ({b?.triesUsed}/2 tries)
                      </span>
                    </div>

                    {b?.solvedAt && (
                      <div className="text-[11px] text-emerald-400">
                        Solved at {formatTime(b.solvedAt)} {b.credited ? '(Admin Credited)' : ''}
                      </div>
                    )}

                    {(!b?.wrongValues || b.wrongValues.length === 0) ? (
                      <div className="text-[11px] text-slate-500 italic">No wrong attempts.</div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Wrong Submissions:</div>
                        {b.wrongValues.map((wv, i) => (
                          <div key={i} className="text-xs font-mono text-rose-300 flex justify-between bg-rose-950/20 px-2 py-0.5 rounded">
                            <span>Value: &quot;{wv.value}&quot;</span>
                            <span className="text-[10px] text-slate-500">{formatTime(wv.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedTeamWrongs(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
