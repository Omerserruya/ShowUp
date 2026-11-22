# ShowUp blog - writing guide

Content lives in `blog/content/*.md`; `python3 blog/build.py` renders it to static
HTML (see the docstring in build.py for the format). Reference examples:
`blog/content/page-rsvp.md` (commercial page).

## Goal
Rank in Google Israel for RSVP searches (אישורי הגעה, אישורי הגעה לחתונה,
אישורי הגעה בוואטסאפ, אישורי הגעה טלפוניים, כמה עולה, חברת אישורי הגעה) and
for the wedding-planning questions around them (צ'ק ליסט לחתונה, כמה מנות
להתחייב לאולם, אחוז הגעה, כמה לשים בצ'ק, סידורי הושבה, נוסח הודעה...). Each
article should be the best answer on the web for its query: specific, practical,
complete, written by people who run events.

## Rules
- Plain, warm, natural Israeli Hebrew. Address the reader in plural (אתם). No
  translationese, no jargon, no English words when a Hebrew one exists.
  Correct spelling (כתיב מלא): אירוע, מתנה, הזמנה, תזכורת, אישור.
- **Truth.** Never invent statistics, surveys, percentages "from research", prices
  of named competitors, or quotes. General practice is fine when framed as such
  ("נהוג", "בדרך כלל", "בהרבה אולמות"), with ranges, not fake precision.
  Gift amounts / headcount percentages: give common ranges and a method to
  compute, and say they vary.
- Don't name or criticise competitors. Compare *methods* (phone calls by a
  family member, call-centre companies, SMS, WhatsApp, a web form).
- ShowUp facts you MAY use (nothing else about the product):
  - Messages go from ShowUp's official WhatsApp Business number with the hosts'
    names inside; guests answer with buttons (מגיע / לא מגיע / עוד לא יודע) and
    choose how many are coming; free text notes ("צמחוני") are kept.
  - Automatic sequence by date: invitation (~a month before), reminder (~a week),
    final reminder (a day or two), thank-you after. The hosts can see and change it.
  - Reminders go only to who hasn't answered.
  - Automated phone calls (Plus: 1 round, Pro: up to 3 rounds) to who didn't
    answer on WhatsApp; the call says it's ShowUp and on whose behalf, guest
    presses a key; calls 10:00-20:00, Friday until 13:00, never on Shabbat;
    one retry, no voicemail message.
  - Digital invitation page, Waze navigation button, add-to-calendar link.
  - Guest import: Excel file, manual, contacts from the phone (Android app),
    sharing contacts to ShowUp's WhatsApp.
  - Seating arrangements; entrance-hostess screen at the door.
  - WhatsApp assistant for the hosts: "כמה אישרו?", "מי עוד לא ענה?", "מי ביקש צמחוני?".
  - Gift link in the thank-you/reminder: Bit, PayBox or credit-card gift link;
    money goes straight to the hosts, ShowUp takes no fee.
  - Daily summary to the hosts; final summary the day after.
  - Prices per event, no subscription: Free ₪0 up to 25 guests; Basic ₪39 up to 50
    (2 message rounds, no calls); Plus ₪99 up to 250 (4 rounds, 1 call round);
    Pro ₪199 unlimited guests (4 rounds, up to 3 call rounds). Extra rounds paid.
- Mention ShowUp naturally, at most 2-3 times in an article, where it genuinely
  solves the step being discussed. The page adds a CTA box automatically at the
  end; put `::: cta` + `:::` in the middle only in RSVP-topic articles.
- Internal links: link to 2-5 other guides using `/blog/<slug>` and commercial
  pages `/rsvp`, `/rsvp-wedding`, `/rsvp-bar-mitzvah`, `/rsvp-brit`,
  `/rsvp-corporate`, `/rsvp-phone-calls`. Only link slugs from the plan list.

## Structure of an article
- `title` (H1) contains the main keyword, natural (e.g. "צ'ק ליסט לחתונה: כל מה
  שצריך לעשות, חודש אחרי חודש"). `seo_title` <= 60 chars incl. "| ShowUp".
  `description` 130-155 chars, with the keyword and a reason to click.
- `lead`: 1-2 sentences that answer the query immediately.
- Then a short direct answer paragraph (for featured snippets), then H2 sections
  (5-9), each answering a sub-question people search. Use lists, tables, and
  checklists (`- [ ]`) where they help. `::: tip` callouts for practical tips.
- 1200-2200 words for big guides, 800-1200 for focused ones.
- `faq`: 4-6 real questions people ask (People-also-ask style), short answers.
- `related`: 3 slugs.
- `date: 2026-11-07`.
