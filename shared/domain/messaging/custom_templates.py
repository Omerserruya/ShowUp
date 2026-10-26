"""Admin-authored WhatsApp templates (Template Studio) - pure domain logic.

A custom template is ONE JSON document (stored in the `custom_templates` table,
see core-service migrations.ensure_custom_templates). This module owns everything
about that document that does not need I/O:

  * normalization + validation against WhatsApp/Meta template rules,
  * logical `{{guest_name}}` variables -> Meta positional `{{1}}` (order of first
    appearance) with examples from the canonical variable samples,
  * the Meta CREATE / EDIT payloads,
  * a WhatsApp-like text rendering for previews,
  * conversion to a catalog `Template` so the EXISTING send path
    (resolver -> meta_adapter -> outpost) delivers it unchanged.

It is strictly ADDITIVE to the frozen messaging architecture: catalog templates
never pass through here. A campaign addresses a custom template as
`custom__<key>`; `resolve_template()` hands such refs to its db_lookup, which
returns the DB row, and `template_from_custom_row()` builds the Template. Only
the row's LIVE (Meta-approved) snapshot is ever deliverable, and only for guest
stage groups.

Document shape (all keys optional except name/title/body):

    {
      "name": "invite_garden_v1",        # Meta template name == table key
      "title": "הזמנה - גן",              # Hebrew display name (admin only)
      "group": "invitation",             # guest stage | "flow" | "host"
      "language": "he",
      "category": "MARKETING" | "UTILITY",
      "header": {"type": "none"} | {"type": "text", "text": "..."} |
                {"type": "image", "url": "https://...", "source": "event"|"fixed"},
      "body": "היי {{guest_name}}, ...",
      "footer": "...",
      "buttons": [{"type": "QUICK_REPLY", "text": "מגיעים!", "action": "rsvp_accepted"}]
               | [{"type": "URL", "text": "להזמנה", "url_var": "invitation_link", "url": ""}],
      "notes": "...",
      "event_types": ["wedding"],        # empty = every event type
      "samples": {"custom_var": "..."}   # examples for non-registry vars (flow/host only)
    }
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote

from .catalog import (
    Template, MetaMapping, MetaShape, MetaSlot, MetaButton, MetaConfig, DeliveryKind,
    TemplateCategory, Tone, CtaType, QuickReplyButton, UrlButton,
)
from .event_types import EVENT_TYPES
from .stages import FlowStage, STAGE_ORDER, canonical_stage
from .variables import VARIABLES, canonical_var_name

# --------------------------------------------------------------------------- #
# Vocabulary
# --------------------------------------------------------------------------- #

CUSTOM_REF_PREFIX = "custom__"

GUEST_GROUPS: Tuple[str, ...] = tuple(s.value for s in STAGE_ORDER)
FLOW_GROUP = "flow"
HOST_GROUP = "host"
GROUPS: Tuple[str, ...] = GUEST_GROUPS + (FLOW_GROUP, HOST_GROUP)

GROUP_LABELS_HE: Dict[str, str] = {
    "save_the_date": "שמרו את התאריך",
    "invitation": "הזמנה",
    "reminder": "תזכורת",
    "final_reminder": "תזכורת אחרונה",
    "table_assignment": "שיבוץ שולחן",
    "thank_you": "תודה",
    FLOW_GROUP: "בונה השיחה",
    HOST_GROUP: "למארחים",
}

CATEGORIES: Tuple[str, ...] = ("MARKETING", "UTILITY")
STATUSES: Tuple[str, ...] = ("draft", "pending", "approved", "rejected", "paused", "disabled")
STATUS_LABELS_HE: Dict[str, str] = {
    "draft": "טיוטה", "pending": "ממתין לאישור Meta", "approved": "מאושר",
    "rejected": "נדחה", "paused": "מושהה", "disabled": "מושבת",
}

HEADER_TYPES = ("none", "text", "image")
QUICK_REPLY = "QUICK_REPLY"
URL = "URL"
QR_ACTIONS = ("rsvp_accepted", "rsvp_declined", "rsvp_maybe")

LIMITS = {
    "name": 80,          # table key; Meta allows 512 but we keep room for `_vN`
    "title": 120,
    "body": 1024,
    "header_text": 60,
    "footer": 60,
    "button_text": 25,
    "quick_replies": 3,
    "url_buttons": 2,
    "url": 2000,
}

# Variables that are not copy tokens (media), so never allowed in text.
NON_TEXT_VARS = frozenset({"header_image_url", "cover_image"})

# Link variables a URL button may append as its single trailing `{{1}}`. At send
# time meta_adapter passes the LAST path segment of the resolved link, so the
# static base must end right before it.
_PUBLIC_BASE = os.getenv("PUBLIC_BASE_URL", "https://app.showup.co.il").rstrip("/")
BUTTON_URL_VARS: Dict[str, Dict[str, str]] = {
    "invitation_link": {"label_he": "דף ההזמנה האישי", "base": f"{_PUBLIC_BASE}/i/", "sample": "demo"},
    "rsvp_link": {"label_he": "דף אישור ההגעה", "base": f"{_PUBLIC_BASE}/r/", "sample": "demo"},
    "nav_link": {"label_he": "ניווט ב-Waze", "base": "https://www.waze.com/",
                 "sample": "ul?q=" + quote("Tel Aviv") + "&navigate=yes"},
}

# Canonical variable -> conversation-flow variable (flow builder param strings use
# `{var}` single-brace flow vars, shared/domain/flow_config.BASE_VARS).
FLOW_VAR_FOR: Dict[str, str] = {
    "guest_name": "guest_name", "guest_first_name": "guest_name",
    "event_name": "event_name",
    "host_name": "host_name", "host_display_name": "host_name", "couple_names": "host_name",
    "event_date": "event_date", "event_time": "event_time",
    "venue_name": "venue", "venue_address": "venue",
}

NAME_RE = re.compile(r"^[a-z0-9_]+$")
VAR_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
LANG_RE = re.compile(r"^[a-z]{2,3}(_[A-Z]{2})?$")
# Any {{...}} token (permissive, so invalid tokens can be reported).
TOKEN_RE = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
_ADJACENT_RE = re.compile(r"\}\}\s*\{\{")
_SINGLE_BRACE_RE = re.compile(r"(?<!\{)\{\s*[a-z_]+\s*\}(?!\})")


def is_custom_ref(ref: Any) -> bool:
    return isinstance(ref, str) and ref.strip().startswith(CUSTOM_REF_PREFIX)


def custom_ref(key: str) -> str:
    return f"{CUSTOM_REF_PREFIX}{key}"


def key_from_ref(ref: str) -> str:
    s = (ref or "").strip()
    return s[len(CUSTOM_REF_PREFIX):] if s.startswith(CUSTOM_REF_PREFIX) else s


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #

def _s(v: Any) -> str:
    return "" if v is None else str(v)


def _canon_tokens(text: str) -> str:
    """Rewrite legacy Hebrew tokens ({{שם}}) and spacing ({{ guest_name }}) to
    the canonical `{{guest_name}}` form. Unknown tokens are kept verbatim so
    validation can report them."""
    def repl(m):
        raw = m.group(1).strip()
        canon = canonical_var_name(raw)
        return "{{%s}}" % (canon or raw)
    return TOKEN_RE.sub(repl, text or "")


def coerce_json(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def normalize_doc(raw: Any) -> Dict[str, Any]:
    """A clean, fully-keyed document. Never raises on odd input - validation
    reports problems; this only shapes."""
    d = raw if isinstance(raw, dict) else {}
    header_in = d.get("header") if isinstance(d.get("header"), dict) else {}
    htype = _s(header_in.get("type") or "none").strip().lower()
    header: Dict[str, Any] = {"type": htype}
    if htype == "text":
        header["text"] = _canon_tokens(_s(header_in.get("text")).strip())
    elif htype == "image":
        header["url"] = _s(header_in.get("url")).strip()
        header["source"] = "fixed" if _s(header_in.get("source")).strip() == "fixed" else "event"

    buttons: List[Dict[str, Any]] = []
    for b in (d.get("buttons") or []) if isinstance(d.get("buttons"), list) else []:
        if not isinstance(b, dict):
            continue
        btype = _s(b.get("type")).strip().upper().replace("-", "_")
        if btype in ("QUICKREPLY", "QR"):
            btype = QUICK_REPLY
        item: Dict[str, Any] = {"type": btype, "text": _s(b.get("text") or b.get("label")).strip()}
        if btype == QUICK_REPLY:
            action = _s(b.get("action")).strip().lower()
            if action:
                item["action"] = action
        elif btype == URL:
            item["url_var"] = _s(b.get("url_var")).strip()
            item["url"] = _s(b.get("url")).strip()
        buttons.append(item)

    samples_in = d.get("samples") if isinstance(d.get("samples"), dict) else {}
    ets = d.get("event_types") if isinstance(d.get("event_types"), list) else []
    return {
        "name": _s(d.get("name")).strip(),
        "title": _s(d.get("title")).strip(),
        "group": _s(d.get("group") or "invitation").strip(),
        "language": _s(d.get("language") or "he").strip(),
        "category": _s(d.get("category") or "UTILITY").strip().upper(),
        "header": header,
        "body": _canon_tokens(_s(d.get("body")).strip()),
        "footer": _s(d.get("footer")).strip(),
        "buttons": buttons,
        "notes": _s(d.get("notes")).strip(),
        "event_types": sorted({_s(e).strip().lower() for e in ets if _s(e).strip()}),
        "samples": {str(k).strip(): _s(v) for k, v in samples_in.items() if str(k).strip()},
    }


# --------------------------------------------------------------------------- #
# Variables
# --------------------------------------------------------------------------- #

def tokens(text: str) -> List[str]:
    return [m.group(1).strip() for m in TOKEN_RE.finditer(text or "")]


def ordered_vars(text: str) -> List[str]:
    out: List[str] = []
    for t in tokens(text):
        if t not in out:
            out.append(t)
    return out


def to_positional(text: str) -> Tuple[str, List[str]]:
    """`{{guest_name}} ... {{event_date}} ... {{guest_name}}` ->
    (`{{1}} ... {{2}} ... {{1}}`, [guest_name, event_date])."""
    order: List[str] = []

    def repl(m):
        name = m.group(1).strip()
        if name not in order:
            order.append(name)
        return "{{%d}}" % (order.index(name) + 1)

    return TOKEN_RE.sub(repl, text or ""), order


def sample_for(var: str, doc: Optional[Dict[str, Any]] = None) -> str:
    if doc and (doc.get("samples") or {}).get(var):
        return str(doc["samples"][var])
    v = VARIABLES.get(var)
    return v.sample if v else var


def sample_values(doc: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    vals = {k: v.sample for k, v in VARIABLES.items()}
    if doc:
        vals.update({k: str(v) for k, v in (doc.get("samples") or {}).items()})
    return vals


def header_var(doc: Dict[str, Any]) -> Optional[str]:
    h = doc.get("header") or {}
    if h.get("type") != "text":
        return None
    vs = ordered_vars(h.get("text") or "")
    return vs[0] if vs else None


def param_hints(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One entry per positional BODY parameter, in Meta order - what a sender
    (e.g. the flow builder's resend_template) must supply."""
    out = []
    for i, var in enumerate(ordered_vars(doc.get("body") or ""), start=1):
        meta = VARIABLES.get(var)
        flow = FLOW_VAR_FOR.get(var)
        out.append({
            "index": i, "var": var,
            "label_he": meta.label_he if meta else var,
            "sample": sample_for(var, doc),
            "flow_var": flow,
            "suggested": "{%s}" % flow if flow else "",
        })
    return out


