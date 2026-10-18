// Monetary values are stored as integer minor units (paise for INR) to avoid
// floating-point rounding errors. All arithmetic happens on integers.

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

export function isSupportedCurrency(c) {
  return SUPPORTED_CURRENCIES.includes(c);
}

/** Converts a major-unit amount (e.g. 25000.50 rupees) into integer minor units. */
export function toMinor(major) {
  if (major === null || major === undefined || major === '') return null;
  const n = typeof major === 'string' ? Number(major.replace(/[,\s]/g, '')) : Number(major);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function toMajor(minor) {
  if (minor === null || minor === undefined) return null;
  return minor / 100;
}

/** Applies a percentage discount (0-100) to a minor-unit amount, rounding to the nearest whole rupee. */
export function applyDiscount(minor, percent) {
  const discounted = Math.round((minor * (100 - percent)) / 100);
  return Math.round(discounted / 100) * 100;
}

export function roundToNearest(minor, stepMinor = 50_000) {
  return Math.round(minor / stepMinor) * stepMinor;
}

export function formatMoney(minor, currency = 'INR') {
  if (minor === null || minor === undefined) return '—';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}
