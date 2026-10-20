import {
  mapCaptainBoardQuestionDTO,
  mapPlayerMe,
  mapRiddleDTO,
  questionStatus,
  type CaptainBoardQuestionDTO,
  type MemberQuestionDTO,
  type ScreenType,
  type StateDTO,
} from './dto';

// Raw shape returned by the Postgres function player_state(). It never contains
// correct answers, points, other teams' data or Round 3 content.
export interface RawPlayerState {
  ok: boolean;
  code?: string;
  serverNowMs: number;
  eventNowMs: number;
  paused: boolean;
  phase: 'setup' | 'r1_running' | 'r1_closed' | 'r2_running' | 'r2_break' | 'r3_open' | 'ended';
  r1DeadlineMs?: number | null;
  breakEndMs?: number | null;
  r3EndMs?: number | null;
  triesR1?: number;
  triesR2: number;
  student: { id: string; name: string; isCaptain: boolean };
  team: { id: string; name: string; n: number; qualified: boolean; withdrawn: boolean; r3Eligible: boolean };
  run: { run: number; deadlineMs: number; finished: boolean; expired: boolean; teaserDone: boolean } | null;
  registeredByMe: boolean;
  piecesAssigned: number;
  piecesHeld: Array<{ pieceNo: number; text: string | null }>;
  mine: Array<{
    questionNo: number;
    stem: string;
    locationName: string;
    voided: boolean;
    attempts: Array<{ try_no: number; correct: boolean }>;
  }>;
  board: Array<{
    question_no: number;
    id: number;
    options: Array<{ id: string; text: string }>;
    voided: boolean;
    attempts: Array<{ try_no: number; correct: boolean }>;
  }>;
  riddles?: Array<{
    id: number;
    position: number;
    text: string;
    options: Array<{ id: string; text: string }>;
    attempts: Array<{ try_no: number; correct: boolean }>;
  }>;
  r3?: {
    hasScanned: boolean;
    findRiddle?: string | null;
    hint?: string | null;
    boxes?: Array<{
      box: number;
      riddle: string;
      kind: 'digit' | 'letter';
      status: 'open' | 'one_try_left' | 'solved' | 'locked';
    }>;
    result?: {
      reason: 'code' | 'progress' | 'admin' | 'none';
      winnerTeamId?: string | null;
      winnerTeamName?: string | null;
      milestones?: number | null;
    } | null;
  };
}

/**
 * Turns the raw database snapshot into the player-facing State of Section 8.1 / Section 15.6.
 */
export function buildState(raw: RawPlayerState): StateDTO {
  const me = mapPlayerMe(
    { id: raw.student.id, name: raw.student.name, is_captain: raw.student.isCaptain },
    { id: raw.team.id, name: raw.team.name, n: raw.team.n }
  );
  const clock = { serverNowMs: raw.serverNowMs, eventNowMs: raw.eventNowMs, paused: raw.paused };
  const base = { clock, me };
  const inR2 = raw.team.qualified && !raw.team.withdrawn;

  let screen: ScreenType;
  switch (raw.phase) {
    case 'setup':
      return { ...base, screen: 'WAIT_R1' };
    case 'r1_running': {
      const riddles = (raw.riddles || []).map((r) => {
        const lastAtt = r.attempts && r.attempts.length > 0 ? r.attempts[r.attempts.length - 1] : null;
        return mapRiddleDTO(
          {
            id: r.id,
            position: r.position,
            text: r.text,
            options: (r.options || []).map((o) => ({ id: o.id, text: o.text })),
          },
          raw.team.id,
          lastAtt
        );
      });
      return {
        ...base,
        screen: 'R1',
        deadlineEventMs: raw.r1DeadlineMs ?? undefined,
        canSubmit: me.isCaptain,
        riddles,
      };
    }
    case 'r1_closed':
      return { ...base, screen: 'R1_DONE' };
    case 'r2_break':
      return {
        ...base,
        screen: inR2 ? 'R2_BREAK' : 'R2_SPECTATOR',
        deadlineEventMs: raw.breakEndMs ?? undefined,
        message: inR2 ? undefined : 'Round 2 is for qualified teams. You can watch the fun.',
      };
    case 'r3_open': {
      if (!raw.team.r3Eligible || raw.team.withdrawn) {
        return {
          ...base,
          screen: 'R3_SPECTATOR',
          deadlineEventMs: raw.r3EndMs ?? undefined,
          message: 'You are not among the top 5 teams. Watch the hunt.',
        };
      }

      if (!raw.r3?.hasScanned) {
        return {
          ...base,
          screen: 'R3_FIND',
          deadlineEventMs: raw.r3EndMs ?? undefined,
          findRiddle: raw.r3?.findRiddle ?? undefined,
          canSubmit: me.isCaptain,
        };
      }

      return {
        ...base,
        screen: 'R3_BOXES',
        deadlineEventMs: raw.r3EndMs ?? undefined,
        hint: raw.r3?.hint ?? '',
        canSubmit: me.isCaptain,
        boxes: raw.r3?.boxes ?? [],
      };
    }
    case 'ended': {
      const r3Res = raw.r3?.result;
      if (!r3Res || !r3Res.reason) {
        return { ...base, screen: 'ENDED' };
      }

      const youWon = r3Res.winnerTeamId === raw.team.id;
      return {
        ...base,
        screen: 'ENDED',
        result: {
          reason: r3Res.reason,
          winnerTeamName: r3Res.winnerTeamName ?? undefined,
          youWon,
          teamId: youWon ? (r3Res.winnerTeamId ?? undefined) : undefined,
          milestones: r3Res.reason === 'progress' && r3Res.milestones != null ? r3Res.milestones : undefined,
        },
      };
    }
    case 'r2_running':
      break;
  }

  if (!inR2) {
    return { ...base, screen: 'R2_SPECTATOR', message: 'Round 2 is for qualified teams. You can watch the fun.' };
  }
  const run = raw.run;
  if (!run || run.finished || run.expired) {
    return { ...base, screen: 'R2_DONE', message: 'Your run is over. Wait for the next step.' };
  }

  const common = { ...base, run: run.run, deadlineEventMs: run.deadlineMs };

  if (!run.teaserDone && !raw.registeredByMe) {
    return {
      ...common,
      screen: 'R2_SCAN',
      message: run.run === 2 ? 'Run 2 is open. Scan any QR.' : undefined,
    };
  }

  if (!run.teaserDone) {
    return {
      ...common,
      screen: 'R2_TEASER',
      piecesHeld: raw.piecesHeld.map((p) => ({ pieceNo: p.pieceNo, text: p.text ?? '' })),
      registered: raw.piecesAssigned,
      total: raw.team.n,
      canAnswer: me.isCaptain && raw.piecesAssigned >= raw.team.n,
    };
  }

  const mine: MemberQuestionDTO[] = raw.mine.map((q) => ({
    questionNo: q.questionNo,
    stem: q.stem,
    locationName: q.locationName,
    status: questionStatus(q.voided, q.attempts, raw.triesR2),
  }));
  const board: CaptainBoardQuestionDTO[] | undefined = me.isCaptain
    ? raw.board.map((q) => mapCaptainBoardQuestionDTO(q, raw.team.id, q.attempts, raw.triesR2))
    : undefined;

  return { ...common, screen: 'R2_QUESTIONS', mine, board };
}
