'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminFetch, AdminFetchError } from '@/lib/admin-fetch';
import ErrorBanner from '@/components/hq/ErrorBanner';

type Tab = 'riddles' | 'questions' | 'teasers' | 'qr' | 'round3';

interface Option { id: string; text: string; }
interface Riddle { id: number; position: number; text: string; options: Option[]; correctOptionId: string; hasAttempts: boolean; }
interface Question { id: number; run: number; slot: number; variant: number; qrId: number; qrName: string; stem: string; options: Option[]; correctOptionId: string; hasAttempts: boolean; }
interface Teaser { id: number; run: number; size: number; pieces: string[]; answerNorm: string; }
interface QRItem { id: number; name: string; token: string; capacity: number; active: boolean; registeredRun1?: number; registeredRun2?: number; scanUrl?: string; }
interface Round3Config { code: string; hintText: string; clueText?: string; passwordNorm?: string; }

function optionsFromText(text: string): Option[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      // Matches "a: Option text" or "a. Option text" or "a - Option text"
      const m = line.match(/^([a-z0-9])[\:\.\-]\s*(.+)$/i);
      if (m) {
        return { id: m[1].toLowerCase(), text: m[2].trim() };
      }
      // If line does not have prefix (e.g. just "DR", "EF"), assign auto id 'a', 'b', etc.
      const defaultId = String.fromCharCode(97 + idx); // 0 -> 'a', 1 -> 'b', etc.
      return { id: defaultId, text: line };
    })
    .filter(Boolean) as Option[];
}

function optionsToText(opts: Option[]): string {
  if (!opts || !Array.isArray(opts)) return '';
  return opts.map((o) => `${o.id}: ${o.text}`).join('\n');
}

