# ShowUp - Product Design Audit (Pre-Launch)

**Date:** 2026-07-03 · **Scope:** entire frontend product (shell, all pages, all flows, design system, states, mobile, accessibility, emotional design) · **Method:** full code-level review of every page, component, and flow, cross-checked against the backend contract where relevant.

---

## 1. Product understanding

**What ShowUp is.** A Hebrew-first, RTL, B2B2C event-RSVP SaaS for the Israeli wedding market. Venues buy plans and hand couples a Starter tier; couples build a digital invitation in a live "studio," send WhatsApp RSVP campaigns, track responses on a control-center dashboard, arrange seating, and get a post-event recap. Guests - the largest user group by far, on mobile, including elderly relatives - open an invitation link and RSVP in seconds.

**Emotional states.** Couples arrive stressed and emotionally invested; the product's core promise is *"your event is under control."* Guests arrive curious and hurried; the invitation must feel special, then get out of the way. The venue arrives transactional. Every screen should be judged against those states.

**Verdict in one paragraph.** The recent overhaul (shell, dashboard, invitation, wizard, auth) is genuinely strong - the editorial direction, the OTP flow, wizard draft persistence, the attention-panel framing, and the envelope moment are premium-grade. What holds the product back from launch is not design taste; it is (a) a handful of **broken or deceptive states on money and core paths**, (b) a **split-brain between the theme and the code that bypasses it** (brand color, RTL, status colors, radii), and (c) **missing lifecycle states** (event over, errors, returning guests). These are refinements, not redesigns - exactly the right problem to have before launch.

---

## 2. Cross-cutting themes (root causes)

1. **Plans/entitlements split-brain.** `config/entitlements.ts` knows `free/starter/basic/plus/pro`; `config/plans.ts` (and Pricing, Billing, Payment, UpgradeDialog) knows only `basic/plus/pro`. This single gap produces three of the worst monetization findings (Pro mis-sell, Basic downgrade trap, Starter-invisible billing page).
2. **The de-facto brand is hardcoded, not tokenized.** Theme `primary` is violet `#8147e6`; the actual product paints indigo `#888cee`/`#6f74e0` from ~30 files of raw hex (564 hex occurrences in 68 files). Marketing (violet), auth (blue `#6B73FF→#000DFF`), and app (indigo) read as three products.
3. **RTL is hand-patched, not systemic.** `theme.direction` is never set to `rtl` and there is no stylis RTL plugin; instead 155 `direction:'rtl'` sx overrides + 25 `dir` props. Every new component is a fresh chance to mis-align.
4. **Dead code masquerading as the product.** Two shells (`SideMenuCustom/*`), two theme providers (`shared-theme/AppTheme`), seven mock-driven chart components, orphaned `Search`, `NavbarBreadcrumbs`, `Home.tsx`, `AuthStyles`, `StatusCard`, `DonutProgress`, `RSVPTable` - all zero-importer or unreachable, several containing English placeholder copy and fabricated data.
5. **State coverage is happy-path only.** Errors are swallowed into confident zeros or fake "delivered to everyone" numbers; loading is a full-page spinner in 27 files (Skeleton in exactly 1); "event over," "already responded," and "RSVP closed" states don't exist.
6. **Feedback and dialog systems are fragmented.** Raw `Snackbar` (5 files) vs `Toast` (3 files) vs never-dismissing fixed `Alert`s; `ResponsiveDialog` vs raw `Dialog`; and the themed `MuiAlert` paints every severity warning-orange, so success doesn't read as success anywhere.

---

## 3. Findings

Severity legend: **C** Critical · **H** High · **M** Medium · **L** Low. Complexity: S/M/L.

