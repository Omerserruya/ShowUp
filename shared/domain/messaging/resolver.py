"""Template + variable resolution.

`resolve_template()` turns ANY reference a campaign might carry - a canonical
catalog key, a legacy Meta template name, a flow-stage/label, or a DB template id
- into a single `Template`. This is what guarantees a stored UUID is never sent
to Meta as a template name: it always resolves to a real approved template.

`VariableResolver` turns an event + guest into canonical variable VALUES, using
the exact same Hebrew formatting the old worker used (moved here so there is one
implementation). The Meta adapter then maps those values to Meta components.
"""
from __future__ import annotations

import json
import os
import re
import uuid as _uuid
from urllib.parse import quote
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from .catalog import (
    Template, MetaMapping, MetaShape, MetaSlot, DeliveryKind,
    TemplateCategory, Tone, CtaType,
    BUILTIN_CATALOG, builtin_by_key, builtin_by_meta_name, default_for_stage,
    ALL_TEMPLATES, DEFAULT_WAZE_URL,
)
from .stages import FlowStage, canonical_stage
from .event_types import event_type_meta
from .variables import canonical_var_name

# Default header image path (identical to the old handler's hardcoded value);
# prefixed with the media base (MEDIA_S3_URL) at resolve time.
DEFAULT_HEADER_IMAGE_PATH = "uploads/c9ef4676-461e-4822-8930-c9a74edf6b30/e1d8d2dd-7662-4c2d-9aea-88c6da854fd2.jpg"

WEEKDAY_HEBREW = {0: "יום שני", 1: "יום שלישי", 2: "יום רביעי", 3: "יום חמישי",
                  4: "יום שישי", 5: "יום שבת", 6: "יום ראשון"}


# ---- formatters (byte-identical to the pre-refactor worker handlers) --------

