/**
 * Helper utilities for QR locations and registration counting.
 * Shared between admin dashboard, admin QR management, and player /api/qr-board.
 */

export interface QrRunCounts {
  run1: number;
  run2: number;
}

/**
 * Counts registrations grouped by QR ID and run (run 1 vs run 2).
 */
export function countRegistrationsByRun(
  registrations: Array<{ qr_id: number; run: number }> | null | undefined
): Record<number, QrRunCounts> {
  const counts: Record<number, QrRunCounts> = {};
  if (!registrations) return counts;

  for (const reg of registrations) {
    if (!counts[reg.qr_id]) {
      counts[reg.qr_id] = { run1: 0, run2: 0 };
    }
    if (reg.run === 1) counts[reg.qr_id].run1++;
    if (reg.run === 2) counts[reg.qr_id].run2++;
  }

  return counts;
}

/**
 * Counts registrations for a specific run grouped by QR ID.
 */
export function countRegistrationsForRun(
  registrations: Array<{ qr_id: number }> | null | undefined
): Record<number, number> {
  const counts: Record<number, number> = {};
  if (!registrations) return counts;

  for (const reg of registrations) {
    counts[reg.qr_id] = (counts[reg.qr_id] || 0) + 1;
  }

  return counts;
}
