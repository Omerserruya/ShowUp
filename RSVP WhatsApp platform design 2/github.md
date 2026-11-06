repo: Omerserruya/ShowUp
branch: main
path: showup-frontend

## Last sync
date: 2026-10-05T14:27:10Z

### Updated in this project
- Landing v4 rebuilt on the real GOTCHA landing structure and tokens, read from `Omerserruya/Gotcha` → `landing/src/generated/Template.jsx` + `landing/src/app/globals.css` (reference only; ShowUp's own repo has no landing).
- ShowUp repo `main` unchanged against the screen map (55 files); no ShowUp screens rebuilt.

## Reference repo
repo: Omerserruya/Gotcha
branch: main
path: landing

## Screen map
| Project screen | Repo files |
| --- | --- |
| Platform v6 (home, guests, sending, tables, status, settings) | Product logic only: Bot-Sender-Service/WhatsappBot.py, Sender.py; nav structure from src/components/SideMenuCustom/MenuContent.tsx |
| Mobile Flows (45 screens) | Same as above; no mobile code in repo |
| Event Signup v2 | None (new flow, not in repo) |
| Landing v3 | None (no landing page in repo; live site showup-rsvp.com is client-rendered) |
| Landing v4 | Gotcha: landing/src/generated/Template.jsx (home: hero, demo card, marquee, stats, timeline spine, dark permissions card, trust band, FAQ, CTA, footer), landing/src/app/globals.css |
| Logo asset | showup-frontend/public/ShowUp.png |

## Sync history
### 2026-10-05T14:20:42Z
- Checked `main` against the screen map: same 55 files; no screens rebuilt.
### 2026-09-01T19:53:40Z
- Rebuilt the RSVP platform screens on the real ShowUp MUI v6 theme (brand blue, gray 220 neutrals, radius 8, card + chip + button variants from `shared-theme`).
- Reused the app shell: 240px drawer, event `Select`, `MenuContent` nav, breadcrumbs + search header, user card.
- Campaign screen modeled on `Bot-Sender-Service/WhatsappBot.py`.
- Imported `showup-frontend/public/ShowUp.png` as the sidebar lockup.
