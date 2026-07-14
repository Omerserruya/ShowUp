"""Meta template PUBLISHING - pure content-management domain logic.

This module holds NO I/O and NO side effects. It is the shared, testable core the
Admin publishing API builds on:

  * the internal workflow status vocabulary (separate from Meta's review status),
  * a deterministic content CHECKSUM for change detection,
  * the Meta `/message_templates` CREATE payload builder (WhatsApp only), and
  * template SELECTION helpers (one / all / stage / event-type).

It deliberately does NOT know about the DB (where mutable Meta runtime state
lives) or the Graph API (that client lives in core-service). Delivery is
untouched: this never feeds the planner/worker/outpost send path - `meta_adapter`
still owns that. Publishing only manages template DEFINITIONS on Meta.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from enum import Enum
from typing import Dict, List, Optional

from .catalog import (
    BUILTIN_CATALOG, EVENT_CATALOG, VARIANT_NAME_OF,
    Template, TemplateCategory, CtaType, DEFAULT_WAZE_URL,
)
from .variables import VARIABLES
from .stages import canonical_stage


# ---------------------------------------------------------------------------
# Status vocabularies - internal workflow is SEPARATE from Meta's review status.
# ---------------------------------------------------------------------------

class InternalStatus(str, Enum):
    """The editorial/workflow state a template moves through internally. Distinct
    from Meta's review status (a template can be internally `published` while Meta
    still reports `pending`)."""
    DRAFT = "draft"
    READY_FOR_REVIEW = "ready_for_review"
    APPROVED_INTERNAL = "approved_internal"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"


class MetaStatus(str, Enum):
    """Meta's WhatsApp template review status (mirrors the Graph API values)."""
    NONE = "none"          # never uploaded
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAUSED = "paused"
    DISABLED = "disabled"


class MetaCategory(str, Enum):
    MARKETING = "MARKETING"
    UTILITY = "UTILITY"
    AUTHENTICATION = "AUTHENTICATION"


# Allowed internal-status transitions (admin-driven). Publishing sets PUBLISHED;
# an admin can DEPRECATE from anywhere and re-open a rejected/deprecated one.
_INTERNAL_TRANSITIONS: Dict[InternalStatus, tuple] = {
    InternalStatus.DRAFT: (InternalStatus.READY_FOR_REVIEW, InternalStatus.DEPRECATED),
    InternalStatus.READY_FOR_REVIEW: (InternalStatus.APPROVED_INTERNAL, InternalStatus.DRAFT, InternalStatus.DEPRECATED),
    InternalStatus.APPROVED_INTERNAL: (InternalStatus.PUBLISHED, InternalStatus.READY_FOR_REVIEW, InternalStatus.DEPRECATED),
    InternalStatus.PUBLISHED: (InternalStatus.DEPRECATED, InternalStatus.APPROVED_INTERNAL),
    InternalStatus.DEPRECATED: (InternalStatus.DRAFT,),
}

# Only templates that have cleared internal review may be pushed to Meta.
PUBLISHABLE_STATUSES = (InternalStatus.APPROVED_INTERNAL, InternalStatus.PUBLISHED)


def can_transition(current: str, target: str) -> bool:
    try:
        cur, tgt = InternalStatus(current), InternalStatus(target)
    except ValueError:
        return False
    if cur == tgt:
        return True
    return tgt in _INTERNAL_TRANSITIONS.get(cur, ())


def default_internal_status(template: Template) -> InternalStatus:
    """Status to assume for a template that has no DB row yet. The six live
    anchors (lifecycle active/approved) are already on Meta → treated as
    PUBLISHED; everything else starts as DRAFT."""
    return InternalStatus.PUBLISHED if template.is_usable else InternalStatus.DRAFT


def default_meta_status(template: Template) -> MetaStatus:
    return MetaStatus.APPROVED if template.is_usable else MetaStatus.NONE


# ---------------------------------------------------------------------------
# Change detection - deterministic checksum over the CONTENT that defines the
# Meta template. Runtime/workflow fields are intentionally excluded so a status
# change never looks like a content change.
# ---------------------------------------------------------------------------

