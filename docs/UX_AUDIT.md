# ShowUp — Master UX/UI Audit & Redesign

**Reviewed against the actual codebase** (`frontend/` React 18 + MUI 5, RTL Hebrew; `core-service` FastAPI + workers), not assumptions.
**Date:** 2026-06-13 · **Primary user:** wedding couples, B'nai Mitzvah parents, family/small-event organizers — non-technical.

---

## 0. What actually exists today (ground truth)

**Stack:** React 18, MUI v5 (the stock MUI *dashboard* + *marketing/checkout* templates), Redux Toolkit, react-router 7. App is forced RTL (`document.documentElement.setAttribute('dir','rtl')`), font `Noto Sans Hebrew`, brand = MUI default blue `hsl(210,98%,48%)`, radius 8. `reactflow` is installed but there is no visual builder route; `aws-architecture-visualizer.tsx` (866 lines) is leftover template demo code.

**Routes that exist** (`src/App.tsx`):

| Route | Screen | Notes |
|---|---|---|
| `/` | MarketingPage | Hero, Features, Pricing, FAQ, Testimonials |
| `/wizard` | EventWizard | 6 steps incl. **payment** |
| `/payment` | Payment | |
| `/login`, `/register` | phone + 6-digit OTP | passwordless |
| `/overview` | Dashboard | countdown, 4 stat cards, pie, recent |
| `/guests`, `/guests/imported` | Guest list / WhatsApp-bot approval | |
| `/messages` | Campaigns ("message rounds") | |
| `/seating` | Seating chart (1,569 LOC) | not in brief, but shipped |
| `/profile` | Profile | |
| `/admin/users`, `/admin/events` | Admin | `/admin/purchases` & `/admin/settings` = "בקרוב" stubs |

**Backend capabilities that have NO UI:** role/permission management (`authz.py` — `Role.OWNER`, `Membership`, `Account` tenancy), the **AI assistant** (`assistant.py` + `ai_tools.py` exist; only referenced in *marketing* copy), template approval lifecycle, usage/quota dashboards (`usage.py`: guests + rounds are customer limits, messages internal-only — exactly the right model, but invisible to users), custom-fields management, tags management, timeline/audit.

**The single biggest structural problem:** the backend is a mature multi-tenant SaaS; the frontend is a single-owner MVP wearing a stock admin template. The audit below is mostly about closing that gap *simply*, without exposing the machinery.

---

# PHASE 1 — Full Product Audit

## 1.1 Authentication — **Grade: B**
Passwordless phone + 6-digit OTP (`Login.tsx`, `Register.tsx`). Good choice for this audience: no passwords to forget, phone is the identity that matters for WhatsApp RSVP.

**Friction & gaps:**
- **Duplicated 200+ lines** of OTP logic across Login and Register (paste handling, LTR-forcing, per-digit refs). One `<PhoneOtpForm>` component.
- **No "resend code" timer / cooldown** surfaced — only an error path (`otp_expired_or_missing`). Users will stare at a dead screen.
- **No channel clarity:** the screen says "קוד OTP נשלח" but never says *where* (SMS? WhatsApp?). For non-technical users, "check your WhatsApp" vs "check your texts" matters.
- **Login and Register are nearly identical but separate** — a user who mistypes their status bounces between two URLs. Merge into one "Continue with phone" entry that auto-detects new vs returning.
- **Email is collected at register but optional** and never used for auth — decide if it earns its field.
- **Missing states:** rate-limit lockout, invalid-phone-format inline help (international format is *required* per wizard validation but not explained up front), "this number isn't registered" → offer to register inline.

## 1.2 Onboarding — **Grade: D (conversion killer)**
There is no onboarding. **The first-run experience IS the 6-step wizard, and step 6 is payment.** A brand-new visitor must choose a paid package and pay *before ever seeing a guest list, a dashboard, or sending anything.* Time-to-value = after a credit card.

This is the #1 thing to fix. Wedding couples comparison-shop and abandon. There is no free state, no sample event, no "see it work first."

**Ideal onboarding:**
1. Phone OTP → land in a **pre-seeded demo event** ("רותם & דניאל - חתונה לדוגמה") with 8 fake guests already showing confirmed/pending so the dashboard is *alive* on first paint.
2. One contextual nudge: *"זה האירוע שלך? בוא נבנה אותו ב-2 דקות"* → launches the real wizard.
3. **First success moment = sending a test invite to your own phone** (free, instant, emotional). Gate payment at the moment of *real* send-to-guests, not at signup.
4. Defer package choice until the user knows their guest count (the wizard asks for the event before it knows the audience — package-first is backwards).

