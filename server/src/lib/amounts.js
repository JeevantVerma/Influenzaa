// Parses monetary amounts out of free text (Indian conventions: ₹, Rs, INR,
// lakh, crore, k). Used by the development mock extractor and by the
// deterministic check that AI-drafted messages contain no unapproved figures.

const UNIT = { k: 1_000, thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, l: 100_000, crore: 10_000_000, crores: 10_000_000, cr: 10_000_000 };

const CURRENCY_FIRST = /(?:₹|\bRs\.?|\bINR|\$|\bUSD)\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/gi;
const UNIT_AFTER = /\b([\d,]+(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr)\b/gi;
const WORD_AFTER = /\b([\d,]{4,}(?:\.\d+)?)\s*(?:rupees|inr|\/-)/gi;

function toNumber(raw, unit) {
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = unit ? UNIT[unit.toLowerCase()] ?? 1 : 1;
  return Math.round(n * mult);
}

/** Returns de-duplicated amounts (major units) with their character offsets. */
export function findAmounts(text) {
  const found = new Map();
  const add = (value, index, raw) => {
    if (value === null || value <= 0) return;
    // Overlapping matches (e.g. "₹1.5 lakh" seen by two patterns) collapse by position.
    for (const [, v] of found) if (Math.abs(v.index - index) <= 4) return;
    found.set(`${index}`, { value, index, raw });
  };
  const NON_MONEY = /^\s*\+?\s*(followers|views|subscribers|impressions|reach|likes|members|people|users|downloads)/i;
  for (const re of [CURRENCY_FIRST, UNIT_AFTER, WORD_AFTER]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      // "150k followers" is an audience figure, not money.
      if (re !== CURRENCY_FIRST && NON_MONEY.test(text.slice(m.index + m[0].length, m.index + m[0].length + 30))) continue;
      add(toNumber(m[1], m[2]), m.index, m[0]);
    }
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

/**
 * Checks that every amount mentioned in `text` is one of `allowedMajor`
 * (within ±1 unit). Returns the list of unexpected amounts.
 */
export function unexpectedAmounts(text, allowedMajor) {
  const allowed = allowedMajor.filter((v) => typeof v === 'number');
  return findAmounts(text).filter((a) => !allowed.some((v) => Math.abs(v - a.value) <= 1));
}