def variables_catalog() -> List[Dict[str, Any]]:
    """Allowed variables (for the editor chips) from the canonical registry."""
    return [
        {"name": v.name, "label_he": v.label_he, "sample": v.sample, "scope": v.scope.value,
         "in_text": v.name not in NON_TEXT_VARS, "flow_var": FLOW_VAR_FOR.get(v.name)}
        for v in VARIABLES.values()
    ]


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

def _issue(field: str, code: str, message: str) -> Dict[str, str]:
    return {"field": field, "code": code, "message": message}


def _check_vars(text: str, field: str, doc: Dict[str, Any], errors: List[dict], warnings: List[dict]) -> None:
    allow_custom = doc.get("group") in (FLOW_GROUP, HOST_GROUP)
    for name in ordered_vars(text):
        if not VAR_NAME_RE.match(name):
            errors.append(_issue(field, "invalid_var",
                                 f"המשתנה {{{{{name}}}}} לא תקין - יש להשתמש במשתנים בשם באנגלית, למשל {{{{guest_name}}}}"))
            continue
        if name in NON_TEXT_VARS:
            errors.append(_issue(field, "media_var", f"המשתנה {{{{{name}}}}} הוא תמונה ולא יכול להופיע בטקסט"))
            continue
        if name in VARIABLES:
            continue
        if not allow_custom:
            errors.append(_issue(field, "unknown_var",
                                 f"המשתנה {{{{{name}}}}} לא מוכר. בתבניות לאורחים אפשר להשתמש רק במשתנים מהרשימה"))
        elif not (doc.get("samples") or {}).get(name):
            errors.append(_issue(field, "missing_sample",
                                 f"חסרה דוגמה למשתנה {{{{{name}}}}} - Meta דורשת דוגמה לכל משתנה"))
        else:
            warnings.append(_issue(field, "custom_var",
                                   f"{{{{{name}}}}} הוא משתנה מותאם - השולח יצטרך לספק לו ערך"))