def _checksum_payload(t: Template) -> dict:
    mc = t.meta_config
    mm = t.meta
    return {
        "category": t.category.value,
        "cta_type": t.cta_type.value,
        "language": t.language,
        "title": t.title,
        "body": t.body,
        "header": t.metadata.get("header"),
        "button": t.metadata.get("button"),
        "quick_replies": [{"label": b.label, "action": b.action} for b in t.quick_replies],
        "url_buttons": [{"label": b.label, "url_var": b.url_var} for b in t.url_buttons],
        "variables": list(t.variables),
        "meta_config": None if not mc else {"name": mc.name, "language": mc.language, "category": mc.category},
        "meta_mapping": None if not mm else {
            "template_name": mm.template_name,
            "language": mm.language,
            "shape": mm.shape.value,
            "body": [{"var": s.var, "key": s.key, "default": s.default} for s in mm.body],
            "header_image_var": mm.header_image_var,
            "buttons": [{"index": b.index, "var": b.var, "type": b.type, "default": b.default} for b in mm.buttons],
        },
    }


def compute_checksum(t: Template) -> str:
    """SHA-256 over the content-defining fields (stable key order)."""
    blob = json.dumps(_checksum_payload(t), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Meta CREATE payload - the exact body POSTed to `/{waba_id}/message_templates`.
# WhatsApp only (per product decision - no channel abstraction).
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z_][\w]*)\s*\}\}")


def _sample(var: str) -> str:
    v = VARIABLES.get(var)
    return v.sample if v else var


def _body_component(t: Template) -> dict:
    """BODY component. Converts logical `{{var}}` tokens in the copy to Meta's
    positional `{{1}}..{{n}}` and supplies example values. When real copy isn't
    written yet the body is the `[[body]]` placeholder (no tokens) → no examples;
    once copy exists the ordering follows the copy, with examples from the
    canonical variable samples."""
    text = t.body or ""
    order: List[str] = []

    def _repl(m):
        name = m.group(1)
        if name not in order:
            order.append(name)
        return "{{%d}}" % (order.index(name) + 1)

    numbered = _TOKEN_RE.sub(_repl, text)
    # If the copy carries no tokens yet, fall back to the send-time variable order
    # so QA/preview still shows the intended parameter count.
    if not order and t.meta and t.meta.body:
        order = [s.var for s in t.meta.body]
    comp: dict = {"type": "BODY", "text": numbered}
    if order:
        comp["example"] = {"body_text": [[_sample(v) for v in order]]}
    return comp


# Meta URL buttons allow a single variable that must be the LAST thing in the URL
# (empirically verified against the Graph API: `…&q={{1}}` is accepted, `…q={{1}}&…`
# is rejected). So links live in buttons - never as a full-URL variable, never in
# the body. invitation → our web page base + slug; nav → Waze directly, with the
# URL-encoded location as the trailing variable.
_PUBLIC_BASE = os.getenv("PUBLIC_BASE_URL", "https://app.showup.co.il").rstrip("/")
_WEB_PATH = {"invitation_link": "/i/", "rsvp_link": "/r/"}
_WAZE_NAV_URL = "https://www.waze.com/ul?navigate=yes&q={{1}}"
_WAZE_NAV_EXAMPLE = "https://www.waze.com/ul?navigate=yes&q=Tel%20Aviv"


def _url_button(b) -> dict:
    """A Meta URL button component from a catalog UrlButton, with the variable at
    the end of the URL and an example. The trailing value (slug / encoded location)
    is supplied per guest at send time."""
    if b.url_var == "nav_link":
        return {"type": "URL", "text": b.label, "url": _WAZE_NAV_URL, "example": [_WAZE_NAV_EXAMPLE]}
    path = _WEB_PATH.get(b.url_var, "/i/")
    return {"type": "URL", "text": b.label,
            "url": f"{_PUBLIC_BASE}{path}{{{{1}}}}", "example": [f"{_PUBLIC_BASE}{path}demo"]}


