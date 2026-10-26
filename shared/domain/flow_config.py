"""Admin-editable guest RSVP conversation flow ("conversation flow settings").

The WhatsApp RSVP state machine (webhook-worker/states/*) has a fixed SHAPE -
invite -> party size -> guest questions -> notes -> done, plus the decline /
maybe / didn't-understand / opt-out branches. This module makes the SAFE parts
of it data: which optional steps run, the copy, the button labels and the party
size range. It is deliberately declarative - there is no way to express code,
new states or arbitrary transitions.

Layers (merged field by field, later wins):
    DEFAULT_FLOW  (this file - reproduces today's behaviour + copy exactly)
    -> scope 'global'      key 'default'
    -> scope 'event_type'  key wedding|bar|bat|brit|brita|birthday|corporate|other
    -> scope 'event'       key <event uuid>

Each stored layer is a SPARSE override (only the fields the admin changed), so
"reset to default" is just removing the key, and the UI can show
"ברירת מחדל" vs "שונה" per field.

Texts use {guest_name} {event_name} {host_name} {event_date} {event_time}
{venue} (+ {min_count}/{max_count} in the party-size texts). Unknown variables
are rejected at save time. `to_legacy_placeholders` converts a text to the
{{event.name}} syntax webhook-worker's BaseState._render_text already renders,
so phase-2 integration does not need a second renderer.

Pure python (no pydantic): webhook-worker and core vendor shared/ with
different dependency sets. SQLAlchemy is imported lazily inside the DB readers.
"""
from __future__ import annotations

import copy
import logging
import re
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

TABLE = "conversation_flow_configs"

SCOPE_GLOBAL = "global"
SCOPE_EVENT_TYPE = "event_type"
SCOPE_EVENT = "event"
SCOPES = (SCOPE_GLOBAL, SCOPE_EVENT_TYPE, SCOPE_EVENT)
GLOBAL_KEY = "default"

EVENT_TYPE_KEYS = ("wedding", "bar", "bat", "brit", "brita", "birthday", "corporate", "other")

# WhatsApp interactive limits.
WA_MAX_BUTTONS = 3
WA_BUTTON_LABEL_MAX = 20
WA_INTERACTIVE_BODY_MAX = 1024
WA_TEXT_MAX = 4096

PARTY_SIZE_HARD_MAX = 200

CACHE_TTL_SECONDS = 60

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

BASE_VARS = ("guest_name", "event_name", "host_name", "event_date", "event_time", "venue")
COUNT_VARS = ("min_count", "max_count")

VARIABLE_LABELS_HE = {
    "guest_name": "שם האורח",
    "event_name": "שם האירוע",
    "host_name": "שם המארחים",
    "event_date": "תאריך האירוע",
    "event_time": "שעת האירוע",
    "venue": "מקום האירוע",
    "min_count": "מינימום משתתפים",
    "max_count": "מקסימום משתתפים",
}

# {var} -> webhook-worker's existing {{x.y}} placeholder (BaseState._render_text).
LEGACY_PLACEHOLDER = {
    "guest_name": "{{guest.name}}",
    "event_name": "{{event.name}}",
    "host_name": "{{event.inviters}}",
    "event_date": "{{event.date}}",
    "event_time": "{{event.time}}",
    "venue": "{{event.location}}",
}

# Same fallbacks BaseState._render_text uses when a value is missing.
FALLBACK_VALUES = {
    "guest_name": "אורח/ת יקר/ה",
    "event_name": "האירוע",
    "host_name": " ",
    "event_date": "התאריך",
    "event_time": "השעה",
    "venue": "המיקום",
}

_VAR_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def variables_in(text: str) -> List[str]:
    """Single-brace {var} names used in `text` (ignores legacy {{x.y}})."""
    if not text:
        return []
    # Strip legacy double-brace placeholders first so {{event.name}} isn't read as {event}.
    stripped = re.sub(r"\{\{[^{}]*\}\}", "", text)
    return _VAR_RE.findall(stripped)


def render(text: str, values: Optional[Dict[str, Any]] = None) -> str:
    """Substitute {var} placeholders. Missing/empty values use FALLBACK_VALUES;
    unknown placeholders are left verbatim (validation rejects them at save)."""
    if not text:
        return ""
    vals = values or {}

    def _sub(m: "re.Match") -> str:
        name = m.group(1)
        v = vals.get(name)
        if v is None or (isinstance(v, str) and not v.strip() and name != "host_name"):
            if name in FALLBACK_VALUES:
                return FALLBACK_VALUES[name]
            if name in vals:
                return "" if v is None else str(v)
            return m.group(0)
        return str(v)

    return _VAR_RE.sub(_sub, text)


