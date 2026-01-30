/**
 * Israel timezone: UTC+2 (winter) or UTC+3 (DST, roughly end of March - end of October).
 * Use when the user enters event/campaign times in "Israel time" so we store correct UTC.
 */
import { Dayjs } from 'dayjs';

/** Israel DST is roughly last Sunday of March to last Sunday of October. Simplified: March 28 - Oct 26. */
function isIsraelDST(date: Dayjs): boolean {
  const m = date.month(); // 0-11
  const d = date.date();
  if (m > 2 && m < 9) return true;  // Apr-Sep
  if (m === 2) return d >= 28;       // late March
  if (m === 9) return d <= 26;       // early Oct
  return false;
}

/** Returns offset string for Israel at the given date: '+03:00' or '+02:00'. */
export function getIsraelOffsetString(date: Dayjs): string {
  return isIsraelDST(date) ? '+03:00' : '+02:00';
}

/**
 * Build an ISO string in UTC for the given date and time interpreted as Israel time.
 * Use when sending event_date or schedule_time so the backend stores correct UTC.
 */
export function israelTimeToISOUTC(date: Dayjs, timeStr: string): string {
  const [hours = 0, minutes = 0] = timeStr.split(':').map(Number);
  const dateStr = date.format('YYYY-MM-DD');
  const offset = getIsraelOffsetString(date);
  const isoIsrael = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00${offset}`;
  return new Date(isoIsrael).toISOString();
}
