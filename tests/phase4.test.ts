import { describe, it, expect } from 'vitest';
import { buildState, type RawPlayerState } from '../lib/state';
import { questionStatus } from '../lib/dto';

function raw(over: Partial<RawPlayerState> = {}): RawPlayerState {
  return {
    ok: true, serverNowMs: 1000, eventNowMs: 500, paused: false, phase: 'r2_running', triesR2: 2,
    student: { id: 'S011', name: 'Ann', isCaptain: true },
    team: { id: 'T01', name: 'Foxes', n: 3, qualified: true, withdrawn: false, r3Eligible: false },
    run: { run: 1, deadlineMs: 9000, finished: false, expired: false, teaserDone: false },
    registeredByMe: true, piecesAssigned: 3,
    piecesHeld: [{ pieceNo: 1, text: 'AB' }], mine: [], board: [],
    ...over,
  };
}
const opts = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];

describe('buildState screen selection (Section 8.1)', () => {
  it('maps phases without a Round 2 run', () => {
    expect(buildState(raw({ phase: 'setup' })).screen).toBe('WAIT_R1');
    expect(buildState(raw({ phase: 'r1_running' })).screen).toBe('R1');
    expect(buildState(raw({ phase: 'r1_closed' })).screen).toBe('R1_DONE');
    expect(buildState(raw({ phase: 'r2_break' })).screen).toBe('R2_BREAK');
    expect(buildState(raw({ phase: 'ended' })).screen).toBe('ENDED');
  });
  it('spectators and Round 3', () => {
    const notIn = raw({ team: { ...raw().team, qualified: false } });
    expect(buildState(notIn).screen).toBe('R2_SPECTATOR');
    expect(buildState({ ...notIn, phase: 'r2_break' }).screen).toBe('R2_SPECTATOR');
    expect(buildState(raw({ phase: 'r3_open' })).screen).toBe('R3_SPECTATOR');
    expect(buildState(raw({ phase: 'r3_open', team: { ...raw().team, r3Eligible: true } })).screen).toBe('R3_FIND');
  });
  it('R2_DONE when run finished, expired or missing', () => {
    expect(buildState(raw({ run: { ...raw().run!, finished: true } })).screen).toBe('R2_DONE');
    expect(buildState(raw({ run: { ...raw().run!, expired: true } })).screen).toBe('R2_DONE');
    expect(buildState(raw({ run: null })).screen).toBe('R2_DONE');
  });
  it('R2_SCAN until the student registers, with the Run 2 message', () => {
    expect(buildState(raw({ registeredByMe: false })).screen).toBe('R2_SCAN');
    const r2 = buildState(raw({ registeredByMe: false, run: { ...raw().run!, run: 2 } }));
    expect(r2.screen).toBe('R2_SCAN');
    expect(r2.message).toBe('Run 2 is open. Scan any QR.');
  });
  it('R2_TEASER: only the captain with all pieces registered can answer', () => {
    const cap = buildState(raw());
    expect(cap.screen).toBe('R2_TEASER');
    expect(cap.canAnswer).toBe(true);
    expect(buildState(raw({ piecesAssigned: 2 })).canAnswer).toBe(false);
    expect(buildState(raw({ student: { id: 'S012', name: 'Bo', isCaptain: false } })).canAnswer).toBe(false);
  });
  it('R2_QUESTIONS: captain gets a board of options without stems; members get none', () => {
    const run = { ...raw().run!, teaserDone: true };
    const mine = [{ questionNo: 1, stem: 'Where is the lion?', locationName: 'Library', voided: false, attempts: [] }];
    const board = [1, 2, 3].map((n) => ({ question_no: n, id: n, options: opts, voided: false, attempts: [] }));
    const cap = buildState(raw({ run, mine, board }));
    expect(cap.screen).toBe('R2_QUESTIONS');
    expect(cap.board).toHaveLength(3);
    expect(cap.mine?.[0].stem).toBe('Where is the lion?');
    expect(JSON.stringify(cap.board)).not.toContain('Where is the lion?');
    const member = buildState(raw({ run, mine, board: [], student: { id: 'S012', name: 'Bo', isCaptain: false } }));
    expect(member.board).toBeUndefined();
  });
  it('never serialises secrets', () => {
    const run = { ...raw().run!, teaserDone: true };
    const board = [{ question_no: 1, id: 1, options: opts, voided: false, attempts: [{ try_no: 1, correct: false }] }];
    const s = JSON.stringify(buildState(raw({ run, board })));
    for (const bad of ['correct_option_id', 'answer_norm', 'password', 'points', 'room']) expect(s).not.toContain(bad);
  });
  it('option order is stable per team and question, and differs between teams', () => {
    const run = { ...raw().run!, teaserDone: true };
    const board = [{ question_no: 1, id: 7, options: Array.from({ length: 8 }, (_, i) => ({ id: String.fromCharCode(97 + i), text: `o${i}` })), voided: false, attempts: [] }];
    const order = (team: string) => buildState(raw({ run, board, team: { ...raw().team, id: team } })).board![0].options.map((o) => o.id).join('');
    expect(order('T01')).toBe(order('T01'));
    expect(order('T01')).not.toBe(order('T02'));
  });
});

describe('questionStatus', () => {
  it('follows the number of tries allowed', () => {
    expect(questionStatus(false, [], 2)).toBe('open');
    expect(questionStatus(false, [{ try_no: 1, correct: false }], 2)).toBe('one_try_left');
    expect(questionStatus(false, [{ try_no: 1, correct: false }, { try_no: 2, correct: false }], 2)).toBe('locked');
    expect(questionStatus(false, [{ try_no: 1, correct: false }], 3)).toBe('open');
    expect(questionStatus(false, [{ try_no: 1, correct: false }, { try_no: 2, correct: true }], 3)).toBe('correct');
    expect(questionStatus(true, [], 2)).toBe('voided');
  });
});
