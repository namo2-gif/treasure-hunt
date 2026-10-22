'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaptainBoardQuestionDTO, MemberQuestionDTO, RiddleDTO, StateDTO } from '@/lib/dto';
import { ANSWER_FEEDBACK, getErrorMessage } from '@/lib/messages';
import QrBoard from '@/components/QrBoard';

type Api = { ok: boolean; code?: string; message?: string; status?: string; [k: string]: unknown };

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function pollMs(screen: string): number {
  const jitter = (base: number) => base + (Math.random() * 2000 - 1000);
  switch (screen) {
    case 'R1':
    case 'R2_QUESTIONS':
      return 15000;
    case 'R3_FIND':
    case 'R3_BOXES':
      return jitter(5000);
    case 'R3_SPECTATOR':
      return 10000;
    case 'R2_SPECTATOR':
    case 'ENDED':
      return 30000;
    default:
      return jitter(5000);
  }
}

export default function Game() {
  const router = useRouter();
  const [state, setState] = useState<StateDTO | null>(null);
  const [offline, setOffline] = useState(false);
  const [, setTick] = useState(0);
  const received = useRef({ eventNowMs: 0, at: 0, paused: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) throw new Error('server');
      const data = (await res.json()) as StateDTO;
      received.current = { eventNowMs: data.clock.eventNowMs, at: Date.now(), paused: data.clock.paused };
      setState(data);
      setOffline(false);
      timer.current = setTimeout(load, pollMs(data.screen));
    } catch {
      setOffline(true);
      timer.current = setTimeout(load, 3000);
    }
  }, [router]);

  useEffect(() => {
    load();
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    load();
  }, [load]);

  /** POST with a stable requestId. A network failure retries with the SAME id (idempotent on the server). */
  const post = useCallback(async (url: string, key: string, body: Record<string, unknown>): Promise<Api | null> => {
    let id = pending.current.get(key);
    if (!id) {
      id = uuid();
      pending.current.set(key, id);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, requestId: id }),
        });
        if (res.status === 401) {
          router.replace('/login');
          return null;
        }
        if (res.status < 500) {
          pending.current.delete(key);
          setOffline(false);
          return (await res.json()) as Api;
        }
      } catch {
        /* network failure: retry below */
      }
      setOffline(true);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    return null;
  }, [router]);

  if (!state) {
    return <p className="text-center text-slate-400 mt-24 text-sm">{offline ? 'Retrying...' : 'Loading...'}</p>;
  }

  const r = received.current;
  const nowEvent = r.eventNowMs + (r.paused ? 0 : Date.now() - r.at);
  const remainingS = state.deadlineEventMs !== undefined ? Math.max(0, Math.floor((state.deadlineEventMs - nowEvent) / 1000)) : null;
  const mmss = remainingS === null ? '' : `${Math.floor(remainingS / 60)}:${String(remainingS % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col flex-1 w-full gap-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Team {state.me.teamId}</div>
          <div className="text-lg font-bold text-slate-100">{state.me.teamName}</div>
        </div>
        <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${state.me.isCaptain ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-300'}`}>
          {state.me.isCaptain ? 'Captain' : 'Agent'}
        </span>
      </div>

      {state.clock.paused && <Banner tone="warn">{getErrorMessage('PAUSED')}</Banner>}
      {offline && <Banner tone="warn">Retrying...</Banner>}
      {remainingS !== null && (
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-slate-400">Time left</div>
          <div className="text-4xl font-extrabold text-accent tabular-nums">{mmss}</div>
        </div>
      )}

      <Screen state={state} remainingS={remainingS} post={post} refresh={refresh} />
      {['R2_SCAN', 'R2_TEASER', 'R2_QUESTIONS', 'R2_DONE'].includes(state.screen) && <QrBoard />}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'ok'; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm text-center font-medium ${tone === 'warn' ? 'bg-amber-950/50 border border-amber-800 text-amber-300' : 'bg-emerald-950/50 border border-emerald-800 text-emerald-300'}`}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="p-4 rounded-xl bg-surface border border-slate-700/60">{children}</div>;
}

function Msg({ title, text }: { title: string; text?: string }) {
  return (
    <Card>
      <div className="text-center py-3">
        <div className="text-base font-bold text-slate-100">{title}</div>
        {text && <p className="text-sm text-slate-400 mt-1">{text}</p>}
      </div>
    </Card>
  );
}

type PostFn = (url: string, key: string, body: Record<string, unknown>) => Promise<Api | null>;

function Screen({
  state,
  remainingS,
  post,
  refresh,
}: {
  state: StateDTO;
  remainingS: number | null;
  post: PostFn;
  refresh: () => void;
}) {
  switch (state.screen) {
    case 'WAIT_R1':
      return <Msg title="Stand by" text="Round 1 has not started yet." />;
    case 'R1':
      return <Round1Screen state={state} post={post} refresh={refresh} />;
    case 'R1_DONE':
      return <Msg title="Round 1 is over" text="Results are being counted." />;
    case 'R2_SPECTATOR':
    case 'R3_SPECTATOR':
      return <Msg title={state.message ?? 'Watching'} />;
    case 'R2_DONE':
      return <Msg title="Run complete" text={state.message} />;
    case 'R2_BREAK': {
      const isZero = state.deadlineEventMs !== undefined && remainingS === 0;
      return (
        <Msg
          title="Break"
          text={isZero ? 'Break over. Waiting for the organisers.' : 'Break. The next round starts soon.'}
        />
      );
    }
    case 'R3_FIND':
      return <R3FindScreen state={state} />;
    case 'R3_BOXES':
      return <R3BoxesScreen state={state} post={post} refresh={refresh} />;
    case 'R3_SPECTATOR':
      return (
        <Msg
          title="Watching the Hunt"
          text="You are not among the top 5 teams. Watch the hunt."
        />
      );
    case 'ENDED':
      return <EndedScreen state={state} />;

    case 'R2_SCAN':
      return (
        <Card>
          <div className="text-center py-2">
            <div className="text-base font-bold text-slate-100">Run {state.run}: find a QR code</div>
            <p className="text-sm text-slate-400 mt-2">{state.message ?? 'Scan any QR code around campus with your phone camera.'}</p>
          </div>
        </Card>
      );
    case 'R2_TEASER':
      return <Teaser state={state} post={post} refresh={refresh} />;
    case 'R2_QUESTIONS':
      return <Questions state={state} post={post} refresh={refresh} />;
  }
}

function Teaser({ state, post, refresh }: { state: StateDTO; post: PostFn; refresh: () => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await post('/api/teaser', `teaser:${answer.trim().toLowerCase()}`, { answer });
    setBusy(false);
    if (!res) return;
    if (res.ok) refresh();
    else setMsg(res.code ? getErrorMessage(res.code) : 'Something went wrong.');
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="text-xs uppercase tracking-wider text-slate-400">Your piece{(state.piecesHeld?.length ?? 0) === 1 ? '' : 's'}</div>
        {state.piecesHeld?.map((p) => (
          <div key={p.pieceNo} className="mt-2 flex items-baseline gap-3">
            <span className="text-xs text-slate-400">#{p.pieceNo}</span>
            <span className="text-2xl font-extrabold text-accent break-words">{p.text}</span>
          </div>
        ))}
        <p className="text-sm text-slate-400 mt-3">
          Teammates registered: <span className="text-slate-100 font-semibold">{state.registered}/{state.total}</span>. Put the pieces together.
        </p>
      </Card>
      {state.me.isCaptain && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!state.canAnswer}
            placeholder={state.canAnswer ? 'Type the answer' : 'Waiting for every teammate to scan'}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-base text-slate-100 disabled:opacity-50"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button disabled={!state.canAnswer || busy || !answer.trim()} className="w-full py-3.5 rounded-xl bg-accent text-slate-950 font-bold disabled:opacity-40">
            {busy ? 'Checking...' : 'Submit answer'}
          </button>
          {msg && <p className="text-sm text-amber-300 text-center">{msg}</p>}
        </form>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  one_try_left: 'One try left',
  correct: 'Correct',
  locked: 'Locked',
  voided: 'Voided',
};

function Questions({ state, post, refresh }: { state: StateDTO; post: PostFn; refresh: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">Your questions</div>
      {state.mine?.length ? (
        state.mine.map((q: MemberQuestionDTO) => (
          <Card key={q.questionNo}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-accent">Question #{q.questionNo}</span>
              <span className="text-xs text-slate-400">{STATUS_LABEL[q.status]}</span>
            </div>
            <p className="text-base text-slate-100 mt-2">{q.stem}</p>
            <p className="text-xs text-slate-400 mt-2">Find the poster at <span className="text-slate-200 font-semibold">{q.locationName}</span>, then tell your captain the answer.</p>
          </Card>
        ))
      ) : (
        <Msg title="No questions for you" text={state.me.isCaptain ? undefined : 'Your captain handles the rest.'} />
      )}

      {state.board && (
        <>
          <div className="text-xs uppercase tracking-wider text-slate-400 mt-2">Captain board</div>
          {state.board.map((b) => (
            <BoardQuestion key={b.questionNo} q={b} post={post} refresh={refresh} />
          ))}
        </>
      )}
    </div>
  );
}

function BoardQuestion({ q, post, refresh }: { q: CaptainBoardQuestionDTO; post: PostFn; refresh: () => void }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const done = q.status === 'correct' || q.status === 'locked' || q.status === 'voided';

  async function submit() {
    if (!choice || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await post('/api/answer', `a:${q.questionNo}:${choice}`, { kind: 'r2', key: q.questionNo, optionId: choice });
    setBusy(false);
    if (!res) return;
    if (res.ok) {
      setMsg(ANSWER_FEEDBACK[String(res.status)] ?? null);
      setChoice(null);
      refresh();
    } else {
      setMsg(res.code ? getErrorMessage(res.code) : 'Something went wrong.');
      refresh();
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-accent">Question #{q.questionNo}</span>
        <span className="text-xs text-slate-400">{STATUS_LABEL[q.status]}</span>
      </div>
      {!done && (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {q.options.map((o) => (
              <label key={o.id} className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-base cursor-pointer ${choice === o.id ? 'border-accent bg-amber-500/10' : 'border-slate-700 bg-slate-900'}`}>
                <input type="radio" name={`q${q.questionNo}`} checked={choice === o.id} onChange={() => setChoice(o.id)} className="accent-amber-500" />
                <span>{o.text}</span>
              </label>
            ))}
          </div>
          <button onClick={submit} disabled={!choice || busy} className="mt-3 w-full py-3.5 rounded-xl bg-accent text-slate-950 font-bold disabled:opacity-40">
            {busy ? 'Submitting...' : 'Submit'}
          </button>
        </>
      )}
      {msg && <p className="text-sm text-amber-300 text-center mt-2">{msg}</p>}
    </Card>
  );
}

