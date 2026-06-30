import { Dayjs } from 'dayjs';
import { CampaignSchedule, FlowStage } from './campaigns';
import { israelTimeToISOUTC } from '../utils/israelTime';

/**
 * Adaptive Timeline Engine
 * ------------------------
 * The recommended communication plan must adapt to how much time is actually
 * left before the event. A wedding in 6 months and a brit tomorrow cannot share
 * the same fixed offsets. Each event type declares an *ideal* set of campaigns
 * (preferred offset, the closest-to-event minimum we'll still allow, a priority,
 * and whether the campaign is optional). The engine then resolves concrete send
 * times for the available window:
 *
 *   - Never schedules anything in the past (respects a small lead buffer, and a
 *     longer lead when a custom template still needs WhatsApp/Meta approval).
 *   - Preserves campaign order (invitation → reminder → final reminder → thank you).
 *   - Compresses toward the event when there isn't enough room, keeping a sane gap.
 *   - Skips optional campaigns that simply cannot fit.
 *
 * The result is always the best possible plan for the time that's left.
 */

export interface CampaignSpec {
  stage: FlowStage;
  label: string; // template campaignLabel (lookup key into config/templates)
  title: string; // user-facing name
  preferredOffsetDays: number; // ideal days before the event (negative = after)
  minOffsetDays: number; // closest-to-event offset we'll still accept (negative = after)
  priority: number; // lower = more important
  optional: boolean;
  time: string; // default send time, 'HH:mm' Israel local
  minTier: number; // minimum plan tier that includes this campaign (0 basic, 1 plus, 2 pro)
}

export interface ResolvedCampaign extends CampaignSchedule {
  stage: FlowStage;
  title: string;
  optional: boolean;
  priority: number;
}

// --- Tunables -------------------------------------------------------------
const BUFFER_HOURS = 3; // never schedule a send within this many hours of "now"
const MIN_GAP_HOURS = 12; // keep consecutive sends at least this far apart
const DEFAULT_APPROVAL_LEAD_DAYS = 1; // lead time a custom template needs for Meta approval

const PLAN_TIER: Record<string, number> = { free: 0, basic: 0, plus: 1, pro: 2 };

export function planTierOf(planId: string | null | undefined): number {
  if (!planId) return 0;
  return PLAN_TIER[planId] ?? 0;
}

// Canonical campaign labels - these are the template lookup keys in config/templates.
const L = {
  invite: 'Save the date',
  reminderWeek: 'תזכורת שבוע לפני',
  reminderDay: 'תזכורת יום לפני',
  thankYou: 'תודה אחרי האירוע',
} as const;

// Reusable display titles (the label itself is sometimes English/technical).
const T = {
  invite: 'הזמנה',
  reminder: 'תזכורת',
  finalReminder: 'תזכורת אחרונה',
  thankYou: 'תודה לאחר האירוע',
} as const;

/**
 * Per-event-type ideal schedules. Offsets are positive = before the event.
 * The plan tier (minTier) decides which of these a given package includes,
 * preserving today's "basic = reminders, plus/pro add invitation + thank-you".
 */
