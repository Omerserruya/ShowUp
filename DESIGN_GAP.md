# DESIGN_GAP: ShowUp design v6 ↔ existing system

Source of truth for the design: `RSVP WhatsApp platform design 2/` (Landing v6, Event Signup v2, Platform v6, Mobile Flows).
Status: **קיים** = backed by an existing endpoint/field · **חלקי** = derivable from existing data, or partly supported · **לא קיים** = no backend support.
"מה נעשה" = what was shipped in this round: **נבנה** / **מוסתר (flag)** / **מצב ריק כן** / **הוחלף בנתון אמיתי** / **נדחה**.

No API, DB field or WhatsApp template was added or changed. All mapping lives in the frontend (`src/adapters/`, `src/contexts/SnapshotContext.tsx`).

---

## 0. Decisions taken without asking (you asked me not to stop). Each one is reversible.

| # | Contradiction / open question | What I did | How to change |
|---|---|---|---|
| 0 | ⚠ **"Reminders only go to whoever didn't answer"** (landing, signup, mobile) | **Not true today, for ANY round.** Each stage has a defined audience in `shared/domain/messaging/stage_definitions.py` (reminder → `PENDING_RSVP` = `no_response`, thank-you → `confirmed`, …), but nothing applies it. Only `GET /api/catalog` exposes it. Campaign creation in core, aub `provision_order` (signup) and the Messages page all save `audience = everyone`, and the worker sends to the stored audience. All "only to non-responders / you can target" copy was removed. **Suggested fix (1 place, backend):** in core `POST /campaigns`, when no audience is sent, set it from the stage's `audience_rule` via `resolve_audience_rule`. That covers signup and Messages alike. Not done without approval. | Approve, then restore the copy |
| 1 | **Prices**: landing ₪39/₪99/₪199 vs signup & mobile ₪249/₪449/₪690 | Used the **real** prices from the payment system (`aub-service/app/data/plans.json` = `frontend/src/config/plans.ts`): Basic ₪39 (50 guests, 2 rounds), Plus ₪99 (250, 4), Pro ₪199 (unlimited, 4). The ₪249/449/690 tiers (בסיסית/מלאה/פרימיום) don't exist in the system and are not shown anywhere. | Change plans.json + plans.ts together |
| 2a | Claim: **"החזר מלא תוך 14 יום"** | **Hidden.** Terms §9 say payments are non-refundable unless stated otherwise. Flag `claimRefund14Days` (off). Also removed the old checkout line "ניתן לבטל את ההזמנה עד 48 שעות לפני מועד האירוע" (same conflict). | Update Terms, then `REACT_APP_FF_CLAIM_REFUND_14=1` |
| 2b | Claim: **"וואטסאפ העסקי הרשמי"** | **Kept.** True: messages go out via Meta WhatsApp Cloud API from ShowUp's business number. | n/a |
| 2c | Claim: **"פרטי האשראי לא נשמרים"** | **Kept.** True: payment happens on iCount's hosted PayPage; we only store the sale id and amounts. | n/a |
| 2d | Claim: **"חשבונית נשלחת למייל"** | **Hidden** (flag `claimInvoiceEmail`). iCount issues `invrec`, but email is optional at checkout, so it isn't guaranteed. | Make email required, then flip the flag |
| 2e | Claim: **"שום הודעה לא יוצאת בלי אישור שלכם"** (signup, landing, platform) | **Removed: it is false.** Campaigns are created with a `schedule_time` and the scheduler sends them automatically. Replaced with the true statement: "אתם רואים את לוח השליחה ויכולים לשנות או לעצור כל הודעה". | Needs an approval state on campaigns (backend) |
| 2f | Claim: rounds per plan | Kept, true: Basic 2, Plus/Pro 4 (`shared/domain/rounds.py`). | n/a |
| 3 | **The assistant**: does it exist, and what can it do? | It exists (WhatsApp assistant number → `assistant-worker` → `POST /assistant`, tools in `core-service/app/ai_tools.py`). The landing shows **only** commands that really work: add a guest, how many confirmed, who hasn't answered, who asked for vegetarian (searches notes), change the event time, who read and didn't reply. **Dropped** from the design: "send a reminder to whoever didn't answer" (there's no create-campaign tool, only trigger an existing one) and "import this group" (no group import). | `src/pages/landing/landingContent.ts` |
| 4 | Testimonial + photo are placeholders | **Hidden** (flag `landingTestimonial`, off). The placeholder avatar asset was not copied. | Add a real, approved quote in `Landing.tsx` and flip the flag |
| 5 | "שלחו לי הזמנה לדוגמה" | **Works.** It calls the existing `POST /api/auth/demo/whatsapp` (Meta template `showup_whatsapp_demo`). Copy changed to "הודעה לדוגמה": the template is a marketing demo with "בואו נתחיל / דברו איתי" buttons, not an RSVP invitation, so the sent-state text no longer promises "לחצו על תשובה". | — |

---

## 1. Design tokens / theme

| Item | Status | What was done |
|---|---|---|
| Palette (paper #FAF8F4/#F5F1E9, warm lines, ink #16150F, lavender #C9B8F3 buttons with ink text, purple #5A3DA6 links and highlights) | — | **Built.** `src/design/tokens.ts`, plus the MUI theme rebuilt from it (`shared-theme/themePrimitives.tsx`: brand / gray / status). Contained buttons are lavender with ink text app-wide. Old periwinkle hexes were swept out of 34 files. Buttons that forced a purple background with ink text (a contrast failure) were fixed. |
| No black surfaces | — | Dark scheme now mirrors light. New storage key, so a stale "dark" choice can't paint the app black. |
| Heebo 600 + Material Symbols Rounded | — | Loaded in `public/index.html`. `.ms` icon class in `src/design/global.css`. |
| Contrast ≥ 4.5:1, 44px touch targets | — | Kept in all new components. Hebrew kickers use smaller letter-spacing and 12px text (the design's 10.5px with .2em tracking reads poorly in Hebrew). |
| Assets | — | `public/brand/` holds seal, invite, guest-phone, og-table, compressed from 6.8MB to 0.5MB. |

## 2. Landing (`/`, `src/pages/landing/Landing.tsx`)

| Section / component | Backing | Status | What was done |
|---|---|---|---|
| Glass header + nav, mobile sticky CTA | — | קיים | Built |
| Hero headline, bullets | claims, see §0 | חלקי | Built. The refund bullet is replaced by "משלמים פעם אחת לאירוע" unless the flag is on. |
| "יאללה, מתחילים" form (name, event type, phone) | wizard query params (`fullName`, `phone`, `eventType`) | קיים | Built. It pre-fills the signup. Event types are limited to the real catalog (no אירוסין / חינה: there's no such `event_type`). |
| "שלחו לי הזמנה לדוגמה" | `POST /api/auth/demo/whatsapp` | קיים | Built and working (see §0-5) |
| Animated WhatsApp loop | static | — | Built (respects reduced motion) |
| Marquee "מתאים לכל שמחה" | catalog types | חלקי | Lists supported types only |
| מה מקבלים (4 features) | — | חלקי | Copy adjusted to real capabilities |
| איך זה עובד 01–04 | scheduling.ts wedding: 30d / 7d / 1d / after | קיים | Built. Bullet "אתם מאשרים כל סבב" replaced (§0-2e). |
| העוזר (interactive chips) | ai_tools.py | חלקי | Built with real commands only (§0-3) |
| Pricing + guests slider | plans.ts | קיים | Built with real prices |
| Trust band | — | חלקי | WhatsApp + secure payment kept. Invoice line behind flag. |
| Testimonial | none | לא קיים | **מוסתר (flag)** |
| FAQ | — | חלקי | Built. The refund Q&A only shows with the flag. Contact goes to the existing `/go/whatsapp`. |
| Closing CTA, footer (terms / privacy / accessibility) | existing routes | קיים | Built |
| The design's "permissions" table (לבד / לשאול אותי / לא לשלוח) and "compare" table in `renderVals` | none | לא קיים | Not rendered (the design file doesn't render them either; there are no per-message permissions in the backend) |

## 3. Signup (`/wizard` + `/payment`)

The existing wizard (6 internal steps, all validation, draft autosave, OTP and order logic untouched) now sits in the design's **4-phase shell**: rail with milestones and "ואחרי הפתיחה", "שלב N מתוך 4" headers, sticky footer with back / next and the plan summary, mobile segmented progress.

| Design step / element | Backing | Status | What was done |
|---|---|---|---|
| 1 Package: guest-size segmented control → "מומלצת לכם" | plans.ts | קיים | Built (sizes ≤50 / ≤250 / more, mapped to the real plans) |
| Plan cards with radio, "כולל מע״מ" | plans.ts | קיים | Built (real prices) |
| "בכל החבילות" box | — | חלקי | Built with true items only. Dropped "שום הודעה לא יוצאת בלי אישור", "תמיכה בטלפון" and "החזר מלא". |
| "יותר מ־600 אורחים, מחיר מותאם" | none | לא קיים | Omitted |
| 2 Event type tiles (Material icons) | catalog event_types | קיים | Built. אירוסין / חינה don't exist as types. |
| Couple types (כלה וחתן / חתן וחתן / כלה וכלה) | wizard `subjects.role1/role2` | קיים | The existing per-partner bride/groom toggle already covers all three |
| Opening-line preview "ההזמנה תיפתח כך" | catalog template bodies | חלקי | The existing live WhatsApp preview in the messages step |
| Date, time, venue (Google Places), navigation | event_date, location; nav_link variable | קיים | Existing fields, restyled by the theme |
| "עד מתי מקבלים תשובות" (RSVP deadline) | **no field** | לא קיים | **נדחה.** No `rsvp_deadline` column. The final reminder is placed by the adaptive timeline. |
| Ceremony time, parking text, hall name | no fields | לא קיים | נדחה (would only live in free text) |
| 3 Messages timeline with toggles | `buildAdaptiveTimeline` + catalog | קיים | Existing schedule step (approve-or-customize) inside the new shell |
| Tone picker רשמי / אישי / קצר | catalog variants | חלקי | Existing template / variant chooser. Only **approved** templates are offered (existing deliverability gate). The design's sample wording is a suggestion only and is not sent. |
| Upgrade-to-unlock messages (day-of / thank-you) | plan tiers | חלקי | Existing tier logic (thank-you on Pro) |
| Invitation image upload in step 3 | `POST /api/uploads/*` needs an event_id | חלקי | Not in signup (the event doesn't exist before payment). Available after payment (onboarding dialog, Settings → images). |
| 4 Review + terms | existing | קיים | Restyled. Duplicate banners and emoji heading removed. |
| Payment method picker (card / Bit / Apple Pay) and card fields | iCount hosted PayPage | לא קיים | **מוסתר (flag `signupPaymentMethods`).** We never render card fields; the provider page decides the methods. |
| "יש לכם קוד הנחה?" | coupon endpoints exist; product decision: no coupon on checkout | — | Not shown (previous explicit decision) |
| 5 "האירוע נפתח" + 3 ways to add guests | Payment success → `/overview` | חלקי | Existing success screen. The home page shows the add-guests next step. |

## 4. Platform (desktop, `Layout` + pages)

New shell: `components/shell/SideNav.tsx` (event card, nav with live counts, next-step card, user) and `AppHeader.tsx` (kicker, title, guest search). Data comes from `adapters/eventSnapshot.ts` via `contexts/SnapshotContext.tsx`, which polls every 60s while the tab is visible.

| Screen / component | Backing | Status | What was done |
|---|---|---|---|
| Sidebar counts (מוזמנים · +pending, סבבים, בלי שולחן) | guests, campaigns, guest-imports/summary | קיים | Built |
| "עוד N ימים · X לא ענו" card | derived | חלקי | Built from real data (`computeNextStep`). It never says "waiting for your approval". |
| Notifications bell | **no notifications feed for the web** | לא קיים | **Omitted** (owner notifications go to WhatsApp only) |
| Header search | `GET /api/guests?search=` | קיים | Built (jumps to the guest list) |
| **Home**: "X אנשים כבר אמרו שהם מגיעים", mix bar, expected range | guests (status, guest_count / import_count) | חלקי | **Built.** Expected range = confirmed .. confirmed + "maybe" (no invented projection). |
| Figures: צפי לקייטרינג / לא ענו / בלי שולחן / מנות מיוחדות | — | חלקי | Built. "מנות מיוחדות" replaced by **"עם בקשה מיוחדת"** = confirmed guests with notes (there's no meal field). |
| "מה מחכה לך" decisions | derived (imports, pending, unseated, failed_count, no party size) | חלקי | Built |
| "נכנס עכשיו בוואטסאפ" feed | guests.last_response + notes | קיים | Built |
| Rounds table (sent to / answered / status) | campaigns + stats (no template codes shown) | קיים | Built |
| **Insights** (`/insights`, new route) | | | |
| – Cumulative confirmations curve | `GET /api/guests/daily-responses?period=month` | קיים | Built (actual data, **no projection line**) |
| – Venue target line "מה שסיכמנו עם האולם" | **no field** | לא קיים | Omitted |
| – "מה כדאי לעשות" | derived | חלקי | Built |
| – Meals for catering, "שליחה לקייטרינג" | **no meal field** (free-text notes only) | לא קיים | **הוחלף:** "מה ביקשו האורחים" lists real notes. Meal counts behind flag `insightsMeals`. No caterer send. |
| – "למי כדאי להתקשר" | "maybe", confirmed without party size, opted-out | חלקי | Built (tel: links). "Read but didn't reply" per guest isn't exposed by REST. |
| – By group: reply rate, % seated | guests.group, table_number | קיים | Built |
| **Guests**: filters with counts, table, bulk bar | existing page | קיים | Restyled (design chips/pills, title moved to the header) |
| **Pending WhatsApp contacts**: approve / edit / dismiss / approve all | `/api/guest-imports` (approve, reject, update) | קיים | **Built** (`components/v6/PendingImportsPanel.tsx`): inline edit (name, phone, party size, group), phone checks (missing digits / foreign number), approve-all skips broken numbers. "Who shared it" (את / עומר שלח) isn't stored → shows the time only. |
| **Campaigns**: 3-step new round (message → audience → when) | existing Messages page (catalog, audiences, rounds-status, 402 extra round) | קיים | Kept functionally. Title moved to the header, buttons lavender. Template codes and read counts are not shown in new UI. |
| – "שליחת בדיקה אליי" | no test-send endpoint | לא קיים | Not added |
| – Waves "גל שני אוטומטי / שיחה אישית" | `follow_up_after_hours` (single follow-up) | חלקי | Existing follow-up only |
| – Sending hours "09:00–20:00, לא בשבת" | not configurable | לא קיים | Not claimed |
| **Seating (desktop)**: hall map, unseated list | `events.seating_layout` + guests.table_number | קיים | Existing ReactFlow map, re-themed |
| – "שיבוץ אוטומטי" | none | לא קיים | **מוסתר (flag `seatingAutoAssign`)** (not added) |
| – Conflict hints ("סבתא ביקשה ליד הבמה") | none | לא קיים | Omitted |
| **Settings**: event details group | `PUT /api/events/{id}` (name, event_date, location) | קיים | **Built** (new "פרטי האירוע" tab, default) |
| – WhatsApp connection (number, display name, hours, unknown replies → me) | not configurable per event | לא קיים | **מוסתר (flag `settingsWhatsAppSender`)** |
| – "מה שואלים אחרי אישור" toggles | RSVP flow is fixed in webhook-worker | לא קיים | **מוסתר (flag `settingsConversationQuestions`)** |
| – Team with roles | `/api/members` | קיים | Existing Team tab |
| Invitation web page, Recap | existing | קיים | Kept (not in the design), reachable from the nav |

## 5. Mobile (`< md`)

| Flow (Mobile Flows) | Status | What was done |
|---|---|---|
| Tab bar בית / מוזמנים / שליחה / שולחנות (+ עוד sheet with event switcher) | קיים | **Built** (`shell/MobileNav.tsx`) |
| 00 Signup on mobile | קיים | Same wizard: compact segmented progress, sticky footer, full-width tiles |
| 01 Login / OTP | קיים | Existing OTP flow. Primary button is now solid lavender + ink. |
| 01 "שכפול מאירוע קודם" | `POST /api/events/{id}/clone` exists | חלקי | Not surfaced in the new UI yet (נדחה) |
| 01 Pick contacts from the phone book | Contact Picker API not implemented | לא קיים | נדחה |
| 01 Registration link for guests | public invite `/i/:slug` | חלקי | Existing invitation page |
| 02 Home: stat, "מה מחכה לך", replied lately | קיים | Same home page (responsive) |
| 02 Notifications screen | לא קיים | Omitted |
| 03 Guest list, filters, pending approval | קיים | Responsive guests page + pending panel |
| 05 Seating as a **list with fill bars** (tap a name, then a table; open a table; remove; new table) | קיים | **Built** (`pages/SeatingList.tsx`, used under 700px). Shape "אבירים", "איפה באולם" and auto-assign omitted. |
| 06 Insights, call list, send to caterer | חלקי | Insights page is responsive. No caterer send. |
| 07 Settings | חלקי | Responsive settings (same flags as desktop) |
| 08 Fix a wrong number + resend | חלקי | Failed count shown on home. Per-guest failure isn't exposed, so there's no guided fix. |
| 08 Offline banner | לא קיים | נדחה |

## 6. WhatsApp templates

No new template is sent. All sends still go through the existing approved catalog and deliverability gate. Wording that appears only in the design (tones, day-of message with a table number, thank-you text) is **a proposal only**. To use it, it must be added to `shared/domain/messaging` and approved on Meta.

## 7. Feature flags (`frontend/src/config/featureFlags.ts`, build-time `REACT_APP_FF_*`)

| Flag | Default | Hides |
|---|---|---|
| `landingTestimonial` | off | Landing testimonial + photo (placeholder in the design) |
| `claimRefund14Days` | off | "החזר מלא תוך 14 יום" in hero, pricing, FAQ, CTA |
| `claimInvoiceEmail` | off | "חשבונית נשלחת למייל" |
| `signupPaymentMethods` | off | Card / Bit / Apple Pay picker and card fields |
| `insightsMeals` | off | Meal counts for the caterer |
| `seatingAutoAssign` | off | Auto-seating |
| `settingsConversationQuestions` | off | Post-RSVP question toggles |
| `settingsWhatsAppSender` | off | Sender name / hours settings |

The admin `feature_flags` table exists, but nothing in the app can read it (admin-only API). If you want runtime toggles, a public read endpoint is needed (backend change, not done).

## 8. Known limits / follow-ups

- `npm run build` passes (2026-10-05) when `frontend-dev` is stopped first: the host has 3 GB RAM and the dev server uses ~1.5 GB. Use `GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=2560`. Main bundle is 634 kB gzip (code-splitting recommended).
- The previous landing components (`Hero`, `Pricing`, `FAQ`, `HowItWorks`…) are no longer mounted but remain on disk. They still contain the unverified 14-day claim. Delete them when convenient.
- Guests stats endpoint mixes units (records vs. headcount). The adapter recomputes from raw guests to stay consistent.