## 1.3 Event Creation Wizard — **Grade: C**
Current 6 steps (`EventWizard.tsx:250`): **חבילה (Package) → אירוע (Event) → תזמון (Schedule) → תבניות (Templates) → אישור (Summary) → תשלום (Payment)**, 2,074 LOC in one file.

**Problems:**
- **Package first** forces a buying decision before the user has described the event. Reverse it.
- **6 steps with payment embedded** is a checkout, not an event setup. Split "create event" (free, instant) from "buy capacity" (only when sending).
- **Schedule step exposes campaign timing** during creation — premature. Smart-default it (Invite now-ish, reminder +48h, final +1 week) and let them tune later in Messages.
- **Template step** asks for "tone/style" — good instinct, but it's a 4th decision in a flow that should have ~2.

**Ideal wizard (3 light steps, payment removed):**
```
Step 1 · מה חוגגים?     [חתונה] [בר/בת מצווה] [ברית] [אירוע חברה] [אחר]
Step 2 · פרטים          שם האירוע* · תאריך · שעה · מיקום (Google Places)
Step 3 · ההזמנה         live WhatsApp preview, tone picker, "שלח לעצמי לבדיקה"
                        → "האירוע מוכן! בוא נוסיף אורחים"
```
Everything else (rounds, package) becomes smart defaults editable later. Required fields: event name + type only. Date/time/location already optional in code — keep it.

## 1.4 Guest Import — **Grade: C− (most confusing surface)**
Two *unrelated* things are conflated under "guests":
- **File import** (`Guests.tsx` modal): download our template (`תבנית_ייבוא_אורחים.xlsx`) → upload matching file → bulk POST. **There is no column-mapping screen and no pre-commit validation/preview.** If the user's columns don't match our template, it just fails (`'שגיאה בייבוא האורחים'`).
- **WhatsApp-bot capture** (`ImportedGuestsReviewScreen` = "אישור אורחים מווטסאפ"): per-contact `validation_errors`, approve/reject, bulk approve. This *is* a good validation UX — but it only exists for the bot path, not for files.

