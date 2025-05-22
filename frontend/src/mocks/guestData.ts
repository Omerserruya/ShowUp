// Types
export interface Guest {
  _id: string;
  eventId: string;
  name: string;
  phone: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'imported' | 'whatsapp';
  note?: string;
  reminderSentAt?: Date;
  confirmedCount?: number;
  assignedSeat?: string;
}

export interface Table {
  id: string;
  name: string;
  seats: number;
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
    name: 'ישראל ישראלי',
    phone: '050-1234567',
    group: 'משפחת ישראלי',
    status: 'confirmed',
    source: 'whatsapp',
    note: 'מגיע עם בן/בת זוג',
    confirmedCount: 2
  },
  {
    _id: '2',
    eventId: 'event1',
    name: 'שרה כהן',
    phone: '052-7654321',
    group: 'משפחת כהן',
    status: 'pending',
    source: 'manual',
    note: ''
  },
  {
    _id: '3',
    eventId: 'event1',
    name: 'דוד לוי',
    phone: '054-9876543',
    group: 'משפחת לוי',
    status: 'declined',
    source: 'imported',
    note: 'לא יכול להגיע'
  },
  {
    _id: '4',
    eventId: 'event1',
    name: 'רחל אברהם',
    phone: '053-4567890',
    group: 'משפחת אברהם',
    status: 'maybe',
    source: 'whatsapp',
    note: 'תאשר בהמשך',
    confirmedCount: 1
  },
  {
    _id: '5',
    eventId: 'event1',
    name: 'יעקב יעקובי',
    phone: '050-1112233',
    group: 'משפחת יעקובי',
    status: 'confirmed',
    source: 'whatsapp',
    note: 'יבוא עם בן/בת זוג',
    confirmedCount: 2
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