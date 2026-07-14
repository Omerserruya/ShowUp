/**
 * Plan entitlements - RETIRED as a feature gate, kept as a compatibility shim.
 *
 * Business model (2026-07): plans differ ONLY by numeric limits -
 *   1. guest capacity  (plan `count_limit`, enforced server-side)
 *   2. campaign rounds (included rounds per plan, enforced server-side)
 *
 * Every plan includes the FULL product: AI assistant, WhatsApp campaigns,
 * contact import, guest management, dashboards, invitation builder, seating,
 * tags, custom fields, analytics - everything. Nothing in the UI should lock,
 * dim, or upsell a feature; upsells are about event size and message rounds
 * only (see the Billing plan picker and the extra-round purchase dialog).
 *
 * `hasFeature` therefore always returns true. The type and helpers remain so
 * stray imports keep compiling; do not add new gating on top of them.
 */

export type Feature =
  | 'dashboard'
  | 'csv_export'
  | 'web_invitation'
  | 'invitation_customization'
  | 'whatsapp_campaigns'
  | 'templates'
  | 'advanced_scheduling'
  | 'tags'
  | 'custom_fields'
  | 'seating'
  | 'team_members'
  | 'ai_assistant'
  | 'read_analytics'
  | 'sms_campaigns'
  | 'custom_domain';

// Canonical plan / edition ids. Editions still exist commercially (price,
// guest cap, included rounds) - they just no longer gate features.
export const PLAN_STARTER = 'starter';
export const PLAN_VENUE = 'venue';

/** Always true - features are not plan-gated anymore. */
export const hasFeature = (_planId: string | null | undefined, _feature: Feature): boolean => true;

/** Purchasable tiers, cheapest first (must mirror `plans.ts`). */
export const PURCHASABLE_TIERS = ['basic', 'plus', 'pro'] as const;
export type PurchasableTier = (typeof PURCHASABLE_TIERS)[number];

/** No feature is ever lost when switching plans - only limits change. */
export const featuresLostOnSwitch = (
  _fromPlanId: string | null | undefined,
  _toPlanId: string,
): Feature[] => [];
