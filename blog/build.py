#!/usr/bin/env python3
"""ShowUp blog + SEO pages: Markdown in blog/content -> static HTML.

Why static: the site is a React SPA, and an article Google has to run JS to
read ranks worse and slower. Every page here is complete HTML (title, meta,
canonical, Open Graph, JSON-LD) that nginx serves as-is
(`try_files $uri $uri/index.html /index.html`).

    python3 blog/build.py          # writes into frontend/public/
    (then the normal frontend build copies public/ into build/)

Content file = YAML front matter + Markdown body:

    ---
    slug: wedding-checklist            # URL: /blog/<slug>  (kind: page -> /<slug>)
    kind: article                      # article | page (commercial landing page)
    title: צ'ק ליסט לחתונה ...          # H1
    seo_title: ...                     # <title>, optional (defaults to title)
    description: ...                   # meta description, ~150 chars
    category: תכנון החתונה
    date: 2026-11-07
    updated: 2026-11-07                # optional
    related: [slug-a, slug-b]          # optional, else same category
    faq:                               # optional -> FAQPage schema + section
      - q: ...
        a: ...
    ---

Markdown supported: ## / ### headings, paragraphs, - lists, 1. lists,
- [ ] checklists, > quotes, | tables |, **bold**, *italic*, [link](url),
`::: tip` ... `:::` callouts, `::: cta` (ShowUp box) on its own line,
`::: raw` ... `:::` trusted HTML/JS passthrough (calculators).
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
OUT = ROOT.parent / "frontend" / "public"
SITE = "https://showup-rsvp.com"
BRAND = "ShowUp"

CATEGORY_ORDER = ["אישורי הגעה", "תכנון החתונה", "תקציב ואולם", "אורחים והושבה", "בר ובת מצווה ואירועים"]

# Static, indexable SPA routes for the sitemap.
SPA_PAGES = [("/", "1.0", "weekly"), ("/terms", "0.2", "yearly"), ("/privacy", "0.2", "yearly"),
             ("/accessibility", "0.2", "yearly")]

ROBOTS = """User-agent: *
Allow: /
Disallow: /api/
Disallow: /overview
Disallow: /insights
Disallow: /invitation
Disallow: /guests
Disallow: /messages
Disallow: /recap
Disallow: /seating
Disallow: /settings
Disallow: /venue
Disallow: /admin
Disallow: /payment
Disallow: /redeem/
Disallow: /hostess/
Disallow: /i/
Disallow: /g/
Disallow: /c/
Disallow: /go/

Sitemap: https://showup-rsvp.com/sitemap.xml
"""


# ---------------------------------------------------------------- markdown --

def _inline(s: str) -> str:
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)

    def link(m):
        text, url = m.group(1), html.unescape(m.group(2))
        ext = url.startswith("http") and not url.startswith(SITE)
        attrs = ' rel="noopener" target="_blank"' if ext else ""
        return f'<a href="{html.escape(url)}"{attrs}>{text}</a>'

    return re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)


def slugify_heading(text: str, used: set) -> str:
    base = re.sub(r"[^\w֐-׿]+", "-", text).strip("-").lower() or "s"
    s, i = base, 2
    while s in used:
        s, i = f"{base}-{i}", i + 1
    used.add(s)
    return s


CTA_HTML = """<aside class="cta">
  <div class="cta-k">ShowUp</div>
  <p class="cta-t">אישורי הגעה בוואטסאפ, בלי לרדוף אחרי אף אחד</p>
  <p class="cta-b">ההזמנה יוצאת מהמספר העסקי של ShowUp עם כפתורי תשובה, התזכורות יוצאות לבד לפי התאריך שלכם, ואתם רואים בזמן אמת כמה מגיעים. החל מ־₪39 לאירוע, בלי מנוי.</p>
  <a class="btn" href="/wizard">מתחילים בחינם</a>
