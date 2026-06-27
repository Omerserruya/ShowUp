// Mirrors core-service schemas.InvitationConfig
export interface InvitationConfig {
  envelope?: {
    color?: string;
    texture?: string | null;   // texture key (e.g. "linen") or image url
    stampText?: string | null;
    envelopeText?: string | null;
    font?: string | null;
  };
  hero?: {
    imageUrl?: string | null;
    bigText?: string | null;
    font?: string | null;
  };
  personalText?: string | null;
  details?: {
    showDate?: boolean;
    showTime?: boolean;
    showLocation?: boolean;
  };
  fontFamily?: string | null;
  rsvpEnabled?: boolean;
}

export interface InvitationData {
  slug?: string;
  name: string;
  event_date?: string | null;
  location?: string | null;
  inviters?: Array<{ fn: string; ln: string }>;
  invitation: InvitationConfig;
}

export const DEFAULT_INVITATION: InvitationConfig = {
  envelope: { color: '#f5efe6', texture: 'linen', stampText: '', envelopeText: 'הזמנה', font: 'serif' },
  hero: { imageUrl: '', bigText: '', font: 'serif' },
  personalText: '',
  details: { showDate: true, showTime: true, showLocation: true },
  fontFamily: 'serif',
  rsvpEnabled: true,
};

/** Location is stored free-form; may be a JSON string from places autocomplete. */
export function formatLocation(location?: string | null): string {
  if (!location) return '';
  try {
    const parsed = JSON.parse(location);
    return parsed.label || parsed.name || parsed.address || location;
  } catch {
    return location;
  }
}
