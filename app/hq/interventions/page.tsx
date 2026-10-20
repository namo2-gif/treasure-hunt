'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';

interface Result { ok: boolean; message?: string; code?: string; [key: string]: any; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-xl bg-slate-800/80 border border-slate-700">
      <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  );
}

function ResultBadge({ result }: { result: Result | null }) {
  if (!result) return null;
  return (
    <div className={`mt-2 p-2.5 rounded text-xs border ${result.ok ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300' : 'bg-red-950/60 border-red-800 text-red-200'}`}>
      {result.ok ? '✓ ' : '✗ '}{result.message || (result.ok ? 'Success' : result.code || 'Error')}
      {result.ok && result.deletedAttempts !== undefined && ` · Deleted ${result.deletedAttempts} attempt(s).`}
      {result.ok && result.run !== undefined && ` · Piece #${result.piece_no ?? result.pieceNo} at "${result.qr_name ?? result.qrName}".`}
    </div>
  );
}

async function callApi(url: string, body: object): Promise<Result> {
  try {
    return await adminFetch<Result>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Request failed' };
  }
}

export default function InterventionsPage() {
  // Cancel Registration
  const [cancelRegId, setCancelRegId] = useState('');
  const [cancelResult, setCancelResult] = useState<Result | null>(null);

  // Admin Register
  const [adminRegStudent, setAdminRegStudent] = useState('');
  const [adminRegQr, setAdminRegQr] = useState('');
  const [adminRegRun, setAdminRegRun] = useState('');
  const [adminRegResult, setAdminRegResult] = useState<Result | null>(null);

  // Skip Teaser
  const [skipTeamId, setSkipTeamId] = useState('');
  const [skipRun, setSkipRun] = useState('1');
  const [skipResult, setSkipResult] = useState<Result | null>(null);

  // Reset Attempts
  const [resetTeamId, setResetTeamId] = useState('');
  const [resetItemId, setResetItemId] = useState('');
  const [resetKind, setResetKind] = useState<'r1' | 'r2'>('r2');
  const [resetResult, setResetResult] = useState<Result | null>(null);

  // Void Question
  const [voidQId, setVoidQId] = useState('');
  const [voidTeamId, setVoidTeamId] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [voidResult, setVoidResult] = useState<Result | null>(null);

  const [loading, setLoading] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<Result>, setResult: (r: Result) => void) {
    setLoading(key);
    try {
      const r = await fn();
      setResult(r);
    } catch (e: any) {
      setResult({ ok: false, message: e.message || 'Network error' });
    } finally {
      setLoading(null);
    }
  }

  const inputClass = 'w-full px-2.5 py-1.5 text-xs rounded bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] font-semibold uppercase text-slate-400 mb-1';
  const BtnAct = ({ onClick, children, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || loading !== null}
      className="mt-3 w-full py-2 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500 transition-colors disabled:opacity-40">
      {disabled ? 'Working...' : children}
    </button>
  );

  return (
    <div className="w-full space-y-6">
      <div className="pb-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Emergency Overrides
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Interventions
          </h1>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* A. Cancel Registration */}
        <Section title="Cancel Registration">
          <p className="text-xs text-slate-400 mb-3">Removes a registration and frees the QR slot and piece number.</p>
          <div>
            <label className={labelClass}>Registration ID</label>
            <input className={inputClass} type="number" placeholder="e.g. 42" value={cancelRegId} onChange={(e) => setCancelRegId(e.target.value)} />
          </div>
          <BtnAct
            onClick={() => act('cancel', () => callApi('/api/admin/interventions/cancel-registration', { registrationId: parseInt(cancelRegId) }), setCancelResult)}
            disabled={loading === 'cancel'}
          >Cancel Registration</BtnAct>
          <ResultBadge result={cancelResult} />
        </Section>

        {/* B. Admin Manual Register */}
        <Section title="Admin Manual Register">
          <p className="text-xs text-slate-400 mb-3">Registers a student at a QR location, bypassing capacity limits.</p>
          <div className="space-y-2">
            <div>
              <label className={labelClass}>Student ID</label>
              <input className={inputClass} placeholder="e.g. S0101" value={adminRegStudent} onChange={(e) => setAdminRegStudent(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>QR Location ID</label>
              <input className={inputClass} type="number" placeholder="e.g. 5" value={adminRegQr} onChange={(e) => setAdminRegQr(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Run (optional — auto-detected if blank)</label>
              <select className={inputClass} value={adminRegRun} onChange={(e) => setAdminRegRun(e.target.value)}>
                <option value="">Auto-detect</option>
                <option value="1">Run 1</option>
                <option value="2">Run 2</option>
              </select>
            </div>
          </div>
          <BtnAct
            onClick={() => act('adminReg', () => callApi('/api/admin/interventions/admin-register', {
              studentId: adminRegStudent,
              qrId: parseInt(adminRegQr),
              ...(adminRegRun && { run: parseInt(adminRegRun) }),
            }), setAdminRegResult)}
            disabled={loading === 'adminReg'}
          >Admin Register</BtnAct>
          <ResultBadge result={adminRegResult} />
        </Section>

        {/* C. Skip Teaser */}
        <Section title="Skip Teaser">
          <p className="text-xs text-slate-400 mb-3">Skips the teaser for a team and immediately assigns questions.</p>
          <div className="space-y-2">
            <div>
              <label className={labelClass}>Team ID</label>
              <input className={inputClass} placeholder="e.g. T01" value={skipTeamId} onChange={(e) => setSkipTeamId(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Run</label>
              <select className={inputClass} value={skipRun} onChange={(e) => setSkipRun(e.target.value)}>
                <option value="1">Run 1</option>
                <option value="2">Run 2</option>
              </select>
            </div>
          </div>
          <BtnAct
            onClick={() => act('skip', () => callApi('/api/admin/interventions/skip-teaser', { teamId: skipTeamId, run: parseInt(skipRun) }), setSkipResult)}
            disabled={loading === 'skip'}
          >Skip Teaser</BtnAct>
          <ResultBadge result={skipResult} />
        </Section>

        {/* D. Reset Attempts */}
        <Section title="Reset Attempts">
          <p className="text-xs text-slate-400 mb-3">Deletes attempt records so a team can retry a riddle or question.</p>
          <div className="space-y-2">
            <div>
              <label className={labelClass}>Team ID</label>
              <input className={inputClass} placeholder="e.g. T01" value={resetTeamId} onChange={(e) => setResetTeamId(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Item ID (Riddle ID or Question ID)</label>
              <input className={inputClass} type="number" placeholder="e.g. 3" value={resetItemId} onChange={(e) => setResetItemId(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Kind</label>
              <select className={inputClass} value={resetKind} onChange={(e) => setResetKind(e.target.value as 'r1' | 'r2')}>
                <option value="r1">R1 Riddle</option>
                <option value="r2">R2 Question</option>
              </select>
            </div>
          </div>
          <BtnAct
            onClick={() => act('reset', () => callApi('/api/admin/interventions/reset-attempts', {
              teamId: resetTeamId,
              itemId: parseInt(resetItemId),
              kind: resetKind,
            }), setResetResult)}
            disabled={loading === 'reset'}
          >Reset Attempts</BtnAct>
          <ResultBadge result={resetResult} />
        </Section>

        {/* E. Void Question */}
        <div className="md:col-span-2">
          <Section title="Void Question">
            <p className="text-xs text-slate-400 mb-3">Voids a question for one team (or all teams). Creates a score adjustment for points already lost. Reason is required.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Question ID</label>
                <input className={inputClass} type="number" placeholder="e.g. 7" value={voidQId} onChange={(e) => setVoidQId(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Team ID (blank = all teams)</label>
                <input className={inputClass} placeholder="e.g. T01 or leave blank" value={voidTeamId} onChange={(e) => setVoidTeamId(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Reason (required)</label>
                <input className={inputClass} placeholder="Reason for voiding" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </div>
            </div>
            <BtnAct
              onClick={() => act('void', () => callApi('/api/admin/interventions/void-question', {
                questionId: parseInt(voidQId),
                teamId: voidTeamId.trim() || null,
                reason: voidReason,
              }), setVoidResult)}
              disabled={loading === 'void'}
            >Void Question</BtnAct>
            <ResultBadge result={voidResult} />
          </Section>
        </div>
      </div>
    </div>
  );
}