**Missing (the brief's requirements):** mapping screen, validation/preview before commit, duplicate detection/merge, row-level error correction, success summary ("נוספו 142, דולגו 3 כפולים, 2 דורשים תיקון"). Google Sheets / paste-a-list / paste-from-WhatsApp-contacts are not real import paths.

**Ideal import:** one "הוסף אורחים" entry → choose source (Excel/CSV · הדבק רשימה · WhatsApp) → **auto-map columns with a confirm screen** (we guess שם/טלפון, user fixes) → **preview grid with inline errors + dup flags** → confirm → success toast with counts. Reuse the existing approval-grid pattern for *all* sources.

## 1.5 Dashboard (Overview) — **Grade: B−**
Has: countdown, 4 stat cards (אישרו / ביטלו / טרם הגיבו / סה״כ מוזמנים), response pie, recent responders. Mobile-first (countdown first on `xs`). Clean, not dense — good.

**Doesn't answer two of the brief's five questions:** *"What campaign is active?"* and *"What needs my attention?"* Add: an **"דורש תשומת לב"** strip (e.g., "37 אורחים לא הגיבו 3 ימים — שלח תזכורת?" with a 1-tap action) and a **current-round status** chip ("סבב 2 נשלח אתמול · 64% פתחו"). Make each stat card a filter link into `/guests?filter=pending` (the route already supports it).

## 1.6 Guest Management — **Grade: B**
3,500-LOC `Guests.tsx`: paginated server-side table, status filter (all/confirmed/declined/pending), groups, notes, CSV/XLSX export, RSVPTable, delete. Status filter via URL param is nice.

**Gaps vs brief:** tags and custom fields exist in the backend but aren't here; **bulk actions** are thin (delete only — no bulk tag, bulk re-invite, bulk move-to-group); no per-guest **timeline** (invited → opened → replied → reminded); search is global, not a fast guest filter. The table is dense on mobile — needs a card layout < `sm`.

## 1.7 Campaigns (Messages) — **Grade: B (best-aligned screen)**
`Messages.tsx` already speaks human: "סבבי הודעות" (message rounds), status pending/scheduled/sent/paused, edit/send-now/pause/resume/delete, stats (approved/declined/read, response rate). It does **not** leak `audience_filter`/`trigger_type`/`follow_up_after_hours` into the UI — good.

**To finish the brief's vision,** make rounds read as a narrative, not a list:
```
סבב 1 · ההזמנה              ✅ נשלח · 64% הגיבו
סבב 2 · תזכורת למי שלא הגיב   ⏰ מתוזמן למחר · ~37 אורחים
סבב 3 · תזכורת אחרונה        ➕ הוסף
```
"מי שלא הגיב" is the human label for `audience_filter`; "מחר" hides `follow_up_after_hours`. Add a per-round audience *count preview* before send ("יישלח ל-37 אורחים").

## 1.8 Templates — **Grade: D (UI mostly absent)**
Only surface is the wizard "style" picker. No standalone manager, no Meta approval-status visibility, no editing after creation. Backend has lifecycle; users can't see "ממתין לאישור מטא / מאושר / נדחה." Needed: a simple template gallery with status pills and a plain-language explainer ("WhatsApp בודקת את ההודעה — בדרך כלל עד 24 שעות"). Never say "HSM"/"Meta template category."

## 1.9 Team Management — **Grade: F (no UI)**
`authz.py` has roles + `Membership` + `Account` tenancy. The frontend has zero team UI. For this audience, expose only **2–3 human roles**: *בעל/ת האירוע* (full), *שותף/ה לתכנון* (edit, no billing), *צופה* (read-only). Hide Manager/Editor/Viewer/Coordinator jargon. Invite by phone number, accept via OTP.

## 1.10 Billing — **Grade: D**
`/payment` (wizard checkout) + admin "בקרוב" stub. `usage.py` correctly meters **guests + rounds** as customer limits and **messages internally only** — the model is right, but users can't see usage. Needed: a usage card ("142 / 250 אורחים · סבב 2 מתוך 3") and a frictionless upgrade when they hit a wall *mid-task*, not a separate billing area. Never show "messages."

## 1.11 AI Assistant — **Grade: F (marketed, not built)**
`assistant.py` + `ai_tools.py` exist; "AI" appears only in `Hero`/`Features`/`Highlights` marketing. There is **no in-app assistant UI** and no clear hook into the WhatsApp RSVP states for the *organizer's* assistant. This is a promised feature that doesn't exist for users — either build the thin chat surface or stop advertising it. (Design in Phase 2 / Phase 4.)

---

# PHASE 2 — Screen Inventory

Legend: ✅ exists · 🟡 partial · ❌ missing

### Auth
| Screen | State | Purpose / Primary action | Empty | Error |
|---|---|---|---|---|
| Phone entry | 🟡 split L/R | Identify by phone → send OTP | — | invalid phone, not-registered→register |
| OTP verify | ✅ | 6-digit verify | — | expired, wrong (n tries left), **resend timer ❌** |
| Invite accept | ❌ | Join an event by invite link/phone | — | expired invite |

### Onboarding
| Demo event | ❌ | Show value pre-payment | seeded sample | — |
| Send-test-to-self | ❌ | First success moment | — | send fail |

### Events
| Wizard (3-step) | 🟡 6-step+pay | Create event | — | per-field |
| Event switcher | 🟡 context only | Change active event | "צור אירוע ראשון" | — |
| Event settings | 🟡 in wizard | Edit details after creation | — | — |

### Guests
| Guest list | ✅ | View/filter/search | "הוסף את האורח הראשון" 🟡 | load fail |
| Add guest (manual) | 🟡 | Quick add | — | dup phone |
| Import: source picker | ❌ | Choose Excel/paste/WA | — | — |
| Import: column map | ❌ | Confirm mapping | — | unmapped required |
| Import: validate/preview | 🟡 (bot only) | Fix errors, flag dups | "no errors" ✅ | row errors |
| Import: success | 🟡 | Counts summary | — | — |
| Guest detail + timeline | ❌ | History, edit, RSVP | — | — |

### Campaigns
| Rounds overview | ✅ | Narrative of rounds | intro card ✅ | load fail |
| Round editor | ✅ (dialog) | Edit content/timing | — | save fail (alert→toast) |
| Audience preview | ❌ | "יישלח ל-N" before send | — | — |
| Campaign analytics | 🟡 basic | Open/response funnel | — | no-data |

### Templates
| Gallery + status | ❌ | Browse/select | "צור תבנית" | rejected reason |
| Editor + live preview | 🟡 wizard | Edit message | — | var errors |

### Team / Billing / AI
| Members | ❌ | Invite/role | "הזמן שותף" | — |
| Usage & plan | 🟡 admin stub | See limits, upgrade | — | payment fail |
| AI assistant panel | ❌ | Ask/act | starters | — |

### Admin
| Users ✅ · Events ✅ · Purchases ❌(stub) · Settings ❌(stub) |

---

# PHASE 3 — User Flows (with friction)

**1. New user → first campaign sent**
`/` → choose plan → **PAY** → wizard → guests → send. **Friction: payment before value.**
→ *Fix:* OTP → demo → real wizard (free) → import → **send test free** → pay only at real send.

**2. Create event → import → launch**
Wizard(6) → Guests → import modal (template-match, may fail silently) → Messages → send.
→ *Fix:* 3-step wizard; guided import with mapping+preview; round narrative with audience count.

**3. Add guest manually** — exists but buried behind import modal logic. *Fix:* persistent "+ הוסף אורח" with phone-dup check inline.

**4. Team invite** — **no flow.** *Fix:* Members → invite by phone → invitee OTP → role-scoped landing.

**5. Template approval** — **no visible flow.** *Fix:* create → "ממתין לאישור" pill → push/toast on approve/reject with plain reason.

**6. AI assistant** — **no flow.** *Fix:* dashboard FAB → starters ("מי עוד לא הגיב?", "שלח תזכורת לכולם") → assistant calls existing `ai_tools` → shows result + confirm action.

**7. Upgrade** — only via initial checkout. *Fix:* hit limit mid-task → inline sheet "הגעת ל-250 אורחים · שדרג" → pay → continue in place.

**8. Export** — exists (CSV/XLSX in `Guests.tsx`). Good; add "export filtered view" and respect current filter.

---

# PHASE 4 — Wireframes (low-fi, RTL)

**Login (unified)**
```
            [ShowUp לוגו]
        הזן מספר טלפון להמשך
   ┌───────────────────────────┐
   │ 📱  +972 5x-xxx-xxxx       │
   └───────────────────────────┘
        [   המשך   ]
   נשלח קוד אימות ל-WhatsApp שלך
```
**OTP**
```
   הזן את הקוד שנשלח ל-WhatsApp
        [_][_][_][_][_][_]
     שלח שוב קוד (00:24)   ← timer
```
**Dashboard**
```
┌─ דורש תשומת לב ───────────────────────────┐
│ ⚠ 37 אורחים לא הגיבו · [שלח תזכורת]        │
└────────────────────────────────────────────┘
[142 מוזמנים] [88 אישרו] [12 ביטלו] [37 טרם]   ← each = filter link
┌── ⏱ עוד 34 ימים ───┐ ┌── סבב פעיל ─────────┐
│  חתונת רותם & דניאל │ │ סבב 2 · 64% הגיבו   │
└────────────────────┘ └─────────────────────┘
[תרשים תגובות]              [אורחים אחרונים שענו]
```
**Guest List (desktop table / mobile cards)**
```
אורחים   🔎[חיפוש]  [הכל|אישרו|ביטלו|טרם]   [+ הוסף] [⬆ ייבוא] [⬇ ייצוא]
☐ שם            טלפון         סטטוס     קבוצה    [⋯]
☐ דוד כהן       972-50-...    🟢 אישר   משפחה
─ bulk bar: [תייג] [שלח תזכורת] [העבר לקבוצה] [מחק]
```
**Import (mapping → preview)**
```
התאמת עמודות                     תצוגה מקדימה (142 שורות)
הקובץ שלך → השדה שלנו            ✓ 137 תקין · ⚠ 3 כפולים · ✗ 2 חסר טלפון
[Name]    → [שם ▾]               דוד כהן | 972.. | ✓
[Mobile]  → [טלפון ▾]            רות לוי | —    | ✗ חסר טלפון [תקן]
[+ התעלם מעמודה]                 [אשר וייבא 140]
```
**Campaign Builder (narrative)**
```
סבבי הודעות לאירוע
① ההזמנה            ✅ נשלח · 64% הגיבו        [צפה]
② תזכורת ללא-מגיבים  ⏰ מחר 10:00 · ~37 אורחים  [ערוך]
③ תזכורת אחרונה      ➕ הוסף סבב
                                   [+ צור סבב חדש]
```
**Template Manager**
```
תבניות   [+ חדשה]
┌ הזמנה קלאסית ─ 🟢 מאושר ──┐ ┌ תזכורת ─ 🟡 ממתין לאישור ┐
│ "שלום {{שם}}, הוזמנת..." │ │ WhatsApp בודקת ~24 שעות  │
└───────────────[ערוך]────┘ └──────────────────────────┘
```
**Team**
```
חברי צוות   [+ הזמן שותף]
דוד (את/ה)        בעל/ת האירוע
רותם 972-52..     שותף/ה לתכנון  [▾ שנה] [הסר]
הזמנה ממתינה: 972-54..  ⏳
```
**Billing / Usage**
```
החבילה שלך · פרימיום
אורחים  ████████░░ 142/250        סבבים ███░░ 2/3
[שדרג חבילה]                       היסטוריית רכישות →
```
**AI Assistant (drawer)**
```
🎉 העוזר של ShowUp
"היי! אני כאן לעזור עם החתונה שלך 💍"
[מי עוד לא הגיב?] [שלח תזכורת לכולם] [כמה אישרו?]
┌ chat ─────────────────────────────┐
│ ...                                │
└───────────────[הקלד הודעה…]──[↑]──┘
```
**Mobile Dashboard / Guest List**
```
☰  חתונת רותם   🔔     │  אורחים        🔎 +
⏱ עוד 34 ימים          │ ┌────────────────────┐
[88✅][37⏳][12✖]      │ │ דוד כהן   🟢 אישר   │
⚠ 37 לא הגיבו [תזכורת] │ │ 972-50-1234567      │
[פאי תגובות]           │ └────────────────────┘
```

---

# PHASE 5 — Design System

The current theme is the **stock MUI template** — exactly the "generic admin dashboard" the brief says to avoid. Keep MUI (don't rewrite), but **re-skin into a warm, celebratory, premium identity.**

**Colors** (move off default MUI blue toward an event/celebration palette):
- Primary `#6D28D9` (deep violet — premium, celebratory, not corporate-blue) · light `#A78BFA` · dark `#4C1D95`
- Secondary / accent `#EC4899` (warm pink) for emotional/CTA moments
- Success `#16A34A` · Warning `#F59E0B` · Danger `#DC2626` · Info `#2563EB`
- Neutrals: keep the gray ramp; backgrounds `#FFFFFF` / `#FAF8FF` (faint violet tint)

**Typography:** keep `Noto Sans Hebrew` (correct for RTL). Tighten scale — current h1 48 / body 14 is fine; add a `display` 56–64 for emotional moments (countdown, success). Numerals in stat cards → 32–40, weight 700.

**Components (premium spec):**
- **Buttons:** filled primary (gradient violet→pink on hero CTAs only), radius 10, 44px min touch target, subtle press scale.
- **Inputs:** filled, 12px radius, RTL-correct icon side, clear inline error + helper.
- **Tables → responsive:** DataGrid on desktop, **card list < `sm`** (current dense table breaks on phones).
- **Cards:** soft shadow (`baseShadow` exists), 16px radius for hero cards, hover lift.
- **Modals → drawers on mobile:** import/edit should be bottom sheets on phone, not centered dialogs.
- **Toasts:** replace the `alert()` and `window.confirm()` calls in `Messages.tsx`/`Guests.tsx` with the existing `Toast` component — native alerts are the loudest "not premium" signal in the app.
- **Empty states:** illustrated, single CTA, encouraging copy ("עדיין אין אורחים — בוא נוסיף את הראשון 🎉").
- **Confetti / micro-delight** on first guest confirmed and on first campaign sent.

**Reference bar:** Stripe (calm density), Linear (speed/keyboard), Notion (friendly empty states), HubSpot (guided setup). Right now we're at "MUI demo."

---

# PHASE 6 — Conversion & Retention

**Drop-off risks (ranked):**
1. **Pay-before-value wizard** — highest. Move payment to point-of-send. *(biggest single conversion lever in the product)*
2. **Package-first decision** before guest count is known → analysis paralysis.
3. **Silent import failures** → user gives up after one bad upload.
4. **OTP dead-end** (no resend timer) → abandoned signup.
5. **`alert()` errors** → feels broken/unsafe with money involved.

**Discoverability gaps:** AI assistant (built backend, invisible), tags/custom fields, team invites, template status — all hidden. Surface via dashboard "next best action" cards.

**Upgrade opportunities:** contextual mid-task upgrade at guest/round limits (using `usage.would_exceed`) beats a billing page. Show usage proactively at 80%.

**Retention:** event lifecycle has a natural end (the event) — retention = **multi-event** ("צור אירוע נוסף" + reusable templates/guest groups across events) and **post-event value** (thank-you round, attendance recap, "ייצא רשימת מתנות"). None exist today.

---

# PHASE 7 — Mobile

App is responsive-aware (`xs/sm/md`, mobile countdown-first) — better than most. But:
- **`Guests.tsx` table** (3,500 LOC) is desktop-first; needs the card layout < `sm`.
- **Centered dialogs** (import, edit campaign, send-now) should be **bottom sheets** on phone.
- **EventWizard** (6 steps) is brutal on mobile — the 3-step redesign helps most here.
- **Seating** (`reactflow`-style canvas, 1,569 LOC) is near-unusable on a phone — needs a simplified mobile read-only/zoom mode.
- **OTP paste** handling exists (good); ensure numeric keypad + `autocomplete="one-time-code"`.
- Touch targets: several icon buttons < 44px.
Given the audience manages events *on their phone at a venue*, mobile parity for guests + campaigns + dashboard is non-negotiable; seating can stay desktop-primary.

---

# PHASE 8 — Final Panel Review (brutally honest)

**Product Designer:** "Solid bones, generic skin. It looks like every MUI starter. The campaign 'rounds' model is genuinely good. The wizard is a checkout pretending to be onboarding."
**Event Organizer:** "I'd panic that I have to pay before I even see if it works. I just want to upload my guest list from WhatsApp and chase the people who ignore me."
**Wedding Planner:** "No way to invite my couple as collaborators. No template status — I won't know if my invite is approved the week of the wedding."
**SaaS Founder:** "You built a multi-tenant, metered, AI-tooled backend and shipped a single-user MVP UI on top. You're underselling your own product and advertising an AI assistant that has no UI."
**UX Researcher:** "Two destructive `alert()`/`confirm()` dialogs, silent import failures, and no resend-OTP timer would each show up in the first 3 user tests."

### Critical (fix before beta)
1. **Remove payment from first-run.** Demo + free test-send; pay at real send / at limit.
2. **Import that can't silently fail** — mapping + validation/preview + dup handling for *file* sources (reuse the WhatsApp approval grid).
3. **Replace all `alert()`/`window.confirm()`** with Toast + proper dialogs.
4. **OTP resend timer** + channel clarity.
5. **Dashboard "needs attention" + active-round** so the home screen drives action.

### Important (before launch)
6. Re-skin off stock MUI into the celebratory identity (Phase 5).
7. Team/members UI (2–3 human roles).
8. Template manager with plain-language Meta status.
9. Build the AI assistant surface (or stop marketing it).
10. Mobile card layout for guests + bottom-sheet dialogs.
11. Usage/upgrade surfaced contextually.

### Nice to have
Guest timeline, bulk tag/group actions, multi-event reuse, post-event recap, keyboard shortcuts, confetti micro-delight.

### Missing features (backend exists, UI doesn't)
Roles/team · AI assistant · templates lifecycle · usage dashboard · tags · custom fields · timeline/audit · invite-accept flow.

### Competitive advantages (lean into these)
WhatsApp-native RSVP + bot guest capture (rare and genuinely valuable), the human "rounds" campaign model, passwordless phone auth, AI tooling backend, RTL/Hebrew-first, seating built-in.

### Scorecard (/10)
| Category | Score | Note |
|---|---|---|
| Simplicity | 6 | Good ideas, wizard & import over-complicate |
| Learnability | 5 | No onboarding; hidden features |
| UX | 5 | Stock template, `alert()`s, silent failures |
| Conversion | 3 | Pay-before-value is severe |
| Delight | 4 | Functional, not emotional; generic skin |
| Mobile | 6 | Responsive-aware but tables/dialogs/seating weak |
| Scalability | 8 | Backend multi-tenant, metered, role-based — strong |
| **Overall** | **5.0** | Strong engine, weak cockpit. Close the backend↔UI gap *simply* and this is an 8. |

**Top 3 levers, in order:** (1) kill pay-before-value, (2) make import unbreakable, (3) re-skin + replace native alerts. Do those three and ShowUp stops feeling like an admin panel and starts feeling like the premium event product it already is under the hood.
