/**
 * Calendar-day distance to the event: 0 = today, positive = days ahead,
 * negative = days since. Both Overview and Recap must use this one helper so
 * the most emotionally loaded number in the product never disagrees between screens.
 */
export function daysUntilEvent(date: string | Date, now: Date = new Date()): number | null {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
}
