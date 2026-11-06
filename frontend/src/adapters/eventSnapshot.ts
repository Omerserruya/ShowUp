/**
 * Event snapshot adapter (design v6).
 *
 * The v6 screens (home, insights, sidebar counts, mobile home) ask questions
 * the API doesn't answer in one call: "how many people are coming", "who has no
 * table", "who should I call". This adapter fetches the EXISTING endpoints and
 * derives those answers on the client. Nothing here is invented - every number
 * is computed from:
 *   GET /api/guests?event_id&page_size=2000     guest records
 *   GET /api/guests/stats?event_id              headcount totals
 *   GET /api/campaigns?event_id                 rounds + per-round funnel stats
 *   GET /api/guest-imports/summary?event_id     WhatsApp contacts awaiting approval
 *
 * Units: "invitations" = guest records (one per household/contact);
 * "people" = headcount (guest_count when the guest answered, else import_count).
 */
import type { Event } from '../contexts/EventContext';
import { parseLocation } from '../config/messaging';
import { daysUntilEvent } from '../utils/dates';


/** Share of confirmed people who usually don't show up on the night. */
export const NO_SHOW_RATE = 0.1;
const afterNoShows = (n: number) => Math.round(n * (1 - NO_SHOW_RATE));

export type RsvpStatus = 'confirmed' | 'declined' | 'maybe' | 'pending';

export interface ApiGuest {
  id: string;
  name: string;
  phone: string;
  status: string;
  group?: string | null;
  import_count?: number | null;
  guest_count?: number | null;
  table_number?: number | null;
  notes?: string | null;
  last_response?: string | null;
  created_at?: string;
  optedOutAt?: string | null;
}

export interface ApiCampaign {
  id: string;
  name: string;
  status: string;
  /** Why the worker left the round in its status (draft/failed/empty audience). */
  status_reason?: string | null;
  schedule_time?: string | null;
  recipient_count?: number;
  audience?: string;
  stats?: {
    sent_count?: number;
    delivered_count?: number;
    read_count?: number;
    replied_count?: number;
    failed_count?: number;
    queued_count?: number;
  };
}

export interface GuestRow {
  id: string;
  name: string;
  phone: string;
  status: RsvpStatus;
  group: string;
  people: number;
  partyKnown: boolean;
  table: number | null;
  notes: string;
  lastResponse: Date | null;
  optedOut: boolean;
}

export interface RoundRow {
  id: string;
  name: string;
  when: Date | null;
  whenLabel: string;
  recipients: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  statusLabel: string;
  tone: 'quiet' | 'ok' | 'lav' | 'warn' | 'err';
  isUpcoming: boolean;
}

export interface GroupRow {
  name: string;
  invited: number;
  replied: number;
  confirmed: number;
  seated: number;
}

export interface Snapshot {
  event: {
    id: string;
    name: string;
    dateISO: string | null;
    daysUntil: number | null;
    dateLine: string;
    shortDate: string;
    venue: string;
  };
  invitations: { total: number; confirmed: number; pending: number; declined: number; maybe: number; replied: number };
  people: { invited: number; confirmed: number; maybe: number; pending: number };
  /** Range of people expected on the night: confirmed .. confirmed + "maybe",
   *  less the usual no-shows (NO_SHOW_RATE) - the number to give the venue. */
  expected: { min: number; max: number };
  guests: GuestRow[];
  unseated: GuestRow[];
  noPartySize: GuestRow[];
  maybe: GuestRow[];
  optedOut: GuestRow[];
  feed: GuestRow[];
  rounds: RoundRow[];
  nextRound: RoundRow | null;
  failedDeliveries: number;
  pendingImports: number;
  groups: GroupRow[];
  tables: { name: string; seats: number; taken: number; number: number }[];
}

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HE_MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The events API returns snake_case (`event_date`, `event_type`) while the
 *  Event type declares `date`/`type`; accept both. */
export const eventDateISO = (e: Partial<Event> | null | undefined): string | null =>
  (e as any)?.date || (e as any)?.event_date || null;
export const eventTypeKey = (e: Partial<Event> | null | undefined): string =>
  ((e as any)?.type || (e as any)?.event_type || '') as string;