def _button_components(t: Template) -> Optional[dict]:
    """The BUTTONS component for the Meta template. Quick-reply buttons (semantic
    RSVP) and URL buttons (View Invitation / Navigate) can COEXIST - Meta groups
    quick-replies first, then CTAs (≤10 total). Falls back to the legacy nav/view
    URL button only for base templates that declare no explicit buttons."""
    buttons: List[dict] = []
    buttons += [{"type": "QUICK_REPLY", "text": b.label} for b in t.quick_replies[:3]]
    buttons += [_url_button(b) for b in t.url_buttons[:2]]
    if buttons:
        return {"type": "BUTTONS", "buttons": buttons}

    # legacy fallback (base/anchor templates only)
    urls = []
    if t.meta and t.meta.buttons:
        for b in t.meta.buttons:
            urls.append({"type": "URL", "text": t.metadata.get("button") or "פתחו", "url": b.default or DEFAULT_WAZE_URL})
    elif t.cta_type in (CtaType.NAVIGATION, CtaType.VIEW_INVITATION):
        sample_url = DEFAULT_WAZE_URL if t.cta_type == CtaType.NAVIGATION else _sample("invitation_link")
        urls.append({"type": "URL", "text": t.metadata.get("button") or "פתחו", "url": sample_url})
    if not urls:
        return None
    return {"type": "BUTTONS", "buttons": urls}


def build_create_payload(t: Template, *, header_handle: Optional[str] = None) -> dict:
    """The exact Meta message-template CREATE payload for this catalog template.

    `header_handle` is the uploaded-media handle Meta requires as the IMAGE header
    example (obtained via the Resumable Upload API). When absent (dry-run / preview)
    a placeholder is used so the payload shape is still visible; a REAL publish must
    pass a handle or Meta rejects the template."""
    mc = t.meta_config
    name = published_name(t)
    language = (mc.language if mc else None) or t.language
    category = (mc.category if mc else None) or "UTILITY"

    components: List[dict] = []
    if t.category == TemplateCategory.WITH_IMAGE or (t.meta and t.meta.header_image_var):
        components.append({
            "type": "HEADER", "format": "IMAGE",
            "example": {"header_handle": [header_handle or "PLACEHOLDER_UPLOAD_A_HEADER_HANDLE"]},
        })
    components.append(_body_component(t))
    buttons = _button_components(t)
    if buttons:
        components.append(buttons)

    return {
        "name": name,
        "language": language,
        "category": str(category).upper(),
        "components": components,
    }


# ---------------------------------------------------------------------------
# Publish naming + readiness.
# ---------------------------------------------------------------------------

def has_placeholder(t: Template) -> bool:
    """True while the template still holds authoring placeholders (`[[body]]`,
    `[[title]]`, …) in its title or body - it is NOT ready to publish and must be
    skipped so no placeholder copy ever reaches Meta."""
    return "[[" in (t.title or "") or "[[" in (t.body or "")


def published_name(t: Template) -> str:
    """The Meta template name to create the template under. An event-type template
    gets a descriptive, unique `{stage}_{variant}__{eventtype}` name (e.g.
    `invitation_classic__wedding`); a base/anchor template keeps its configured
    name. Create and sync must use the SAME name - both call this."""
    et = t.event_types[0] if t.event_types else None
    if et:
        vid = VARIANT_NAME_OF.get(t.key, (None,))[0]
        if vid:
            return f"{t.flow_stage.value}_{vid}__{et}"
    return (t.meta_config.name if t.meta_config else None) or t.key


# ---------------------------------------------------------------------------
# Selection - which templates a publish request targets. Publishing reads the
# EFFECTIVE Stage → Event Type → Variant catalog (EVENT_CATALOG, post-inheritance)
# so each (stage, event type, variant) becomes its own Meta template. It does NOT
# publish the `_shared` base or the 6 live anchors - those stay untouched.
# ---------------------------------------------------------------------------

def select_templates(scope: str, *, key: Optional[str] = None,
                     stage: Optional[str] = None,
                     event_type: Optional[str] = None) -> List[Template]:
    scope = (scope or "all").strip().lower()
    pool = list(EVENT_CATALOG.values())
    if scope == "one":
        t = EVENT_CATALOG.get((key or "").strip())
        return [t] if t else []
    if scope == "stage":
        cs = canonical_stage(stage)
        return [t for t in pool if cs and t.flow_stage == cs]
    if scope == "event_type":
        et = (event_type or "").strip().lower()
        return [t for t in pool if et and t.event_types and t.event_types[0] == et]
    return pool  # "all"