</aside>"""


def render_md(md: str):
    """-> (html, toc[(id, text)])"""
    lines = md.strip("\n").split("\n")
    out, toc, used = [], [], set()
    i = 0
    para: list = []

    def flush():
        if para:
            out.append("<p>" + _inline(" ".join(para)) + "</p>")
            para.clear()

    while i < len(lines):
        line = lines[i].rstrip()
        st = line.strip()
        if not st:
            flush(); i += 1; continue
        if st == "::: cta":
            flush(); out.append(CTA_HTML); i += 1
            if i < len(lines) and lines[i].strip() == ":::":
                i += 1
            continue
        if st == "::: raw":  # trusted HTML from our own content files (calculators)
            flush(); i += 1
            raw = []
            while i < len(lines) and lines[i].strip() != ":::":
                raw.append(lines[i]); i += 1
            i += 1
            out.append("\n".join(raw))
            continue
        m = re.match(r"^:::\s*(tip|note|warn)\s*(.*)$", st)
        if m:
            flush()
            kind, head = m.group(1), m.group(2)
            body = []
            i += 1
            while i < len(lines) and lines[i].strip() != ":::":
                body.append(lines[i]); i += 1
            i += 1
            inner, _ = render_md("\n".join(body))
            h = f'<div class="call-h">{_inline(head)}</div>' if head else ""
            out.append(f'<div class="call call-{kind}">{h}{inner}</div>')
            continue
        m = re.match(r"^(#{2,3})\s+(.+)$", st)
        if m:
            flush()
            lvl, text = len(m.group(1)), m.group(2).strip()
            hid = slugify_heading(text, used)
            if lvl == 2:
                toc.append((hid, text))
            out.append(f'<h{lvl} id="{hid}">{_inline(text)}</h{lvl}>')
            i += 1; continue
        if st.startswith(">"):
            flush()
            q = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                q.append(lines[i].strip()[1:].strip()); i += 1
            # Lines inside a quote keep their breaks (message wording examples);
            # an empty ">" line starts a new paragraph.
            paras, cur = [], []
            for ln in q + [""]:
                if ln:
                    cur.append(_inline(ln))
                elif cur:
                    paras.append("<br>".join(cur)); cur = []
            out.append("<blockquote>" + "".join(f"<p>{x}</p>" for x in paras) + "</blockquote>")
            continue
        if st.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
            t = ['<div class="tbl"><table><thead><tr>' + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr></thead><tbody>"]
            for r in body:
                t.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table></div>")
            out.append("".join(t))
            continue
        if re.match(r"^[-*]\s+\[[ xX]\]\s+", st):
            flush()
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+\[[ xX]\]\s+", lines[i]):
                items.append(re.sub(r"^\s*[-*]\s+\[[ xX]\]\s+", "", lines[i])); i += 1
            out.append('<ul class="check">' + "".join(
                f'<li><label><input type="checkbox"><span>{_inline(t)}</span></label></li>' for t in items) + "</ul>")
            continue
        if re.match(r"^[-*]\s+", st):
            flush()
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                items.append(re.sub(r"^\s*[-*]\s+", "", lines[i])); i += 1
            out.append("<ul>" + "".join(f"<li>{_inline(t)}</li>" for t in items) + "</ul>")
            continue
        if re.match(r"^\d+[.)]\s+", st):
            flush()
            items = []
            while i < len(lines) and re.match(r"^\s*\d+[.)]\s+", lines[i]):
                items.append(re.sub(r"^\s*\d+[.)]\s+", "", lines[i])); i += 1
            out.append("<ol>" + "".join(f"<li>{_inline(t)}</li>" for t in items) + "</ol>")
            continue
        para.append(st)
        i += 1
    flush()
    return "\n".join(out), toc


# ------------------------------------------------------------------ pages --

CSS = """
:root{--paper:#FAF8F4;--card:#fff;--ink:#16150F;--body:#4A4741;--muted:#6B6660;--line:#E8E3D9;--lav:#C9B8F3;--lavh:#BBA6EE;--purple:#5A3DA6;--purpled:#432C85;--tint:#F6F2FD;--tintb:#DCD0F4;--ok:#3F6323;--okbg:#E7F0D4;--warn:#7E5410;--warnbg:#F6EFD8}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Heebo,"Noto Sans Hebrew",Arial,sans-serif;font-size:17px;line-height:1.75}
a{color:var(--purple)}a:hover{color:var(--purpled)}img{max-width:100%;height:auto}
.wrap{max-width:1120px;margin:0 auto;padding-inline:20px}
header.top{border-bottom:1px solid var(--line);background:rgba(250,248,244,.95);position:sticky;top:0;z-index:5;backdrop-filter:blur(8px)}
header.top .wrap{display:flex;align-items:center;gap:20px;height:64px}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);font-weight:700;font-size:19px;letter-spacing:-.02em}
.logo img{width:28px;height:28px}
nav.main{display:flex;gap:18px;margin-inline-start:auto;align-items:center;font-size:15px}
nav.main a{color:var(--body);text-decoration:none}nav.main a:hover{color:var(--purple)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:12px;background:var(--lav);color:var(--ink)!important;font-weight:600;text-decoration:none;font-size:15.5px}
.btn:hover{background:var(--lavh)}
@media(max-width:640px){nav.main a.hide-s{display:none}}
.crumbs{font-size:13.5px;color:var(--muted);padding-top:22px}.crumbs a{color:var(--muted);text-decoration:none}.crumbs a:hover{color:var(--purple)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:56px;padding-block:18px 64px}
@media(max-width:960px){.layout{grid-template-columns:minmax(0,1fr)}aside.side{display:none}}
article{min-width:0;max-width:720px}
.kicker{display:inline-block;font-size:13px;font-weight:600;letter-spacing:.04em;color:var(--purple);background:var(--tint);border:1px solid var(--tintb);border-radius:999px;padding:2px 12px;text-decoration:none}
h1{font-family:"Frank Ruhl Libre",Georgia,serif;font-size:clamp(30px,4.6vw,46px);line-height:1.18;margin:14px 0 14px;text-wrap:balance;letter-spacing:-.01em}
.lead{font-size:19px;color:var(--body);margin:0 0 18px}
.meta{font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 16px;padding-bottom:22px;border-bottom:1px solid var(--line);margin-bottom:8px}
article h2{font-size:27px;line-height:1.3;margin:44px 0 10px;text-wrap:balance;scroll-margin-top:84px}
article h3{font-size:20px;margin:30px 0 6px;scroll-margin-top:84px}
article p{margin:0 0 16px}article ul,article ol{margin:0 0 18px;padding-inline-start:24px}article li{margin:4px 0}
article blockquote{margin:22px 0;padding:6px 20px;border-inline-start:3px solid var(--lav);color:var(--body);font-size:18px}
ul.check{list-style:none;padding:0}ul.check li{margin:0;border-bottom:1px solid var(--line)}
ul.check label{display:flex;gap:12px;align-items:flex-start;padding:10px 4px;cursor:pointer}
ul.check input{width:19px;height:19px;margin-top:5px;accent-color:var(--purple);flex-shrink:0}
ul.check input:checked+span{color:var(--muted);text-decoration:line-through}
.tbl{overflow-x:auto;margin:6px 0 22px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:15.5px}th,td{padding:10px 14px;text-align:start;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--tint);font-weight:600}tr:last-child td{border-bottom:0}
.call{border-radius:14px;padding:16px 20px 2px;margin:22px 0;background:var(--tint);border:1px solid var(--tintb)}
.call-warn{background:var(--warnbg);border-color:#E9D9A8}.call-note{background:var(--card);border-color:var(--line)}
.call-h{font-weight:700;margin-bottom:4px}
.cta{margin:36px 0;padding:26px 26px 28px;border-radius:18px;background:var(--card);border:1px solid var(--tintb);box-shadow:0 1px 0 var(--line)}
.cta-k{font-size:13px;font-weight:600;color:var(--purple);letter-spacing:.04em}
.cta-t{font-size:22px;font-weight:700;margin:4px 0 6px;line-height:1.35}.cta-b{color:var(--body);margin:0 0 16px}
.toc{position:sticky;top:88px;font-size:14.5px;line-height:1.5}
.toc-h{font-weight:700;margin-bottom:10px;font-size:13px;letter-spacing:.04em;color:var(--muted)}
.toc a{display:block;padding:6px 12px;border-inline-start:2px solid var(--line);color:var(--body);text-decoration:none}
.toc a:hover{border-color:var(--purple);color:var(--purple)}
.side-cta{margin-top:26px;padding:18px;border-radius:14px;background:var(--tint);border:1px solid var(--tintb);font-size:14.5px}
.side-cta b{display:block;font-size:16px;margin-bottom:4px}.side-cta .btn{margin-top:12px;width:100%}
.faq{margin-top:44px}.faq details{border-bottom:1px solid var(--line);padding:4px 0}
.faq summary{cursor:pointer;font-weight:600;padding:12px 0;list-style-position:inside}
.faq details p{margin:0 0 14px;color:var(--body)}
.rel{border-top:1px solid var(--line);padding-block:40px 64px}
.rel h2{font-size:24px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.card{display:flex;flex-direction:column;gap:8px;padding:20px;border-radius:16px;background:var(--card);border:1px solid var(--line);text-decoration:none;color:var(--ink);min-width:0}
.card:hover{border-color:var(--tintb);box-shadow:0 6px 24px rgba(90,61,166,.08)}
.card .ct{font-size:12.5px;font-weight:600;color:var(--purple)}.card .tt{font-size:18px;font-weight:700;line-height:1.35}
.card .dd{font-size:14.5px;color:var(--body);line-height:1.55}
.hero{padding-block:48px 18px}.hero p{max-width:640px;color:var(--body);font-size:19px;margin:0}
.cat{padding-block:26px 8px}.cat h2{font-size:24px;margin:0 0 16px}
footer.bot{border-top:1px solid var(--line);background:var(--tint);font-size:14px;color:var(--body)}
footer.bot .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;padding-block:28px}
footer.bot a{color:var(--body);text-decoration:none}footer.bot a:hover{color:var(--purple)}
.page-body{max-width:760px}
"""

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700&display=swap" rel="stylesheet">')

HEADER = """<header class="top"><div class="wrap">
<a class="logo" href="/"><img src="/brand/seal.png" alt="" width="28" height="28">ShowUp</a>
<nav class="main"><a href="/blog">המדריכים</a><a class="hide-s" href="/rsvp">אישורי הגעה</a><a class="hide-s" href="/#pricing">מחירים</a><a class="btn" href="/wizard">יוצאים לדרך</a></nav>
</div></header>"""


def footer(pages):
    links = "".join(f'<a href="{p["url"]}">{html.escape(p["nav"])}</a>' for p in pages)
    return f"""<footer class="bot"><div class="wrap">
<span>© {dt.date.today().year} ShowUp · אישורי הגעה בוואטסאפ</span>
<a href="/">דף הבית</a><a href="/blog">המדריכים</a>{links}
<a href="/terms">תנאי שימוש</a><a href="/privacy">פרטיות</a><a href="/accessibility">הצהרת נגישות</a>
</div></footer>"""


def head(title, desc, url, *, og_type="website", ld=(), extra=""):
    t, d = html.escape(title), html.escape(desc)
    lds = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title><meta name="description" content="{d}">
<link rel="canonical" href="{url}"><meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:locale" content="he_IL"><meta property="og:site_name" content="ShowUp">
<meta property="og:type" content="{og_type}"><meta property="og:title" content="{t}"><meta property="og:description" content="{d}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{SITE}/brand/og-table.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FAF8F4"><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/brand/seal.png">
{FONTS}<style>{CSS}</style>{lds}{extra}
</head><body>"""


ORG = {"@type": "Organization", "name": "ShowUp", "url": SITE, "logo": f"{SITE}/brand/seal.png"}


def load():
    items = []
    for f in sorted(CONTENT.glob("*.md")):
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
        if not m:
            sys.exit(f"{f.name}: missing front matter")
        try:
            meta = yaml.safe_load(m.group(1))
        except yaml.YAMLError as e:  # usually an unquoted ": " in a title
            sys.exit(f"{f.name}: bad front matter (quote values that contain ': '): {e}")
        meta["body"] = m.group(2)
        meta.setdefault("kind", "article")
        for k in ("slug", "title", "description"):
            if not meta.get(k):
                sys.exit(f"{f.name}: missing {k}")
        meta["date"] = str(meta.get("date") or dt.date.today())
        meta["updated"] = str(meta.get("updated") or meta["date"])
        meta["url"] = f"/blog/{meta['slug']}" if meta["kind"] == "article" else f"/{meta['slug']}"
        meta.setdefault("category", "אישורי הגעה")
        meta.setdefault("nav", meta.get("short") or meta["title"])
        items.append(meta)
    slugs = [x["url"] for x in items]
    dup = {s for s in slugs if slugs.count(s) > 1}
    if dup:
        sys.exit(f"duplicate urls: {dup}")
    return items


def reading_minutes(body):
    words = len(re.findall(r"\S+", body))
    return max(2, round(words / 200))


def he_date(s):
    y, m, d = s.split("-")
    months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
    return f"{int(d)} ב{months[int(m) - 1]} {y}"


def card(p):
    return (f'<a class="card" href="{p["url"]}"><span class="ct">{html.escape(p["category"])}</span>'
            f'<span class="tt">{html.escape(p["title"])}</span><span class="dd">{html.escape(p["description"])}</span></a>')


def related_for(p, items):
    by = {x["slug"]: x for x in items}
    rel = [by[s] for s in p.get("related") or [] if s in by and s != p["slug"]]
    for x in items:
        if len(rel) >= 3:
            break
        if x is not p and x not in rel and x["kind"] == "article" and x["category"] == p["category"]:
            rel.append(x)
    for x in items:
        if len(rel) >= 3:
            break
        if x is not p and x not in rel and x["kind"] == "article":
            rel.append(x)
    return rel[:3]


def page_html(p, items, pages):
    body, toc = render_md(p["body"])
    url = SITE + p["url"]
    is_art = p["kind"] == "article"
    crumbs = [("ShowUp", SITE + "/")]
    if is_art:
        crumbs.append(("המדריכים", SITE + "/blog"))
    crumbs.append((p["title"], url))
    ld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(crumbs)]}]
    if is_art:
        ld.append({"@context": "https://schema.org", "@type": "Article", "headline": p["title"],
                   "description": p["description"], "inLanguage": "he-IL", "datePublished": p["date"],
                   "dateModified": p["updated"], "mainEntityOfPage": url, "image": f"{SITE}/brand/og-table.jpg",
                   "author": {**ORG}, "publisher": {**ORG}})
    else:
        ld.append({"@context": "https://schema.org", "@type": "Service", "name": p["title"], "description": p["description"],
                   "provider": ORG, "areaServed": {"@type": "Country", "name": "Israel"}, "url": url,
                   "offers": {"@type": "AggregateOffer", "priceCurrency": "ILS", "lowPrice": "0", "highPrice": "199"}})
    faq = p.get("faq") or []
    if faq:
        ld.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq]})
    title = p.get("seo_title") or f'{p["title"]} | ShowUp'
    out = [head(title, p["description"], url, og_type="article" if is_art else "website", ld=ld), HEADER]
    cr = " › ".join(f'<a href="{u.replace(SITE, "") or "/"}">{html.escape(n)}</a>' for n, u in crumbs[:-1])
    out.append(f'<main class="wrap"><nav class="crumbs" aria-label="פירורי לחם">{cr}</nav><div class="layout"><article>')
    cat_link = f'<a class="kicker" href="/blog#{slugify_heading(p["category"], set())}">{html.escape(p["category"])}</a>' if is_art else f'<span class="kicker">{html.escape(p.get("kicker") or "ShowUp")}</span>'
    out.append(cat_link)
    out.append(f'<h1>{html.escape(p["title"])}</h1>')
    if p.get("lead"):
        out.append(f'<p class="lead">{_inline(p["lead"])}</p>')
    if is_art:
        upd = f' · עודכן {he_date(p["updated"])}' if p["updated"] != p["date"] else ""
        out.append(f'<div class="meta"><span>צוות ShowUp</span><span>{he_date(p["date"])}{upd}</span><span>{reading_minutes(p["body"])} דקות קריאה</span></div>')
    out.append(body)
    if faq:
        out.append('<section class="faq"><h2 id="faq">שאלות נפוצות</h2>' + "".join(
            f"<details><summary>{html.escape(f['q'])}</summary><p>{_inline(f['a'])}</p></details>" for f in faq) + "</section>")
    if "::: cta" not in p["body"]:
        out.append(CTA_HTML)
    out.append("</article>")
    side = ""
    if len(toc) >= 3:
        side = '<div class="toc"><div class="toc-h">בעמוד הזה</div>' + "".join(
            f'<a href="#{i}">{html.escape(t)}</a>' for i, t in toc) + "</div>"
    out.append(f'<aside class="side">{side}<div class="side-cta"><b>אישורי הגעה בוואטסאפ</b>הזמנה, תזכורות ושיחות טלפון למי שלא ענה. החל מ־₪39 לאירוע.<a class="btn" href="/wizard">יוצאים לדרך</a></div></aside>')
    out.append("</div></main>")
    rel = related_for(p, items)
    if rel:
        out.append('<section class="rel"><div class="wrap"><h2>עוד מדריכים</h2><div class="grid">' + "".join(card(r) for r in rel) + "</div></div></section>")
    out.append(footer(pages) + "</body></html>")
    return "\n".join(out)