export function normalizeStatus(s: string | null | undefined): RsvpStatus {
  const v = (s || '').toLowerCase();
  if (v === 'confirmed' || v === 'attending') return 'confirmed';
  if (v === 'declined') return 'declined';
  if (v === 'maybe') return 'maybe';
  return 'pending';
}

export const STATUS_LABEL: Record<RsvpStatus, string> = {
  confirmed: 'אישרו',
  declined: 'לא יגיעו',
  maybe: 'אולי',
  pending: 'לא ענו',
};

export function hebDate(d: Date): string {
  return `${d.getDate()} ${HE_MONTHS[d.getMonth()]}`;
}
export function hebDayDate(d: Date): string {
  return `${HE_DAYS[d.getDay()]}, ${hebDate(d)}`;
}
export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "היום 10:00" / "מחר, 10:00" / "4 בספטמבר" style labels for round rows. */
export function whenLabel(d: Date | null, now = new Date()): string {
  if (!d) return 'לא נקבע מועד';
  const diff = daysUntilEvent(d, now);
  if (diff === 0) return `היום, ${hhmm(d)}`;
  if (diff === 1) return `מחר, ${hhmm(d)}`;
  if (diff === -1) return `אתמול, ${hhmm(d)}`;
  return `${hebDate(d)}, ${hhmm(d)}`;
}

