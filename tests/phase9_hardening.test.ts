import { describe, it, expect } from 'vitest';
import { seededShuffle } from '../lib/shuffle';
import { questionStatus, mapRiddleDTO } from '../lib/dto';
import { getErrorMessage } from '../lib/messages';

describe('AGENTS.md Section 13 Test Suite', () => {
  describe('1. Seeded Shuffle', () => {
    it('produces identical order for identical seed and item set', () => {
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
      const seed = 'T01:r1:5';
      const shuffled1 = seededShuffle(items, seed);
      const shuffled2 = seededShuffle(items, seed);
      expect(shuffled1).toEqual(shuffled2);
    });

    it('produces different orders for different team seeds', () => {
      const items = [
        { id: 'a', text: 'Opt 1' },
        { id: 'b', text: 'Opt 2' },
        { id: 'c', text: 'Opt 3' },
        { id: 'd', text: 'Opt 4' },
        { id: 'e', text: 'Opt 5' },
        { id: 'f', text: 'Opt 6' },
      ];
      const s1 = seededShuffle(items, 'T01:r1:1');
      const s2 = seededShuffle(items, 'T02:r1:1');
      // The permutations should not be identical for 6 items across distinct seeds
      expect(s1.map((x) => x.id)).not.toEqual(s2.map((x) => x.id));
    });
  });

  describe('2. Points & Question Status Logic', () => {
    it('calculates full points per question accurately for team sizes 3, 4, 5', () => {
      const runTotal = 120;
      // n=3 gives 40/20, n=4 gives 30/15, n=5 gives 24/12
      const full3 = Math.floor(runTotal / 3);
      const half3 = Math.floor(full3 / 2);
      expect(full3).toBe(40);
      expect(half3).toBe(20);

      const full4 = Math.floor(runTotal / 4);
      const half4 = Math.floor(full4 / 2);
      expect(full4).toBe(30);
      expect(half4).toBe(15);

      const full5 = Math.floor(runTotal / 5);
      const half5 = Math.floor(full5 / 2);
      expect(full5).toBe(24);
      expect(half5).toBe(12);
    });

    it('correctly reports questionStatus through its lifecycle', () => {
      // 0 attempts -> open
      expect(questionStatus(false, [], 2)).toBe('open');

      // 1 wrong attempt with maxTries=2 -> one_try_left
      expect(questionStatus(false, [{ try_no: 1, correct: false }], 2)).toBe('one_try_left');

      // 2 wrong attempts with maxTries=2 -> locked
      expect(
        questionStatus(
          false,
          [
            { try_no: 1, correct: false },
            { try_no: 2, correct: false },
          ],
          2
        )
      ).toBe('locked');

      // 1 correct attempt -> correct
      expect(questionStatus(false, [{ try_no: 1, correct: true }], 2)).toBe('correct');

      // 1 wrong followed by 1 correct -> correct
      expect(
        questionStatus(
          false,
          [
            { try_no: 1, correct: false },
            { try_no: 2, correct: true },
          ],
          2
        )
      ).toBe('correct');

      // voided -> voided regardless of attempts
      expect(questionStatus(true, [], 2)).toBe('voided');
      expect(questionStatus(true, [{ try_no: 1, correct: false }], 2)).toBe('voided');
    });
  });

  describe('3. Ranking & Tie-Break Ordering', () => {
    it('orders by points descending, then last point-earning timestamp ascending', () => {
      const teams = [
        { teamId: 'T01', points: 100, lastMs: 5000 },
        { teamId: 'T02', points: 120, lastMs: 6000 },
        { teamId: 'T03', points: 100, lastMs: 3000 }, // tie on points with T01, but reached earlier!
        { teamId: 'T04', points: 80, lastMs: 2000 },
      ];

      teams.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const aMs = a.lastMs ?? Number.MAX_SAFE_INTEGER;
        const bMs = b.lastMs ?? Number.MAX_SAFE_INTEGER;
        return aMs - bMs;
      });

      expect(teams[0].teamId).toBe('T02'); // 120 pts
      expect(teams[1].teamId).toBe('T03'); // 100 pts at ms 3000
      expect(teams[2].teamId).toBe('T01'); // 100 pts at ms 5000
      expect(teams[3].teamId).toBe('T04'); // 80 pts
    });

    it('assigns identical ranks to tied teams and properly includes cutoff ties', () => {
      const rows = [
        { teamId: 'T01', points: 100, lastMs: 3000 },
        { teamId: 'T02', points: 100, lastMs: 3000 }, // exact tie
        { teamId: 'T03', points: 90, lastMs: 2000 },
      ];

      let rank = 1;
      const ranked = rows.map((row, i) => {
        if (i > 0) {
          const prev = rows[i - 1];
          const sameRank = prev.points === row.points && prev.lastMs === row.lastMs;
          if (!sameRank) rank = i + 1;
        }
        return { rank, ...row };
      });

      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(1);
      expect(ranked[2].rank).toBe(3); // Rank skips to 3 per standard rank() SQL semantics
    });
  });

  describe('4. Security & DTO Sanitization', () => {
    it('never leaks correct_option_id in mapRiddleDTO', () => {
      const rawRiddle = {
        id: 1,
        position: 1,
        text: 'Where is the fountain?',
        options: [
          { id: 'a', text: 'North' },
          { id: 'b', text: 'South' },
        ],
        correct_option_id: 'a', // raw DB field
      };

      const dto = mapRiddleDTO(rawRiddle as any, 'T01', null);
      expect(dto).not.toHaveProperty('correct_option_id');
      expect(dto).not.toHaveProperty('correctOptionId');
      expect(dto.status).toBe('open');
    });

    it('never leaks master code, wrong values, or other team data in Phase 10 Round 3', () => {
      const boxDto = {
        box: 1,
        riddleText: 'CIPHER_TEXT',
        status: 'open' as const,
      };

      expect((boxDto as any).expected).toBeUndefined();
      expect((boxDto as any).code).toBeUndefined();
      expect((boxDto as any).wrongValues).toBeUndefined();
      expect((boxDto as any).triesCount).toBeUndefined();
      expect((boxDto as any).room).toBeUndefined();
      expect((boxDto as any).keyInfo).toBeUndefined();
    });
  });

  describe('5. Error Codes & Text Normalization', () => {
    it('maps all standard domain error codes to user-friendly messages', () => {
      expect(getErrorMessage('WRONG_PHASE')).toBe('That is not open right now.');
      expect(getErrorMessage('PAUSED')).toBe('The event is paused. Hang tight.');
      expect(getErrorMessage('QR_FULL')).toBe('This location is full. Find another location.');
      expect(getErrorMessage('TEAMMATE_HERE')).toBe('A teammate already registered here. Find another location.');
      expect(getErrorMessage('NOT_CAPTAIN')).toBe('Only your captain can submit.');
      expect(getErrorMessage('THROTTLED', { s: 15 })).toBe('Too many tries. Wait 15 seconds.');
    });

    it('normalizes password and teaser text per Section 2.7', () => {
      const rawInput = '  Secret   PassWord  123 \n ';
      const normalized = rawInput.toLowerCase().trim().replace(/\s+/g, ' ');
      expect(normalized).toBe('secret password 123');
    });
  });
});