const SCHEDULES: Record<string, CampaignSpec[]> = {
  wedding: [
    { stage: 'invitation', label: L.invite, title: T.invite, preferredOffsetDays: 30, minOffsetDays: 3, priority: 2, optional: false, time: '10:00', minTier: 1 },
    { stage: 'reminder', label: L.reminderWeek, title: T.reminder, preferredOffsetDays: 7, minOffsetDays: 1, priority: 2, optional: false, time: '12:00', minTier: 0 },
    { stage: 'final_reminder', label: L.reminderDay, title: T.finalReminder, preferredOffsetDays: 1, minOffsetDays: 0, priority: 1, optional: false, time: '18:00', minTier: 0 },
    { stage: 'thank_you', label: L.thankYou, title: T.thankYou, preferredOffsetDays: -1, minOffsetDays: -1, priority: 3, optional: true, time: '11:00', minTier: 1 },
  ],
  mitzvah: [
    { stage: 'invitation', label: L.invite, title: T.invite, preferredOffsetDays: 21, minOffsetDays: 3, priority: 2, optional: false, time: '10:00', minTier: 1 },
    { stage: 'reminder', label: L.reminderWeek, title: T.reminder, preferredOffsetDays: 7, minOffsetDays: 1, priority: 2, optional: false, time: '12:00', minTier: 0 },
    { stage: 'final_reminder', label: L.reminderDay, title: T.finalReminder, preferredOffsetDays: 1, minOffsetDays: 0, priority: 1, optional: false, time: '18:00', minTier: 0 },
    { stage: 'thank_you', label: L.thankYou, title: T.thankYou, preferredOffsetDays: -1, minOffsetDays: -1, priority: 3, optional: true, time: '11:00', minTier: 1 },
  ],
  // Brit/brita timelines are short by nature - guests are often invited just days ahead.
  brit: [
    { stage: 'invitation', label: L.invite, title: T.invite, preferredOffsetDays: 5, minOffsetDays: 0, priority: 1, optional: false, time: '10:00', minTier: 0 },
    { stage: 'final_reminder', label: L.reminderDay, title: T.reminder, preferredOffsetDays: 1, minOffsetDays: 0, priority: 2, optional: false, time: '09:00', minTier: 0 },
    { stage: 'thank_you', label: L.thankYou, title: T.thankYou, preferredOffsetDays: -1, minOffsetDays: -1, priority: 3, optional: true, time: '11:00', minTier: 1 },
  ],
  business: [
    { stage: 'invitation', label: L.invite, title: T.invite, preferredOffsetDays: 14, minOffsetDays: 1, priority: 2, optional: false, time: '09:00', minTier: 1 },
    { stage: 'reminder', label: L.reminderWeek, title: T.reminder, preferredOffsetDays: 3, minOffsetDays: 1, priority: 2, optional: false, time: '09:00', minTier: 0 },
    { stage: 'final_reminder', label: L.reminderDay, title: T.finalReminder, preferredOffsetDays: 1, minOffsetDays: 0, priority: 1, optional: false, time: '09:00', minTier: 0 },
    { stage: 'thank_you', label: L.thankYou, title: T.thankYou, preferredOffsetDays: -1, minOffsetDays: -1, priority: 3, optional: true, time: '12:00', minTier: 1 },
  ],
  social: [
    { stage: 'invitation', label: L.invite, title: T.invite, preferredOffsetDays: 14, minOffsetDays: 2, priority: 2, optional: false, time: '11:00', minTier: 1 },
    { stage: 'reminder', label: L.reminderWeek, title: T.reminder, preferredOffsetDays: 5, minOffsetDays: 1, priority: 2, optional: false, time: '12:00', minTier: 0 },
    { stage: 'final_reminder', label: L.reminderDay, title: T.finalReminder, preferredOffsetDays: 1, minOffsetDays: 0, priority: 1, optional: false, time: '18:00', minTier: 0 },
    { stage: 'thank_you', label: L.thankYou, title: T.thankYou, preferredOffsetDays: -1, minOffsetDays: -1, priority: 3, optional: true, time: '11:00', minTier: 1 },
  ],
};

/** Map the wizard's event-type ids to a schedule key. */
export function scheduleKeyForEventType(type: string | null | undefined): string {
  switch (type) {
    case 'wedding':
      return 'wedding';
    case 'brit':
    case 'brita':
      return 'brit';
    case 'bar':
    case 'bat':
      return 'mitzvah';
    case 'corporate':
      return 'business';
    case 'birthday':
      return 'social';
    default:
      return 'wedding'; // sensible, full-featured default for unknown/other types
  }
}

/** The ideal specs for an event type, filtered to what the plan tier includes. */
export function getSpecsForEvent(eventType: string, planId: string | null | undefined): CampaignSpec[] {
  const specs = SCHEDULES[scheduleKeyForEventType(eventType)] || SCHEDULES.wedding;
  const tier = planTierOf(planId);
  return specs.filter((s) => s.minTier <= tier);
}

function atTime(date: Dayjs, time: string): Dayjs {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return date.hour(h).minute(m).second(0).millisecond(0);
}

function offsetDaysBetween(eventDate: Dayjs, sendAt: Dayjs): number {
  // Positive = before the event. Day-granular so the UI reads cleanly.
  return eventDate.startOf('day').diff(sendAt.startOf('day'), 'day');
}

export interface BuildTimelineParams {
  eventType: string;
  planId: string | null | undefined;
  eventDate: Dayjs | null;
  eventTime: string;
  now: Dayjs;
  /** Campaign labels that use a custom template needing Meta approval before it can send. */
  customLabels?: string[];
  approvalLeadDays?: number;
}

/**
 * Resolve the adaptive timeline for an event. Returns the campaigns that can run,
 * each with a concrete `scheduledAt` (ISO-UTC), an effective `offsetDays`, and a
 * `note` when it had to be moved to fit the available time. Campaigns that cannot
 * fit at all are omitted.
 */
