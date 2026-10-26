/**
 * Frontend feature flags for the design-v6 rollout.
 *
 * Every element of the new design that has no real backing in the system (or
 * whose marketing claim is not yet verified) sits behind one of these flags.
 * Flags default to the SAFE value: off unless the capability/claim is verified.
 * Override per environment with REACT_APP_FF_<NAME>=1|0 at build time.
 *
 * The full list, and why each flag exists, is documented in DESIGN_GAP.md.
 */

const env = (name: string): boolean | undefined => {
  const v = (process.env as Record<string, string | undefined>)[`REACT_APP_FF_${name}`];
  if (v === undefined || v === '') return undefined;
  return v === '1' || v.toLowerCase() === 'true';
};

const flag = (name: string, fallback: boolean) => env(name) ?? fallback;

export const featureFlags = {
  /** Landing: customer testimonial + photo. The design ships a placeholder
   *  quote ("שם הלקוחה"); never show it until a real, approved testimonial exists. */
  landingTestimonial: flag('LANDING_TESTIMONIAL', false),

  /** Marketing claim: "full refund within 14 days". Terms §9 currently say
   *  payments are non-refundable unless stated otherwise. Needs a business
   *  decision + Terms update before it may be shown. */
  claimRefund14Days: flag('CLAIM_REFUND_14', false),

  /** Marketing claim: "tax invoice is emailed after payment". iCount can issue
   *  it, but email is optional at checkout, so the promise isn't guaranteed. */
  claimInvoiceEmail: flag('CLAIM_INVOICE_EMAIL', false),

  /** Signup step 4: Bit / Apple Pay method picker. The payment provider page
   *  (iCount hosted) decides the methods; we don't render card fields ourselves. */
  signupPaymentMethods: flag('SIGNUP_PAYMENT_METHODS', false),

  /** Platform: "insights" (תמונת מצב) caterer/meals block. No meal-choice
   *  field is captured from WhatsApp, so meal counts can't be computed. */
  insightsMeals: flag('INSIGHTS_MEALS', false),

  /** Platform: seating "auto-assign" button. No backend auto-seating exists. */
  seatingAutoAssign: flag('SEATING_AUTO_ASSIGN', false),

  /** Settings: "what we ask after RSVP" toggles (party size / companions /
   *  meal / shuttle). The RSVP conversation flow isn't configurable per event. */
  settingsConversationQuestions: flag('SETTINGS_CONVERSATION_QUESTIONS', false),

  /** Wizard: "write your own message". A free-text first-contact message is
   *  rejected by Meta (no 24h window) and core ignores custom_message on
   *  outbound campaigns unless ALLOW_CUSTOM_MESSAGE_CAMPAIGNS=1. */
  customMessages: flag('CUSTOM_MESSAGES', false),

  /** Settings: per-event sending hours / sender display name. Not configurable. */
  settingsWhatsAppSender: flag('SETTINGS_WA_SENDER', false),
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export const isOn = (f: FeatureFlag) => featureFlags[f];
