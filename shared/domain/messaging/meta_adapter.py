"""Meta adapter - the ONLY place that knows Meta slot numbers / component shapes.

Given a resolved Template (its `meta` mapping) and a dict of canonical variable
VALUES, it produces the exact `parameters` structure outpost sends to the Meta
Cloud API. Nothing upstream (worker, planner, catalog) deals in slot indices.

It reproduces the pre-refactor payloads byte-for-byte for the six migrated
templates, so delivery is unchanged.
"""
from __future__ import annotations

from typing import Any, Dict

from .catalog import Template, MetaMapping, MetaShape, MetaSlot


def _slot_value(slot: MetaSlot, values: Dict[str, str]) -> str:
    # Mirrors the old `source.get(var, default)` exactly: the default applies only
    # when the variable is ABSENT, never when it is present-but-empty.
    v = values.get(slot.var, slot.default)
    return v if v is not None else ""


def build_meta_parameters(template: Template, values: Dict[str, str]) -> Dict[str, Any]:
    """Build the Meta `parameters` dict for a meta-template delivery."""
    meta = template.meta
    if meta is None:
        raise ValueError(f"template {template.key} has no Meta mapping")

    if meta.shape == MetaShape.POSITIONAL_FLAT:
        return {str(i + 1): _slot_value(s, values) for i, s in enumerate(meta.body)}

    if meta.shape == MetaShape.NAMED_FLAT:
        return {s.key: _slot_value(s, values) for s in meta.body}

    # STRUCTURED - header (optional) + numbered body + url buttons (optional).
    out: Dict[str, Any] = {}
    if meta.header_image_var:
        out["header"] = {"type": "image", "media_url": values.get(meta.header_image_var, "")}
    out["body"] = {str(i + 1): _slot_value(s, values) for i, s in enumerate(meta.body)}
    if meta.buttons:
        # On Meta the buttons are ordered quick-replies FIRST (capped at 3), then
        # url buttons - matching the publish builder. So a url button's absolute
        # index is offset past the quick-replies; sending it at its bare index (0)
        # collides with a quick-reply → "Button at index N must be of type QuickReply".
        qr_offset = min(len(template.quick_replies or ()), 3)
        out["buttons"] = [
            {"type": b.type, "index": qr_offset + b.index, "url": _button_suffix(values.get(b.var) or b.default)}
            for b in meta.buttons
        ]
    return out


def _button_suffix(value: str) -> str:
    """Meta url buttons are `<base>/<path>/{{1}}` - the send parameter is only the
    TRAILING dynamic segment (e.g. the invitation slug `demo`), not a full URL. If
    the resolved value is a full URL, use its last path segment."""
    v = value or ""
    if v.startswith("http") and "/" in v:
        return v.rstrip("/").rsplit("/", 1)[-1] or v
    return v


def build_meta_message(template: Template, values: Dict[str, str], *, recipient: str,
                       event_id: str, campaign_id: str, guest_id: str) -> Dict[str, Any]:
    """The full outpost message for a Meta-template send. Language comes from the
    catalog (data-driven) - never inferred from the template name."""
    if template.meta is None:
        raise ValueError(
            f"template {template.key} has no Meta mapping (meta_mapping is null); "
            f"it cannot be delivered as a Meta template"
        )
    return {
        "platform": "WA",
        "recipient": recipient,
        "template": template.meta.template_name,
        "language": template.meta.language,
        "parameters": build_meta_parameters(template, values),
        "message_type": "template",
        "source": "campaign_worker",
        "event_id": event_id,
        "state": template.key,
        "campaign_id": campaign_id,
        "guest_id": guest_id,
    }


def build_free_text(text: str, *, recipient: str, event_id: str, campaign_id: str,
                    guest_id: str) -> Dict[str, Any]:
    """The full outpost message for a free-text send (custom message / future AI).
    One delivery path, no duplicated logic - same envelope, different type/body."""
    return {
        "platform": "WA",
        "recipient": recipient,
        "message_type": "free_text",
        # Outpost's free_text contract reads `text` (rabbit_consumer requires it);
        # must not be `body`.
        "text": text,
        "source": "campaign_worker",
        "event_id": event_id,
        "state": "custom",
        "campaign_id": campaign_id,
        "guest_id": guest_id,
    }