def _serialize_datetime(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def format_event_date(event_date_str) -> str:
    s = _serialize_datetime(event_date_str)
    if not s:
        return ""
    dt = datetime.fromisoformat(s)
    weekday = WEEKDAY_HEBREW.get(dt.weekday(), "יום")
    return f"{weekday}, ה־{dt.day}.{dt.month}.{str(dt.year)[-2:]}"


def format_event_time(event_date_str) -> str:
    s = _serialize_datetime(event_date_str)
    if not s:
        return ""
    return datetime.fromisoformat(s).strftime("%H:%M")


def format_inviters(inviters: Optional[List[Dict[str, str]]]) -> str:
    if not inviters:
        return " "  # space, not empty (WhatsApp API compatibility) - unchanged
    names = [f"{i.get('fn', '')} {i.get('ln', '')}" for i in inviters]
    return " ו".join(names)


def parse_location(loc: Any) -> tuple[str, str]:
    """Event.location may be a plain string OR a structured value
    ({"name", "address", "coordinates"}) - stored as JSON text or already a dict.
    Return (venue_name, venue_address) as human-readable strings; never the raw
    JSON (which would otherwise be sent verbatim into a WhatsApp template slot)."""
    if not loc:
        return "", ""
    data: Any = loc
    if isinstance(loc, str):
        s = loc.strip()
        if not s.startswith("{"):
            return s, s  # plain address string
        try:
            data = json.loads(s)
        except (ValueError, TypeError):
            return s, s  # looked like JSON but wasn't - treat as plain text
    if isinstance(data, dict):
        name = str(data.get("name") or "").strip()
        address = str(data.get("address") or "").strip()
        # Fall back so neither slot is empty when only one field is present.
        return (name or address), (address or name)
    return str(loc), str(loc)


def waze_link_from_location(loc: Any) -> str:
    """Build a real Waze deep-link from the event's structured location - using its
    coordinates when present, else its address query. Returns "" when the location
    carries neither (caller falls back to the configured default)."""
    if not loc:
        return ""
    data: Any = loc
    if isinstance(loc, str):
        s = loc.strip()
        if not s.startswith("{"):
            return f"https://www.waze.com/ul?q={quote(s)}&navigate=yes" if s else ""
        try:
            data = json.loads(s)
        except (ValueError, TypeError):
            return f"https://www.waze.com/ul?q={quote(s)}&navigate=yes"
    if isinstance(data, dict):
        coords = data.get("coordinates") or {}
        lat, lng = coords.get("lat"), coords.get("lng")
        if lat is not None and lng is not None:
            return f"https://www.waze.com/ul?ll={lat}%2C{lng}&navigate=yes"
        q = str(data.get("address") or data.get("name") or "").strip()
        return f"https://www.waze.com/ul?q={quote(q)}&navigate=yes" if q else ""
    return ""


def _join_he(a: Optional[str], b: Optional[str]) -> str:
    """Join two names the Hebrew way ("נועה ויונתן"). Mirrors the wizard's joinHe."""
    a = (a or "").strip()
    b = (b or "").strip()
    if a and b:
        return f"{a} ו{b}"
    return a or b


# ---- template resolution ----------------------------------------------------

def _looks_like_uuid(value: str) -> bool:
    try:
        _uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _template_from_db_row(row: Dict[str, Any]) -> Template:
    """Build a Template from a `wa_templates` DB row, giving it a deliverable Meta
    mapping by borrowing its flow-stage's default approved template (this is what
    makes previously-undeliverable custom templates actually send)."""
    stage = canonical_stage(row.get("flow_stage")) or FlowStage.INVITATION
    components = row.get("components") or {}
    title = components.get("title") if isinstance(components, dict) else None
    stage_default = default_for_stage(stage)
    return Template(
        key=str(row.get("id")),
        flow_stage=stage,
        category=TemplateCategory.TEXT_ONLY,
        tone=Tone.WARM,
        cta_type=CtaType.NONE,
        title=title or row.get("name") or "",
        body=row.get("body") or "",
        language=row.get("language") or (stage_default.language if stage_default else "he"),
        event_types=(str(row["event_type"]),) if row.get("event_type") else (),
        visibility=row.get("visibility") or "public",
        lifecycle=row.get("lifecycle") or "approved",
        is_default=bool(components.get("is_default")) if isinstance(components, dict) else False,
        delivery=DeliveryKind.META_TEMPLATE,
        meta=stage_default.meta if stage_default else None,
        metadata={"source": "db", "wa_template_id": str(row.get("id"))},
    )


def prefer_event_variant(t: Optional[Template], event_type: Optional[str]) -> Optional[Template]:
    """Prefer the event-type-specific approved variant `<key>__<event_type>` over a
    base template. The Meta templates that are actually published+approved are the
    event-type ones (e.g. `final_reminder_gentle__wedding`); base templates usually
    have no Meta mapping. When the event has a type and a *usable* variant exists,
    send that; otherwise keep the base as the fallback."""
    if t is None or not event_type:
        return t
    variant = ALL_TEMPLATES.get(f"{t.key}__{event_type}")
    return variant if (variant is not None and variant.is_usable) else t


def resolve_template(
    ref: Any,
    *,
    flow_stage: Any = None,
    event_type: Any = None,
    db_lookup: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
) -> Optional[Template]:
    """Resolve a campaign's template reference to a single catalog Template.

    Resolution order (each is a backward-compatibility path):
      1. canonical catalog key                     (new campaigns)
      2. legacy Meta template name                 (the 6 old worker keys)
      3. legacy flow-stage / label                 (plans.json / design labels)
      4. DB template id (UUID) via db_lookup       (event-scoped custom templates)
      5. fall back to the default for a known stage
    When `event_type` is given, a usable `<key>__<event_type>` variant (the form
    actually approved on Meta) is preferred over the base template.
    Returns None only when nothing resolves (caller decides what to do).
    """
    if isinstance(ref, Template):
        return ref
    et = str(event_type).strip() if event_type else None
    key = "" if ref is None else str(ref).strip()

    if key:
        # Exact event-type key, or a base key whose event-type variant is approved.
        if et:
            variant = ALL_TEMPLATES.get(f"{key}__{et}")
            if variant is not None and variant.is_usable:
                return variant
        t = builtin_by_key(key)
        if t:
            return prefer_event_variant(t, et)
        t = builtin_by_meta_name(key)
        if t:
            return prefer_event_variant(t, et)
        stage = canonical_stage(key)
        if stage:
            d = default_for_stage(stage)
            if d:
                return prefer_event_variant(d, et)
        if _looks_like_uuid(key) and db_lookup is not None:
            row = db_lookup(key)
            if row:
                return _template_from_db_row(row)

    # Last resort: an explicit flow_stage hint (e.g. from the campaign row).
    stage = canonical_stage(flow_stage)
    if stage:
        return prefer_event_variant(default_for_stage(stage), et)
    return None


# ---- variable resolution ----------------------------------------------------

_VAR_RE = re.compile(r"\{\{\s*([^}\s]+)\s*\}\}")


class VariableResolver:
    """Resolves canonical variable values for one (event, guest) pair. This is the
    single send-time variable system - the worker calls this, never slot numbers."""

    def __init__(self, event: Dict[str, Any], media_base: Optional[str] = None,
                 public_base: Optional[str] = None, header_image_override: Optional[str] = None):
        self.event = event or {}
        self.media_base = media_base if media_base is not None else os.getenv("MEDIA_S3_URL", "")
        self.public_base = (public_base if public_base is not None
                            else os.getenv("PUBLIC_BASE_URL", "")).rstrip("/")
        # Per-campaign header image (a full URL). When set it overrides the default
        # header_image_url / cover_image so image-header templates send the image
        # the owner picked for that specific round.
        self.header_image_override = (header_image_override or "").strip() or None
        self._event_values = self._resolve_event_scope()

    def _resolve_event_scope(self) -> Dict[str, str]:
        e = self.event
        etm = event_type_meta(e.get("event_type"))
        venue_name, venue_address = parse_location(e.get("location"))
        vals = {
            "event_name": e.get("name", "") or "",
            "event_date": format_event_date(e.get("event_date", "")),
            "event_time": format_event_time(e.get("event_date", "")),
            "venue_name": venue_name,
            "venue_address": venue_address,
            "host_name": format_inviters(e.get("inviters", [])),
            "nav_link": e.get("waze_url") or waze_link_from_location(e.get("location")) or DEFAULT_WAZE_URL,
            "event_type_name": etm.name_he if etm else "",
            # Header image chain: per-campaign override -> the EVENT's WhatsApp
            # cover (uploaded at onboarding / settings) -> static default asset.
            "header_image_url": (self.header_image_override
                                 or (e.get("wa_image_url") or "").strip()
                                 or ((self.media_base or "") + DEFAULT_HEADER_IMAGE_PATH)),
        }
        # cover_image is an alias of the header image (used by save-the-date copy).
        vals["cover_image"] = vals["header_image_url"]
        # Subject (event-type-specific) variables - derived from the persisted
        # `event.subjects`, using the SAME logic the wizard preview uses, so
        # preview and delivery resolve identically. Only non-empty values are set.
        vals.update(self._resolve_subjects())
        # Public invitation links (from the event's slug).
        slug = e.get("public_slug")
        if slug and self.public_base:
            vals["invitation_link"] = f"{self.public_base}/i/{slug}"
            vals["rsvp_link"] = f"{self.public_base}/r/{slug}"
        return vals

    def _resolve_subjects(self) -> Dict[str, str]:
        s = self.event.get("subjects") or {}
        p1 = (s.get("p1") or "").strip()
        p2 = (s.get("p2") or "").strip()
        parent1 = (s.get("parent1") or "").strip()
        parent2 = (s.get("parent2") or "").strip()
        honoree = (s.get("honoree") or "").strip()
        company = (s.get("company") or "").strip()
        bride = p1 if s.get("role1") == "bride" else (p2 if s.get("role2") == "bride" else p1)
        groom = p1 if s.get("role1") == "groom" else (p2 if s.get("role2") == "groom" else p2)
        couple = _join_he(p1, p2)
        parents = _join_he(parent1, parent2)
        out = {
            "bride_name": bride, "groom_name": groom, "couple_names": couple,
            "baby_name": honoree, "celebrant_name": honoree,
            "mother_name": parent1, "father_name": parent2, "parents_names": parents,
            "company_name": company,
            "host_display_name": self._host_display(company, couple),
        }
        return {k: v for k, v in out.items() if v}

    def _host_display(self, company: str, couple: str) -> str:
        """The canonical host label templates use: company / couple / family."""
        if company:
            return company
        if couple:
            return couple
        inv = self.event.get("inviters") or []
        if inv:
            ln = (inv[0].get("ln") or "").strip()
            if ln:
                return f"משפחת {ln}"
        return format_inviters(inv)

    def values_for(self, guest: Dict[str, Any]) -> Dict[str, str]:
        g = guest or {}
        table = g.get("table_number")
        vals = dict(self._event_values)
        vals["table_number"] = str(table) if table is not None else ""
        # guest_name is included ONLY when the source has a name key, so a slot
        # with a non-empty default (general_rsvp → "testname") reproduces the old
        # `guest.get("name", default)` behavior exactly (absent → default;
        # present-but-empty → "").
        if "name" in g:
            name = g.get("name") or ""
            vals["guest_name"] = name
            parts = name.split()
            vals["guest_first_name"] = parts[0] if parts else ""
            vals["guest_last_name"] = " ".join(parts[1:]) if len(parts) > 1 else ""
        if g.get("guest_count") is not None:
            vals["party_size"] = str(g.get("guest_count"))
        return vals

    def render_body(self, body: str, guest: Dict[str, Any]) -> str:
        """Fill a copy body's {{token}} placeholders (canonical or legacy Hebrew).
        Used for free_text delivery and for previews - the SAME body everywhere."""
        vals = self.values_for(guest)

        def repl(m):
            canon = canonical_var_name(m.group(1))
            if canon and canon in vals:
                return vals[canon]
            return m.group(0)  # leave unknown tokens intact

        return _VAR_RE.sub(repl, body or "")