export function buildAdaptiveTimeline(params: BuildTimelineParams): ResolvedCampaign[] {
  const { eventType, planId, eventDate, eventTime, now } = params;
  const approvalLeadDays = params.approvalLeadDays ?? DEFAULT_APPROVAL_LEAD_DAYS;
  const customLabels = new Set(params.customLabels || []);
  const tier = planTierOf(planId);
  const specs = getSpecsForEvent(eventType, planId);

  // No date yet (or a half-typed / invalid date) → present the ideal plan without
  // resolving concrete send times. Guarding isValid() here prevents an Invalid Date
  // from reaching israelTimeToISOUTC, which would throw on toISOString().
  if (!eventDate || !eventDate.isValid()) {
    return specs.map((s) => ({
      enabled: s.stage === 'thank_you' ? tier >= 2 : true,
      label: s.label,
      title: s.title,
      stage: s.stage,
      optional: s.optional,
      priority: s.priority,
      offsetDays: s.preferredOffsetDays,
      time: s.time,
    }));
  }

  const eventAt = atTime(eventDate, eventTime || '18:00');
  const leadHoursFor = (s: CampaignSpec) =>
    customLabels.has(s.label) ? Math.max(BUFFER_HOURS, approvalLeadDays * 24) : BUFFER_HOURS;

  const before = specs.filter((s) => s.preferredOffsetDays >= 0).sort((a, b) => b.preferredOffsetDays - a.preferredOffsetDays);
  const after = specs.filter((s) => s.preferredOffsetDays < 0);

  const resolved: ResolvedCampaign[] = [];
  let prev: Dayjs | null = null;

  for (const s of before) {
    const earliest = now.add(leadHoursFor(s), 'hour');
    const ideal = atTime(eventDate.subtract(s.preferredOffsetDays, 'day'), s.time);
    const latest = atTime(eventDate.subtract(s.minOffsetDays, 'day'), s.time);
    const cap = latest.isAfter(eventAt) ? eventAt : latest; // never after the event itself
    const lower = prev ? maxDate(earliest, prev.add(MIN_GAP_HOURS, 'hour')) : earliest;

    let sendAt: Dayjs;
    if (lower.isAfter(cap)) {
      // No clean room left for this campaign in the available window.
      if (s.optional) continue; // skip optional campaigns rather than crowd the plan
      // Mandatory: squeeze it as close to the event as allowed, if at all possible.
      if (cap.isAfter(earliest) || cap.isSame(earliest)) {
        sendAt = cap;
      } else {
        continue; // truly impossible (event is essentially now / in the past)
      }
    } else {
      sendAt = clampDate(ideal, lower, cap);
    }

    const compressed = !sendAt.isSame(ideal, 'minute');
    resolved.push({
      enabled: true,
      label: s.label,
      title: s.title,
      stage: s.stage,
      optional: s.optional,
      priority: s.priority,
      offsetDays: offsetDaysBetween(eventDate, sendAt),
      time: sendAt.format('HH:mm'),
      scheduledAt: israelTimeToISOUTC(sendAt, sendAt.format('HH:mm')),
      note: compressed ? 'הותאם ללוח הזמנים שנותר' : undefined,
    });
    prev = sendAt;
  }

  for (const s of after) {
    const enabledDefault = s.stage === 'thank_you' ? tier >= 2 : true;
    const earliest = now.add(BUFFER_HOURS, 'hour');
    let sendAt = atTime(eventDate.subtract(s.preferredOffsetDays, 'day'), s.time); // subtract(neg) = after
    if (sendAt.isBefore(earliest)) sendAt = earliest;
    resolved.push({
      enabled: enabledDefault,
      label: s.label,
      title: s.title,
      stage: s.stage,
      optional: s.optional,
      priority: s.priority,
      offsetDays: offsetDaysBetween(eventDate, sendAt),
      time: sendAt.format('HH:mm'),
      scheduledAt: israelTimeToISOUTC(sendAt, sendAt.format('HH:mm')),
    });
  }

  // Chronological: earliest offset (largest "days before") first.
  return resolved.sort((a, b) => b.offsetDays - a.offsetDays);
}

function maxDate(a: Dayjs, b: Dayjs): Dayjs {
  return a.isAfter(b) ? a : b;
}

function clampDate(value: Dayjs, lower: Dayjs, upper: Dayjs): Dayjs {
  if (value.isBefore(lower)) return lower;
  if (value.isAfter(upper)) return upper;
  return value;
}
