/**
 * Adds business days (Mon–Fri). Indian public holidays are not modelled; the
 * follow-up is sent at 10:00 IST on the resulting day.
 */
export function addBusinessDays(from, days) {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ist = new Date(d.getTime() + 5.5 * 3600_000);
    const dow = ist.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  // 10:00 IST == 04:30 UTC
  d.setUTCHours(4, 30, 0, 0);
  return d;
}