def to_legacy_placeholders(text: str, extra: Optional[Dict[str, Any]] = None) -> str:
    """Convert {event_name} -> {{event.name}} etc. for BaseState._render_text.
    `extra` values (e.g. {"max_count": 50}) are substituted directly."""
    if not text:
        return ""
    extra = extra or {}

    def _sub(m: "re.Match") -> str:
        name = m.group(1)
        if name in LEGACY_PLACEHOLDER:
            return LEGACY_PLACEHOLDER[name]
        if name in extra:
            return str(extra[name])
        return m.group(0)

    return _VAR_RE.sub(_sub, text)


# ---------------------------------------------------------------------------
# Default flow - EXACTLY today's behaviour and copy (see webhook-worker/states).
# ---------------------------------------------------------------------------

DEFAULT_FLOW: Dict[str, Any] = {
    "after_confirm": {
        # states/rsvp_count.py RsvpCountState / RsvpCountRetryState
        "ask_party_size": {
            "enabled": True,
            "text": (
                "יופי! שמחים לדעת שתוכל להגיע ל{event_name} של {host_name} 🥳\n"
                "רק כדי שנוכל להתכונן כמו שצריך – כמה אנשים תגיעו? 😊\n\n *הגב בבקשה במספר בלבד*"
            ),
            "retry_text": (
                "לא הצלחנו להבין כמה תהיו 😅\n"
                "נשמח למספר בלבד, בין {min_count} ל־{max_count} – כולל אותך. למשל: 2"
            ),
            "min": 1,
            "max": 50,
        },
        # Guest questions (event_field_defs.ask_in_rsvp) - asked after the party size.
        "ask_guest_questions": {
            "enabled": True,
        },
        # states/rsvp_info_question.py + states/note_info.py
        "ask_notes": {
            "enabled": True,
            "text": (
                "תודה על העדכון! האם יש משהו שחשוב שנדע? למשל מנה צמחונית/טבעונית "
                "או כל הערה מיוחדת – נשמח אם תעדכן כאן ❤️"
            ),
            "buttons": {
                "no_notes": "אין שום דבר מיוחד",
                "write_note": "לכתוב לנו הערה",
            },
            "note_prompt_text": "בוודאי 😊 נשמח אם תכתוב לנו את ההערה כאן 👇",
        },
        # states/rsvp_done.py
        "done_message": {
            "text": "מעולה! רשמנו לפנינו  ✨  \nאם יהיו שינויים, נשמח אם תעדכן כאן או תענה על ההודעה ❤️",
            "buttons": {
                "update": "לעדכן הגעה",
            },
        },
        # states/rsvp_update.py (reached from the done message's "update" button)
        "update_menu": {
            "text": "נשמח אם תעדכן אותנו מה השתנה לגבי ההגעה שלך ✨  \nאפשר לעדכן את הפרטים דרך הכפתור למטה ❤️",
            "buttons": {
                "add_note": "יש הערה שלא ציינו",
                "decline": "בסוף לא נוכל להגיע",
                "change_count": "נגיע כמות אחרת בסוף",
            },
        },
    },
    # states/rsvp_decline.py
    "after_decline": {
        "text": "חבל 😢 עדכנו שלא תגיע. אם תתחרט תמיד אפשר לכתוב לנו שוב!",
        "allow_change_mind": True,
        "buttons": {
            "change_mind": "בסוף נוכל להגיע",
        },
    },
    # states/rsvp_maybe.py
    "after_maybe": {
        "text": (
            "הכול טוב, לוקחים את הזמן 😊 נזכיר לך שוב קרוב יותר לאירוע.\n"
            "ברגע שתחליט/י - אפשר לעדכן כאן בכל רגע ❤️"
        ),
        # Informational today: reminder rounds target 'maybe' guests regardless.
        "remind": True,
        "buttons": {
            "confirm": "בסוף נוכל להגיע",
            "decline": "לצערי לא נוכל",
        },
    },
    # states/didnt_understand.py
    "didnt_understand": {
        "text": "לא כל כך הבנו את התשובה 😅 נסו לבחור אחת מהאפשרויות בהודעה למעלה",
    },
    # flow_manager.handle_event opt-out ack (phone-level - no event variables).
    "opt_out": {
        "text": "הוסרת מרשימת התפוצה ולא יישלחו אליך הודעות נוספות. כדי לחזור לקבל עדכונים, השב/י 'התחל'.",
    },
    # A guest who already answered taps an invitation/reminder button again.
    #   restart     - today: the new answer is applied and the flow re-runs from it
    #   acknowledge - send `text` (with the done message's update button), change nothing
    "already_answered": {
        "behavior": "restart",
        "text": "כבר רשמנו את התשובה שלך 😊 אם משהו השתנה, אפשר לעדכן בכפתור למטה ❤️",
    },
}