export default function ContentPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('riddles');
  const [riddles, setRiddles] = useState<Riddle[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [teasers, setTeasers] = useState<Teaser[]>([]);
  const [qrs, setQrs] = useState<QRItem[]>([]);
  const [r3, setR3] = useState<Round3Config>({ code: '1DAI', hintText: '', clueText: '', passwordNorm: '' });
  const [loading, setLoading] = useState(true);
  const [errorBannerMsg, setErrorBannerMsg] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Edit states
  const [editRiddle, setEditRiddle] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState<number | null>(null);
  const [editTeaser, setEditTeaser] = useState<number | null>(null);
  const [editQr, setEditQr] = useState<number | null>(null);
  const [editForms, setEditForms] = useState<Record<string, any>>({});

  // New form states
  const [newRiddle, setNewRiddle] = useState({ position: '', text: '', optionsText: '', correctOptionId: '' });
  const [newQuestion, setNewQuestion] = useState({ run: '1', slot: '1', variant: '1', qrId: '', stem: '', optionsText: '', correctOptionId: '' });
  const [newTeaser, setNewTeaser] = useState({ run: '1', size: '3', piecesText: '', answerNorm: '' });
  const [newQr, setNewQr] = useState({ name: '', capacity: '12' });
  const [showNewRiddle, setShowNewRiddle] = useState(false);
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [showNewTeaser, setShowNewTeaser] = useState(false);
  const [showNewQr, setShowNewQr] = useState(false);

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const fetchAll = useCallback(async () => {
    setErrorBannerMsg(null);
    try {
      const [rd, qd, td, qrd, r3d] = await Promise.all([
        adminFetch<{ ok: boolean; riddles: Riddle[] }>('/api/admin/content/riddles'),
        adminFetch<{ ok: boolean; questions: Question[] }>('/api/admin/content/questions'),
        adminFetch<{ ok: boolean; teasers: Teaser[] }>('/api/admin/content/teasers'),
        adminFetch<{ ok: boolean; qrs: QRItem[] }>('/api/admin/content/qr'),
        adminFetch<{ ok: boolean; code?: string; hintText?: string; clueText?: string; passwordNorm?: string }>('/api/admin/round3'),
      ]);

      if (rd.ok) setRiddles(rd.riddles || []);
      if (qd.ok) setQuestions(qd.questions || []);
      if (td.ok) setTeasers(td.teasers || []);
      if (qrd.ok) setQrs(qrd.qrs || []);
      if (r3d.ok) {
        setR3({
          code: r3d.code || r3d.passwordNorm || '1DAI',
          hintText: r3d.hintText || r3d.clueText || '',
          clueText: r3d.clueText || r3d.hintText || '',
          passwordNorm: r3d.passwordNorm || r3d.code || '1DAI',
        });
      }
    } catch (e: any) {
      if (e instanceof AdminFetchError && e.status === 401) {
        return; // Redirected by adminFetch
      }
      setErrorBannerMsg(e.message || 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function callApi(url: string, method: string, body?: object) {
    try {
      const res = await adminFetch<any>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return res;
    } catch (err: any) {
      return { ok: false, message: err.message || 'Request failed' };
    }
  }

  // Riddle actions
  async function saveRiddle(id: number) {
    const f = editForms[`r:${id}`] || {};
    const data = await callApi(`/api/admin/content/riddles/${id}`, 'PUT', {
      ...(f.text !== undefined && { text: f.text }),
      ...(f.position !== undefined && { position: parseInt(f.position, 10) }),
      ...(f.optionsText !== undefined && { options: optionsFromText(f.optionsText) }),
      ...(f.correctOptionId !== undefined && { correctOptionId: f.correctOptionId }),
    });
    if (data.ok) { showMsg('ok', 'Riddle updated'); setEditRiddle(null); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function deleteRiddle(id: number) {
    if (!confirm('Delete this riddle?')) return;
    const data = await callApi(`/api/admin/content/riddles/${id}`, 'DELETE');
    if (data.ok) { showMsg('ok', 'Riddle deleted'); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function createRiddle() {
    const opts = optionsFromText(newRiddle.optionsText);
    const data = await callApi('/api/admin/content/riddles', 'POST', {
      position: parseInt(newRiddle.position, 10),
      text: newRiddle.text,
      options: opts,
      correctOptionId: newRiddle.correctOptionId,
    });
    if (data.ok) {
      showMsg('ok', 'Riddle created');
      setShowNewRiddle(false);
      setNewRiddle({ position: '', text: '', optionsText: '', correctOptionId: '' });
      await fetchAll();
    } else {
      showMsg('err', data.message || data.code);
    }
  }

  // Question actions
  async function saveQuestion(id: number) {
    const f = editForms[`q:${id}`] || {};
    const body: any = {};
    if (f.stem !== undefined) body.stem = f.stem;
    if (f.qrId !== undefined) body.qrId = parseInt(f.qrId, 10);
    if (f.optionsText !== undefined) body.options = optionsFromText(f.optionsText);
    if (f.correctOptionId !== undefined) body.correctOptionId = f.correctOptionId.trim().toLowerCase();
    const data = await callApi(`/api/admin/content/questions/${id}`, 'PUT', body);
    if (data.ok) { showMsg('ok', 'Question updated'); setEditQuestion(null); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function deleteQuestion(id: number) {
    if (!confirm('Delete this question?')) return;
    const data = await callApi(`/api/admin/content/questions/${id}`, 'DELETE');
    if (data.ok) { showMsg('ok', 'Question deleted'); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function createQuestion() {
    const opts = optionsFromText(newQuestion.optionsText);
    const data = await callApi('/api/admin/content/questions', 'POST', {
      run: parseInt(newQuestion.run, 10),
      slot: parseInt(newQuestion.slot, 10),
      variant: parseInt(newQuestion.variant, 10),
      qrId: parseInt(newQuestion.qrId, 10),
      stem: newQuestion.stem,
      options: opts,
      correctOptionId: newQuestion.correctOptionId.trim().toLowerCase(),
    });
    if (data.ok) {
      showMsg('ok', 'Question created');
      setShowNewQuestion(false);
      setNewQuestion({ run: '1', slot: '1', variant: '1', qrId: '', stem: '', optionsText: '', correctOptionId: '' });
      await fetchAll();
    } else {
      showMsg('err', data.message || data.code);
    }
  }

  // Teaser actions
  async function saveTeaser(id: number) {
    const f = editForms[`t:${id}`] || {};
    const body: any = {};
    if (f.piecesText !== undefined) body.pieces = f.piecesText.split('\n').map((s: string) => s.trim()).filter(Boolean);
    if (f.answerNorm !== undefined) body.answerNorm = f.answerNorm;
    const data = await callApi(`/api/admin/content/teasers/${id}`, 'PUT', body);
    if (data.ok) { showMsg('ok', 'Teaser updated'); setEditTeaser(null); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function deleteTeaser(id: number) {
    if (!confirm('Delete this teaser?')) return;
    const data = await callApi(`/api/admin/content/teasers/${id}`, 'DELETE');
    if (data.ok) { showMsg('ok', 'Teaser deleted'); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function createTeaser() {
    const pieces = newTeaser.piecesText.split('\n').map((s) => s.trim()).filter(Boolean);
    const data = await callApi('/api/admin/content/teasers', 'POST', {
      run: parseInt(newTeaser.run, 10),
      size: parseInt(newTeaser.size, 10),
      pieces,
      answerNorm: newTeaser.answerNorm,
    });
    if (data.ok) {
      showMsg('ok', 'Teaser created');
      setShowNewTeaser(false);
      setNewTeaser({ run: '1', size: '3', piecesText: '', answerNorm: '' });
      await fetchAll();
    } else {
      showMsg('err', data.message || data.code);
    }
  }

  // QR actions
  async function saveQr(id: number) {
    const f = editForms[`qr:${id}`] || {};
    const data = await callApi(`/api/admin/content/qr/${id}`, 'PUT', {
      ...(f.name !== undefined && { name: f.name }),
      ...(f.capacity !== undefined && { capacity: parseInt(f.capacity, 10) }),
      ...(f.active !== undefined && { active: f.active }),
    });
    if (data.ok) { showMsg('ok', 'QR updated'); setEditQr(null); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function deleteQr(id: number) {
    if (!confirm('Delete this QR location?')) return;
    const data = await callApi(`/api/admin/content/qr/${id}`, 'DELETE');
    if (data.ok) { showMsg('ok', 'QR deleted'); await fetchAll(); }
    else showMsg('err', data.message || data.code);
  }

  async function createQr() {
    const data = await callApi('/api/admin/content/qr', 'POST', {
      name: newQr.name.trim(),
      capacity: parseInt(newQr.capacity, 10) || 12,
    });
    if (data.ok) {
      showMsg('ok', 'QR location created');
      setShowNewQr(false);
      setNewQr({ name: '', capacity: '12' });
      await fetchAll();
    } else {
      showMsg('err', data.message || data.code);
    }
  }

  // R3 actions
  async function saveR3() {
    const data = await callApi('/api/admin/round3', 'PUT', {
      code: r3.code,
      hintText: r3.hintText,
      clueText: r3.hintText,
      passwordNorm: r3.code,
    });
    if (data.ok) showMsg('ok', 'Round 3 config saved');
    else showMsg('err', data.message || data.code);
  }

  const ef = (key: string, field: string, val: any) =>
    setEditForms((p) => ({ ...p, [key]: { ...(p[key] || {}), [field]: val } }));

  const inputClass = 'w-full px-2.5 py-1.5 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] uppercase font-bold text-slate-400 mb-1';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'riddles', label: 'Riddles' },
    { key: 'questions', label: 'Questions' },
    { key: 'teasers', label: 'Teasers' },
    { key: 'qr', label: 'QR Locations' },
    { key: 'round3', label: 'Round 3' },
  ];

  // Group questions by run/slot
  const questionsByRunSlot: Record<string, Question[]> = {};
  for (const q of questions) {
    const k = `R${q.run} Slot ${q.slot}`;
    if (!questionsByRunSlot[k]) questionsByRunSlot[k] = [];
    questionsByRunSlot[k].push(q);
  }

  return (
    <div className="w-full space-y-6">
      <div className="pb-5 border-b border-slate-800 flex items-center justify-between">
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent rounded border border-accent/30">
            Puzzles & Questions
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Content Management
          </h1>
        </div>
      </div>

      <ErrorBanner message={errorBannerMsg} onRetry={fetchAll} />

      {msg && (
        <div className={`mt-3 p-2.5 rounded text-xs border ${msg.type === 'ok' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300' : 'bg-red-950/60 border-red-800 text-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mt-4 border-b border-slate-700 pb-0 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-bold rounded-t border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-accent text-accent bg-slate-800/80' : 'border-transparent text-slate-400 hover:text-slate-200 bg-transparent'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-8 text-center text-xs text-slate-400">Loading content...</p>
      ) : (
        <div className="mt-4">
          {/* ─── RIDDLES ─── */}
          {tab === 'riddles' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setShowNewRiddle((s) => !s)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600">
                  {showNewRiddle ? '✕ Cancel' : '+ Add Riddle'}
                </button>
              </div>

              {showNewRiddle && (
                <div className="p-4 rounded-xl bg-slate-800/80 border border-accent/40">
                  <h3 className="text-xs font-bold text-accent uppercase mb-3">New Riddle</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Position</label>
                      <input className={inputClass} type="number" value={newRiddle.position} onChange={(e) => setNewRiddle((p) => ({ ...p, position: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelClass}>Correct Option ID</label>
                      <input className={inputClass} value={newRiddle.correctOptionId} onChange={(e) => setNewRiddle((p) => ({ ...p, correctOptionId: e.target.value }))} placeholder="e.g. a" />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Question Text</label>
                    <textarea className={`${inputClass} h-20 resize-none`} value={newRiddle.text} onChange={(e) => setNewRiddle((p) => ({ ...p, text: e.target.value }))} />
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Options (one per line: &quot;a: Option text&quot;)</label>
                    <textarea className={`${inputClass} h-28 resize-none font-mono`} value={newRiddle.optionsText} onChange={(e) => setNewRiddle((p) => ({ ...p, optionsText: e.target.value }))} placeholder={'a: First option\nb: Second option\nc: Third option'} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createRiddle} className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Create Riddle</button>
                    <button onClick={() => setShowNewRiddle(false)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                  </div>
                </div>
              )}

              {riddles.map((r) => (
                <div key={r.id} className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold">#{r.position} · ID {r.id}</span>
                      {r.hasAttempts && <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase font-bold rounded bg-amber-500/20 text-amber-400">Options Locked</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {editRiddle !== r.id && (
                        <>
                          <button onClick={() => { setEditRiddle(r.id); setEditForms((p) => ({ ...p, [`r:${r.id}`]: { text: r.text, position: r.position, optionsText: optionsToText(r.options), correctOptionId: r.correctOptionId } })); }}
                            className="px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600">Edit</button>
                          {!r.hasAttempts && (
                            <button onClick={() => deleteRiddle(r.id)} className="px-2 py-1 text-[10px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800">Delete</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {editRiddle !== r.id ? (
                    <p className="text-xs text-slate-300">{r.text}</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelClass}>Position</label>
                          <input className={inputClass} type="number" value={editForms[`r:${r.id}`]?.position ?? r.position}
                            onChange={(e) => ef(`r:${r.id}`, 'position', e.target.value)} />
                        </div>
                        <div>
                          <label className={labelClass}>Correct Option ID{r.hasAttempts && ' (locked)'}</label>
                          <input className={inputClass} value={editForms[`r:${r.id}`]?.correctOptionId ?? r.correctOptionId}
                            onChange={(e) => ef(`r:${r.id}`, 'correctOptionId', e.target.value)}
                            disabled={r.hasAttempts} />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Question Text</label>
                        <textarea className={`${inputClass} h-20 resize-none`} value={editForms[`r:${r.id}`]?.text ?? r.text}
                          onChange={(e) => ef(`r:${r.id}`, 'text', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Options (one per line){r.hasAttempts && ' (locked)'}</label>
                        <textarea className={`${inputClass} h-28 resize-none font-mono`}
                          value={editForms[`r:${r.id}`]?.optionsText ?? optionsToText(r.options)}
                          onChange={(e) => ef(`r:${r.id}`, 'optionsText', e.target.value)}
                          disabled={r.hasAttempts} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveRiddle(r.id)} className="px-3 py-1 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Save</button>
                        <button onClick={() => setEditRiddle(null)} className="px-3 py-1 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {riddles.length === 0 && !showNewRiddle && (
                <p className="text-center text-xs text-slate-400 py-8">No riddles yet.</p>
              )}
            </div>
          )}

          {/* ─── QUESTIONS ─── */}
          {tab === 'questions' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button onClick={() => setShowNewQuestion((s) => !s)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600">
                  {showNewQuestion ? '✕ Cancel' : '+ Add Question'}
                </button>
              </div>

              {showNewQuestion && (
                <div className="p-4 rounded-xl bg-slate-800/80 border border-accent/40">
                  <h3 className="text-xs font-bold text-accent uppercase mb-3">New Question</h3>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div>
                      <label className={labelClass}>Run</label>
                      <select className={inputClass} value={newQuestion.run} onChange={(e) => setNewQuestion((p) => ({ ...p, run: e.target.value }))}>
                        <option value="1">Run 1</option>
                        <option value="2">Run 2</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Slot (1–10)</label>
                      <input className={inputClass} type="number" min="1" max="10" value={newQuestion.slot} onChange={(e) => setNewQuestion((p) => ({ ...p, slot: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelClass}>Variant</label>
                      <input className={inputClass} type="number" min="1" value={newQuestion.variant} onChange={(e) => setNewQuestion((p) => ({ ...p, variant: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelClass}>QR Location</label>
                      <select className={inputClass} value={newQuestion.qrId} onChange={(e) => setNewQuestion((p) => ({ ...p, qrId: e.target.value }))}>
                        <option value="">Select QR</option>
                        {qrs.map((qr) => <option key={qr.id} value={qr.id}>{qr.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Stem (Question Text)</label>
                    <textarea className={`${inputClass} h-20 resize-none`} value={newQuestion.stem} onChange={(e) => setNewQuestion((p) => ({ ...p, stem: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Options (one per line: &quot;a: Option text&quot;)</label>
                      <textarea className={`${inputClass} h-28 resize-none font-mono`} value={newQuestion.optionsText} onChange={(e) => setNewQuestion((p) => ({ ...p, optionsText: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelClass}>Correct Option ID</label>
                      <input className={inputClass} value={newQuestion.correctOptionId} onChange={(e) => setNewQuestion((p) => ({ ...p, correctOptionId: e.target.value }))} placeholder="e.g. a" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createQuestion} className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Create Question</button>
                    <button onClick={() => setShowNewQuestion(false)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                  </div>
                </div>
              )}

              {Object.entries(questionsByRunSlot).map(([group, qs]) => (
                <div key={group} className="space-y-2">
                  <h3 className="text-xs font-bold uppercase text-slate-400 border-b border-slate-700 pb-1">{group}</h3>
                  {qs.map((q) => (
                    <div key={q.id} className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold">
                            R{q.run} Slot {q.slot} · Var {q.variant} · QR: {q.qrName}
                          </span>
                          {q.hasAttempts && <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase font-bold rounded bg-amber-500/20 text-amber-400">Options Locked</span>}
                        </div>
                        <div className="flex gap-1.5">
                          {editQuestion !== q.id && (
                            <>
                              <button onClick={() => { setEditQuestion(q.id); setEditForms((p) => ({ ...p, [`q:${q.id}`]: { stem: q.stem, qrId: q.qrId, optionsText: optionsToText(q.options), correctOptionId: q.correctOptionId } })); }}
                                className="px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600">Edit</button>
                              {!q.hasAttempts && (
                                <button onClick={() => deleteQuestion(q.id)} className="px-2 py-1 text-[10px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800">Delete</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {editQuestion !== q.id ? (
                        <p className="text-xs text-slate-300">{q.stem}</p>
                      ) : (
                        <div className="space-y-2">
                          <div>
                            <label className={labelClass}>Stem Text</label>
                            <textarea className={`${inputClass} h-20 resize-none`} value={editForms[`q:${q.id}`]?.stem ?? q.stem}
                              onChange={(e) => ef(`q:${q.id}`, 'stem', e.target.value)} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={labelClass}>QR Location</label>
                              <select className={inputClass} value={editForms[`q:${q.id}`]?.qrId ?? q.qrId}
                                onChange={(e) => ef(`q:${q.id}`, 'qrId', e.target.value)}>
                                {qrs.map((qr) => <option key={qr.id} value={qr.id}>{qr.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className={labelClass}>Correct Option ID{q.hasAttempts && ' (locked)'}</label>
                              <input className={inputClass} value={editForms[`q:${q.id}`]?.correctOptionId ?? q.correctOptionId}
                                onChange={(e) => ef(`q:${q.id}`, 'correctOptionId', e.target.value)}
                                disabled={q.hasAttempts} />
                            </div>
                          </div>
                          <div>
                            <label className={labelClass}>Options (one per line){q.hasAttempts && ' (locked)'}</label>
                            <textarea className={`${inputClass} h-28 resize-none font-mono`}
                              value={editForms[`q:${q.id}`]?.optionsText ?? optionsToText(q.options)}
                              onChange={(e) => ef(`q:${q.id}`, 'optionsText', e.target.value)}
                              disabled={q.hasAttempts} />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => saveQuestion(q.id)} className="px-3 py-1 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Save</button>
                            <button onClick={() => setEditQuestion(null)} className="px-3 py-1 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {questions.length === 0 && !showNewQuestion && (
                <p className="text-center text-xs text-slate-400 py-8">No questions yet.</p>
              )}
            </div>
          )}

          {/* ─── TEASERS ─── */}
          {tab === 'teasers' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setShowNewTeaser((s) => !s)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600">
                  {showNewTeaser ? '✕ Cancel' : '+ Add Teaser'}
                </button>
              </div>

              {showNewTeaser && (
                <div className="p-4 rounded-xl bg-slate-800/80 border border-accent/40">
                  <h3 className="text-xs font-bold text-accent uppercase mb-3">New Teaser Puzzle</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Run</label>
                      <select className={inputClass} value={newTeaser.run} onChange={(e) => setNewTeaser((p) => ({ ...p, run: e.target.value }))}>
                        <option value="1">Run 1</option>
                        <option value="2">Run 2</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Team Size (3–5)</label>
                      <input className={inputClass} type="number" min="3" max="5" value={newTeaser.size} onChange={(e) => setNewTeaser((p) => ({ ...p, size: e.target.value }))} />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Answer (will be normalized)</label>
                    <input className={inputClass} value={newTeaser.answerNorm} onChange={(e) => setNewTeaser((p) => ({ ...p, answerNorm: e.target.value }))} placeholder="e.g. library" />
                  </div>
                  <div className="mb-3">
                    <label className={labelClass}>Pieces (one per line, exactly N pieces)</label>
                    <textarea className={`${inputClass} h-24 resize-none`} value={newTeaser.piecesText} onChange={(e) => setNewTeaser((p) => ({ ...p, piecesText: e.target.value }))} placeholder="Piece 1 text&#10;Piece 2 text&#10;Piece 3 text" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createTeaser} className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Create Teaser</button>
                    <button onClick={() => setShowNewTeaser(false)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                  </div>
                </div>
              )}

              {teasers.map((t) => (
                <div key={t.id} className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Run {t.run} · Team Size {t.size} · ID {t.id}</span>
                    <div className="flex gap-1.5">
                      {editTeaser !== t.id && (
                        <>
                          <button onClick={() => { setEditTeaser(t.id); setEditForms((p) => ({ ...p, [`t:${t.id}`]: { piecesText: t.pieces.join('\n'), answerNorm: t.answerNorm } })); }}
                            className="px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600">Edit</button>
                          <button onClick={() => deleteTeaser(t.id)} className="px-2 py-1 text-[10px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800">Delete</button>
                        </>
                      )}
                    </div>
                  </div>

                  {editTeaser !== t.id ? (
                    <div>
                      <p className="text-xs text-accent font-semibold mb-1">Answer: &quot;{t.answerNorm}&quot;</p>
                      <div className="space-y-1">
                        {t.pieces.map((piece, i) => (
                          <div key={i} className="text-xs text-slate-300 bg-slate-900/60 px-2.5 py-1 rounded">
                            <span className="text-[10px] text-slate-500 mr-2">P{i + 1}:</span>
                            {piece}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <label className={labelClass}>Answer (normalized)</label>
                        <input className={inputClass} value={editForms[`t:${t.id}`]?.answerNorm ?? t.answerNorm}
                          onChange={(e) => ef(`t:${t.id}`, 'answerNorm', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Pieces (one per line, exactly {t.size} pieces)</label>
                        <textarea className={`${inputClass} h-24 resize-none`}
                          value={editForms[`t:${t.id}`]?.piecesText ?? t.pieces.join('\n')}
                          onChange={(e) => ef(`t:${t.id}`, 'piecesText', e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveTeaser(t.id)} className="px-3 py-1 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Save</button>
                        <button onClick={() => setEditTeaser(null)} className="px-3 py-1 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {teasers.length === 0 && !showNewTeaser && (
                <p className="text-center text-xs text-slate-400 py-8">No teasers yet.</p>
              )}
            </div>
          )}

          {/* ─── QR LOCATIONS ─── */}
          {tab === 'qr' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setShowNewQr((s) => !s)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600">
                  {showNewQr ? '✕ Cancel' : '+ Add QR Location'}
                </button>
              </div>

              {showNewQr && (
                <div className="p-4 rounded-xl bg-slate-800/80 border border-accent/40">
                  <h3 className="text-xs font-bold text-accent uppercase mb-3">New QR Location</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Name</label>
                      <input className={inputClass} value={newQr.name} onChange={(e) => setNewQr((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Science Library East" />
                    </div>
                    <div>
                      <label className={labelClass}>Capacity</label>
                      <input className={inputClass} type="number" min="1" value={newQr.capacity} onChange={(e) => setNewQr((p) => ({ ...p, capacity: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createQr} className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Create QR Location</button>
                    <button onClick={() => setShowNewQr(false)} className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                  </div>
                </div>
              )}

              {qrs.map((qr) => (
                <div key={qr.id} className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="text-xs font-bold text-slate-200">{qr.name}</span>
                      <span className="ml-2 text-[10px] text-slate-400">ID #{qr.id} · Cap: {qr.capacity}</span>
                      <span className={`ml-2 px-1.5 py-0.5 text-[9px] uppercase font-bold rounded ${qr.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                        {qr.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {editQr !== qr.id && (
                        <>
                          <button onClick={() => { setEditQr(qr.id); setEditForms((p) => ({ ...p, [`qr:${qr.id}`]: { name: qr.name, capacity: qr.capacity, active: qr.active } })); }}
                            className="px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600">Edit</button>
                          <button onClick={() => deleteQr(qr.id)} className="px-2 py-1 text-[10px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800">Delete</button>
                        </>
                      )}
                    </div>
                  </div>

                  {editQr !== qr.id ? (
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <p>Token: <span className="font-mono text-slate-300">{qr.token}</span></p>
                      {qr.scanUrl && <p>URL: <span className="font-mono text-slate-300">{qr.scanUrl}</span></p>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelClass}>Name</label>
                          <input className={inputClass} value={editForms[`qr:${qr.id}`]?.name ?? qr.name}
                            onChange={(e) => ef(`qr:${qr.id}`, 'name', e.target.value)} />
                        </div>
                        <div>
                          <label className={labelClass}>Capacity</label>
                          <input className={inputClass} type="number" min="1" value={editForms[`qr:${qr.id}`]?.capacity ?? qr.capacity}
                            onChange={(e) => ef(`qr:${qr.id}`, 'capacity', e.target.value)} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={editForms[`qr:${qr.id}`]?.active ?? qr.active}
                            onChange={(e) => ef(`qr:${qr.id}`, 'active', e.target.checked)} />
                          Active
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveQr(qr.id)} className="px-3 py-1 text-xs font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white">Save</button>
                        <button onClick={() => setEditQr(null)} className="px-3 py-1 text-xs font-bold rounded bg-slate-700 text-slate-300">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {qrs.length === 0 && !showNewQr && (
                <p className="text-center text-xs text-slate-400 py-8">No QR locations yet.</p>
              )}
            </div>
          )}

          {/* ─── ROUND 3 ─── */}
          {tab === 'round3' && (
            <div className="p-5 rounded-xl bg-slate-800/80 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-200 uppercase">Round 3 Configuration</h2>
                <Link
                  href="/hq/round3"
                  className="px-3 py-1.5 text-xs font-bold rounded bg-accent/20 text-accent hover:bg-accent/30 border border-accent/40 transition-colors"
                >
                  Manage Live Round 3 & Zones →
                </Link>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>4-Character Master Code (1 digit followed by 3 letters)</label>
                  <input
                    className={`${inputClass} font-mono tracking-wider uppercase`}
                    value={r3.code}
                    maxLength={4}
                    onChange={(e) => setR3((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. 1DAI"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Format: 1 digit (1-9) + 3 letters (A-Z). Box 1 is the digit, Boxes 2-4 are the letters.</p>
                </div>
                <div>
                  <label className={labelClass}>Cipher Hint Text (shown to players on box screen)</label>
                  <textarea
                    className={`${inputClass} h-24 resize-none`}
                    value={r3.hintText}
                    onChange={(e) => setR3((p) => ({ ...p, hintText: e.target.value }))}
                    placeholder="Optional hint for decrypting the boxes"
                  />
                </div>
                <button onClick={saveR3} className="w-full py-2.5 text-xs font-bold rounded bg-accent hover:bg-amber-400 text-slate-950 transition-colors">
                  Save Round 3 Config
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
