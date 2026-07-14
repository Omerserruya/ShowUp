"""The Template Catalog - every template exists exactly once.

A Template carries EVERYTHING every layer needs: identity, event type, stage,
category, tone, CTA, channel, language, lifecycle, defaults, premium/priority,
variables, preview metadata, version, and - crucially - its Meta mapping (which
approved Meta template delivers it and how its variables fill the Meta
components). The worker/outpost hold no template knowledge; they read it here.

SOURCE OF TRUTH: the copy and per-variant metadata are NO LONGER defined in this
module. They live in an editable content catalog at
`shared/content/messaging_catalog.yaml`, structured
`stage → event_type → variant → template` so copy is grouped by EVENT TYPE first
(a Wedding invitation is different copy from a Brit invitation). An `_shared` base
event type holds event-agnostic copy; a real event type INHERITS a variant from
that base unless it authors its own override. Each event type's `default_variant`
supplies the (event type × stage) recommendation.
This module is now a CONSUMER of that file: it loads the YAML once at import and
builds the exact same `Template` objects the rest of the platform already reads -
so the wizard/planner/worker/outpost/Meta chain is byte-identical. Edit copy,
add variants, or manage Meta status in the YAML; no Python change is required.

STRUCTURE vs COPY: this file owns the catalog *structure* (the dataclasses/enums
and the loader). The message COPY (title/body/header/button) is intentionally
left as placeholders (`[[…]]`) in the YAML, to be populated in a later pass. The
six real deliverable templates keep their exact Meta mappings (delivery is
byte-identical) and are marked `active`; every other variant is a `draft`
awaiting copy + Meta approval and is not offered/sent until promoted.

Custom, event-scoped templates live in the DB (`wa_templates`) and conform to the
same model. Extensibility: unknown future fields go in `metadata` (ai, seasonal,
…) without changing this shape or any consumer.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

from shared.domain.enums import TemplateState
from .stages import FlowStage, STAGE_ORDER, canonical_stage
from .variables import canonical_var_name
from .event_types import event_type_of
from shared.domain.rsvp import normalize_button_action

# Catalog structure/version stamps. These are FALLBACKS; the live values are read
# from the YAML (schema_version / catalog_version) so the content owner controls
# them. Bump SCHEMA_VERSION on a shape change, CATALOG_VERSION on a content change.
SCHEMA_VERSION = 2
CATALOG_VERSION = 1

# Location of the content SSOT. Overridable via env for tests / alternate deploys.
_DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "content" / "messaging_catalog.yaml"
CATALOG_PATH = Path(os.getenv("MESSAGING_CATALOG_PATH", str(_DEFAULT_CATALOG_PATH)))

# Default Waze link used by nav buttons when the event has none (identical to the
# value hardcoded in the old handlers). Sourced from the YAML `defaults.waze_url`.
DEFAULT_WAZE_URL = "https://www.waze.com/ul?q=%D7%A0%D7%95%D7%A2%D7%94+%D7%94%D7%91%D7%99%D7%AA+%D7%9C%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D&navigate=yes"


# --- dimensions --------------------------------------------------------------

class DeliveryKind(str, Enum):
    META_TEMPLATE = "meta_template"  # send an approved Meta template (default)
    FREE_TEXT = "free_text"          # send plain text (custom message / future AI)


class TemplateCategory(str, Enum):
    """Structural shape of the message (aligns with Meta component layout)."""
    TEXT_ONLY = "text_only"
    WITH_IMAGE = "with_image"
    WITH_NAV_BUTTON = "with_nav_button"
    WITH_RSVP_BUTTON = "with_rsvp_button"
    WITH_DETAILS_BUTTON = "with_details_button"


class Tone(str, Enum):
    """Voice/style of the copy."""
    WARM = "warm"
    FORMAL = "formal"
    PLAYFUL = "playful"
    FESTIVE = "festive"
    HEARTFELT = "heartfelt"


class CtaType(str, Enum):
    """The call-to-action the template drives."""
    NONE = "none"
    RSVP = "rsvp"                            # confirm attendance (link)
    NAVIGATION = "navigation"                # Waze / maps
    VIEW_INVITATION = "view_invitation"      # open the invitation page
    QUICK_REPLY_CONFIRM = "quick_reply_confirm"  # WhatsApp quick-reply buttons


class MetaShape(str, Enum):
    """How the Meta `parameters` dict is shaped - matches what outpost accepts."""
    POSITIONAL_FLAT = "positional_flat"  # {"1": .., "2": ..}
    NAMED_FLAT = "named_flat"            # {"guest_name": .., ..}
    STRUCTURED = "structured"            # {"header":.., "body":{..}, "buttons":[..]}


# --- Meta mapping ------------------------------------------------------------

@dataclass(frozen=True)
class MetaSlot:
    var: str            # canonical variable name (see variables.py)
    default: str = ""   # fallback if the variable is ABSENT (not when empty)
    key: str = ""       # param key for NAMED_FLAT (else positional index used)


@dataclass(frozen=True)
class MetaButton:
    index: int
    var: str                       # variable providing the URL
    type: str = "url"
    default: str = DEFAULT_WAZE_URL


@dataclass(frozen=True)
class MetaMapping:
    """The single place a template is bound to a Meta template. The Meta adapter
    is the only code that turns this + resolved variables into Meta parameters."""
    template_name: str             # approved Meta template name (never a UUID)
    language: str                  # data-driven language code, e.g. "he"/"en"
    shape: MetaShape
    body: Tuple[MetaSlot, ...] = ()
    header_image_var: Optional[str] = None   # canonical var holding an image URL
    buttons: Tuple[MetaButton, ...] = ()


# --- quick-reply buttons -----------------------------------------------------

@dataclass(frozen=True)
class QuickReplyButton:
    """A WhatsApp quick-reply button as the CATALOG defines it: `label` is pure
    presentation (wording / emoji / language / A/B), `action` is the semantic
    business signal (e.g. `rsvp_accepted`). The engine consumes only the action -
    it becomes the Meta button payload, so the label can change freely without
    touching any engine logic."""
    label: str
    action: str      # canonical semantic action token (see shared.domain.rsvp)


@dataclass(frozen=True)
class UrlButton:
    """A WhatsApp URL (call-to-action) button. `label` is presentation; `url_var`
    names the link the button opens (`invitation_link` → the web invitation,
    `nav_link` → navigation). Meta URL buttons must be a static base + a single
    trailing variable, so the publisher renders `{public_base}/i/{{1}}` etc. and
    the slug is supplied at send time. Links live HERE, never in the body copy."""
    label: str
    url_var: str     # canonical link variable: invitation_link | nav_link


# --- preview metadata --------------------------------------------------------

@dataclass(frozen=True)
class Preview:
    """How the wizard should present the template before copy is filled in."""
    emoji: str = "💬"
    accent: str = "#888cee"
    header: str = "none"        # none | image
    length_hint: str = "short"  # short | medium | long
    note: str = ""              # short human hint about the template's purpose


# --- authored Meta config ----------------------------------------------------

@dataclass(frozen=True)
class MetaConfig:
    """AUTHORED Meta template identity/config (from the YAML `meta:` block). This
    is version-controlled product data: the desired Meta template name, language
    and category used when (re)creating the template on Meta. MUTABLE runtime
    state (Meta id, review status, uploaded_at, last_sync, rejection_reason, and
    the internal workflow status) is NOT here - it lives in the DB, written by the
    Admin publishing API. `name` defaults to the template key; `category` is one
    of MARKETING / UTILITY / AUTHENTICATION."""
    name: str
    language: str = "he"
    category: str = "UTILITY"


# --- template ----------------------------------------------------------------

@dataclass(frozen=True)
class Template:
    key: str                       # canonical, stable id - used everywhere
    flow_stage: FlowStage
    category: TemplateCategory
    tone: Tone
    cta_type: CtaType
    title: str                     # message headline / display title (placeholder)
    body: str                      # copy (preview + free_text source) (placeholder)
    channel: str = "whatsapp"
    language: str = "he"           # SSOT for language (mirrors meta.language)
    event_types: Tuple[str, ...] = ()   # empty = all event types
    visibility: str = "public"
    lifecycle: str = TemplateState.DRAFT.value
    is_default: bool = False       # the recommended variant for its stage
    premium: bool = False
    priority: int = 50
    delivery: DeliveryKind = DeliveryKind.META_TEMPLATE
    meta: Optional[MetaMapping] = None   # None until a Meta template is approved
    preview: Preview = field(default_factory=Preview)
    description: str = ""
    variables: Tuple[str, ...] = ()      # canonical variable names the copy will use
    version: int = 1
    metadata: Dict = field(default_factory=dict)  # extensible (ai, seasonal, …)
    meta_config: Optional[MetaConfig] = None      # authored Meta identity/category
    quick_replies: Tuple[QuickReplyButton, ...] = ()  # semantic {label, action} buttons
    url_buttons: Tuple[UrlButton, ...] = ()       # {label, url_var} call-to-action buttons

    @property
    def is_usable(self) -> bool:
        """Only templates that can actually be delivered may be offered in the wizard
        or sent. That means an approved/active lifecycle AND - for Meta-template
        delivery - a real approved Meta mapping. A missing meta_mapping means the
        Meta template was never published/approved, so the send would crash: such a
        template is never usable. Free-text delivery needs no Meta mapping."""
        if self.lifecycle not in (TemplateState.APPROVED.value, TemplateState.ACTIVE.value):
            return False
        if self.delivery == DeliveryKind.META_TEMPLATE and self.meta is None:
            return False
        return True


# ===========================================================================
# LOADER - build the catalog from the editable YAML content SSOT.
# Nothing below hardcodes copy or per-template config; it all comes from
# `shared/content/messaging_catalog.yaml`. The produced Template objects are
# identical to the ones the platform read before the content move, so delivery
# is byte-identical.
# ===========================================================================

def _meta_mapping_from(raw: Optional[dict]) -> Optional[MetaMapping]:
    """Build a MetaMapping from a YAML `meta_mapping` block (or None for drafts)."""
    if not raw:
        return None
    body = tuple(
        MetaSlot(var=s["var"], default=s.get("default", ""), key=s.get("key", ""))
        for s in raw.get("body", ())
    )
    buttons = tuple(
        MetaButton(index=b["index"], var=b["var"],
                   type=b.get("type", "url"), default=b.get("default", DEFAULT_WAZE_URL))
        for b in raw.get("buttons", ())
    )
    return MetaMapping(
        template_name=raw["template_name"],
        language=raw["language"],
        shape=MetaShape(raw["shape"]),
        body=body,
        header_image_var=raw.get("header_image_var"),
        buttons=buttons,
    )


# --- auto-derivation: variables + length are NEVER hand-maintained -----------
# One source of truth: a template's variables are whatever its CONTENT references
# ({{token}} in the copy) plus whatever its Meta binding fills. No separate list.

_TOKEN_RE = re.compile(r"\{\{\s*([^}\s]+)\s*\}\}")


def _extract_variables(content: dict, meta_mapping: Optional[dict]) -> Tuple[str, ...]:
    """Canonical variable names a template references, derived automatically from
    the copy tokens ({{event_date}}, legacy {{תאריך}}) and its Meta binding - so
    the catalog never maintains a parallel variable list. Copy order first, then
    any binding-only vars; deduped and canonicalized."""
    order: List[str] = []

    def add(name: Optional[str]):
        if not name:
            return
        canon = canonical_var_name(str(name)) or str(name).strip()
        if canon and canon not in order:
            order.append(canon)

    texts: List[str] = [str(content.get("title") or ""),
                        str(content.get("body") or ""),
                        str(content.get("header") or "")]
    # buttons may be label strings or {label, action} dicts - scan the label text.
    texts += [str(b.get("label", "") if isinstance(b, dict) else (b or ""))
              for b in (content.get("buttons") or [])]
    for txt in texts:
        for m in _TOKEN_RE.finditer(txt):
            add(m.group(1))

    if meta_mapping:
        for s in (meta_mapping.get("body") or ()):
            add(s.get("var"))
        add(meta_mapping.get("header_image_var"))
        for b in (meta_mapping.get("buttons") or ()):
            add(b.get("var"))
    return tuple(order)


# Availability vocabulary - the three states a (event type × stage) can be in.
RECOMMENDED_ON = "true"        # enabled by default in the wizard
RECOMMENDED_OPTIONAL = "optional"  # offered, off by default
RECOMMENDED_OFF = "false"      # not recommended (still manually enable-able)


def _norm_recommended(value) -> str:
    """Collapse author styles (bool / 'optional' / 'yes'/'no') to one vocabulary."""
    if value is True:
        return RECOMMENDED_ON
    if value is False:
        return RECOMMENDED_OFF
    s = str(value or "").strip().lower()
    if s in ("optional", "maybe"):
        return RECOMMENDED_OPTIONAL
    if s in ("true", "yes", "on", "recommended", "1"):
        return RECOMMENDED_ON
    return RECOMMENDED_OFF


def _derive_length_hint(body: str) -> str:
    """UI length hint, derived from the copy (short/medium/long). Placeholder copy
    (`[[body]]`, no real text yet) is treated as short."""
    b = body or ""
    if "[[" in b:
        return "short"
    n = len(b)
    if n <= 160:
        return "short"
    if n <= 480:
        return "medium"
    return "long"


def _template_from(raw: dict) -> Template:
    """Build a Template from one YAML `templates[]` entry."""
    content = raw.get("content", {}) or {}
    md_raw = raw.get("metadata", {}) or {}
    prev_raw = raw.get("preview", {}) or {}

    # Reconstruct the extensible `metadata` dict exactly as the old catalog held
    # it (header/button placeholders where present). Meta runtime state is NOT
    # here - it lives in the DB (see MetaConfig docstring).
    metadata: Dict = {}
    if content.get("header") is not None:
        metadata["header"] = content["header"]
    # `buttons` entries may be legacy label strings (URL/label placeholders) OR
    # semantic quick-reply dicts {label, action}. Both keep the first label in
    # metadata["button"] (unchanged behavior); dicts also build quick_replies.
    raw_buttons = content.get("buttons") or []
    quick_replies = tuple(
        QuickReplyButton(
            label=str(b.get("label", "")),
            action=normalize_button_action(b.get("action")) or str(b.get("action", "")).strip().lower(),
        )
        for b in raw_buttons if isinstance(b, dict) and b.get("action")
    )
    url_buttons = tuple(
        UrlButton(label=str(b.get("label", "")), url_var=str(b.get("url_var", "")).strip())
        for b in raw_buttons if isinstance(b, dict) and b.get("url_var")
    )
    if raw_buttons:
        first = raw_buttons[0]
        metadata["button"] = first.get("label", "") if isinstance(first, dict) else first

    # Authored Meta config block (optional; defaults keep old catalogs loading).
    meta_raw = raw.get("meta") or {}
    meta_config = MetaConfig(
        name=meta_raw.get("name") or raw["key"],
        language=meta_raw.get("language", md_raw.get("language", "he")),
        category=meta_raw.get("category", "UTILITY"),
    )

    stage = canonical_stage(raw["_stage"])
    return Template(
        key=raw["key"],
        flow_stage=stage,
        category=TemplateCategory(raw["category"]),
        tone=Tone(md_raw["tone"]),
        cta_type=CtaType(raw["cta_type"]),
        title=content.get("title", "[[title]]"),
        body=content.get("body", "[[body]]"),
        channel=raw.get("channel", "whatsapp"),
        language=md_raw.get("language", "he"),
        event_types=tuple(raw.get("event_types", ()) or ()),
        visibility=raw.get("visibility", "public"),
        lifecycle=md_raw.get("lifecycle", TemplateState.DRAFT.value),
        is_default=bool(md_raw.get("default", False)),
        premium=bool(raw.get("premium", False)),
        priority=int(raw.get("priority", 50)),
        delivery=DeliveryKind(raw.get("delivery", DeliveryKind.META_TEMPLATE.value)),
        meta=_meta_mapping_from(raw.get("meta_mapping")),
        preview=Preview(
            emoji=prev_raw.get("emoji", "💬"),
            accent=prev_raw.get("accent", "#888cee"),
            header=prev_raw.get("header", "none"),
            length_hint=_derive_length_hint(content.get("body", "")),  # derived, not authored
            note=content.get("notes", "") or "",
        ),
        description=content.get("notes", "") or "",
        variables=_extract_variables(content, raw.get("meta_mapping")),  # auto-derived
        version=int(md_raw.get("version", 1)),
        metadata=metadata,
        meta_config=meta_config,
        quick_replies=quick_replies,
        url_buttons=url_buttons,
    )


def _deep_merge(base: dict, over: dict) -> dict:
    """Recursively overlay `over` on `base` (over wins). Used so an event-type
    template can author ONLY its `content` and inherit every structural field
    (category, cta_type, preview, metadata, …) from its `_shared` base variant."""
    out = dict(base)
    for k, v in over.items():
        if isinstance(out.get(k), dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _inherit_event_template(event_raw: dict, base_raw: Optional[dict]) -> dict:
    """Fill an event-type template's missing structural fields from its `_shared`
    base variant, keeping the event type's own copy. Safety overrides ensure an
    inherited event-type template is always a draft with its OWN identity - never a
    clone of the base's live Meta binding: `meta.name` defaults to the event key,
    `lifecycle` to draft, and `meta_mapping` to null unless the copy sets them."""
    if not base_raw:
        return event_raw
    merged = _deep_merge(base_raw, event_raw)
    ev_meta = event_raw.get("meta") or {}
    if "name" not in ev_meta:
        merged["meta"] = {**(merged.get("meta") or {}), "name": event_raw["key"]}
    if "lifecycle" not in (event_raw.get("metadata") or {}):
        merged["metadata"] = {**(merged.get("metadata") or {}),
                              "lifecycle": TemplateState.DRAFT.value}
    if "meta_mapping" not in event_raw:
        merged["meta_mapping"] = None
    return merged


def _load_catalog(path: Path):
    """Parse the content YAML into (version stamps, ordered Templates, and the
    stage/variant/recommendation metadata the stage layer needs)."""
    with open(path, "r", encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}

    schema_version = int(doc.get("schema_version", SCHEMA_VERSION))
    catalog_version = int(doc.get("catalog_version", CATALOG_VERSION))
    waze_url = (doc.get("defaults", {}) or {}).get("waze_url", DEFAULT_WAZE_URL)
    recommendations = {
        et: dict(m) for et, m in (doc.get("recommendations", {}) or {}).items()
    }
    # Availability recommendation matrix: event_type -> {stage_id: "true"|"optional"
    # |"false"}. A DEFAULT for the wizard, never a restriction. Normalized to
    # strings so bool/`optional` author styles collapse to one vocabulary.
    availability: Dict[str, Dict[str, str]] = {}
    for et, stages_map in (doc.get("availability", {}) or {}).items():
        row: Dict[str, str] = {}
        for sid, cfg in (stages_map or {}).items():
            rec = (cfg or {}).get("recommended") if isinstance(cfg, dict) else cfg
            row[sid] = _norm_recommended(rec)
        availability[et] = row

    base_et = (doc.get("defaults", {}) or {}).get("base_event_type", "_shared")

    templates: List[Template] = []                     # _shared base -> BUILTIN_CATALOG
    event_templates: List[Template] = []               # per-event-type -> EVENT_CATALOG
    variant_name_of: Dict[str, Tuple[str, str]] = {}   # template_key -> (variant_id, name)
    stage_copy: Dict[str, Dict[str, str]] = {}         # stage_id -> {title, description}
    # Inheritance indexes for Stage -> Event Type -> Variant -> Template resolution.
    base_variant_key: Dict[Tuple[str, str], str] = {}          # (stage, variant) -> shared template key
    event_variant_key: Dict[Tuple[str, str, str], str] = {}    # (stage, event_type, variant) -> event template key
    variant_display: Dict[Tuple[str, str], str] = {}           # (stage, variant) -> Hebrew name

    stages = doc.get("stages", {}) or {}
    # Iterate in canonical stage order for a stable, catalog-order Template list.
    ordered_stage_ids = [s.value for s in STAGE_ORDER if s.value in stages]
    ordered_stage_ids += [sid for sid in stages if sid not in ordered_stage_ids]

    def _emit(traw: dict, sid: str, vid: str, vname: str,
              event_type: Optional[str]) -> Template:
        """Build + register one template. `event_type` None => shared base (engine
        catalog); otherwise an event-type-owned template (authoring layer, kept OUT
        of BUILTIN_CATALOG so the stage model / resolver / anchors stay identical)."""
        traw = dict(traw)
        traw["_stage"] = sid
        if event_type is not None:
            # Event-type copy is scoped to its event type (unless the copy locks it further).
            traw.setdefault("event_types", [event_type])
        t = _template_from(traw)
        (templates if event_type is None else event_templates).append(t)
        variant_name_of[t.key] = (vid, vname)
        return t

    def _iter_variants(block: dict):
        """Yield (variant_id, variant_name, template_raw) for a variants: map.
        Tolerates the empty `{}` (inherit) and legacy list forms."""
        for vid, vblock in (block.get("variants", {}) or {}).items():
            vblock = vblock or {}
            vname = vblock.get("name", vid)
            for traw in (vblock.get("templates", []) or []):
                yield vid, vname, traw

    for sid in ordered_stage_ids:
        sblock = stages[sid] or {}
        stage_copy[sid] = {
            "title": sblock.get("title", ""),
            "description": sblock.get("description", ""),
        }

        # Backward compatibility: a stage may still use the flat `variants:` shape
        # (pre event-type migration). Treat it as the shared base.
        event_types_block = sblock.get("event_types")
        if event_types_block is None:
            event_types_block = {base_et: {"variants": sblock.get("variants", {}) or {}}}

        # 1. Shared base - the event-agnostic templates (event_types=() unless the
        #    copy declares otherwise). These are the deliverable anchors today.
        base_block = event_types_block.get(base_et, {}) or {}
        base_variant_raw: Dict[str, dict] = {}   # variant_id -> base template raw
        for vid, vname, traw in _iter_variants(base_block):
            base_variant_raw.setdefault(vid, traw)
            t = _emit(traw, sid, vid, vname, event_type=None)
            base_variant_key[(sid, vid)] = t.key
            variant_display[(sid, vid)] = vname

        # 2. Per-event-type blocks: default_variant (-> recommendations) + the event
        #    type's OWN templates. Each inherits any structural field it omits from
        #    its `_shared` base variant, so authors write only content per type.
        for et, etblock in event_types_block.items():
            if et == base_et:
                continue
            etblock = etblock or {}
            dv = etblock.get("default_variant")
            if dv:
                recommendations.setdefault(et, {})[sid] = dv
            for vid, vname, traw in _iter_variants(etblock):
                merged = _inherit_event_template(traw, base_variant_raw.get(vid))
                t = _emit(merged, sid, vid, vname, event_type=et)
                event_variant_key[(sid, et, vid)] = t.key
                variant_display.setdefault((sid, vid), vname)

    return {
        "schema_version": schema_version,
        "catalog_version": catalog_version,
        "waze_url": waze_url,
        "base_event_type": base_et,
        "recommendations": recommendations,
        "availability": availability,
        "templates": templates,
        "event_templates": event_templates,
        "variant_name_of": variant_name_of,
        "stage_copy": stage_copy,
        "base_variant_key": base_variant_key,
        "event_variant_key": event_variant_key,
        "variant_display": variant_display,
    }


_LOADED = _load_catalog(CATALOG_PATH)

SCHEMA_VERSION = _LOADED["schema_version"]
CATALOG_VERSION = _LOADED["catalog_version"]
DEFAULT_WAZE_URL = _LOADED["waze_url"]

_BUILTIN: List[Template] = _LOADED["templates"]

BUILTIN_CATALOG: Dict[str, Template] = {t.key: t for t in _BUILTIN}

# Per-event-type authoring layer - every event type's OWN templates. Deliberately
# SEPARATE from BUILTIN_CATALOG so the engine (stage model, resolver, the 6 active
# anchors, publishing) is byte-identical; this layer is reached only via
# resolve_event_variant()/effective_variants_for() and the content-repository view.
_EVENT: List[Template] = _LOADED["event_templates"]
EVENT_CATALOG: Dict[str, Template] = {t.key: t for t in _EVENT}

# Every template that exists anywhere in the repository (base + per-event-type),
# for validation and content tooling. NOT what the engine iterates.
ALL_TEMPLATE_LIST: List[Template] = _BUILTIN + _EVENT   # raw (keeps duplicates visible)
ALL_TEMPLATES: Dict[str, Template] = {**BUILTIN_CATALOG, **EVENT_CATALOG}

# Index by Meta template name for reverse lookup (legacy campaigns that stored a
# raw Meta name resolve straight to their catalog entry). Only active anchors.
_BY_META = {t.meta.template_name: t for t in _BUILTIN if t.meta}

# --- content the stage layer consumes (kept here so the YAML is parsed once) ---
# template_key -> (variant_id, variant_display_name)
VARIANT_NAME_OF: Dict[str, Tuple[str, str]] = _LOADED["variant_name_of"]
# event_type -> {stage_id: recommended_variant_id}
RECOMMENDATIONS: Dict[str, Dict[str, str]] = _LOADED["recommendations"]
# event_type -> {stage_id: "true"|"optional"|"false"} - the wizard default matrix
AVAILABILITY: Dict[str, Dict[str, str]] = _LOADED["availability"]
# stage_id -> {"title": .., "description": ..}
STAGE_COPY: Dict[str, Dict[str, str]] = _LOADED["stage_copy"]

# --- Stage -> Event Type -> Variant -> Template inheritance indexes -----------
# The content repository groups copy by event type; these indexes resolve a
# (stage, event_type, variant) request to the right template, falling back to the
# shared base when an event type does not override that variant. Delivery is
# unchanged: with no overrides authored yet, every lookup lands on the shared base
# (the exact templates the resolver/worker already use).
BASE_EVENT_TYPE: str = _LOADED["base_event_type"]
# (stage_id, variant_id) -> shared base template key
_BASE_VARIANT_KEY: Dict[Tuple[str, str], str] = _LOADED["base_variant_key"]
# (stage_id, event_type, variant_id) -> event-type override template key
_EVENT_VARIANT_KEY: Dict[Tuple[str, str, str], str] = _LOADED["event_variant_key"]
# (stage_id, variant_id) -> Hebrew display name
_VARIANT_DISPLAY: Dict[Tuple[str, str], str] = _LOADED["variant_display"]


def resolve_event_variant(stage, event_type, variant) -> Optional[Template]:
    """Resolve Stage -> Event Type -> Variant -> Template with inheritance.

    Prefers an event-type-specific override; falls back to the shared base variant
    when the event type does not override it. Returns None if the (stage, variant)
    does not exist at all. Additive helper - it does NOT change the legacy key /
    (stage, variant) resolution the planner and worker use."""
    cs = canonical_stage(stage)
    if not cs:
        return None
    vid = (variant or "").strip()
    et = event_type_of(event_type)
    if et is not None:
        key = _EVENT_VARIANT_KEY.get((cs.value, et.value, vid))
        if key:
            return EVENT_CATALOG.get(key)          # the event type's OWN copy
    base_key = _BASE_VARIANT_KEY.get((cs.value, vid))
    return BUILTIN_CATALOG.get(base_key) if base_key else None   # _shared fallback


def effective_variants_for(stage, event_type) -> Dict[str, Dict]:
    """The variants an event type effectively sees for a stage: every shared base
    variant, with any event-type override taking precedence. For the editor -
    each entry says whether the copy is `inherited` (from the shared base) or an
    event-type-specific `override`. Purely a read view; no behavior change."""
    cs = canonical_stage(stage)
    if not cs:
        return {}
    et = event_type_of(event_type)
    out: Dict[str, Dict] = {}
    # shared base first (marked inherited - the safety-net fallback)
    for (sid, vid), key in _BASE_VARIANT_KEY.items():
        if sid == cs.value:
            out[vid] = {"variant": vid, "name": _VARIANT_DISPLAY.get((sid, vid), vid),
                        "template_key": key, "inherited": True}
    # the event type's OWN copy wins (this is where authors write)
    if et is not None:
        for (sid, e, vid), key in _EVENT_VARIANT_KEY.items():
            if sid == cs.value and e == et.value:
                out[vid] = {"variant": vid, "name": _VARIANT_DISPLAY.get((sid, vid), vid),
                            "template_key": key, "inherited": False}
    return out


def stage_recommended_for(event_type: str, stage) -> str:
    """Whether a stage is recommended for an event type: 'true' (on by default),
    'optional' (offered, off by default) or 'false'. A DEFAULT, not a restriction -
    the wizard may still enable any stage. Unknown combos default to 'optional' so
    a stage is never silently hidden."""
    cs = canonical_stage(stage)
    if not cs:
        return RECOMMENDED_OFF
    row = AVAILABILITY.get((event_type or "").strip().lower())
    if not row:
        return RECOMMENDED_OPTIONAL
    return row.get(cs.value, RECOMMENDED_OPTIONAL)


def builtin_by_key(key: str) -> Optional[Template]:
    return BUILTIN_CATALOG.get((key or "").strip())


def builtin_by_meta_name(name: str) -> Optional[Template]:
    return _BY_META.get((name or "").strip())


def usable_templates() -> List[Template]:
    """Templates that may be offered in the wizard / sent (approved or active)."""
    return [t for t in _BUILTIN if t.is_usable]


def default_for_stage(stage: FlowStage) -> Optional[Template]:
    """The recommended template for a stage. Prefers a usable default, then any
    usable, then a marked default, then the first - so drafts never shadow a
    deliverable template."""
    matches = [t for t in _BUILTIN if t.flow_stage == stage]
    if not matches:
        return None
    for pred in (
        lambda t: t.is_usable and t.is_default,
        lambda t: t.is_usable,
        lambda t: t.is_default,
    ):
        hit = next((t for t in matches if pred(t)), None)
        if hit:
            return hit
    return matches[0]