ALREADY_ANSWERED_BEHAVIORS = ("restart", "acknowledge")

# ---------------------------------------------------------------------------
# Schema (declarative): path -> field spec
# ---------------------------------------------------------------------------
# kinds: bool | int | text | buttons | enum
#   text:    {"kind": "text", "vars": (...), "max": n, "label": he}
#   buttons: {"kind": "buttons", "keys": (...)}

_T = BASE_VARS
SCHEMA: Dict[str, Dict[str, Any]] = {
    "after_confirm.ask_party_size.enabled": {"kind": "bool", "label": "לשאול כמה יגיעו"},
    "after_confirm.ask_party_size.text": {"kind": "text", "vars": _T + COUNT_VARS, "max": WA_TEXT_MAX, "label": "שאלת כמות"},
    "after_confirm.ask_party_size.retry_text": {"kind": "text", "vars": _T + COUNT_VARS, "max": WA_TEXT_MAX, "label": "הודעה כשהמספר לא תקין"},
    "after_confirm.ask_party_size.min": {"kind": "int", "min": 1, "max": PARTY_SIZE_HARD_MAX, "label": "מינימום"},
    "after_confirm.ask_party_size.max": {"kind": "int", "min": 1, "max": PARTY_SIZE_HARD_MAX, "label": "מקסימום"},
    "after_confirm.ask_guest_questions.enabled": {"kind": "bool", "label": "לשאול את שאלות האירוע"},
    "after_confirm.ask_notes.enabled": {"kind": "bool", "label": "לשאול על הערות"},
    "after_confirm.ask_notes.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "שאלת הערות"},
    "after_confirm.ask_notes.buttons": {"kind": "buttons", "keys": ("no_notes", "write_note"), "label": "כפתורי הערות"},
    "after_confirm.ask_notes.note_prompt_text": {"kind": "text", "vars": _T, "max": WA_TEXT_MAX, "label": "בקשה לכתוב הערה"},
    "after_confirm.done_message.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "הודעת סיום"},
    "after_confirm.done_message.buttons": {"kind": "buttons", "keys": ("update",), "label": "כפתור עדכון"},
    "after_confirm.update_menu.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "תפריט עדכון"},
    "after_confirm.update_menu.buttons": {"kind": "buttons", "keys": ("add_note", "decline", "change_count"), "label": "כפתורי עדכון"},
    "after_decline.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "הודעה אחרי סירוב"},
    "after_decline.allow_change_mind": {"kind": "bool", "label": "כפתור 'בסוף נגיע'"},
    "after_decline.buttons": {"kind": "buttons", "keys": ("change_mind",), "label": "כפתור שינוי דעה"},
    "after_maybe.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "הודעה אחרי 'אולי'"},
    "after_maybe.remind": {"kind": "bool", "label": "תזכורת למתלבטים"},
    "after_maybe.buttons": {"kind": "buttons", "keys": ("confirm", "decline"), "label": "כפתורי 'אולי'"},
    "didnt_understand.text": {"kind": "text", "vars": _T, "max": WA_TEXT_MAX, "label": "לא הבנו"},
    "opt_out.text": {"kind": "text", "vars": (), "max": WA_TEXT_MAX, "label": "אישור הסרה"},
    "already_answered.behavior": {"kind": "enum", "values": ALREADY_ANSWERED_BEHAVIORS, "label": "כשכבר ענו"},
    "already_answered.text": {"kind": "text", "vars": _T, "max": WA_INTERACTIVE_BODY_MAX, "label": "הודעה למי שכבר ענה"},
}