### 3.1 Broken or deceptive core paths

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 1 | C | **"New round" / "Create first round" buttons have no onClick.** The campaigns page's primary CTA - and its empty state's only CTA - is a dead click. | `Messages.tsx:1020-1027, 1085` | M |
| 2 | C | **Payment success can dead-end on a permanent "redirecting…" spinner.** The `done` path (order already paid on load - exactly the `pending_order_id` resume path from Layout) sets success but never navigates; copy promises "מעבירים אתכם ללוח הבקרה". | `Payment.tsx:105-110, 184-201` | S |
| 3 | C | **Invitation studio has zero unsaved-changes protection.** All edits live in local state; refresh/navigation/event-switch silently destroys a session of emotional design work. No dirty flag, no beforeunload, no autosave. | `InvitationStudio.tsx:29`, `Invitation.tsx:82` | M |
| 4 | C | **Import review progress is hardcoded to 0%.** `const approvedCount = 0` feeds the bar and "0 מתוך N אושרו" label forever. | `ImportedGuestsReviewScreen.tsx:121, 403, 415` | S |
| 5 | H | **"פורסם ✓" button silently unpublishes the live invitation.** It looks like a status badge; clicking it takes the guest-facing page offline with no confirmation. | `InvitationStudio.tsx:117`, `Invitation.tsx:49` | S |
| 6 | H | **Group / "with notes" filters only filter the loaded 25-row page.** Guests in the group on other pages silently vanish - users see a wrong guest list. | `Guests.tsx:267-282, 312-321` | M |
| 7 | H | **"Delivered" count lies when stats are unavailable** - falls back to full recipient count, masking delivery failures. No `failed` campaign status exists at all. | `Messages.tsx:1100, 260` | M |
| 8 | H | **Seating: table delete has no confirmation** (context menu *and* stray Backspace) and unseats everyone instantly; **rejected drag-drops fail silently**; failed PUTs never roll back optimistic state. | `Seating.tsx:358-363, 751-756, 532-535, 562-568` | S |
| 9 | M | **RSVPTable note-save is a `console.log` no-op; row menu is dead.** Legacy component superseded by Guests inline table - should be deleted. | `RSVPTable.tsx:195-198, 457-459` | S |
| 10 | M | **`CampaignUpdates` ships fabricated default stats** ("357 אורחים", fake read rates) rendered whenever no props are passed. | `CampaignUpdates.tsx:27-65, 91` | S |
| 11 | M | **Dead links to a non-existent `/events/new` route** in unrouted `Home.tsx` and orphaned `SelectContent`. | `SelectContent.tsx:29+` | S |

