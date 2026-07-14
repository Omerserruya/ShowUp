import { useEvent } from '../contexts/EventContext';
import { PLAN_STARTER, PLAN_VENUE } from '../config/entitlements';

// NOTE: feature gating was removed (plans differ only by guest capacity and
// campaign rounds - every plan includes the full product). These hooks remain
// for plan *identity* display (PlanBadge, Billing), not for locking features.

/** The plan id of the currently-selected event (or null if none/unknown). */
export function usePlanId(): string | null {
  const { selectedEvent } = useEvent();
  return (selectedEvent as any)?.planId ?? (selectedEvent as any)?.plan_id ?? null;
}

/** True when the current event is on the couple's included Starter plan. */
export function useIsStarter(): boolean {
  return (usePlanId() || '').toLowerCase() === PLAN_STARTER;
}

/** True when the current event is Venue Edition (access granted by a partner venue). */
export function useIsVenue(): boolean {
  return (usePlanId() || '').toLowerCase() === PLAN_VENUE;
}

/** The partner venue's name for the current event, or null (drives "Provided by <Venue>"). */
export function useVenueName(): string | null {
  const { selectedEvent } = useEvent();
  return (selectedEvent as any)?.venueName ?? (selectedEvent as any)?.venue_name ?? null;
}