def validate_doc(raw: Any, *, reserved_names: Iterable[str] = ()) -> Dict[str, List[Dict[str, str]]]:
    """Meta/WhatsApp template rules. Returns {"errors": [...], "warnings": [...]}
    where each issue is {field, code, message(Hebrew)}. `reserved_names` are
    Meta names already taken (catalog/system/other custom templates)."""
    doc = normalize_doc(raw)
    errors: List[dict] = []
    warnings: List[dict] = []

    name = doc["name"]
    if not name:
        errors.append(_issue("name", "required", "חסר שם תבנית ל-Meta"))
    elif not NAME_RE.match(name):
        errors.append(_issue("name", "invalid", "שם התבנית יכול להכיל רק אותיות אנגליות קטנות, ספרות וקו תחתון"))
    elif len(name) > LIMITS["name"]:
        errors.append(_issue("name", "too_long", f"שם התבנית ארוך מדי (עד {LIMITS['name']} תווים)"))
    elif "__" in name or name.startswith("_") or name.endswith("_"):
        errors.append(_issue("name", "reserved", "השם לא יכול להכיל שני קווים תחתונים רצופים או להתחיל/להסתיים בקו תחתון"))
    elif name in set(reserved_names):
        errors.append(_issue("name", "taken", "השם כבר תפוס על ידי תבנית אחרת"))

    if not doc["title"]:
        errors.append(_issue("title", "required", "חסר שם תצוגה"))
    elif len(doc["title"]) > LIMITS["title"]:
        errors.append(_issue("title", "too_long", f"שם התצוגה ארוך מדי (עד {LIMITS['title']} תווים)"))

    if doc["group"] not in GROUPS:
        errors.append(_issue("group", "invalid", "קבוצה לא מוכרת"))
    if not LANG_RE.match(doc["language"]):
        errors.append(_issue("language", "invalid", "קוד שפה לא תקין (למשל he או en_US)"))
    if doc["category"] not in CATEGORIES:
        errors.append(_issue("category", "invalid", "הקטגוריה חייבת להיות MARKETING או UTILITY"))

    # --- body
    body = doc["body"]
    if not body:
        errors.append(_issue("body", "required", "גוף ההודעה ריק"))
    else:
        numbered, order = to_positional(body)
        if len(numbered) > LIMITS["body"]:
            errors.append(_issue("body", "too_long", f"גוף ההודעה ארוך מדי ({len(numbered)}/{LIMITS['body']} תווים)"))
        _check_vars(body, "body", doc, errors, warnings)
        if TOKEN_RE.match(body):
            errors.append(_issue("body", "var_at_start", "ההודעה לא יכולה להתחיל במשתנה - הוסיפו טקסט לפניו"))
        if re.search(r"\{\{[^{}]*\}\}\s*$", body):
            errors.append(_issue("body", "var_at_end", "ההודעה לא יכולה להסתיים במשתנה - הוסיפו טקסט אחריו (גם נקודה מספיקה)"))
        if _ADJACENT_RE.search(body):
            errors.append(_issue("body", "adjacent_vars", "אסור ששני משתנים יופיעו צמודים - צריך טקסט ביניהם"))
        if _SINGLE_BRACE_RE.search(body):
            warnings.append(_issue("body", "single_brace",
                                   "נראה שיש משתנה בסוגריים בודדים - בתבניות משתמשים בסוגריים כפולים {{...}}"))
        if order:
            words = len(re.sub(TOKEN_RE, " ", body).split())
            if words < 2 * len(order) + 1:
                warnings.append(_issue("body", "var_density",
                                       "יש הרבה משתנים ביחס לאורך הטקסט - Meta עלולה לדחות. הוסיפו עוד מילים"))
        if "\n\n\n" in body:
            warnings.append(_issue("body", "blank_lines", "יותר משתי שורות ריקות ברצף - Meta עלולה לדחות"))

    # --- header
    h = doc["header"]
    if h["type"] not in HEADER_TYPES:
        errors.append(_issue("header", "invalid", "סוג כותרת לא מוכר"))
    elif h["type"] == "text":
        txt = h.get("text") or ""
        if not txt:
            errors.append(_issue("header", "required", "כותרת טקסט ריקה - מלאו אותה או בחרו 'ללא כותרת'"))
        else:
            if len(to_positional(txt)[0]) > LIMITS["header_text"]:
                errors.append(_issue("header", "too_long", f"הכותרת ארוכה מדי (עד {LIMITS['header_text']} תווים)"))
            if len(ordered_vars(txt)) > 1 or len(tokens(txt)) > 1:
                errors.append(_issue("header", "too_many_vars", "בכותרת מותר משתנה אחד לכל היותר"))
            if "\n" in txt:
                errors.append(_issue("header", "newline", "הכותרת חייבת להיות שורה אחת"))
            if "*" in txt or "~" in txt:
                warnings.append(_issue("header", "formatting", "Meta לא מציגה עיצוב (*מודגש*) בכותרת"))
            _check_vars(txt, "header", doc, errors, warnings)
    elif h["type"] == "image":
        url = h.get("url") or ""
        if not re.match(r"^https?://", url):
            errors.append(_issue("header", "image_url", "לכותרת תמונה צריך קישור לתמונה לדוגמה (https://...)"))
        elif not re.search(r"\.(jpe?g|png)(\?.*)?$", url, re.I):
            warnings.append(_issue("header", "image_type", "Meta מקבלת תמונות JPG או PNG בלבד"))

    # --- footer
    footer = doc["footer"]
    if footer:
        if len(footer) > LIMITS["footer"]:
            errors.append(_issue("footer", "too_long", f"הכותרת התחתונה ארוכה מדי (עד {LIMITS['footer']} תווים)"))
        if "{{" in footer or "}}" in footer:
            errors.append(_issue("footer", "vars", "אי אפשר להשתמש במשתנים בכותרת התחתונה"))

    # --- buttons
    btns = doc["buttons"]
    kinds = {b["type"] for b in btns}
    if kinds - {QUICK_REPLY, URL}:
        errors.append(_issue("buttons", "invalid", "סוג כפתור לא מוכר"))
    if len(kinds & {QUICK_REPLY, URL}) > 1:
        errors.append(_issue("buttons", "mixed", "אפשר לבחור כפתורי תשובה מהירה או כפתורי קישור - לא את שניהם"))
    n_qr = sum(1 for b in btns if b["type"] == QUICK_REPLY)
    n_url = sum(1 for b in btns if b["type"] == URL)
    if n_qr > LIMITS["quick_replies"]:
        errors.append(_issue("buttons", "too_many", f"עד {LIMITS['quick_replies']} כפתורי תשובה מהירה"))
    if n_url > LIMITS["url_buttons"]:
        errors.append(_issue("buttons", "too_many", f"עד {LIMITS['url_buttons']} כפתורי קישור"))
    seen = set()
    for i, b in enumerate(btns):
        f = f"buttons[{i}]"
        t = b.get("text") or ""
        if not t:
            errors.append(_issue(f, "required", f"לכפתור {i + 1} חסר טקסט"))
        elif len(t) > LIMITS["button_text"]:
            errors.append(_issue(f, "too_long", f"הטקסט של כפתור {i + 1} ארוך מדי (עד {LIMITS['button_text']} תווים)"))
        if "{{" in t:
            errors.append(_issue(f, "vars", "אי אפשר להשתמש במשתנים בטקסט של כפתור"))
        if t and t in seen:
            errors.append(_issue(f, "duplicate", "לשני כפתורים אותו טקסט"))
        seen.add(t)
        if b["type"] == QUICK_REPLY:
            if b.get("action") and b["action"] not in QR_ACTIONS:
                errors.append(_issue(f, "action", "פעולת כפתור לא מוכרת"))
        elif b["type"] == URL:
            uv = b.get("url_var") or ""
            url = b.get("url") or ""
            if uv and uv not in BUTTON_URL_VARS:
                errors.append(_issue(f, "url_var", "סוג קישור לא נתמך"))
            if uv and doc["group"] not in GUEST_GROUPS:
                warnings.append(_issue(f, "url_var_group", "קישור אישי מתמלא רק בשליחה לאורחים"))
            if not uv and not url:
                errors.append(_issue(f, "url", f"לכפתור {i + 1} חסר קישור"))
            if url and not url.startswith("https://"):
                errors.append(_issue(f, "url", "הקישור חייב להתחיל ב-https://"))
            if "{{" in url:
                errors.append(_issue(f, "url", "אל תכתבו משתנה בקישור - בחרו 'קישור אישי' והוא יתווסף אוטומטית"))
            if len(url) > LIMITS["url"]:
                errors.append(_issue(f, "url", "הקישור ארוך מדי"))

    # --- event types
    known = {(e.value if hasattr(e, "value") else str(e)) for e in EVENT_TYPES}
    bad = [e for e in doc["event_types"] if e not in known]
    if bad:
        errors.append(_issue("event_types", "invalid", f"סוגי אירוע לא מוכרים: {', '.join(bad)}"))

    if doc["group"] in GUEST_GROUPS and doc["category"] == "UTILITY" and doc["group"] in ("save_the_date", "thank_you"):
        warnings.append(_issue("category", "category_hint",
                               "Meta מסווגת לרוב הודעות כאלה כ-MARKETING - היא עשויה לשנות את הקטגוריה"))
    return {"errors": errors, "warnings": warnings}