/** Relative "time ago" for the incoming feed. */
export function agoLabel(d: Date | null, now = new Date()): string {
  if (!d) return '';
  const diff = daysUntilEvent(d, now);
  if (diff === 0) return hhmm(d);
  if (diff === -1) return 'אתמול';
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function toGuestRow(g: ApiGuest): GuestRow {
  const status = normalizeStatus(g.status);
  const partyKnown = g.guest_count != null;
  const people = status === 'declined' ? 0 : (g.guest_count ?? g.import_count ?? 1) || 1;
  return {
    id: g.id,
    name: g.name || '',
    phone: g.phone || '',
    status,
    group: (g.group || '').trim(),
    people,
    partyKnown,
    table: g.table_number ?? null,
    notes: (g.notes || '').trim(),
    lastResponse: g.last_response ? new Date(g.last_response) : null,
    optedOut: !!g.optedOutAt,
  };
}

function roundRow(c: ApiCampaign, now: Date): RoundRow {
  const when = c.schedule_time ? new Date(c.schedule_time) : null;
  const st = c.stats || {};
  const s = (c.status || '').toLowerCase();
  const future = !!when && when > now;
  const reason = (c.status_reason || '').toLowerCase();
  // Default is NOT 'נשלח': an unknown status must never read as delivered.
  let statusLabel = 'בהכנה';
  let tone: RoundRow['tone'] = 'quiet';
  if (s === 'paused') { statusLabel = 'מושהה'; tone = 'warn'; }
  else if (s === 'draft') { statusLabel = 'טיוטה'; tone = 'warn'; }
  else if (s === 'failed') { statusLabel = 'נכשל'; tone = 'err'; }
  else if (s === 'sending' || s === 'processing') { statusLabel = 'יוצא עכשיו'; tone = 'ok'; }
  else if (s === 'pending' && !when) { statusLabel = 'לא מתוזמן'; tone = 'warn'; }
  else if (s === 'pending' && future) { statusLabel = 'מתוזמן'; tone = 'lav'; }
  else if (s === 'pending' && !future) { statusLabel = 'בתור לשליחה'; tone = 'lav'; }
  else if (s === 'sent') {
    // A round finalized with nobody to send to is 'sent' in the DB but reached no one.
    const empty = reason.includes('empty audience') || reason.includes('no_guests') || reason.includes('no_recipients');
    if (empty && !(st.sent_count || 0)) { statusLabel = 'לא נשלח · אין נמענים'; tone = 'warn'; }
    else { statusLabel = (st.replied_count || 0) > 0 ? 'הסתיים' : 'נשלח'; tone = 'quiet'; }
  }
  return {
    id: c.id,
    name: c.name,
    when,
    whenLabel: whenLabel(when, now),
    recipients: c.recipient_count || st.sent_count || 0,
    delivered: st.delivered_count || 0,
    read: st.read_count || 0,
    replied: st.replied_count || 0,
    failed: st.failed_count || 0,
    statusLabel,
    tone,
    isUpcoming: (s === 'pending' || s === 'draft') && future,
  };
}

export function buildSnapshot(
  event: Event,
  apiGuests: ApiGuest[],
  apiCampaigns: ApiCampaign[],
  pendingImports: number,
  now = new Date(),
): Snapshot {
  const guests = apiGuests.map(toGuestRow);
  const by = (s: RsvpStatus) => guests.filter((g) => g.status === s);
  const confirmed = by('confirmed');
  const maybe = by('maybe');
  const pending = by('pending');
  const declined = by('declined');
  const sum = (xs: GuestRow[]) => xs.reduce((a, g) => a + g.people, 0);

  const dateISO = eventDateISO(event);
  const d = dateISO ? new Date(dateISO) : null;
  const validDate = d && !isNaN(d.getTime()) ? d : null;
  const loc = parseLocation(event.location);

  const rounds = apiCampaigns
    .map((c) => roundRow(c, now))
    .sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));
  const nextRound = rounds.find((r) => r.isUpcoming) || null;

  // Groups ("צד כלה", "חברים"...) as the host typed them.
  const gm = new Map<string, GroupRow>();
  guests.forEach((g) => {
    const key = g.group || 'בלי קבוצה';
    const row = gm.get(key) || { name: key, invited: 0, replied: 0, confirmed: 0, seated: 0 };
    row.invited += 1;
    if (g.status !== 'pending') row.replied += 1;
    if (g.status === 'confirmed') {
      row.confirmed += 1;
      if (g.table != null) row.seated += 1;
    }
    gm.set(key, row);
  });

  // Seating: tables live in event.seatingLayout; a guest sits at table N via
  // table_number, where N = parseInt(table.id) (same rule as pages/Seating.tsx).
  const layoutTables = ((event.seatingLayout?.tables || []) as Array<Record<string, any>>);
  const tables = layoutTables.map((t, i) => {
    const parsed = parseInt(String(t.id), 10);
    const number = Number.isNaN(parsed) ? i + 1 : parsed;
    const taken = guests.filter((g) => g.table === number && g.status !== 'declined').reduce((a, g) => a + g.people, 0);
    return { name: String(t.name || `שולחן ${number}`), seats: Number(t.seats) || 0, taken, number };
  });

  return {
    event: {
      id: event.id,
      name: event.name,
      dateISO,
      daysUntil: validDate ? daysUntilEvent(validDate, now) : null,
      dateLine: validDate ? `${hebDayDate(validDate)} · ${hhmm(validDate)}` : 'עוד לא נקבע תאריך',
      shortDate: validDate ? hebDate(validDate) : '',
      venue: loc.name,
    },
    invitations: {
      total: guests.length,
      confirmed: confirmed.length,
      pending: pending.length,
      declined: declined.length,
      maybe: maybe.length,
      replied: guests.length - pending.length,
    },
    people: {
      invited: apiGuests.reduce((a, g) => a + (g.import_count || 1), 0),
      confirmed: sum(confirmed),
      maybe: sum(maybe),
      pending: sum(pending),
    },
    expected: { min: afterNoShows(sum(confirmed)), max: afterNoShows(sum(confirmed) + sum(maybe)) },
    guests,
    unseated: confirmed.filter((g) => g.table == null),
    noPartySize: confirmed.filter((g) => !g.partyKnown),
    maybe,
    optedOut: guests.filter((g) => g.optedOut),
    feed: guests
      .filter((g) => g.lastResponse && g.status !== 'pending')
      .sort((a, b) => (b.lastResponse!.getTime() - a.lastResponse!.getTime()))
      .slice(0, 6),
    rounds,
    nextRound,
    failedDeliveries: rounds.reduce((a, r) => a + r.failed, 0),
    pendingImports,
    groups: Array.from(gm.values()).sort((a, b) => b.invited - a.invited),
    tables,
  };
}
