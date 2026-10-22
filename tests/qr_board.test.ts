import { describe, expect, it } from 'vitest';
import { mapQrBoardDTO } from '../lib/dto';
import { countRegistrationsByRun, countRegistrationsForRun } from '../lib/qr';

describe('QR Board DTO Mapper', () => {
  it('returns exactly number, name, count, capacity and never token or id', () => {
    const rawQrs = [
      { id: 10, name: 'Library Entrance', capacity: 12, token: 'secret-tok-1', active: true },
      { id: 25, name: 'Cafeteria South', capacity: 8, token: 'secret-tok-2', active: true },
    ];
    const counts = { 10: 5, 25: 3 };

    const dto = mapQrBoardDTO(1, rawQrs as any, counts);

    expect(dto.ok).toBe(true);
    expect(dto.run).toBe(1);
    expect(dto.locations).toHaveLength(2);

    // Assert exact keys on each location item
    for (const loc of dto.locations) {
      const keys = Object.keys(loc).sort();
      expect(keys).toEqual(['capacity', 'count', 'name', 'number']);
      expect((loc as any).token).toBeUndefined();
      expect((loc as any).id).toBeUndefined();
    }

    // Numbering is 1-based sequential position
    expect(dto.locations[0]).toEqual({
      number: 1,
      name: 'Library Entrance',
      count: 5,
      capacity: 12,
    });
    expect(dto.locations[1]).toEqual({
      number: 2,
      name: 'Cafeteria South',
      count: 3,
      capacity: 8,
    });

    // Ensure raw JSON serialization contains no "token"
    const jsonStr = JSON.stringify(dto);
    expect(jsonStr).not.toContain('secret-tok');
    expect(jsonStr).not.toContain('token');
  });

  it('caps count at capacity and handles zero / missing registrations', () => {
    const rawQrs = [
      { id: 1, name: 'Overfilled Hub', capacity: 12, token: 'tok-overflow', active: true },
      { id: 2, name: 'Empty Spot', capacity: 6, token: 'tok-empty', active: true },
    ];
    const counts = { 1: 15 }; // 15 > 12; qr 2 has no registrations

    const dto = mapQrBoardDTO(2, rawQrs as any, counts);

    expect(dto.run).toBe(2);
    expect(dto.locations[0].count).toBe(12); // capped at 12
    expect(dto.locations[0].capacity).toBe(12);
    expect(dto.locations[1].count).toBe(0); // missing defaults to 0
    expect(dto.locations[1].capacity).toBe(6);
  });

  it('excludes inactive QRs and re-indexes active QRs from 1', () => {
    const rawQrs = [
      { id: 1, name: 'Active Spot 1', capacity: 10, active: true },
      { id: 2, name: 'Disabled Spot', capacity: 10, active: false },
      { id: 3, name: 'Active Spot 2', capacity: 10, active: true },
    ];
    const counts = { 1: 2, 2: 8, 3: 4 };

    const dto = mapQrBoardDTO(1, rawQrs, counts);

    expect(dto.locations).toHaveLength(2);
    expect(dto.locations[0].name).toBe('Active Spot 1');
    expect(dto.locations[0].number).toBe(1);
    expect(dto.locations[1].name).toBe('Active Spot 2');
    expect(dto.locations[1].number).toBe(2);
  });
});

describe('QR Registration Counting Helpers', () => {
  it('counts registrations by run correctly', () => {
    const regs = [
      { qr_id: 1, run: 1 },
      { qr_id: 1, run: 1 },
      { qr_id: 1, run: 2 },
      { qr_id: 2, run: 2 },
    ];
    const counts = countRegistrationsByRun(regs);
    expect(counts[1]).toEqual({ run1: 2, run2: 1 });
    expect(counts[2]).toEqual({ run1: 0, run2: 1 });
    expect(counts[3]).toBeUndefined();
  });

  it('counts registrations for a specific run correctly', () => {
    const regs = [
      { qr_id: 1 },
      { qr_id: 1 },
      { qr_id: 2 },
    ];
    const counts = countRegistrationsForRun(regs);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(1);
    expect(counts[99]).toBeUndefined();
  });
});
