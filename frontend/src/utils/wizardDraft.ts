/**
 * Abandoned-wizard recovery
 * -------------------------
 * Users build their entire event in the wizard before paying. If they close the
 * tab, refresh, or come back tomorrow, they must never lose that work. We persist
 * a lightweight draft of the wizard to localStorage on every change and offer to
 * restore it on return. The draft is cleared once the event is actually created
 * (free) or paid (the order then lives server-side and is the source of truth).
 */

export interface WizardDraft {
  version: number;
  savedAt: string; // ISO timestamp
  activeStep: number;
  selectedPackageId: string;
  orderId: string | null;
  // Stored loosely: these mirror wizard state shapes (EventDetails/EventSubjects/
  // paymentData) but with `date` serialized as an ISO string (Dayjs isn't JSON-safe).
  // Kept as `any` so the wizard can persist its exact state without index-signature
  // friction; restore re-hydrates into the proper typed state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventDetails: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subjects: any;
  campaigns: unknown[];
  selectedTemplates: Record<string, string>;
  customMessages: Record<string, string>;
  scheduleCustomize: boolean;
  templatesCustomize: boolean;
  nameManuallyEdited: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paymentData: any;
}

const KEY = 'showup_wizard_draft_v1';
const VERSION = 1;
// Drafts older than two weeks are stale — an event that long abandoned is unlikely
// to be resumed and the data (e.g. a past date) is probably no longer relevant.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function saveWizardDraft(draft: Omit<WizardDraft, 'version' | 'savedAt'>): void {
  try {
    const payload: WizardDraft = { ...draft, version: VERSION, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable / quota — recovery is best-effort */
  }
}

export function loadWizardDraft(): WizardDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as WizardDraft;
    if (!draft || draft.version !== VERSION || !draft.savedAt) return null;
    if (Date.now() - new Date(draft.savedAt).getTime() > MAX_AGE_MS) {
      clearWizardDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearWizardDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** A draft is worth offering to restore only once it holds meaningful progress. */
export function draftHasProgress(draft: WizardDraft | null): boolean {
  if (!draft) return false;
  const name = (draft.eventDetails?.name as string) || '';
  return Boolean(draft.activeStep > 0 || draft.selectedPackageId || name.trim() || draft.orderId);
}
