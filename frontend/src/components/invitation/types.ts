// Mirrors core-service schemas.InvitationConfig
export interface InvitationConfig {
  envelope?: {
    enabled?: boolean;         // show the wax-sealed envelope intro on open
    color?: string;            // envelope paper colour
    texture?: string | null;   // texture key (e.g. "linen") or image url
    waxColor?: string | null;  // wax seal colour
    stampText?: string | null; // text pressed into the wax seal
    paperText?: string | null; // message written on the envelope paper
    envelopeText?: string | null; // editorial overline (shown on the photo)
    font?: string | null;      // font for the envelope / seal text
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
  theme?: InvitationTheme | null;
  /** Editable UI labels (section overlines, detail labels, footer note, …),
   *  keyed by a stable id. Missing keys fall back to built-in defaults. */
  labels?: Record<string, string> | null;
  /** Order of the movable content blocks in the left column. */
  order?: string[] | null;
  /** Ids of content blocks hidden from guests. */
  hidden?: string[] | null;
}

/** Visual theme tokens for the editorial invitation. All optional; the
 *  renderer fills in sensible defaults (see engine `resolveTheme`). */
export interface InvitationTheme {
  preset?: string | null;
  bg?: string | null;         // page background
  ink?: string | null;        // primary text
  accent?: string | null;     // overlines, dividers, buttons
  titleFont?: string | null;  // serif display
  bodyFont?: string | null;   // sans body
}

export interface InvitationData {
  slug?: string;
  name: string;
  event_date?: string | null;
  location?: string | null;
  event_type?: string | null;
  inviters?: Array<{ fn: string; ln: string }>;
  invitation: InvitationConfig;
}

export const DEFAULT_INVITATION: InvitationConfig = {
  envelope: { enabled: false, color: '#3e121a', texture: 'linen', waxColor: '#d8ccb8', stampText: '', paperText: '', envelopeText: 'הזמנה', font: '"Frank Ruhl Libre", serif' },
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
