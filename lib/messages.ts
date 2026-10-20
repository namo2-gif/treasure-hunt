export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_LOGIN: 'Student ID or code is wrong.',
  THROTTLED: 'Too many tries. Wait {s} seconds.',
  WRONG_PHASE: 'That is not open right now.',
  PAUSED: 'The event is paused. Hang tight.',
  NOT_IN_ROUND: 'Your team is not in this round.',
  ABSENT: 'You are marked absent. Ask an organiser.',
  INVALID_QR: 'This QR code is not valid.',
  QR_INACTIVE: 'This location is closed. Find another location.',
  TEAMMATE_HERE: 'A teammate already registered here. Find another location.',
  QR_USED_BEFORE: 'You used this location before. Find another location.',
  QR_FULL: 'This location is full. Find another location.',
  ALREADY_REGISTERED: 'You are already registered for this run.',
  TEAM_COMPLETE: 'Your team is already complete.',
  NOT_CAPTAIN: 'Only your captain can submit.',
  TEASER_NOT_READY: 'Wait until every teammate has registered.',
  TEASER_WRONG: 'Not quite. Keep talking to your team.',
  ALREADY_DONE: 'Already answered.',
  LOCKED: 'This question is locked.',
  INVALID_OPTION: 'Choose one of the options.',
  NOT_ELIGIBLE: 'Your team is not in this round.',
  CONTENT_MISSING: 'Something is not set up. Tell an organiser.',
  UNAUTHORIZED: 'You must be logged in to access this.',
  DUPLICATE_REQUEST: 'Something went wrong. Reload and try again.',
  RPC_ERROR: 'Something is not set up. Tell an organiser.',
  SETTING_LOCKED: 'This setting is locked and cannot be edited.',
  // Round 3 Phase 10 codes
  WRONG_ZONE: "This is not your team's location. Check your riddle.",
  NOT_SCANNED: 'Scan your location QR first.',
  INVALID_FORMAT: 'Box 1 takes one digit from 1 to 9. Boxes 2 to 4 take one letter.',
  BOX_LOCKED: 'This box is locked.',
  INVALID_BOX: 'That box does not exist.',
  R3_OVER: 'The hunt is over.',
  // Admin-side codes
  BREAK_NOT_OVER: 'The break has not ended yet.',
  R3_TEAM_COUNT: 'Choose 1 to 5 teams',
  R3_TOO_MANY: 'Maximum 5 teams can participate in Round 3',
  R3_ZONE_TAKEN: 'Zone is already assigned to another team',
  R3_CONTENT_MISSING: 'Content missing for this zone',
  R3_CODE_INVALID: 'One digit 1 to 9, then three letters',
  R3_LOCKED: 'Round 3 is already active or ended',
  CREDIT_LAST_BOX: 'Reset the box so the team types it',
  REASON_REQUIRED: 'Reason is required',
  RESET_BLOCKED: 'Reset is currently blocked',
};

export const ANSWER_FEEDBACK: Record<string, string> = {
  correct: 'Correct.',
  wrong_one_left: 'Wrong. One try left.',
  locked: 'Wrong. This box is locked.',
  wrong: 'Wrong.',
  won: 'Code correct! The code is the room number. Decipher it and go find the treasure.',
};


export function getErrorMessage(code: string, params?: { s?: number | string }): string {
  let msg = ERROR_MESSAGES[code] || 'An unexpected error occurred.';
  if (params?.s !== undefined) {
    msg = msg.replace('{s}', String(params.s));
  }
  return msg;
}
