// Types
export interface Guest {
  _id: string;
  eventId: string;
  name: string;
  phone: string;
  email?: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'imported' | 'whatsapp';
  note?: string;
  reminderSentAt?: Date;
  /** For seating: guest_count if confirmed, else import_count. Used for capacity. */
  confirmedCount?: number;
  /** From API: import_count (expected from list). */
  expectedCount?: number;
  assignedSeat?: string;
  /** From API: table_number (which table). */
  tableNumber?: number | null;
  lastResponse?: string | Date;
  avatarUrl?: string;
}

export interface Table {
  id: string;
  name: string;
  seats: number;
  /** Optional per-side capacity (bride + groom = seats when both set). */
  seatsBride?: number;
  seatsGroom?: number;
  style: 'round' | 'row' | 'square';
  side: 'bride' | 'groom';
  position: { x: number; y: number };
  size: { width: number; height: number };
  seatAssignments: { [key: string]: string }; // seat index -> guest id
}

// Status colors
export const statusColors = {
  pending: '#f57c00',
  confirmed: '#2e7d32',
  declined: '#c62828',
  maybe: '#1976d2'
} as const;

// Status labels
export const statusLabels = {
  pending: 'ממתין',
  confirmed: 'אישר',
  declined: 'ביטל',
  maybe: 'אולי'
} as const;

// Source icons
export const sourceIcons = {
  manual: 'TableChartIcon',
  whatsapp: 'WhatsAppIcon',
  excel: 'TableChartIcon'
} as const;

// Source labels
export const sourceLabels = {
  manual: 'ידני',
  whatsapp: 'וואטסאפ',
  excel: 'אקסל'
} as const;

// Mock data
export const mockGuests: Guest[] = [
  {
    _id: '1',
    eventId: 'event1',
    name: 'שרה לוי',
    phone: '050-1234567',
    email: 'sarah@example.com',
    group: 'משפחת ישראלי',
    status: 'confirmed',
    source: 'whatsapp',
    note: 'מגיע עם בן/בת זוג',
    confirmedCount: 2,
    lastResponse: '12/05/2024'
  },
  {
    _id: '2',
    eventId: 'event1',
    name: 'יוסי כהן',
    phone: '052-9876543',
    email: 'yossi@example.com',
    group: 'משפחת כהן',
    status: 'confirmed',
    source: 'manual',
    note: '',
    confirmedCount: 1,
    lastResponse: '11/05/2024'
  },
  {
    _id: '3',
    eventId: 'event1',
    name: 'מיכל אברהם',
    phone: '054-5556677',
    email: 'michal@example.com',
    group: 'משפחת לוי',
    status: 'declined',
    source: 'imported',
    note: 'לא יכול להגיע',
    lastResponse: '10/05/2024'
  },
  {
    _id: '4',
    eventId: 'event1',
    name: 'דוד מזרחי',
    phone: '053-1112233',
    email: 'david@example.com',
    group: 'משפחת אברהם',
    status: 'confirmed',
    source: 'whatsapp',
    note: 'תאשר בהמשך',
    confirmedCount: 3,
    lastResponse: '09/05/2024'
  },
  {
    _id: '5',
    eventId: 'event1',
    name: 'רונית שמש',
    phone: '055-9998877',
    email: 'ronit@example.com',
    group: 'משפחת יעקובי',
    status: 'pending',
    source: 'whatsapp',
    note: '',
  }
];

// RSVP Statistics
export const mockRSVPStats = {
  approved: 24,
  declined: 8,
  pending: 18
};

// Mock tables data
export const mockTables: Table[] = [
  {
    id: '1',
    name: 'שולחן 1',
    seats: 8,
    style: 'round',
    side: 'bride',
    position: { x: 100, y: 100 },
    size: { width: 200, height: 200 },
    seatAssignments: {},
  },
  {
    id: '2',
    name: 'שולחן 2',
    seats: 8,
    style: 'round',
    side: 'groom',
    position: { x: 400, y: 100 },
    size: { width: 200, height: 200 },
    seatAssignments: {},
  },
  {
    id: '3',
    name: 'שולחן 3',
    seats: 8,
    style: 'row',
    side: 'bride',
    position: { x: 100, y: 400 },
    size: { width: 300, height: 150 },
    seatAssignments: {},
  },
]; 