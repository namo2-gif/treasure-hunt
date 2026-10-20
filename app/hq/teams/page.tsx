'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

interface Member {
  id: string;
  name: string;
  isCaptain: boolean;
  absent: boolean;
  failedLogins: number;
  lockedUntil: string | null;
}

interface Team {
  id: string;
  name: string;
  n: number;
  qualified: boolean;
  withdrawn: boolean;
  r3Eligible: boolean;
  members: Member[];
}

export default function TeamsPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resetCodeResults, setResetCodeResults] = useState<Record<string, string>>({});
  const [editN, setEditN] = useState<Record<string, number>>({});
  const [editingN, setEditingN] = useState<string | null>(null);
  const [absentTarget, setAbsentTarget] = useState<string>('');
  const [absentingFor, setAbsentingFor] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    try {
      const data = await adminFetch<any>('/api/admin/teams-full');
      if (data.ok) {
        setTeams(data.teams);
        setError(null);
      } else {
        setError(data.message || 'Failed to load teams');
      }
    } catch (e: any) {
      if (e instanceof AdminFetchError && e.status === 401) return;
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
    const iv = setInterval(fetchTeams, 5000);
    return () => clearInterval(iv);
  }, [fetchTeams]);

  async function studentAction(studentId: string, action: string, body: object = {}) {
    setActionLoading(`${studentId}:${action}`);
    try {
      const data = await adminFetch<any>(`/api/admin/students/${studentId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!data.ok) {
        alert(`Error: ${data.message || data.code}`);
      } else {
        if (action === 'reset-code' && data.code) {
          setResetCodeResults((prev) => ({ ...prev, [studentId]: data.code }));
        }
        await fetchTeams();
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function teamPatch(teamId: string, patch: object) {
    setActionLoading(`team:${teamId}`);
    try {
      const data = await adminFetch<any>(`/api/admin/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!data.ok) {
        alert(`Error: ${data.message || data.code}`);
      } else {
        setEditingN(null);
        await fetchTeams();
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = teams.filter((t) => {
    const q = search.toLowerCase();
    if (!q) return true;
    if (t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) return true;
    return t.members.some((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  });

  const BtnSm = ({ onClick, disabled, className, children }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-[10px] font-bold rounded border transition-colors disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );

  return (
    <div className="w-full space-y-6">
      <div className="pb-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Rosters & Passcodes
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Teams & Students
          </h1>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={fetchTeams} />

      <div className="mt-4">
        <input
          type="text"
          placeholder="Search by team ID, name, or student ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent"
        />
      </div>

      {loading ? (
        <p className="mt-8 text-center text-xs text-slate-400">Loading teams...</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filtered.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No teams found.</p>
          )}
          {filtered.map((team) => (
            <div key={team.id} className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
              {/* Team header */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="font-bold text-accent text-sm">{team.id}</span>
                <span className="text-slate-200 font-semibold text-sm">{team.name}</span>
                <span className="text-slate-400 text-xs">(n={team.n})</span>
                {team.qualified && <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400">Qualified</span>}
                {team.withdrawn && <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/20 text-red-400">Withdrawn</span>}
                {team.r3Eligible && <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500/20 text-amber-400">R3</span>}
              </div>

              {/* Team actions */}
              <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-slate-700/60">
                {/* Edit N */}
                {editingN === team.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={3} max={5}
                      value={editN[team.id] ?? team.n}
                      onChange={(e) => setEditN((p) => ({ ...p, [team.id]: parseInt(e.target.value) || team.n }))}
                      className="w-14 px-1.5 py-0.5 text-xs rounded bg-slate-900 border border-slate-600 text-slate-100"
                    />
                    <BtnSm
                      onClick={() => teamPatch(team.id, { n: editN[team.id] ?? team.n })}
                      disabled={actionLoading === `team:${team.id}`}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-600"
                    >Save N</BtnSm>
                    <BtnSm onClick={() => setEditingN(null)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600">✕</BtnSm>
                  </div>
                ) : (
                  <BtnSm onClick={() => { setEditingN(team.id); setEditN((p) => ({ ...p, [team.id]: team.n })); }} className="bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600">
                    Edit N
                  </BtnSm>
                )}
                <BtnSm
                  onClick={() => teamPatch(team.id, { withdrawn: !team.withdrawn })}
                  disabled={actionLoading === `team:${team.id}`}
                  className={team.withdrawn ? 'bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 border-emerald-700' : 'bg-red-950/60 hover:bg-red-900 text-red-300 border-red-800'}
                >
                  {team.withdrawn ? 'Un-withdraw' : 'Withdraw'}
                </BtnSm>
              </div>

              {/* Members */}
              <div className="space-y-2">
                {team.members.map((member) => (
                  <div key={member.id} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700/80">
                    {/* Reset code result */}
                    {resetCodeResults[member.id] && (
                      <div className="mb-2 p-2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-mono flex items-center justify-between gap-2">
                        <span>New code for <b>{member.name}</b>: <b className="text-amber-200 text-sm tracking-widest">{resetCodeResults[member.id]}</b></span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(resetCodeResults[member.id]!); }}
                          className="px-2 py-0.5 text-[10px] bg-amber-600 hover:bg-amber-500 text-white rounded font-bold"
                        >Copy</button>
                        <button
                          onClick={() => setResetCodeResults((p) => { const n = { ...p }; delete n[member.id]; return n; })}
                          className="text-slate-400 hover:text-slate-200 text-[10px]"
                        >✕</button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-400">{member.id}</span>
                        <span className="text-slate-200 text-xs font-semibold">{member.name}</span>
                        {member.isCaptain && <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400">Captain</span>}
                        {member.absent && <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400">Absent</span>}
                        {member.lockedUntil && new Date(member.lockedUntil) > new Date() && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-500/20 text-orange-400">🔒 Throttled</span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <BtnSm
                          onClick={() => studentAction(member.id, 'reset-code')}
                          disabled={actionLoading === `${member.id}:reset-code`}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600"
                        >Reset Code</BtnSm>

                        <BtnSm
                          onClick={() => studentAction(member.id, 'unlock')}
                          disabled={actionLoading === `${member.id}:unlock`}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600"
                        >Unlock</BtnSm>

                        {!member.isCaptain && (
                          <BtnSm
                            onClick={() => studentAction(member.id, 'make-captain')}
                            disabled={actionLoading === `${member.id}:make-captain`}
                            className="bg-amber-900/60 hover:bg-amber-800 text-amber-300 border-amber-700"
                          >Make Captain</BtnSm>
                        )}

                        {!member.absent ? (
                          <>
                            {absentingFor === member.id ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={absentTarget}
                                  onChange={(e) => setAbsentTarget(e.target.value)}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 border border-slate-600 text-slate-100"
                                >
                                  <option value="">Move pieces to...</option>
                                  {team.members.filter((m) => m.id !== member.id && !m.absent).map((m) => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                                  ))}
                                </select>
                                <BtnSm
                                  onClick={async () => {
                                    if (!absentTarget) { alert('Select a teammate'); return; }
                                    await studentAction(member.id, 'absent', { moveToStudentId: absentTarget });
                                    setAbsentingFor(null);
                                    setAbsentTarget('');
                                  }}
                                  disabled={!absentTarget}
                                  className="bg-red-950/60 hover:bg-red-900 text-red-300 border-red-800"
                                >Confirm</BtnSm>
                                <BtnSm onClick={() => setAbsentingFor(null)} className="bg-slate-700 text-slate-400 border-slate-600">✕</BtnSm>
                              </div>
                            ) : (
                              <BtnSm
                                onClick={() => { setAbsentingFor(member.id); setAbsentTarget(''); }}
                                className="bg-red-950/60 hover:bg-red-900 text-red-300 border-red-800"
                              >Mark Absent</BtnSm>
                            )}
                          </>
                        ) : (
                          <BtnSm
                            onClick={() => studentAction(member.id, 'unabsent')}
                            disabled={actionLoading === `${member.id}:unabsent`}
                            className="bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 border-emerald-700"
                          >Unmark Absent</BtnSm>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