### 3.2 Monetization & plan gating

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 12 | H | **Upgrade dialog always sells Pro (₪199) for features included in Plus (₪99).** Only `ai_assistant/sms_campaigns/custom_domain` are Pro-exclusive; seating, campaigns, team etc. are Plus. Mis-sell at 2× price. | `UpgradeDialog.tsx:45-74`, `entitlements.ts:81-95` | M |
| 13 | H | **Starter→Basic "upgrade" silently removes seating** (Starter has it, Basic doesn't). Paying to lose a feature. | `entitlements.ts:61-80` | S–M |
| 14 | M | **Billing page can't represent Starter:** no current-plan marker, `delta = full price` on all tiers, contradicting the "pay only the difference" promise. | `Billing.tsx:44-48, 182-208` | M |
| 15 | M | **Team tab has no lock badge and gating is discovered via server 404/409;** `team_members`/`seating` missing from `FEATURE_META` so locks show generic copy. | `Settings.tsx:17-21`, `Team.tsx:79-80` | S |
| 16 | M | **"מנוי" (subscription) wording in Settings contradicts the "בלי מנוי" promise** made on Pricing/Payment. | `Settings.tsx:20` | S |
| 17 | M | **Inactive-event banner's "הסדר תשלום" CTA goes to the profile tab, not payment**, via a full page reload. | `InactiveEventBanner.tsx:24` | S |

### 3.3 Shell, IA & navigation

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 18 | H | **Primary nav is keyboard-inoperable** - rail rows, event switcher, and mobile dock are click-only `role="button"` divs; no `tabIndex`, no Enter/Space, no `aria-current`. | `AppRail.tsx:42`, `MobileNav.tsx:40-68`, `EventSwitcher.tsx:48` | M |
| 19 | H | **User menu is English and half-dead:** "Profile / My account / Settings / Logout"; two items are no-ops; working ones use `window.location.href` (full reload). | `OptionsMenu.tsx:62, 93-96` | S |
| 20 | H | **Orphaned legacy shell still in tree** (`SideMenuCustom/*` ×6, `SelectContent`, `NavbarBreadcrumbs`, `Search` with English "Coming Soon!"). | grep-verified zero importers | S |
| 21 | M | **Active-nav uses exact path equality** - on `/guests/imported` no section is highlighted. | `AppRail.tsx:38`, `MobileNav.tsx:38` | S |
| 22 | M | **`document.title` never changes** - all tabs/history read the same. | `index.html:30` | S |
| 23 | M | **Same destination, three names:** Messages = "תזכורות"/"תזכורות והודעות"/"קמפיינים"; Overview = "הבית"/"לוח בקרה"; Seating = "הושבה"/"סידור מושבים". | `navConfig.tsx`, `KeyboardShortcuts.tsx:35-37` | S |
| 24 | M | **Admin area reachable only by typing URLs** - no nav entry exists for admins. | `App.tsx:118-119` | S |
| 25 | M | **Two conflicting "event OK" signals:** banner keys off `active`, switcher dot keys off `paymentStatus`; they can disagree. | `BannerContext.tsx:17-21`, `EventSwitcher.tsx:41` | M |
| 26 | M | **Mobile dock priority:** Settings gets a dock slot while Invitation and Seating (core features) hide behind "עוד". | `navConfig.tsx:33-38` | S |
| 27 | L | Keyboard shortcuts exist but are undiscoverable; collapsed rail lacks tooltips; avatar lacks aria-label and uses off-brand random colors; `BannerContext` logs debug objects in production. | various | S |

### 3.4 Design system coherence

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 28 | C | **De-facto brand color is hardcoded indigo, not the theme's violet.** `#888cee`(37×)+`#6f74e0`(56×) across ~30 files vs theme `primary` `#8147e6`; a third purple `#6366f1` in StatusCard; AppRail mixes two purples in one component. | `themePrimitives.tsx:40`, `Overview.tsx:16`, `AppRail.tsx:14-15,60` | L |
| 29 | H | **RTL is not in the theme** (no `direction:'rtl'`, no stylis-plugin-rtl) - faked via 155 sx overrides; MUI direction-aware internals (menus, pagination, sliders) run LTR. | `ThemeProvider.tsx`, grep counts | M |
| 30 | H | **Radius/shadow/card anarchy:** 8px token vs 15 distinct hardcoded radii (2–999px), 38 ad-hoc rgba shadows, three card languages. | `feedback.ts:52`, `UpgradeDialog.tsx:30`, `StatusCard.tsx:43` | M |
| 31 | H | **Dark mode is half-broken:** token layer is solid but hardcoded surfaces (`DonutProgress` white card, Guests `#F2F3F5` chips, auth gradient) stay light. | `DonutProgress.tsx:114`, `Guests.tsx:1098-1195` | M |
| 32 | H | **Auth screens are a third brand** - pure-blue `#6B73FF→#000DFF` gradient, own radii, unrelated to violet or indigo. | `AuthStyles.tsx:13` (orphaned) + live auth surfaces | S |
| 33 | H | **Three status-color palettes for the same semantics** (dashboard `#22c55e/#ef4444/#f59e0b`, GuestsSummary pastels, legacy charts' set) + greens/reds that bypass `palette.success/error`. | `KpiCards.tsx:5-8`, `GuestsSummary.tsx:6-8` | M |
| 34 | M | **Themed `MuiAlert` paints every severity warning-orange** - success/error toasts don't read as success/error, product-wide. | `feedback.ts:37-44` | S |
| 35 | M | **No shared EmptyState; Skeleton in 1 file vs CircularProgress in 27; Toast used by 3 pages vs raw Snackbar in 5.** | grep counts | M |
| 36 | M | **Duplicate primitives:** two PageHeaders, two ColorModeIconDropdowns, orphaned StatusCard/DonutProgress, dead `shared-theme/AppTheme` provider. | grep-verified | S |
| 37 | L | Theme customizations themselves leak literals (`#000`/`#fff` toggles, hardcoded menu shadows); unused `getDesignTokens` duplicates the palette. | `inputs.tsx:319-359`, `navigation.tsx:70-113` | S |

### 3.5 Dashboard & Recap

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 38 | C | **No "event is over" state.** A finished wedding still says "הצעד הבא: סידור מושבים"; Recap - the payoff screen - is never surfaced from Overview. | `Overview.tsx:87-100, 133` | M |
| 39 | H | **Stats errors render a fake all-zeros dashboard under the alert** - reads as "all my RSVPs vanished," maximum stress. | `useOverviewData.ts:78-85`, `Overview.tsx:140` | S |
| 40 | H | **All-or-nothing full-page spinner** blocks on three independent fetches; no skeletons. | `Overview.tsx:64-70` | M |
| 41 | H | **Campaign/guest fetch failures are silent and flip the advice wrong** - "אין תזכורת מתוזמנת" shown even when one exists but failed to load. | `useOverviewData.ts:162-167` | M |
| 42 | H | **"Days until" computed differently on Overview (floor) vs Recap (ceil)** - the most emotionally loaded number disagrees between screens. | `Overview.tsx:20`, `Recap.tsx:47` | S |
| 43 | H | **Seven dead mock-data chart components** (fake May-2024 data, English copy) still in tree, carrying incompatible palettes. | `MessageStatistics.tsx:29-54` etc. | S |
| 44 | M | Recap under-delivers its own promise ("רגעים לזכור") - a stat strip with no celebration moment; confetti exists but not here. | `Recap.tsx:151-220` | M |
| 45 | M | KPI "שיעור אישורים" vs Recap "אחוז מענה" - same purple, different formulas. | `KpiCards.tsx:72`, `Recap.tsx:94-95` | S |
| 46 | L | First-confirmation confetti fires retroactively on old events; recap stat strip shows dangling divider on mobile wrap; hero wraps awkwardly at small widths. | `Overview.tsx:51-55`, `Recap.tsx:26` | S |

### 3.6 Guests / Messages / Seating (daily work)

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 47 | H | **No optimistic updates on the guest grid** - every field edit refetches everything and dims the table; Seating *is* optimistic, so the app is inconsistent with itself. | `Guests.tsx:344-370` | M |
| 48 | M | **Inline editing is double-click only, with zero affordance** (and status is single-click - inconsistent); not keyboard-reachable. | `Guests.tsx:1396-1705` | M |
| 49 | M | **Message editing is a raw textarea with naked `{{tokens}}`** while the polished `CustomMessageEditor` (badges, Meta validation) sits unused in these paths - edits can silently break template approval. | `Messages.tsx:1270-1278, 1188` | M |
| 50 | M | **Bulk ops fire N parallel requests** with no progress; partial failures reported as counts only, not which rows. | `Guests.tsx:420-477` | M |
| 51 | M | **Seating lacks all capacity feedback:** no unseated count, no per-table "5/8", no global seated/total meter, no canvas empty state for first run. | `Seating.tsx:1133-1144`, `TableNode` | M |
| 52 | M | **Three toast systems, two dialog systems, three header patterns across the three daily pages** (Seating has no page header at all; fixed Alerts never auto-dismiss). | `Guests.tsx:904`, `Seating.tsx:999` | M |
| 53 | L | Change-count can't be zeroed; add-guest lacks phone validation; imported-section shows static values during edit; seating "בטל" discards layout without confirm. | various | S |

### 3.7 Invitation (studio + public)

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 54 | H | **Public page loads ~20 Google Font families** (the entire studio menu) as render-blocking CSS on every guest visit; any invite uses ~3. Biggest perceived-perf lever in the product. | `public/index.html:19`, `invitation/theme.ts:17-44` | M |
| 55 | H | **Envelope intro replays on every visit** - scroll-locked ceremony blocks the guest hurrying back for directions day-of. | `PublicInvitation.tsx:55`, `EnvelopeIntro.tsx:131-157` | S |
| 56 | H | **No add-to-calendar; navigation is Waze-only** - the two highest-intent guest actions after RSVP. | `InvitationView.tsx:169, 251` | M |
| 57 | H | **Returning guests get no "already responded" state or pre-fill**, though the backend fully supports upsert-by-phone; identical success copy for create vs update. | `PublicInvitation.tsx:73-118`, `public_invite.py:83-94` | M |
| 58 | H | **Sub-AA contrast + 12px labels on the info elderly guests need most** (accent `#95836b` on `#f5efe6` ≈ 2.6:1 for date/time labels). | `invitation/theme.ts:82`, `InvitationView.tsx:203-262` | S–M |
| 59 | M | Studio has no true guest-eye preview (edit chrome always on); tablet toggle renders a layout no real tablet gets; image upload has no progress/size guard/crop for the full-bleed hero. | `InvitationStudio.tsx:37, 42-48, 106` | S–M |
| 60 | M | No draft-vs-published clarity ("are guests seeing my latest edits?"); public URL shown only as an icon. | `InvitationStudio.tsx:113-117` | M |
| 61 | M | Backend error strings (some English) shown verbatim to guests; RSVP-disabled silently removes the block with no explanation; success state is emotionally flat (confetti used elsewhere but not on the guest's yes). | `PublicInvitation.tsx:98-118` | S |
| 62 | M | `letterSpacing: 4–6` applied to Hebrew display text (Hebrew doesn't track) across the invitation's most designed moments. | `InvitationView.tsx:203-343` | S |
| 63 | M | Loading is a bare spinner (no skeleton) before a font-heavy first paint; demo duplicates the RSVP form verbatim (drift already begun); RSVP toggles/tap targets under 44px; event date parsed without timezone anchoring. | `PublicInvitation.tsx:39-49`, `DemoInvite.tsx:121-180`, `rsvpStyle.ts:29` | S–M |

### 3.8 Auth, wizard, settings

| # | Sev | Finding | Evidence | Cx |
|---|-----|---------|----------|----|
| 64 | M | **Profile is a password-era surface in an OTP-only product** - change-password dialog, "שם משתמש", axios instead of `fetchWithAuth`. | `Profile.tsx:241-273, 383` | S–M |
| 65 | L | Wizard: `?package=` opens at "שלב 2 מתוך 6" with an unseen step pre-checked; duplicate `VerifiedIcon` on two steps; OTP resend doesn't refocus slot 0 and resend "link" ignores `disabled`; raw server errors can surface in English; `OAuthCallback` logs PII for a flow that has no UI. | `EventWizard.tsx:303, 447, 2943`, `OtpVerification.tsx:84` | S |
| 66 | L | Admin pages are dense English-feeling CRUD tables inside the couple shell - acceptable for internal use, tonal jump noticeable. | `admin/Users.tsx` | M |

### What's already excellent (keep, don't touch)

- The **auth funnel identity** (AuthLayout split-screen, benefit carousel) and best-in-class **OTP input** (WebOTP, paste, auto-submit, cooldown).
- **Wizard draft persistence** (versioned, TTL, restore banner) and the wizard→login→payment data handoff.
- **Payment trust signals** (PCI/iCount badges, VAT-correct summary, non-punitive cancel).
- The **dashboard's information framing** (hero status voice, attention panel, deep-linking KPIs, tasteful count-ups honoring `prefers-reduced-motion`).
- The **invitation's editorial system** (Reveal easing, envelope flap, two-column magazine layout, correct RTL logic).
- **PremiumLock's "preview, not a wall"** pattern and PlanBadge's "כלול באדיבות האולם שלכם" framing.

---

## 4. Prioritized roadmap

**P0 - broken/deceptive paths (fix before anything):** #1 dead campaign CTA · #2 payment dead-end · #3 studio data loss · #4 stuck import progress · #5 accidental unpublish · #6 wrong filter results · #7 fake delivered counts · #8 seating destructive actions · #39 fake-zeros error state.

**P1 - trust & money:** #12 tier-accurate upsell · #13/#14 Starter/Basic ladder · #17 banner CTA → payment · #38 event-over → Recap · #42 one daysUntil · #19 user menu · #34 Alert severities.

**P2 - systemic coherence:** #28 brand token consolidation · #29 RTL in theme · #33 one status palette · #54 font diet · #18 keyboard nav · #21–23 wayfinding (active state, titles, terminology) · #20/#43 dead-code purge.

**P3 - experience elevation:** #55–58 guest-facing wins (envelope memory, calendar/maps, returning guest, contrast) · #40 skeletons · #44 recap keepsake · #47–52 daily-work ergonomics · #59–63 studio polish.

Everything above is a refinement of the existing identity - no rebrand, no new design language, no typography change.

---

## 5. Implemented in this pass (2026-07-03)

All changes typecheck clean and the production build passes (bundle −9.26 kB gzipped).

**P0 - broken/deceptive paths, all fixed:**
- #1 Campaigns "סבב חדש"/"צרו סבב ראשון" now open a real create-round dialog (template picker with live WhatsApp preview, optional scheduling) wired to `POST /api/campaigns`.
- #2 Payment: already-paid orders auto-redirect to the dashboard, plus an explicit "המשך ללוח הבקרה" fallback button.
- #3 Studio: dirty tracking vs. last-saved config, `beforeunload` guard, "שינויים לא נשמרו" chip, save button emphasizes when dirty and reports failures.
- #4 Import review progress bar now tracks processed contacts ("X מתוך Y טופלו").
- #5 Unpublish is confirm-gated; published state reads as a green status button; publish toast clarifies the link is live; saving while published says the changes went live.
- #6 Group / "with notes" filters now fetch the full guest list before filtering.
- #7/#33 partial: "נמסר ל-" only shows with real delivery stats; otherwise "נשלח ל-N נמענים · נתוני מסירה יתעדכנו בקרוב"; summary-strip "נחשפו" no longer counts planned recipients.
- #8 Seating: table deletion (context menu + Backspace) confirm dialog showing how many guests will be unseated; rejected drops explain why (capacity / no adjacent seats); failed seat writes roll back with a toast.
- #39 Stats errors render a calm error panel with retry instead of a fake all-zeros dashboard.

**P1 - trust & money:**
- #12 UpgradeDialog + PremiumLock are plan-aware: they pitch the *cheapest* tier that unlocks the triggering feature, with its real price and feature list (`minPlanForFeature`, `upgradePointsForPlan`).
- #13 Billing picker warns when a "higher" tier removes features the couple has today (`featuresLostOnSwitch` - the Starter→Basic seating trap).
- #14 Starter billing: absolute prices with "מעבר ל-X" CTAs (no fake deltas), explanatory caption.
- #15 Team tab carries a LockBadge and the Team page renders behind PremiumLock for non-entitled plans; `seating`/`team_members`/`web_invitation`/`invitation_customization` added to FEATURE_META.
- #16 "המנוי" → "החבילה" in Settings.
- #17 Banner CTA resumes an open checkout (`pending_order_id`) or goes to the billing tab - via router, no reload.
- #19 User menu: Hebrew, all items functional, admin entry when `isAdmin` (also fixes #24), router navigation.
- #34 MuiAlert severities are semantic again (orange = warning only; success/error/info use their palettes, light + dark).
- #38 Event-over state: hero shows "היה בלתי נשכח 💜", status/attention/timeline all route to Recap; Recap fires a one-time celebration confetti.
- #42 One shared `daysUntilEvent()` (calendar-day) used by Overview, Recap, and the event switcher.

**P2 - coherence & wayfinding:**
- #18 Rail, dock, sheet, and event switcher are real `<button>`s: Tab/Enter/Space, `aria-current="page"`, focus rings, rail expands on keyboard focus, tooltips on collapsed icons.
- #21 Active-nav matches sub-routes (`/guests/imported` keeps האורחים lit).
- #22 `document.title` per section ("האורחים · ShowUp").
- #23 Shortcuts help labels now match the nav 1:1.
- #26 Mobile dock: ההזמנה replaces הגדרות (Settings moved to the "עוד" sheet).
- #20/#43/#9/#10/#11 Dead code deleted (~21 files): `SideMenuCustom/*`, legacy `Search`+`SearchContext`+provider, `NavbarBreadcrumbs`, `SelectContent`, `Home`, `AuthStyles`, seven mock-data chart components, `StatusCard`, `DonutProgress`, broken `RSVPTable`, fake-data `CampaignUpdates`, dead `shared-theme/AppTheme`+`ColorModeSelect`.
- #27 BannerContext debug logging removed; avatar colors constrained to brand tints + aria-label; Toast renders RTL.
- #40 Overview loads with a layout-shaped skeleton instead of a blank page + spinner.

**P3 - guest experience & studio:**
- #54 Font diet: index.html ships 3 families (app font + invitation defaults); `utils/fonts.ts` lazy-loads exactly what each invitation's theme uses; the studio loads the full menu.
- #55 Envelope plays once per session per slug; repeat visits go straight to the invite.
- #56 "הוספה ליומן" (Google Calendar) under the date; Waze *and* Google Maps under the location - hairline editorial links.
- #57 Returning guests: last RSVP remembered per device, form pre-filled with "כבר שלחתם תשובה" note, success copy distinguishes update vs. create, "רוצים לעדכן?" link on the thank-you state.
- #58 `accentText` token (accent blended toward ink) for all label text; labels raised to 14px; RSVP toggles/button ≥44px tap targets.
- #61 Curated Hebrew errors for 403/409/generic; RSVP-off renders a quiet "אישורי ההגעה נסגרו" line instead of a silent hole; confirmed RSVPs fire theme-appropriate confetti.
- #62 Hebrew letter-spacing reduced from 3-6 to ~1 across the invitation and demo ribbon.
- #59 partial: true guest-eye preview toggle in the studio (renders without edit chrome); tablet preview now shows the layout a real tablet gets.
- #65 partial: OTP resend refocuses the first digit (Login + Register).
- #46 Recap mobile strip divider fixed; first-confirmation confetti no longer fires on past events.

**Deliberately NOT done (needs product decisions / bigger effort):** #28 brand-token consolidation (pick violet vs. indigo first), #29 theme-level RTL (stylis plugin - mechanical but wide), #13 root fix (should Basic include seating?), #25 canonical event-status helper (backend contract), #47 optimistic guest grid, #49 CustomMessageEditor in campaign editing, #44 recap "moments", #59 image crop/progress, #63 timezone anchoring (backend).