# --------------------------------------------------------------------------- #
# Meta payloads
# --------------------------------------------------------------------------- #

HEADER_HANDLE_PLACEHOLDER = "PLACEHOLDER_UPLOAD_A_HEADER_HANDLE"


def url_button_base(b: Dict[str, Any]) -> str:
    uv = b.get("url_var") or ""
    if uv:
        return (b.get("url") or BUTTON_URL_VARS.get(uv, {}).get("base") or "")
    return b.get("url") or ""


def build_components(raw: Any, *, header_handle: Optional[str] = None) -> List[Dict[str, Any]]:
    doc = normalize_doc(raw)
    comps: List[Dict[str, Any]] = []
    h = doc["header"]
    if h["type"] == "text" and h.get("text"):
        numbered, order = to_positional(h["text"])
        comp: Dict[str, Any] = {"type": "HEADER", "format": "TEXT", "text": numbered}
        if order:
            comp["example"] = {"header_text": [sample_for(order[0], doc)]}
        comps.append(comp)
    elif h["type"] == "image":
        comps.append({"type": "HEADER", "format": "IMAGE",
                      "example": {"header_handle": [header_handle or HEADER_HANDLE_PLACEHOLDER]}})

    numbered, order = to_positional(doc["body"])
    body: Dict[str, Any] = {"type": "BODY", "text": numbered}
    if order:
        body["example"] = {"body_text": [[sample_for(v, doc) for v in order]]}
    comps.append(body)

    if doc["footer"]:
        comps.append({"type": "FOOTER", "text": doc["footer"]})

    buttons: List[Dict[str, Any]] = []
    for b in doc["buttons"]:
        if b["type"] == QUICK_REPLY:
            buttons.append({"type": "QUICK_REPLY", "text": b["text"]})
        elif b["type"] == URL:
            uv = b.get("url_var") or ""
            base = url_button_base(b)
            if uv:
                buttons.append({"type": "URL", "text": b["text"], "url": base + "{{1}}",
                                "example": [base + BUTTON_URL_VARS.get(uv, {}).get("sample", "demo")]})
            else:
                buttons.append({"type": "URL", "text": b["text"], "url": base})
    if buttons:
        comps.append({"type": "BUTTONS", "buttons": buttons})
    return comps