def index_html(items, pages):
    arts = [x for x in items if x["kind"] == "article"]
    cats = [c for c in CATEGORY_ORDER if any(a["category"] == c for a in arts)] + sorted(
        {a["category"] for a in arts} - set(CATEGORY_ORDER))
    url = SITE + "/blog"
    ld = [{"@context": "https://schema.org", "@type": "Blog", "name": "המדריכים של ShowUp", "url": url, "inLanguage": "he-IL",
           "publisher": ORG, "blogPost": [{"@type": "BlogPosting", "headline": a["title"], "url": SITE + a["url"],
                                           "datePublished": a["date"]} for a in arts]}]
    out = [head("מדריכים לחתונה ולאירועים: אישורי הגעה, תכנון, תקציב והושבה | ShowUp",
                "מדריכים מעשיים לזוגות ולמארחים: איך עושים אישורי הגעה, צ'ק ליסט לחתונה, כמה מנות להתחייב לאולם, וואטסאפ או SMS, סידורי הושבה ועוד.",
                url, ld=ld), HEADER]
    out.append('<main class="wrap"><section class="hero"><span class="kicker">המדריכים</span>'
               '<h1>כל מה שצריך לדעת לפני האירוע</h1>'
               '<p>מדריכים מעשיים לזוגות, להורים ולמארחים: אישורי הגעה, לוחות זמנים, תקציב, התחייבות לאולם, הושבה, וכל הדברים הקטנים שקל לשכוח.</p></section>')
    for c in cats:
        cid = slugify_heading(c, set())
        out.append(f'<section class="cat"><h2 id="{cid}">{html.escape(c)}</h2><div class="grid">' +
                   "".join(card(a) for a in arts if a["category"] == c) + "</div></section>")
    out.append('<div style="padding-block:24px 64px">' + CTA_HTML + "</div></main>")
    out.append(footer(pages) + "</body></html>")
    return "\n".join(out)


