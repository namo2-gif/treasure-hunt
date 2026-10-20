import type { SupabaseClient } from '@supabase/supabase-js';
import { getErrorMessage } from './messages';
import type { RawPlayerState } from './state';

export interface ActionResult {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/** Adds the player-facing message for a rejection. Postgres returns codes only. */
function withMessage(result: ActionResult): ActionResult {
  if (!result.ok && result.code && !result.message) {
    return { ...result, message: getErrorMessage(result.code) };
  }
  return result;
}

async function callRpc(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const { data, error } = await client.rpc(fn, args);
  if (error || !data) {
    console.error(`rpc ${fn} failed`, error?.code, error?.message);
    // PGRST202 means the SQL migration has not been run. Anything else is a real failure (5xx upstream).
    return withMessage({ ok: false, code: 'RPC_ERROR' });
  }
  return withMessage(data as ActionResult);
}

export async function getRawPlayerState(client: SupabaseClient, studentId: string): Promise<RawPlayerState | null> {
  const { data, error } = await client.rpc('player_state', { p_student: studentId });
  if (error) throw new Error(`player_state failed (${error.code}): ${error.message}`);
  if (!data || data.ok === false) return null;
  return data as RawPlayerState;
}

export function solveTeaser(client: SupabaseClient, studentId: string, answer: string) {
  return callRpc(client, 'solve_teaser', { p_student: studentId, p_answer: answer });
}

export function submitAnswer(
  client: SupabaseClient,
  studentId: string,
  kind: 'r1' | 'r2',
  key: number,
  optionId: string,
  requestId: string
) {
  return callRpc(client, 'submit_answer', {
    p_student: studentId,
    p_kind: kind,
    p_key: key,
    p_option: optionId,
    p_request: requestId,
  });
}

export function submitR3Box(
  client: SupabaseClient,
  studentId: string,
  box: number,
  value: string,
  requestId: string
) {
  return callRpc(client, 'r3_submit_box', {
    p_student: studentId,
    p_box: box,
    p_value: value,
    p_request: requestId,
  });
}

