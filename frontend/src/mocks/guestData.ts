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