def build_create_payload(raw: Any, *, name: Optional[str] = None,
                         header_handle: Optional[str] = None) -> Dict[str, Any]:
    """The exact body POSTed to `/{waba_id}/message_templates`."""
    doc = normalize_doc(raw)
    return {
        "name": name or doc["name"],
        "language": doc["language"],
        "category": doc["category"],
        "components": build_components(doc, header_handle=header_handle),
    }


def build_edit_payload(raw: Any, *, header_handle: Optional[str] = None,
                       include_category: bool = True) -> Dict[str, Any]:
    """The body POSTed to `/{template_id}` (Meta's edit endpoint). Category may
    only change while a template is not approved."""
    doc = normalize_doc(raw)
    out: Dict[str, Any] = {"components": build_components(doc, header_handle=header_handle)}
    if include_category:
        out["category"] = doc["category"]
    return out


def needs_header_handle(raw: Any) -> bool:
    return normalize_doc(raw)["header"]["type"] == "image"


def docs_equal(a: Any, b: Any) -> bool:
    """Content equality of two docs (what Meta would see + routing fields)."""
    if a is None or b is None:
        return a is b
    return json.dumps(normalize_doc(a), sort_keys=True, ensure_ascii=False) == \
        json.dumps(normalize_doc(b), sort_keys=True, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# Rendering (preview)
# --------------------------------------------------------------------------- #

def _fill(text: str, values: Dict[str, str]) -> str:
    def repl(m):
        name = m.group(1).strip()
        v = values.get(name)
        return m.group(0) if v is None else str(v)
    return TOKEN_RE.sub(repl, text or "")


def render(raw: Any, values: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """What the guest sees: header/body/footer/buttons filled with `values`
    (defaults to the canonical samples) + a single plain-text rendering."""
    doc = normalize_doc(raw)
    vals = sample_values(doc)
    if values:
        vals.update({k: ("" if v is None else str(v)) for k, v in values.items()})
    h = doc["header"]
    header_text = _fill(h.get("text") or "", vals) if h["type"] == "text" else None
    header_image = None
    if h["type"] == "image":
        header_image = (h.get("url") if h.get("source") == "fixed" else vals.get("header_image_url")) or h.get("url")
    body = _fill(doc["body"], vals)
    buttons = []
    for b in doc["buttons"]:
        item = {"type": b["type"], "text": b["text"]}
        if b["type"] == URL:
            uv = b.get("url_var") or ""
            item["url"] = (vals.get(uv) or url_button_base(b)) if uv else url_button_base(b)
        buttons.append(item)
    parts = []
    if header_text:
        parts.append(f"*{header_text}*")
    parts.append(body)
    if doc["footer"]:
        parts.append(doc["footer"])
    if buttons:
        parts.append("\n".join(f"[{b['text']}]" for b in buttons))
    return {"header_text": header_text, "header_image": header_image, "body": body,
            "footer": doc["footer"] or None, "buttons": buttons, "text": "\n\n".join(parts)}


# --------------------------------------------------------------------------- #
# Send-path bridge -> catalog Template
# --------------------------------------------------------------------------- #

def _shape(doc: Dict[str, Any]) -> Tuple[TemplateCategory, CtaType]:
    btns = doc["buttons"]
    if doc["header"]["type"] == "image":
        cat = TemplateCategory.WITH_IMAGE
    elif any(b["type"] == QUICK_REPLY for b in btns):
        cat = TemplateCategory.WITH_RSVP_BUTTON
    elif any(b.get("url_var") == "nav_link" for b in btns):
        cat = TemplateCategory.WITH_NAV_BUTTON
    elif any(b["type"] == URL for b in btns):
        cat = TemplateCategory.WITH_DETAILS_BUTTON
    else:
        cat = TemplateCategory.TEXT_ONLY
    if any(b["type"] == QUICK_REPLY for b in btns):
        cta = CtaType.QUICK_REPLY_CONFIRM
    elif any(b.get("url_var") == "nav_link" for b in btns):
        cta = CtaType.NAVIGATION
    elif any(b.get("url_var") == "rsvp_link" for b in btns):
        cta = CtaType.RSVP
    elif any(b["type"] == URL for b in btns):
        cta = CtaType.VIEW_INVITATION
    else:
        cta = CtaType.NONE
    return cat, cta


def template_from_doc(raw: Any, *, key: str, meta_name: Optional[str], deliverable: bool,
                      version: int = 1) -> Template:
    """A catalog `Template` for a custom doc. With `deliverable` it carries a
    STRUCTURED MetaMapping to `meta_name` (body slots in positional order, image
    header from the event media chain or a fixed URL, URL-button suffixes), so
    meta_adapter.build_meta_message delivers it like any catalog template."""
    doc = normalize_doc(raw)
    stage = canonical_stage(doc["group"]) or FlowStage.INVITATION
    cat, cta = _shape(doc)
    body_vars = ordered_vars(doc["body"])
    h = doc["header"]
    url_buttons_raw = [b for b in doc["buttons"] if b["type"] == URL]
    meta = None
    if deliverable and meta_name:
        meta = MetaMapping(
            template_name=meta_name,
            language=doc["language"],
            shape=MetaShape.STRUCTURED,
            body=tuple(MetaSlot(var=v, default=(doc["samples"].get(v, "") if v not in VARIABLES else ""))
                       for v in body_vars),
            header_image_var="header_image_url" if h["type"] == "image" else None,
            buttons=tuple(MetaButton(index=i, var=b["url_var"], type="url", default="")
                          for i, b in enumerate(url_buttons_raw) if b.get("url_var")),
        )
    metadata: Dict[str, Any] = {"source": "custom", "custom_key": key, "group": doc["group"]}
    if h["type"] == "text":
        metadata["header"] = h.get("text") or ""
        hv = header_var(doc)
        if hv:
            metadata["header_text_var"] = hv
    if h["type"] == "image" and h.get("source") == "fixed" and h.get("url"):
        metadata["header_image_fixed"] = h["url"]
    if doc["footer"]:
        metadata["footer"] = doc["footer"]
    if doc["buttons"]:
        metadata["button"] = doc["buttons"][0]["text"]
    all_vars = list(dict.fromkeys(([header_var(doc)] if header_var(doc) else []) + body_vars
                                  + [b["url_var"] for b in url_buttons_raw if b.get("url_var")]
                                  + (["header_image_url"] if h["type"] == "image" else [])))
    return Template(
        key=custom_ref(key),
        flow_stage=stage,
        category=cat,
        tone=Tone.WARM,
        cta_type=cta,
        title=doc["title"] or key,
        body=doc["body"],
        language=doc["language"],
        event_types=tuple(doc["event_types"]),
        lifecycle="approved" if meta is not None else "draft",
        delivery=DeliveryKind.META_TEMPLATE,
        meta=meta,
        description=doc["notes"],
        variables=tuple(all_vars),
        version=int(version or 1),
        metadata=metadata,
        meta_config=MetaConfig(name=meta_name or doc["name"] or key, language=doc["language"],
                               category=doc["category"]),
        quick_replies=tuple(QuickReplyButton(label=b["text"], action=b.get("action") or "")
                            for b in doc["buttons"] if b["type"] == QUICK_REPLY),
        url_buttons=tuple(UrlButton(label=b["text"], url_var=b["url_var"])
                          for b in url_buttons_raw if b.get("url_var")),
    )


def live_of(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The row's LIVE (approved on Meta) snapshot, or None."""
    live = coerce_json(row.get("live")) if row else None
    if isinstance(live, dict) and live.get("status") == "approved" and live.get("meta_name") \
            and isinstance(coerce_json(live.get("doc")), dict):
        return live
    return None


def template_from_custom_row(row: Optional[Dict[str, Any]]) -> Optional[Template]:
    """Resolver bridge (db_lookup result -> Template). Deliverable ONLY when the
    row has an approved live snapshot AND it belongs to a guest stage group;
    otherwise a non-usable Template (so the campaign gate rejects it clearly)."""
    if not row:
        return None
    key = str(row.get("key") or "")
    live = live_of(row)
    if live is not None:
        live_doc = coerce_json(live.get("doc"))
        group = normalize_doc(live_doc)["group"]
        return template_from_doc(live_doc, key=key, meta_name=live["meta_name"],
                                 deliverable=group in GUEST_GROUPS, version=int(live.get("version") or 1))
    doc = coerce_json(row.get("doc")) or {}
    return template_from_doc(doc, key=key, meta_name=None, deliverable=False,
                             version=int(row.get("version") or 1))


# --------------------------------------------------------------------------- #
# Import helpers - turn an existing catalog/system template into a draft doc
# --------------------------------------------------------------------------- #

def doc_from_catalog_template(t: Template, *, name: str, title: Optional[str] = None,
                              group: Optional[str] = None) -> Dict[str, Any]:
    header: Dict[str, Any] = {"type": "none"}
    if t.category == TemplateCategory.WITH_IMAGE or (t.meta and t.meta.header_image_var):
        header = {"type": "image", "url": VARIABLES["header_image_url"].sample, "source": "event"}
    elif isinstance(t.metadata.get("header"), str) and t.metadata["header"].strip() \
            and "[[" not in t.metadata["header"]:
        header = {"type": "text", "text": t.metadata["header"].strip()}
    buttons: List[Dict[str, Any]] = []
    if t.quick_replies:
        buttons = [{"type": QUICK_REPLY, "text": b.label, "action": b.action} for b in t.quick_replies[:3]]
    elif t.url_buttons:
        buttons = [{"type": URL, "text": b.label, "url_var": b.url_var, "url": ""}
                   for b in t.url_buttons[:2] if b.url_var in BUTTON_URL_VARS]
    cfg = t.meta_config
    return normalize_doc({
        "name": name,
        "title": title or t.title,
        "group": group or t.flow_stage.value,
        "language": (cfg.language if cfg else None) or t.language,
        "category": (cfg.category if cfg else None) or "UTILITY",
        "header": header,
        "body": t.body if "[[" not in (t.body or "") else "",
        "footer": "",
        "buttons": buttons,
        "notes": f"שוכפל מתבנית הקטלוג {t.key}",
        "event_types": list(t.event_types),
    })


def doc_from_system_template(st: Any, *, name: str, title: Optional[str] = None,
                             group: str = HOST_GROUP) -> Dict[str, Any]:
    """System templates use positional {{n}}; rename to `{{param_n}}` with the
    param description as the sample (the admin should then edit)."""
    body = re.sub(r"\{\{\s*(\d+)\s*\}\}", lambda m: "{{param_%s}}" % m.group(1), st.body or "")
    samples = {f"param_{k}": str(v) for k, v in (st.params or {}).items()}
    return normalize_doc({
        "name": name, "title": title or st.key, "group": group, "language": st.language,
        "category": st.meta_category, "header": {"type": "none"}, "body": body,
        "notes": f"שוכפל מתבנית המערכת {st.key}", "samples": samples,
    })


def suggest_name(title: str, taken: Iterable[str] = ()) -> str:
    """A Meta-safe name from a (possibly Hebrew) title: latin words kept,
    otherwise `template`; uniquified with a numeric suffix."""
    base = re.sub(r"[^a-z0-9]+", "_", (title or "").lower()).strip("_")[:60] or "template"
    base = re.sub(r"_+", "_", base)
    taken_set = set(taken)
    if base not in taken_set:
        return base
    i = 2
    while f"{base}_{i}" in taken_set:
        i += 1
    return f"{base}_{i}"
