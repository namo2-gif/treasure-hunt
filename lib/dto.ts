import { seededShuffle } from './shuffle';

export type ScreenType =
  | 'WAIT_R1'
  | 'R1'
  | 'R1_DONE'
  | 'R2_SPECTATOR'
  | 'R2_SCAN'
  | 'R2_TEASER'
  | 'R2_QUESTIONS'
  | 'R2_DONE'
  | 'R2_BREAK'
  | 'R3_FIND'
  | 'R3_BOXES'
  | 'R3_SPECTATOR'
  | 'ENDED';

export interface PlayerMeDTO {
  studentId: string;
  name: string;
  teamId: string;
  teamName: string;
  isCaptain: boolean;
  n: number;
}

export interface ClockDTO {
  serverNowMs: number;
  eventNowMs: number;
  paused: boolean;
}

export interface OptionDTO {
  id: string;
  text: string;
}

export interface RiddleDTO {
  id: number;
  position: number;
  text: string;
  options: OptionDTO[];
  status: 'open' | 'submitted';
  chosenOptionId?: string;
}

export interface TeaserPieceDTO {
  pieceNo: number;
  text: string;
}

export type QuestionStatus = 'open' | 'one_try_left' | 'correct' | 'locked' | 'voided';

export interface MemberQuestionDTO {
  questionNo: number;
  stem: string;
  locationName: string;
  status: QuestionStatus;
}

export interface CaptainBoardQuestionDTO {
  questionNo: number;
  options: OptionDTO[];
  status: QuestionStatus;
}

export interface R3BoxDTO {
  box: number;
  riddle: string;
  kind: 'digit' | 'letter';
  status: 'open' | 'one_try_left' | 'solved' | 'locked';
}

export interface R3EndedResultDTO {
  reason: 'code' | 'progress' | 'admin' | 'none';
  winnerTeamName?: string;
  youWon: boolean;
  teamId?: string; // winning team ID, sent ONLY to the winning team
  milestones?: number; // sent only when reason = 'progress'
}

export interface StateDTO {
  clock: ClockDTO;
  me: PlayerMeDTO;
  screen: ScreenType;
  deadlineEventMs?: number;
  submittedCount?: number;
  total?: number;
  // Screen-specific payloads
  riddles?: RiddleDTO[];
  canSubmit?: boolean;
  run?: number;
  message?: string;
  piecesHeld?: TeaserPieceDTO[];
  registered?: number;
  canAnswer?: boolean;
  mine?: MemberQuestionDTO[];
  board?: CaptainBoardQuestionDTO[];
  // Round 3
  findRiddle?: string;
  hint?: string;
  boxes?: R3BoxDTO[];
  result?: R3EndedResultDTO;
}


/**
 * Mapper for player profile
 */
export function mapPlayerMe(
  student: { id: string; name: string; is_captain: boolean },
  team: { id: string; name: string; n: number }
): PlayerMeDTO {
  return {
    studentId: student.id,
    name: student.name,
    teamId: team.id,
    teamName: team.name,
    isCaptain: student.is_captain,
    n: team.n,
  };
}

/**
 * Safe mapper for Riddles (options shuffled deterministically, correct_option_id stripped, blind status)
 */
export function mapRiddleDTO(
  riddle: { id: number; position: number; text: string; options: OptionDTO[] },
  teamId: string,
  attempt?: { try_no?: number; option_id?: string; correct?: boolean } | null
): RiddleDTO {
  const seed = `${teamId}:r1:${riddle.id}`;
  const shuffledOptions = seededShuffle(riddle.options, seed);
  const isSubmitted = !!attempt;

  return {
    id: riddle.id,
    position: riddle.position,
    text: riddle.text,
    options: shuffledOptions,
    status: isSubmitted ? 'submitted' : 'open',
    chosenOptionId: attempt?.option_id ?? undefined,
  };
}

/**
 * Status of a Round 2 question from its attempts (no points, no answers).
 */
export function questionStatus(
  voided: boolean,
  attempts: Array<{ try_no: number; correct: boolean }>,
  maxTries: number
): QuestionStatus {
  if (voided) return 'voided';
  if (attempts.some((a) => a.correct)) return 'correct';
  if (attempts.length >= maxTries) return 'locked';
  if (attempts.length === maxTries - 1 && attempts.length > 0) return 'one_try_left';
  return 'open';
}

/**
 * Safe mapper for the captain board (NO stems, only options shuffled deterministically and status)
 */
export function mapCaptainBoardQuestionDTO(
  question: { question_no: number; id: number; options: OptionDTO[]; voided: boolean },
  teamId: string,
  attempts: Array<{ try_no: number; correct: boolean }>,
  maxTries: number
): CaptainBoardQuestionDTO {
  const seed = `${teamId}:r2:${question.id}`;
  return {
    questionNo: question.question_no,
    options: seededShuffle(question.options, seed),
    status: questionStatus(question.voided, attempts, maxTries),
  };
}

export interface QrBoardLocationDTO {
  number: number;
  name: string;
  count: number;
  capacity: number;
}

export interface QrBoardDTO {
  ok: true;
  run: number;
  locations: QrBoardLocationDTO[];
}

/**
 * Safe mapper for Round 2 QR locations board.
 * Strips tokens, IDs, and internal identifiers. Caps count at capacity.
 */
export function mapQrBoardDTO(
  run: number,
  qrs: Array<{ id: number; name: string; capacity: number; active?: boolean }>,
  countsByQrId: Record<number, number>
): QrBoardDTO {
  const activeQrs = qrs.filter((q) => q.active !== false);
  const locations: QrBoardLocationDTO[] = activeQrs.map((qr, index) => {
    const rawCount = countsByQrId[qr.id] ?? 0;
    const count = Math.min(Math.max(0, rawCount), qr.capacity);
    return {
      number: index + 1,
      name: qr.name,
      count,
      capacity: qr.capacity,
    };
  });

  return {
    ok: true,
    run,
    locations,
  };
}



