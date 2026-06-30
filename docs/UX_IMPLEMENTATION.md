# ShowUp - UX Audit Implementation Log

Companion to `UX_AUDIT.md`. **Verified:** frontend `npm run build` exits 0 (0 `src/` type errors); backend `./tooling/test/run.sh` → **98 passed** (88 prior + 10 new), `alembic upgrade head` clean.

## ✅ Shipped

| # | Audit item | What changed | Files |
|---|---|---|---|
| 1 | **Re-skin off stock MUI** | Brand recolored to celebratory **violet→pink** (was default blue). New `brand` + `pink` ramps; `secondary` + radius 10 wired into the active theme. Side-menu gradients & auth buttons recolored on-brand. | `shared-theme/themePrimitives.tsx`, `theme/ThemeProvider.tsx`, `components/SideMenuCustom/MenuContent.tsx`, `pages/Login.tsx`, `pages/Register.tsx` |
| 2 | **Replace `alert()`/`confirm()`** (Critical) | All 6 `alert()`s → Toast snackbars; `window.confirm` delete → proper confirmation Dialog. | `pages/Messages.tsx` |
| 3 | **OTP resend timer + channel clarity** (Critical) | 60s countdown + "שלח קוד חדש" resend; copy now says the code is sent to **WhatsApp**. | `pages/Login.tsx`, `pages/Register.tsx` |
| 4 | **Dashboard "needs attention" + active round** (Critical) | New top strip: "N אורחים עדיין לא הגיבו" with one-tap **שלח תזכורת** → campaigns; shows next/last round status. (Stat cards already deep-linked to filtered lists.) | `pages/Overview.tsx` |
| 5 | **Import validation & preview** (Critical) | CSV files now parsed client-side: column auto-detect (שם/טלפון), per-row validation, **duplicate detection**, preview table with counts, and the confirm button shows "ייבא N אורחים" / blocks 0-valid imports. | `pages/Guests.tsx` |
| 6 | **Templates Manager** (Important) | New `/templates` page + nav item - fully wired to the real templates API: list, create (with variable chips), "שלח לאישור" (validate→meta_pending), activate, clone, plain-language status pills, rejection reasons. No Meta jargon. | `pages/Templates.tsx`, `App.tsx`, `MenuContent.tsx` |
| 7 | **AI Assistant surface** (Important) | Global FAB + drawer with friendly persona, conversation starters that actually navigate, graceful fallback. Mounted on all in-app pages. | `components/AssistantWidget.tsx`, `components/Layout.tsx` |
| 8 | **Payment-free first-run** (Critical #1) | The wizard Summary step now offers authenticated users **"צור עכשיו, שלם לפני השליחה"** - creates the event via the existing free `POST /events` and lands them in the app. The pay-wall no longer blocks reaching value; payment moves to send-time. | `pages/EventWizard.tsx` |
| 9 | **Team / Members** (Important #7) | New `/team` page + nav. **New backend `members` router** (list / invite-by-phone / change-role / remove) on the existing Account/Membership tenancy, with RBAC guards (`MEMBER_MANAGE`, can't touch owners, owner not assignable). Invite resolves the phone via a **new aub-service internal lookup** (`/auth/internal/user-by-phone`, batch `/auth/internal/users`) since users live in the auth DB. Human role labels, no jargon. **10 new tests.** | `core-service/app/routers/members.py`, `app/user_directory.py`, `aub-service/app/routers/auth.py`, `pages/Team.tsx` |
| 10 | **Usage / Billing** (Important #11) | New `/billing` page + nav + **new backend `usage` router** (`GET /usage` → guests + rounds used for an event, RBAC-checked). Frontend shows usage bars vs plan limits (`countLimit`, rounds) from the existing plans API, an at-80% upgrade nudge, and the "you pay for guests + rounds, messages are included" message. | `core-service/app/routers/usage_router.py`, `pages/Billing.tsx` |
| 11 | **Mobile bottom-sheet dialogs** (Important #10) | New reusable `ResponsiveDialog` - a drop-in `<Dialog>` replacement that renders a centered modal on desktop and a slide-up, bottom-anchored sheet (rounded top, full-width, 92vh max) on `< sm`. Swapped into **all 5 guest modals** (delete, change-count, add, import, edit) and **all 3 campaign modals** (edit, send-now, delete). Guest list already had the mobile card layout; this closes the "modals → drawers on mobile" gap. | `components/ResponsiveDialog.tsx`, `pages/Guests.tsx`, `pages/Messages.tsx` |

Backend wiring: both routers registered in `core-service/app/main.py`; `INTERNAL_API_SECRET` added to `docker-compose.yml` (core + aub) and `.env`; `AUB_SERVICE_URL` was already injected into core.

## ✨ Nice-to-have pass (audit "Nice to have")

| # | Item | What changed | Files |
|---|---|---|---|
| 12 | **Confetti micro-delight** | Dependency-free canvas confetti burst (respects `prefers-reduced-motion`). Fires once on the **first campaign sent** and once per event on the **first confirmed guest** (dashboard), with a normal burst on later sends. | `utils/confetti.ts`, `pages/Messages.tsx`, `pages/Overview.tsx` |
| 13 | **Keyboard shortcuts + help** | Global handler mounted in `Layout`: `g`-prefixed navigation (`g g/m/t/e/b/s/o/p`), `c` new event, `n` add guest, `/` focus guest search, `?` toggles a help dialog. Ignores typing targets. Guests page listens for the `n` / `/` custom events. | `components/KeyboardShortcuts.tsx`, `components/Layout.tsx`, `pages/Guests.tsx` |
| 14 | **Guest timeline** | `GuestTimeline` fetches `GET /api/guests/{id}/timeline` and renders a vertical activity rail (Hebrew labels + icons for all `GuestEventType`s). Mounted in the guest **edit modal**. | `components/GuestTimeline.tsx`, `pages/Guests.tsx` |
| 15 | **Bulk tag/group actions** | Row selection (table header/rows + mobile card checkboxes) drives a floating `BulkActionsBar`: **tag** (existing account tags or create-new, via `TagPickerDialog` → `tags` API), **move-to-group** (bulk `PUT`), and **bulk delete**. Counts surfaced in toasts. | `components/BulkActionsBar.tsx`, `components/TagPickerDialog.tsx`, `pages/Guests.tsx` |
| 16 | **Multi-event reuse** | The side-menu event switcher + "צור אירוע חדש" already existed; tags are account-scoped and templates can be account-global (both reusable across events). Added a concrete reuse action: **"העתק אורחים מאירוע קודם"** in the import dialog (`CopyGuestsDialog`) copies name/phone/group from another event, resetting statuses. | `components/CopyGuestsDialog.tsx`, `pages/Guests.tsx` |
| 17 | **Post-event recap** | New `/recap` page + nav item ("סיכום האירוע"): celebratory hero, attendance tiles (אישרו / לא הגיעו / לא הגיבו / אחוז מענה from the stats API), and post-event actions - **שלח תודה לאורחים** (→ campaigns) and **ייצא רשימת אורחים** (reuses the export endpoint). Shows a "preview" chip when the event date hasn't passed. | `pages/Recap.tsx`, `App.tsx`, `MenuContent.tsx` |

## ⏸ Still partial (honest notes)

- **Payment-free path covers authenticated users.** A brand-new, not-yet-registered visitor still goes through the existing pay flow (account creation happens at the payment step). A fully anonymous "try first" path would mean moving registration earlier in the wizard - a larger flow change left for a focused pass.
- **Upgrade button** on `/billing` links to the marketing pricing page; there's no in-place upgrade-order API yet.
- **Full Excel (.xlsx) client-side preview.** Import preview is CSV-only (no xlsx parser dependency added); .xlsx still uploads to the existing server-side bulk importer unchanged.
- **Bulk actions & copy-guests are client-side fan-outs.** The backend has no batch tag/group/delete endpoint and no per-account guest-clone, so the UI loops per-guest requests (tags assigned in parallel; copy created sequentially with progress). Fine for typical event sizes; a server-side batch endpoint would be the scale-up.
- **Recap uses live stats.** The `/recap` numbers come from the existing guests-stats API (not a frozen post-event snapshot); before the event date it's labeled a preview. "ייצא רשימת מתנות" from the audit is not built - export is the full guest list.

## Notes
- App remains RTL Hebrew throughout; all new copy is Hebrew and non-technical.
- The AI assistant posts to `/api/assistant` if/when that endpoint exists; until then it gives a friendly message and the action-shortcuts do the real work.
- Team invite requires `INTERNAL_API_SECRET` set for both core-service and aub-service (done in `.env`/compose) and the invitee to be a registered ShowUp user.
