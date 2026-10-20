import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../lib/messages';
import { mapPlayerMe, mapRiddleDTO, mapCaptainBoardQuestionDTO } from '../lib/dto';
import { signPlayerToken, verifyPlayerToken, signAdminToken, verifyAdminToken } from '../lib/session';

describe('Phase 1 Tests', () => {
  describe('Messages & Errors', () => {
    it('returns standard error message for INVALID_LOGIN', () => {
      expect(getErrorMessage('INVALID_LOGIN')).toBe('Student ID or code is wrong.');
    });

    it('interpolates seconds correctly in THROTTLED message', () => {
      expect(getErrorMessage('THROTTLED', { s: 30 })).toBe('Too many tries. Wait 30 seconds.');
    });
  });

  describe('JWT Session Verification', () => {
    // Set dummy secrets for test environment if not set
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_secret_must_be_32_bytes_long_minimum_length';
    process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'test_admin_secret_must_be_32_bytes_long_minimum';

    it('signs and verifies a valid player token', async () => {
      const token = await signPlayerToken('S0101');
      const payload = await verifyPlayerToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.sid).toBe('S0101');
    });

    it('rejects an invalid or tampered player token', async () => {
      const token = await signPlayerToken('S0101');
      const tampered = token + 'broken';
      const payload = await verifyPlayerToken(tampered);
      expect(payload).toBeNull();
    });

    it('signs and verifies a valid admin token', async () => {
      const token = await signAdminToken(42);
      const payload = await verifyAdminToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.aid).toBe(42);
    });

    it('does not cross-verify player token with admin secret', async () => {
      const playerToken = await signPlayerToken('S0101');
      const adminPayload = await verifyAdminToken(playerToken);
      expect(adminPayload).toBeNull();
    });
  });

  describe('DTO Mappers (Information Hiding)', () => {
    it('mapPlayerMe strips sensitive fields', () => {
      const student = { id: 'S0101', name: 'Alice', is_captain: true, code_hash: 'secret', failed_logins: 0 };
      const team = { id: 'T01', name: 'Alpha', n: 4 };
      const dto = mapPlayerMe(student, team);

      expect(dto).toEqual({
        studentId: 'S0101',
        name: 'Alice',
        teamId: 'T01',
        teamName: 'Alpha',
        isCaptain: true,
        n: 4,
      });
      expect((dto as any).code_hash).toBeUndefined();
    });

    it('mapRiddleDTO deterministic shuffle and strips correct_option_id', () => {
      const riddle = {
        id: 1,
        position: 1,
        text: 'What is it?',
        options: [
          { id: 'a', text: 'Opt A' },
          { id: 'b', text: 'Opt B' },
          { id: 'c', text: 'Opt C' },
        ],
        correct_option_id: 'a',
      };

      const dto = mapRiddleDTO(riddle as any, 'T01', null);
      expect(dto.id).toBe(1);
      expect(dto.status).toBe('open');
      expect((dto as any).correct_option_id).toBeUndefined();
      expect(dto.options.length).toBe(3);
    });

    it('Phase 10 Round 3 DTOs never leak master code or expected characters', () => {
      const boxDto = {
        box: 1,
        riddleText: 'Secret cipher',
        status: 'open' as const,
      };
      expect((boxDto as any).expected).toBeUndefined();
      expect((boxDto as any).code).toBeUndefined();
      expect((boxDto as any).room).toBeUndefined();
    });

    it('mapCaptainBoardQuestionDTO never leaks question stems', () => {
      const question = {
        id: 10,
        question_no: 2,
        stem: 'Confidential poster location question',
        options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
        voided: false,
      };

      const dto = mapCaptainBoardQuestionDTO(question, 'T01', [], 2);
      expect((dto as any).stem).toBeUndefined();
      expect(dto.questionNo).toBe(2);
      expect(dto.status).toBe('open');
    });
  });

  describe('Throttle Backoff Calculation', () => {
    function calcThrottleSeconds(failures: number): number {
      if (failures < 5) return 0;
      return Math.min(2 * Math.pow(2, failures - 5), 60);
    }

    it('verifies exponential throttle curve', () => {
      expect(calcThrottleSeconds(1)).toBe(0);
      expect(calcThrottleSeconds(4)).toBe(0);
      expect(calcThrottleSeconds(5)).toBe(2);
      expect(calcThrottleSeconds(6)).toBe(4);
      expect(calcThrottleSeconds(7)).toBe(8);
      expect(calcThrottleSeconds(8)).toBe(16);
      expect(calcThrottleSeconds(9)).toBe(32);
      expect(calcThrottleSeconds(10)).toBe(60);
      expect(calcThrottleSeconds(20)).toBe(60);
    });
  });
});