def _get_path(d: Dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def _set_path(d: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cur = d
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def _del_path(d: Dict[str, Any], path: str) -> None:
    parts = path.split(".")
    stack = []
    cur: Any = d
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return
        stack.append((cur, part))
        cur = cur[part]
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)
    # prune empty parents
    for parent, key in reversed(stack):
        if isinstance(parent.get(key), dict) and not parent[key]:
            parent.pop(key)


def deep_merge(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Field-by-field merge; dicts recurse, everything else replaces."""
    out = copy.deepcopy(base)
    if not override:
        return out
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _leaf_paths(d: Dict[str, Any], prefix: str = "") -> Iterable[Tuple[str, Any]]:
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else str(k)
        if p in SCHEMA:
            yield p, v
        elif isinstance(v, dict):
            yield from _leaf_paths(v, p)
        else:
            yield p, v


def override_paths(override: Optional[Dict[str, Any]]) -> List[str]:
    """Leaf paths an override sets (buttons expand to path.key)."""
    out: List[str] = []
    for p, v in _leaf_paths(override or {}):
        spec = SCHEMA.get(p)
        if spec and spec["kind"] == "buttons" and isinstance(v, dict):
            out.extend(f"{p}.{k}" for k in v)
        else:
            out.append(p)
    return out


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _err(path: str, code: str, message: str) -> Dict[str, str]:
    return {"path": path, "code": code, "message": message}


def _validate_field(path: str, spec: Dict[str, Any], value: Any) -> List[Dict[str, str]]:
    errs: List[Dict[str, str]] = []
    kind = spec["kind"]
    if kind == "bool":
        if not isinstance(value, bool):
            errs.append(_err(path, "type", "ערך חייב להיות כן/לא"))
    elif kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            errs.append(_err(path, "type", "ערך חייב להיות מספר שלם"))
        elif not (spec["min"] <= value <= spec["max"]):
            errs.append(_err(path, "range", f"הערך חייב להיות בין {spec['min']} ל-{spec['max']}"))
    elif kind == "enum":
        if value not in spec["values"]:
            errs.append(_err(path, "enum", "ערך לא מוכר"))
    elif kind == "text":
        if not isinstance(value, str):
            errs.append(_err(path, "type", "ערך חייב להיות טקסט"))
        else:
            if not value.strip():
                errs.append(_err(path, "empty", "הטקסט לא יכול להיות ריק"))
            if len(value) > spec["max"]:
                errs.append(_err(path, "too_long", f"הטקסט ארוך מדי (מקסימום {spec['max']} תווים)"))
            unknown = sorted({v for v in variables_in(value) if v not in spec["vars"]})
            if unknown:
                allowed = ", ".join("{" + v + "}" for v in spec["vars"]) or "אין משתנים בהודעה זו"
                errs.append(_err(path, "unknown_var",
                                 f"משתנה לא מוכר: {', '.join('{' + u + '}' for u in unknown)}. מותר: {allowed}"))
            if "{{" in value or "}}" in value:
                errs.append(_err(path, "bad_braces", "יש להשתמש במשתנים בפורמט {event_name}"))
    elif kind == "buttons":
        if not isinstance(value, dict):
            errs.append(_err(path, "type", "כפתורים חייבים להיות אובייקט"))
            return errs
        for k, label in value.items():
            bp = f"{path}.{k}"
            if k not in spec["keys"]:
                errs.append(_err(bp, "unknown_key", "כפתור לא מוכר"))
                continue
            if not isinstance(label, str) or not label.strip():
                errs.append(_err(bp, "empty", "תווית כפתור לא יכולה להיות ריקה"))
                continue
            if len(label.strip()) > WA_BUTTON_LABEL_MAX:
                errs.append(_err(bp, "too_long", f"תווית כפתור עד {WA_BUTTON_LABEL_MAX} תווים (וואטסאפ)"))
            if variables_in(label) or "{" in label:
                errs.append(_err(bp, "no_vars", "אין להשתמש במשתנים בתווית כפתור"))
        if len(spec["keys"]) > WA_MAX_BUTTONS:  # schema guard
            errs.append(_err(path, "too_many", f"עד {WA_MAX_BUTTONS} כפתורים"))
    return errs


def validate_override(override: Any) -> List[Dict[str, str]]:
    """Validate a SPARSE override: only known paths, correct types."""
    if override is None:
        return []
    if not isinstance(override, dict):
        return [_err("", "type", "התצורה חייבת להיות אובייקט")]
    errs: List[Dict[str, str]] = []
    for path, value in _leaf_paths(override):
        spec = SCHEMA.get(path)
        if spec is None:
            errs.append(_err(path, "unknown_field", "שדה לא מוכר"))
            continue
        errs.extend(_validate_field(path, spec, value))
    return errs


def validate_effective(flow: Dict[str, Any]) -> List[Dict[str, str]]:
    """Cross-field checks on a fully merged flow."""
    errs: List[Dict[str, str]] = []
    for path, spec in SCHEMA.items():
        value = _get_path(flow, path)
        if value is None:
            errs.append(_err(path, "missing", "שדה חסר"))
            continue
        errs.extend(_validate_field(path, spec, value))
    ps = _get_path(flow, "after_confirm.ask_party_size") or {}
    if isinstance(ps.get("min"), int) and isinstance(ps.get("max"), int) and ps["min"] > ps["max"]:
        errs.append(_err("after_confirm.ask_party_size.min", "range", "המינימום גדול מהמקסימום"))
    # Buttons inside one message must be distinct (WhatsApp rejects duplicates).
    for path, spec in SCHEMA.items():
        if spec["kind"] != "buttons":
            continue
        labels = [str(v).strip() for v in (_get_path(flow, path) or {}).values()]
        if len(labels) != len(set(labels)):
            errs.append(_err(path, "duplicate", "תוויות הכפתורים בהודעה חייבות להיות שונות"))
    return errs


def validate_layers(*overrides: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    errs: List[Dict[str, str]] = []
    for o in overrides:
        errs.extend(validate_override(o))
    if errs:
        return errs
    return validate_effective(merge_layers(*overrides))


def merge_layers(*overrides: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = copy.deepcopy(DEFAULT_FLOW)
    for o in overrides:
        if o:
            out = deep_merge(out, o)
    return out


def normalize_override(override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Canonical sparse override: strip button labels. Values equal to the
    default are KEPT - an event-type layer may deliberately restore the default
    over a changed global layer. Does not validate."""
    out: Dict[str, Any] = {}
    for path, value in _leaf_paths(override or {}):
        spec = SCHEMA.get(path)
        if spec and spec["kind"] == "buttons" and isinstance(value, dict):
            for k, label in value.items():
                _set_path(out, f"{path}.{k}", label.strip() if isinstance(label, str) else label)
        else:
            _set_path(out, path, value)
    return out


def reset_field(override: Dict[str, Any], path: str) -> Dict[str, Any]:
    out = copy.deepcopy(override or {})
    _del_path(out, path)
    return out


# ---------------------------------------------------------------------------
# FlowConfig - what the worker reads
# ---------------------------------------------------------------------------

class FlowConfig:
    """Effective (merged) flow for one conversation. Read-only."""

    def __init__(self, data: Dict[str, Any], *, layers: Optional[List[Dict[str, Any]]] = None):
        self.data = data
        # [{"scope", "scope_key", "version"}] that contributed (for logs/debug).
        self.layers = layers or []

    def get(self, path: str, default: Any = None) -> Any:
        v = _get_path(self.data, path)
        return default if v is None else v

    def enabled(self, path: str) -> bool:
        return bool(self.get(path, False))

    def text(self, path: str, values: Optional[Dict[str, Any]] = None) -> str:
        """Rendered text (for previews / non-worker callers)."""
        return render(str(self.get(path, "")), {**self._count_values(), **(values or {})})

    def legacy_text(self, path: str) -> str:
        """Text in webhook-worker's {{event.name}} syntax, count vars substituted.
        Pass straight to BaseState.build_text / build_interactive."""
        return to_legacy_placeholders(str(self.get(path, "")), self._count_values())

    def buttons(self, path: str) -> List[str]:
        """Button labels in schema order (≤3)."""
        spec = SCHEMA.get(path) or {}
        labels = self.get(path, {}) or {}
        return [str(labels[k]).strip() for k in spec.get("keys", ()) if labels.get(k)][:WA_MAX_BUTTONS]

    def button(self, path: str, key: str) -> str:
        return str(self.get(f"{path}.{key}", "")).strip()

    @property
    def party_min(self) -> int:
        return int(self.get("after_confirm.ask_party_size.min", 1))

    @property
    def party_max(self) -> int:
        return int(self.get("after_confirm.ask_party_size.max", 50))

    def _count_values(self) -> Dict[str, Any]:
        return {"min_count": self.party_min, "max_count": self.party_max}

    def to_dict(self) -> Dict[str, Any]:
        return copy.deepcopy(self.data)


def default_flow() -> FlowConfig:
    return FlowConfig(copy.deepcopy(DEFAULT_FLOW))


def build_flow(global_o: Optional[dict] = None, type_o: Optional[dict] = None,
               event_o: Optional[dict] = None, *, layers: Optional[list] = None) -> FlowConfig:
    """Merge layers, dropping any layer that does not validate (fail-safe:
    a bad stored row never breaks the guest conversation)."""
    good: List[Optional[dict]] = []
    for o in (global_o, type_o, event_o):
        if o and validate_override(o):
            logger.error("flow_config: ignoring invalid stored override")
            continue
        good.append(o)
    merged = merge_layers(*good)
    if validate_effective(merged):
        logger.error("flow_config: merged flow invalid - falling back to defaults")
        return FlowConfig(copy.deepcopy(DEFAULT_FLOW), layers=layers)
    return FlowConfig(merged, layers=layers)


# ---------------------------------------------------------------------------
# DB readers (sync Session/Connection and AsyncSession) + 60s cache
# ---------------------------------------------------------------------------

ACTIVE_ROWS_SQL = (
    f"SELECT scope, scope_key, config, version FROM {TABLE} "
    "WHERE is_active AND ((scope = 'global' AND scope_key = 'default') "
    "OR (scope = 'event_type' AND scope_key = :etype) "
    "OR (scope = 'event' AND scope_key = :eid))"
)

_cache: Dict[Tuple[str, str], Tuple[float, FlowConfig]] = {}
_cache_lock = threading.Lock()


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


def normalize_event_type(event_type: Any) -> str:
    v = str(event_type or "").strip().lower()
    return v if v in EVENT_TYPE_KEYS else ""


def _coerce_json(v: Any) -> Optional[dict]:
    if v is None:
        return None
    if isinstance(v, dict):
        return v
    import json
    try:
        out = json.loads(v)
        return out if isinstance(out, dict) else None
    except (TypeError, ValueError):
        return None


coerce_json = _coerce_json


def flow_from_rows(rows: Iterable[Any]) -> FlowConfig:
    by_scope: Dict[str, dict] = {}
    layers: List[dict] = []
    for r in rows:
        m = r._mapping if hasattr(r, "_mapping") else r
        scope = m["scope"]
        by_scope[scope] = _coerce_json(m["config"]) or {}
        layers.append({"scope": scope, "scope_key": m["scope_key"], "version": m["version"]})
    order = {s: i for i, s in enumerate(SCOPES)}
    layers.sort(key=lambda x: order.get(x["scope"], 9))
    return build_flow(by_scope.get(SCOPE_GLOBAL), by_scope.get(SCOPE_EVENT_TYPE),
                      by_scope.get(SCOPE_EVENT), layers=layers)


def _active_rows_stmt() -> Any:
    try:
        from sqlalchemy import text as _text
    except ImportError:  # unit tests with a fake connection
        return ACTIVE_ROWS_SQL
    return _text(ACTIVE_ROWS_SQL)


def _cache_get(key: Tuple[str, str]) -> Optional[FlowConfig]:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    return None


def _cache_put(key: Tuple[str, str], flow: FlowConfig) -> None:
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, flow)


def resolve_flow(conn_or_session: Any, event_type: Any = None, event_id: Any = None,
                 *, use_cache: bool = True) -> FlowConfig:
    """Effective flow for an event (sync SQLAlchemy Session or Connection).
    Never raises: on any DB problem returns DEFAULT_FLOW."""
    etype = normalize_event_type(event_type)
    eid = str(event_id or "")
    key = (etype, eid)
    if use_cache:
        hit = _cache_get(key)
        if hit is not None:
            return hit
    try:
        rows = conn_or_session.execute(_active_rows_stmt(), {"etype": etype, "eid": eid}).fetchall()
        flow = flow_from_rows(rows)
    except Exception as exc:  # table missing, DB hiccup - never break the RSVP
        logger.warning("flow_config: resolve failed (%s) - using defaults", exc)
        try:
            conn_or_session.rollback()
        except Exception:
            pass
        flow = default_flow()
        if use_cache:
            _cache_put(key, flow)
        return flow
    if use_cache:
        _cache_put(key, flow)
    return flow


async def aresolve_flow(session: Any, event_type: Any = None, event_id: Any = None,
                        *, use_cache: bool = True) -> FlowConfig:
    """Async variant for webhook-worker's AsyncSession. Never raises.

    NOTE: on failure this rolls `session` back - pass a dedicated connection
    (webhook-worker uses engine.connect()), not a session holding ORM objects."""
    etype = normalize_event_type(event_type)
    eid = str(event_id or "")
    key = (etype, eid)
    if use_cache:
        hit = _cache_get(key)
        if hit is not None:
            return hit
    try:
        res = await session.execute(_active_rows_stmt(), {"etype": etype, "eid": eid})
        flow = flow_from_rows(res.fetchall())
    except Exception as exc:
        logger.warning("flow_config: resolve failed (%s) - using defaults", exc)
        try:
            await session.rollback()
        except Exception:
            pass
        flow = default_flow()
        if use_cache:
            _cache_put(key, flow)
        return flow
    if use_cache:
        _cache_put(key, flow)
    return flow


# ---------------------------------------------------------------------------
# Preview: simulated conversation
# ---------------------------------------------------------------------------

SAMPLE_VALUES_BY_TYPE: Dict[str, Dict[str, str]] = {
    "wedding": {"event_name": "החתונה", "host_name": "נועה ואורי"},
    "bar": {"event_name": "בר המצווה", "host_name": "משפחת לוי"},
    "bat": {"event_name": "בת המצווה", "host_name": "משפחת כהן"},
    "brit": {"event_name": "הברית", "host_name": "שירה ודניאל"},
    "brita": {"event_name": "הבריתה", "host_name": "שירה ודניאל"},
    "birthday": {"event_name": "יום ההולדת", "host_name": "יעל"},
    "corporate": {"event_name": "כנס השנתי", "host_name": "צוות החברה"},
    "other": {"event_name": "האירוע", "host_name": "המארחים"},
}

SAMPLE_COMMON = {
    "guest_name": "דנה",
    "event_date": "יום חמישי, ה־12.11.26",
    "event_time": "19:30",
    "venue": "אולמי הגן",
}

# The invitation itself is a catalog TEMPLATE (not editable here); these are the
# standard RSVP quick replies shown for context only.
INVITE_BUTTONS = ["ברור שאגיע!", "לצערי לא אוכל", "עוד מתלבט/ת, תחזרו אלי?"]

SAMPLE_QUESTIONS = [
    {"label": "האם תצטרכו הסעה?", "options": ["כן", "לא"]},
]


def sample_values(event_type: Any = None, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    etype = normalize_event_type(event_type) or "other"
    return {**SAMPLE_COMMON, **SAMPLE_VALUES_BY_TYPE.get(etype, {}), **(overrides or {})}


def _bot(text: str, buttons: Optional[List[str]] = None, *, step: str, note: Optional[str] = None) -> Dict[str, Any]:
    t: Dict[str, Any] = {"from": "bot", "text": text, "buttons": buttons or [], "step": step}
    if note:
        t["note"] = note
    return t


def _guest(text: str, *, tap: bool = False) -> Dict[str, Any]:
    return {"from": "guest", "text": text, "tap": tap}


def simulate(flow: FlowConfig, event_type: Any = None, *, values: Optional[Dict[str, Any]] = None,
             questions: Optional[List[Dict[str, Any]]] = None) -> Dict[str, List[Dict[str, Any]]]:
    """Simulated transcripts for each path. Pure; mirrors the worker's states."""
    vals = sample_values(event_type, values)
    qs = SAMPLE_QUESTIONS if questions is None else questions

    def T(path: str) -> str:
        return flow.text(path, vals)

    invite = _bot(
        f"היי {vals['guest_name']}! {vals['host_name']} מזמינים אותך: {vals['event_name']}, "
        f"{vals['event_date']} בשעה {vals['event_time']}, {vals['venue']} 🎉",
        INVITE_BUTTONS, step="invite", note="הודעת ההזמנה (תבנית מהקטלוג - לא נערכת כאן)",
    )

    # --- confirm ---
    confirm: List[Dict[str, Any]] = [invite, _guest(INVITE_BUTTONS[0], tap=True)]
    if flow.enabled("after_confirm.ask_party_size.enabled"):
        confirm.append(_bot(T("after_confirm.ask_party_size.text"), step="ask_party_size"))
        confirm.append(_guest("המון"))
        confirm.append(_bot(T("after_confirm.ask_party_size.retry_text"), step="ask_party_size_retry"))
        confirm.append(_guest(str(min(2, flow.party_max))))
    if flow.enabled("after_confirm.ask_guest_questions.enabled") and qs:
        for q in qs:
            opts = [str(o) for o in (q.get("options") or [])][:WA_MAX_BUTTONS]
            confirm.append(_bot(str(q.get("label") or ""), opts, step="guest_question",
                                note="שאלה מתוך 'שאלות לאורחים' של האירוע"))
            confirm.append(_guest(opts[0] if opts else "כן", tap=bool(opts)))
    if flow.enabled("after_confirm.ask_notes.enabled"):
        nb = flow.buttons("after_confirm.ask_notes.buttons")
        confirm.append(_bot(T("after_confirm.ask_notes.text"), nb, step="ask_notes"))
        confirm.append(_guest(flow.button("after_confirm.ask_notes.buttons", "write_note"), tap=True))
        confirm.append(_bot(T("after_confirm.ask_notes.note_prompt_text"), step="note_prompt"))
        confirm.append(_guest("אני צמחונית 🌱"))
    confirm.append(_bot(T("after_confirm.done_message.text"),
                        flow.buttons("after_confirm.done_message.buttons"), step="done"))

    # --- update (from done) ---
    update = [
        _bot(T("after_confirm.done_message.text"), flow.buttons("after_confirm.done_message.buttons"), step="done"),
        _guest(flow.button("after_confirm.done_message.buttons", "update"), tap=True),
        _bot(T("after_confirm.update_menu.text"), flow.buttons("after_confirm.update_menu.buttons"), step="update_menu"),
    ]

    # --- decline ---
    decline = [invite, _guest(INVITE_BUTTONS[1], tap=True)]
    dbtn = flow.buttons("after_decline.buttons") if flow.enabled("after_decline.allow_change_mind") else []
    decline.append(_bot(T("after_decline.text"), dbtn, step="decline"))
    if dbtn:
        decline.append(_guest(dbtn[0], tap=True))
        if flow.enabled("after_confirm.ask_party_size.enabled"):
            decline.append(_bot(T("after_confirm.ask_party_size.text"), step="ask_party_size",
                                note="ממשיך כמו אחרי 'מגיעים'"))

    # --- maybe ---
    maybe = [invite, _guest(INVITE_BUTTONS[2], tap=True),
             _bot(T("after_maybe.text"), flow.buttons("after_maybe.buttons"), step="maybe",
                  note=None if flow.enabled("after_maybe.remind") else "ללא תזכורת למתלבטים")]

    # --- didn't understand ---
    didnt = [invite, _guest("מה השעה בדיוק?"), _bot(T("didnt_understand.text"), step="didnt_understand")]

    # --- already answered ---
    if flow.get("already_answered.behavior") == "acknowledge":
        already = [_guest(INVITE_BUTTONS[0], tap=True),
                   _bot(T("already_answered.text"), flow.buttons("after_confirm.done_message.buttons"),
                        step="already_answered")]
    else:
        already = [_guest(INVITE_BUTTONS[1], tap=True),
                   _bot(T("after_decline.text"), dbtn, step="decline", note="התשובה החדשה נרשמת והשיחה ממשיכה ממנה")]

    # --- opt out ---
    opt_out = [_guest("הסר"), _bot(flow.text("opt_out.text", {}), step="opt_out")]

    return {
        "confirm": confirm,
        "update": update,
        "decline": decline,
        "maybe": maybe,
        "didnt_understand": didnt,
        "already_answered": already,
        "opt_out": opt_out,
    }


def schema_for_ui() -> Dict[str, Any]:
    """Field specs for the admin UI (labels, limits, allowed vars)."""
    out = {}
    for path, spec in SCHEMA.items():
        s = {k: (list(v) if isinstance(v, tuple) else v) for k, v in spec.items()}
        out[path] = s
    return {
        "fields": out,
        "variables": [{"name": v, "label": VARIABLE_LABELS_HE[v]} for v in BASE_VARS + COUNT_VARS],
        "limits": {"buttons": WA_MAX_BUTTONS, "button_label": WA_BUTTON_LABEL_MAX,
                   "interactive_body": WA_INTERACTIVE_BODY_MAX, "text": WA_TEXT_MAX},
        "event_types": list(EVENT_TYPE_KEYS),
    }


EVENT_TYPE_SQL = "SELECT event_type FROM events WHERE CAST(id AS text) = :eid"


def cached_flow_for_event(event_id: Any) -> Optional[FlowConfig]:
    """Cache peek (no I/O) - lets a caller skip opening a connection."""
    return _cache_get(("@event", str(event_id or "")))


def cached_flow(event_type: Any = None, event_id: Any = None) -> Optional[FlowConfig]:
    return _cache_get((normalize_event_type(event_type), str(event_id or "")))


async def aresolve_flow_for_event(session: Any, event_id: Any, *, use_cache: bool = True) -> FlowConfig:
    """webhook-worker entry point: looks up the event's type, then layers
    global -> event_type -> event. Cached 60s per event. Never raises."""
    eid = str(event_id or "")
    key = ("@event", eid)
    if use_cache:
        hit = _cache_get(key)
        if hit is not None:
            return hit
    etype = ""
    if eid:
        try:
            try:
                from sqlalchemy import text as _text
                stmt: Any = _text(EVENT_TYPE_SQL)
            except ImportError:
                stmt = EVENT_TYPE_SQL
            res = await session.execute(stmt, {"eid": eid})
            row = res.first()
            etype = (row[0] if row else "") or ""
        except Exception as exc:
            logger.warning("flow_config: event type lookup failed (%s)", exc)
            try:
                await session.rollback()
            except Exception:
                pass
    flow = await aresolve_flow(session, etype, eid, use_cache=use_cache)
    if use_cache:
        _cache_put(key, flow)
    return flow