function Round1Screen({ state, post, refresh }: { state: StateDTO; post: PostFn; refresh: () => void }) {
  const riddles = state.riddles || [];
  const canSubmit = !!state.canSubmit;
  const total = riddles.length;
  const submittedCount = riddles.filter((r) => r.status === 'submitted').length;
  const allSubmitted = total > 0 && submittedCount === total;

  const [currentIndex, setCurrentIndex] = useState(() => {
    const firstOpen = riddles.findIndex((r) => r.status === 'open');
    return firstOpen !== -1 ? firstOpen : 0;
  });

  const [draftChoices, setDraftChoices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Record<number, string>>({});

  const safeIndex = total > 0 ? Math.min(Math.max(0, currentIndex), total - 1) : 0;
  const currentRiddle = riddles[safeIndex];

  if (total === 0 || !currentRiddle) {
    return (
      <Card>
        <div className="text-center py-6 text-slate-400 text-sm">
          No riddles available right now. Tell an organiser.
        </div>
      </Card>
    );
  }

  const isCurrentSubmitted = currentRiddle.status === 'submitted';
  const selectedChoice = isCurrentSubmitted
    ? currentRiddle.chosenOptionId || draftChoices[currentRiddle.id] || null
    : draftChoices[currentRiddle.id] || null;

  async function handleSubmit() {
    if (!selectedChoice || busy || !canSubmit || isCurrentSubmitted) return;
    setBusy(true);
    setFeedback((prev) => ({ ...prev, [currentRiddle.id]: '' }));

    const res = await post('/api/answer', `r1:${currentRiddle.id}:${selectedChoice}`, {
      kind: 'r1',
      key: currentRiddle.id,
      optionId: selectedChoice,
    });
    setBusy(false);

    if (!res) return;
    if (res.ok) {
      setFeedback((prev) => ({ ...prev, [currentRiddle.id]: 'Answer submitted' }));
      refresh();
    } else {
      setFeedback((prev) => ({
        ...prev,
        [currentRiddle.id]: res.code ? getErrorMessage(res.code) : 'Something went wrong.',
      }));
      refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Round 1</div>
          <h2 className="text-base font-bold text-slate-100">Campus Riddles</h2>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 font-medium">
            {submittedCount} / {total} answered
          </span>
          <div className="text-[11px] text-accent font-semibold">
            Riddle {safeIndex + 1} of {total}
          </div>
        </div>
      </div>

      {allSubmitted && (
        <div className="rounded-lg p-3 bg-slate-800 border border-slate-700 text-xs text-slate-200 text-center font-medium">
          All {total} answers submitted. Waiting for Round 1 to end.
        </div>
      )}

      {!canSubmit && (
        <div className="rounded-lg p-3 bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
          👀 You are viewing in read-only mode. Only your captain can submit answers for the team.
        </div>
      )}

      {/* Number Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar">
        {riddles.map((r, idx) => {
          const isCurr = idx === safeIndex;
          const isSub = r.status === 'submitted';
          return (
            <button
              key={r.id}
              onClick={() => setCurrentIndex(idx)}
              className={`min-w-[34px] h-8 px-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-all shrink-0 ${
                isCurr
                  ? 'border-2 border-accent text-accent bg-accent/15'
                  : isSub
                  ? 'bg-slate-700 text-slate-200 border border-slate-600'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
              }`}
              title={`Riddle ${idx + 1}${isSub ? ' (Answered)' : ''}`}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {/* Active Question Card */}
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-accent">
            Riddle #{currentRiddle.position} ({safeIndex + 1} / {total})
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
            {isCurrentSubmitted ? 'Submitted' : 'Open'}
          </span>
        </div>

        <p className="text-base text-slate-100 mt-3 whitespace-pre-line leading-relaxed">
          {currentRiddle.text}
        </p>

        {/* Options */}
        <div className="mt-4 flex flex-col gap-2">
          {currentRiddle.options.map((opt) => {
            const isSelected = selectedChoice === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm transition-colors ${
                  isCurrentSubmitted
                    ? isSelected
                      ? 'border-slate-600 bg-slate-800 text-slate-200 cursor-not-allowed'
                      : 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed'
                    : isSelected
                    ? 'border-accent bg-amber-500/10 text-slate-100 cursor-pointer'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 cursor-pointer'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name={`riddle-${currentRiddle.id}`}
                    disabled={isCurrentSubmitted || !canSubmit}
                    checked={isSelected}
                    onChange={() => {
                      if (!isCurrentSubmitted && canSubmit) {
                        setDraftChoices((prev) => ({ ...prev, [currentRiddle.id]: opt.id }));
                      }
                    }}
                    className="mt-0.5 accent-amber-500 disabled:opacity-40"
                  />
                  <span className="leading-snug">{opt.text}</span>
                </div>
                {isCurrentSubmitted && isSelected && (
                  <span className="text-[11px] font-medium text-slate-400 shrink-0">Your answer</span>
                )}
              </label>
            );
          })}
        </div>

        {/* Action / Feedback */}
        {!isCurrentSubmitted && canSubmit && (
          <button
            onClick={handleSubmit}
            disabled={!selectedChoice || busy}
            className="mt-4 w-full py-3 rounded-xl bg-accent text-slate-950 font-bold text-sm tracking-wide disabled:opacity-40 hover:bg-amber-400 transition-colors"
          >
            {busy ? 'Submitting...' : 'Submit Riddle'}
          </button>
        )}

        {(isCurrentSubmitted || feedback[currentRiddle.id]) && (
          <div className="mt-3 p-2.5 rounded text-center text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700">
            {feedback[currentRiddle.id] || 'Answer submitted'}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
          <button
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            disabled={safeIndex === 0}
            className="flex-1 py-2 px-3 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-slate-400 font-medium">
            {safeIndex + 1} / {total}
          </span>
          <button
            onClick={() => setCurrentIndex((prev) => Math.min(total - 1, prev + 1))}
            disabled={safeIndex >= total - 1}
            className="flex-1 py-2 px-3 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
          >
            Next
          </button>
        </div>
      </Card>
    </div>
  );
}

function R3FindScreen({ state }: { state: StateDTO }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Round 3</div>
          <h2 className="text-base font-bold text-slate-100">Location Hunt</h2>
        </div>
        <span className="px-2 py-0.5 text-xs font-bold uppercase rounded bg-accent/20 text-accent">
          Top 5 Race
        </span>
      </div>

      <Card>
        <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Start Clue</span>
        <div className="mt-2 p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-accent whitespace-pre-wrap leading-relaxed">
          {state.findRiddle || 'Finding your start location...'}
        </div>
        <div className="mt-3 text-xs text-slate-300 font-medium space-y-1">
          <p>Find the place this riddle points to. Your captain scans the QR there.</p>
          {!state.canSubmit && (
            <p className="text-slate-400 italic">👀 Waiting for your captain to arrive and scan the location QR.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function R3BoxesScreen({
  state,
  post,
  refresh,
}: {
  state: StateDTO;
  post: PostFn;
  refresh: () => void;
}) {
  const boxes = state.boxes || [];
  const canSubmit = !!state.canSubmit;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Round 3</div>
          <h2 className="text-base font-bold text-slate-100">The 4 Boxes</h2>
        </div>
        <span className="px-2 py-0.5 text-xs font-bold uppercase rounded bg-accent/20 text-accent">
          Milestones: {boxes.filter((b) => b.status === 'solved').length} / 4
        </span>
      </div>

      {state.hint && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
          <span className="font-bold">Hint: </span>
          <span>{state.hint}</span>
        </div>
      )}

      {!canSubmit && (
        <div className="rounded-lg p-3 bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
          👀 Team Members: Riddles are read-only so you can split up. Only your captain can type and submit answers.
        </div>
      )}

      {boxes.map((b) => (
        <R3BoxCard
          key={b.box}
          box={b}
          canSubmit={canSubmit}
          post={post}
          refresh={refresh}
        />
      ))}
    </div>
  );
}

function R3BoxCard({
  box,
  canSubmit,
  post,
  refresh,
}: {
  box: { box: number; riddle: string; kind: 'digit' | 'letter'; status: string };
  canSubmit: boolean;
  post: PostFn;
  refresh: () => void;
}) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const isSolved = box.status === 'solved';
  const isLocked = box.status === 'locked';
  const isDone = isSolved || isLocked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = val.trim().toUpperCase();
    if (!clean || busy || !canSubmit || isDone) return;

    if (box.kind === 'digit' && !/^[1-9]$/.test(clean)) {
      setMsg({ text: 'Box 1 takes one digit from 1 to 9.', ok: false });
      return;
    }
    if (box.kind === 'letter' && !/^[A-Z]$/.test(clean)) {
      setMsg({ text: `Box ${box.box} takes one letter.`, ok: false });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await post('/api/r3/answer', `r3:${box.box}:${clean}`, {
        box: box.box,
        value: clean,
      });
      if (!res) return;
      if (res.ok) {
        if (res.status === 'won') {
          setMsg({
            text: 'Code correct! The code is the room number. Decipher it and go find the treasure.',
            ok: true,
          });
        } else if (res.status === 'correct') {
          setMsg({ text: 'Correct.', ok: true });
        } else if (res.status === 'locked') {
          setMsg({ text: 'Wrong. This box is locked.', ok: false });
        } else if (res.status === 'wrong') {
          setMsg({ text: `Wrong. ${res.triesLeft ?? 1} try left.`, ok: false });
        }
        setVal('');
        refresh();
      } else {
        setMsg({ text: res.code ? getErrorMessage(res.code) : String(res.message || 'Error'), ok: false });
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-accent">Box #{box.box} ({box.kind === 'digit' ? '1 Digit' : '1 Letter'})</span>
        <span
          className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded ${
            isSolved
              ? 'bg-emerald-500/20 text-emerald-400'
              : isLocked
              ? 'bg-red-500/20 text-red-400'
              : box.status === 'one_try_left'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-slate-800 text-slate-300'
          }`}
        >
          {isSolved
            ? '✓ Solved'
            : isLocked
            ? '🔒 Locked'
            : box.status === 'one_try_left'
            ? '1 Try Left'
            : 'Open'}
        </span>
      </div>

      <p className="text-sm text-slate-200 mt-2 font-medium leading-relaxed">{box.riddle}</p>

      {!isDone && canSubmit && (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode={box.kind === 'digit' ? 'numeric' : 'text'}
              maxLength={1}
              value={val}
              disabled={busy}
              onChange={(e) => setVal(e.target.value.toUpperCase())}
              placeholder={box.kind === 'digit' ? '1-9' : 'A-Z'}
              className="w-16 text-center py-2 px-3 text-lg font-black uppercase rounded-lg bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!val.trim() || busy}
              className="flex-1 py-2.5 px-4 rounded-lg bg-accent text-slate-950 font-bold text-xs tracking-wide hover:bg-amber-400 disabled:opacity-40 transition-colors"
            >
              {busy ? 'Checking...' : `Submit Box ${box.box}`}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            {box.status === 'one_try_left' ? 'Warning: You have 1 try left on this box.' : 'You have 2 tries on this box.'}
          </p>
        </form>
      )}

      {msg && (
        <div
          className={`mt-2 p-2 rounded text-xs text-center font-semibold ${
            msg.ok ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800' : 'bg-red-950/60 text-red-300 border border-red-800'
          }`}
        >
          {msg.text}
        </div>
      )}
    </Card>
  );
}

function EndedScreen({ state }: { state: StateDTO }) {
  const res = state.result;

  if (!res) {
    return <Msg title="The hunt has ended" text="The event is over." />;
  }

  if (res.reason === 'code' && res.youWon) {
    return (
      <div className="p-6 rounded-2xl bg-gradient-to-b from-amber-500/20 to-slate-900 border-2 border-accent text-center shadow-xl flex flex-col items-center gap-3">
        <span className="px-3 py-1 text-xs font-black uppercase tracking-wider rounded-full bg-accent text-slate-950">
          🏆 TREASURE UNLOCKED 🏆
        </span>
        <div className="text-4xl sm:text-5xl font-black text-accent mt-2 font-mono tracking-wider">
          {res.teamId || state.me.teamId}
        </div>
        <div className="text-lg font-bold text-slate-100">{state.me.teamName}</div>
        <p className="text-sm font-semibold text-amber-200 mt-2">
          Code correct! The code is the room number. Decipher it and go find the treasure.
        </p>
        <div className="mt-4 p-3 rounded-lg bg-slate-950/90 border border-slate-800 text-xs text-slate-300">
          Show this screen to the organiser.
        </div>
      </div>
    );
  }

  if (res.reason === 'code' && !res.youWon) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl font-bold">
            🏁
          </div>
          <h2 className="text-lg font-bold text-slate-100">Hunt Completed</h2>
          <p className="text-sm text-slate-300 mt-2">
            <span className="font-bold text-accent">{res.winnerTeamName || 'Another team'}</span> cracked the code first. The hunt is over.
          </p>
        </div>
      </Card>
    );
  }

  if (res.reason === 'progress') {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl font-bold">
            ⏱️
          </div>
          <h2 className="text-lg font-bold text-slate-100">Time is up</h2>
          <p className="text-sm text-slate-300 mt-2">
            Time is up. <span className="font-bold text-accent">{res.winnerTeamName}</span> wins with the furthest progress ({res.milestones ?? 0} of 5 steps).
          </p>
        </div>
      </Card>
    );
  }

  if (res.reason === 'none') {
    return (
      <Card>
        <div className="text-center py-6">
          <h2 className="text-lg font-bold text-slate-100">Time is up</h2>
          <p className="text-sm text-slate-400 mt-2">Nobody reached the first location.</p>
        </div>
      </Card>
    );
  }

  return <Msg title="The hunt has ended" text="The event is over." />;
}



