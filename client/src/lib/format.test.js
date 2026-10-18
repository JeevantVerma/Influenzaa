import { describe, it, expect } from 'vitest';
import { money, toMinor, toMajor, deliverablesText, DELIVERY_LABELS } from './format.js';

describe('format helpers', () => {
  it('formats INR in Indian grouping from minor units', () => {
    expect(money(12_345_600, 'INR')).toMatch(/1,23,456/);
    expect(money(null)).toBe('—');
  });
  it('converts rupee input to integer paise without float drift', () => {
    expect(toMinor('1,23,456.78')).toBe(12_345_678);
    expect(toMinor('₹ 0.1')).toBe(10);
    expect(toMinor('')).toBeNull();
    expect(toMajor(4_500_000)).toBe('45000');
  });
  it('describes deliverables', () => {
    expect(deliverablesText([{ type: 'instagram_reel', quantity: 2 }])).toBe('2 × Instagram Reel');
  });
  it('labels simulated sends as not delivered', () => {
    expect(DELIVERY_LABELS.simulated.label).toMatch(/not delivered/);
    expect(DELIVERY_LABELS.draft.label).toMatch(/not sent/);
  });
});