def sitemap(items):
    today = dt.date.today().isoformat()
    rows = [(SITE + u, today if u == "/" else "2026-11-07", pr, fq) for u, pr, fq in SPA_PAGES]
    rows.append((SITE + "/blog", today, "0.8", "weekly"))
    for x in items:
        rows.append((SITE + x["url"], x["updated"], "0.9" if x["kind"] == "page" else "0.7", "monthly"))
    body = "".join(f"<url><loc>{u}</loc><lastmod>{d}</lastmod><changefreq>{f}</changefreq><priority>{p}</priority></url>"
                   for u, d, p, f in rows)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n'


def main():
    items = load()
    pages = [x for x in items if x["kind"] == "page" and x.get("in_footer", True)]
    # Clean previous output so a removed article does not linger.
    blog_out = OUT / "blog"
    if blog_out.exists():
        for f in sorted(blog_out.rglob("*"), reverse=True):
            f.unlink() if f.is_file() else f.rmdir()
    for x in items:
        d = OUT / x["url"].lstrip("/")
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page_html(x, items, pages), encoding="utf-8")
    blog_out.mkdir(parents=True, exist_ok=True)
    (blog_out / "index.html").write_text(index_html(items, pages), encoding="utf-8")
    (OUT / "sitemap.xml").write_text(sitemap(items), encoding="utf-8")
    (OUT / "robots.txt").write_text(ROBOTS, encoding="utf-8")
    print(f"built {len(items)} pages ({sum(x['kind'] == 'article' for x in items)} articles)")


if __name__ == "__main__":
    main()
