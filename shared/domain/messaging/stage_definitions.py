"""Communication Stages - the business layer above templates.

The platform models WORKFLOWS, not individual messages. The hierarchy is:

    Event Type → Stage Definition → Variant → Campaign (execution instance)

A **Stage Definition** is the business object: it owns the trigger, the audience
rule (WHO enters), the interaction flow, the completion rule (when the stage's
objective is met) and which stages may follow. A **Variant** is a communication
STYLE within a stage; it changes only wording/look, never behavior. A variant has
one or more **channel implementations** (WhatsApp today; Email/SMS later) - each
implementation is a catalog `Template` (which carries the channel's delivery/Meta
mapping). A **Campaign** is just "run Stage X, variant Y, at time Z"; it holds no
business logic - the planner decides WHEN, the audience rule decides WHO, the
worker decides HOW.

This layer is ADDITIVE and non-breaking: a template is now reachable both by its
legacy key and by (stage, variant, channel), and both resolve to the SAME
`Template`, so delivery is byte-identical. The stage metadata below documents the
existing behavior declaratively - it does not change it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

from shared.domain.enums import CampaignAudience, GuestStatus
from .stages import FlowStage, canonical_stage
from .catalog import (
    BUILTIN_CATALOG, Template,
    VARIANT_NAME_OF, RECOMMENDATIONS, STAGE_COPY,
)


# --- stage-level vocabularies ------------------------------------------------

class Trigger(str, Enum):
    MANUAL = "manual"
    SCHEDULED = "scheduled"
    AFTER_PREVIOUS_STAGE = "after_previous_stage"
    AFTER_RSVP = "after_rsvp"
    AFTER_EVENT = "after_event"
    AFTER_PAYMENT = "after_payment"
    CUSTOM = "custom"


class AudienceRule(str, Enum):
    """WHO enters the stage. Resolved to concrete guests at execution time by the
    campaign runner (never a fixed list on the stage)."""
    EVERYONE = "everyone"
    PENDING_RSVP = "pending_rsvp"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    # Everyone who has NOT declined: confirmed + not-yet-answered + maybe.
    NOT_DECLINED = "not_declined"
    WITHOUT_TABLE = "without_table"
    WITH_TABLE = "with_table"
    VIP = "vip"
    FAMILY = "family"
    BRIDE_SIDE = "bride_side"
    GROOM_SIDE = "groom_side"
    CUSTOM = "custom"


class CompletionRule(str, Enum):
    EVERYONE_PROCESSED = "everyone_processed"
    RSVP_COMPLETED = "rsvp_completed"
    TIMEOUT_REACHED = "timeout_reached"
    MANUAL_CLOSE = "manual_close"
    BUSINESS_RULE = "business_rule"


class FlowStep(str, Enum):
    SEND_MESSAGE = "send_message"
    GUEST_OPENS = "guest_opens"
    GUEST_RESPONDS = "guest_responds"
    COLLECT_RSVP = "collect_rsvp"
    COLLECT_GUEST_COUNT = "collect_guest_count"
    COLLECT_NOTES = "collect_notes"
    ASSIGN_TABLE = "assign_table"
    COMPLETE = "complete"


# --- Audience rule resolution ------------------------------------------------
# Maps a stage's audience rule to the (CampaignAudience, filter) BOTH audience
# resolvers understand (core app/audience.py and campaign-worker/audience.py).
# Custom filters may only use keys both support: status (list), group (str),
# tag_id (uuid), table ('none' | 'any'). An unsupported key is ignored by the
# resolvers, which silently WIDENS the audience - so it must never appear here.
#
# Which rules are applied AUTOMATICALLY when a campaign is created without an
# explicit audience: see AUTO_APPLICABLE_RULES. The group-based rules
# (VIP/FAMILY/BRIDE/GROOM) depend on owner-chosen free-text group names, so they
# are never auto-applied; their mapping is deliberately narrow (a group filter
# that matches nobody rather than everyone).

_NOT_DECLINED_STATUSES = sorted(
    GuestStatus.confirmed_values() | GuestStatus.pending_values() | GuestStatus.maybe_values()
)
_CONFIRMED_STATUSES = sorted(GuestStatus.confirmed_values())

_AUDIENCE_RULE_MAP: Dict[AudienceRule, Tuple[CampaignAudience, Optional[dict]]] = {
    AudienceRule.EVERYONE: (CampaignAudience.EVERYONE, None),
    AudienceRule.PENDING_RSVP: (CampaignAudience.NO_RESPONSE, None),
    AudienceRule.CONFIRMED: (CampaignAudience.CONFIRMED, None),
    AudienceRule.DECLINED: (CampaignAudience.DECLINED, None),
    AudienceRule.NOT_DECLINED: (CampaignAudience.CUSTOM, {"status": _NOT_DECLINED_STATUSES}),
    AudienceRule.WITHOUT_TABLE: (CampaignAudience.CUSTOM, {"status": _CONFIRMED_STATUSES, "table": "none"}),
    AudienceRule.WITH_TABLE: (CampaignAudience.CUSTOM, {"status": _CONFIRMED_STATUSES, "table": "any"}),
    # Tags are addressed by tag_id (uuid), not name - a "vip" tag cannot be
    # expressed statically. Narrow fallback: a group literally named "vip".
    AudienceRule.VIP: (CampaignAudience.CUSTOM, {"group": "vip"}),
    AudienceRule.FAMILY: (CampaignAudience.CUSTOM, {"group": "family"}),
    AudienceRule.BRIDE_SIDE: (CampaignAudience.CUSTOM, {"group": "bride"}),
    AudienceRule.GROOM_SIDE: (CampaignAudience.CUSTOM, {"group": "groom"}),
    AudienceRule.CUSTOM: (CampaignAudience.CUSTOM, None),
}


# Rules safe to apply automatically (no owner-specific naming involved).
AUTO_APPLICABLE_RULES = frozenset({
    AudienceRule.EVERYONE, AudienceRule.PENDING_RSVP, AudienceRule.CONFIRMED,
    AudienceRule.DECLINED, AudienceRule.NOT_DECLINED,
    AudienceRule.WITHOUT_TABLE, AudienceRule.WITH_TABLE,
})


def resolve_audience_rule(rule: AudienceRule) -> Tuple[str, Optional[dict]]:
    """(campaign_audience_value, audience_filter) for a stage audience rule."""
    aud, flt = _AUDIENCE_RULE_MAP.get(rule, (CampaignAudience.EVERYONE, None))
    return aud.value, (dict(flt) if flt else None)


def default_audience_for_stage(stage_id) -> Optional[Tuple[str, Optional[dict]]]:
    """The (audience, audience_filter) a campaign of this stage gets when the
    creator did not choose one explicitly - or None when the stage is unknown or
    its rule must not be applied automatically (caller keeps its own default)."""
    sd = stage_by_id(stage_id)
    if sd is None or sd.audience_rule not in AUTO_APPLICABLE_RULES:
        return None
    return resolve_audience_rule(sd.audience_rule)


# --- Variant / channel model -------------------------------------------------

@dataclass(frozen=True)
class ChannelImpl:
    """One channel's implementation of a variant → a catalog template."""
    channel: str          # whatsapp | email | sms | …
    template_key: str     # key into BUILTIN_CATALOG


@dataclass(frozen=True)
class Variant:
    """A communication STYLE within a stage. Style only - no business behavior."""
    id: str
    name: str
    description: str
    tone: str
    event_types: Tuple[str, ...]
    is_default: bool
    premium: bool
    lifecycle: str
    channels: Tuple[ChannelImpl, ...]


@dataclass(frozen=True)
class StageDefinition:
    """A complete communication workflow. The business object of the system."""
    id: str                              # canonical FlowStage value
    title: str
    description: str
    event_types: Tuple[str, ...]         # empty = all
    trigger: Trigger
    audience_rule: AudienceRule
    completion_rule: CompletionRule
    flow_steps: Tuple[FlowStep, ...]
    next_stages: Tuple[str, ...]
    variants: Tuple[Variant, ...]

    def default_variant(self) -> Optional[Variant]:
        usable = [v for v in self.variants if v.lifecycle in ("active", "approved")]
        for v in usable:
            if v.is_default:
                return v
        return usable[0] if usable else (self.variants[0] if self.variants else None)


# --- template → variant grouping ---------------------------------------------
# Which variant (style) each catalog template belongs to, and its Hebrew display
# name. This now comes from the content SSOT (the YAML `stage → variant`
# grouping), loaded once by catalog.py. Keeping the stage/style concern in the
# stage layer, but the data itself is editable content - not code.

_VARIANT_OF: Dict[str, Tuple[str, str]] = VARIANT_NAME_OF  # template_key -> (variant_id, name)


# ---------------------------------------------------------------------------
# DEFAULT VARIANTS - the recommended variant per (event type × stage). This is a
# RECOMMENDATION, not a restriction: every stage supports every event type, and
# any variant can be chosen manually. Sourced from the content SSOT's
# `recommendations` section (editable without touching Python).
# ---------------------------------------------------------------------------
DEFAULT_VARIANTS: Dict[str, Dict[str, str]] = RECOMMENDATIONS


def default_variant_for(event_type: str, stage_id) -> Optional[str]:
    """Recommended variant id for an (event type, stage). Falls back to the
    stage's usable default variant so every combination always resolves."""
    cs = canonical_stage(stage_id)
    if not cs:
        return None
    rec = DEFAULT_VARIANTS.get((event_type or "").strip().lower(), {}).get(cs.value)
    if rec:
        return rec
    sd = STAGE_DEFINITIONS.get(cs.value)
    dv = sd.default_variant() if sd else None
    return dv.id if dv else None


def _variant_of(key: str) -> Tuple[str, str]:
    return _VARIANT_OF.get(key, ("classic", "קלאסי"))


def _build_variants(stage: FlowStage) -> Tuple[Variant, ...]:
    """Group the stage's catalog templates into variants (by variant id), each
    variant exposing its per-channel implementations."""
    by_variant: Dict[str, Dict] = {}
    for t in BUILTIN_CATALOG.values():
        if t.flow_stage != stage:
            continue
        vid, vname = _variant_of(t.key)
        v = by_variant.setdefault(vid, {
            "id": vid, "name": vname, "description": t.preview.note,
            "tone": t.tone.value, "event_types": t.event_types,
            "is_default": False, "premium": t.premium, "lifecycle": t.lifecycle,
            "channels": [],
        })
        v["channels"].append(ChannelImpl(channel=t.channel, template_key=t.key))
        if t.is_default:
            v["is_default"] = True
        # a variant is usable if any channel impl is usable
        if t.lifecycle in ("active", "approved"):
            v["lifecycle"] = t.lifecycle
    return tuple(
        Variant(
            id=v["id"], name=v["name"], description=v["description"], tone=v["tone"],
            event_types=v["event_types"], is_default=v["is_default"], premium=v["premium"],
            lifecycle=v["lifecycle"], channels=tuple(v["channels"]),
        )
        for v in by_variant.values()
    )


# --- the stage definitions ---------------------------------------------------
# The WORKFLOW behavior (trigger/audience/completion/flow/next) lives here - it is
# planner/worker logic, not copy. The audience_rule is APPLIED by core when a
# campaign is created without an explicit audience (default_audience_for_stage);
# existing campaigns keep their stored audience. The stage
# TITLE/DESCRIPTION are copy and now come from the content SSOT (STAGE_COPY).
# Variants are derived from the catalog.

_STAGE_META = {
    FlowStage.SAVE_THE_DATE: dict(
        trigger=Trigger.SCHEDULED, audience_rule=AudienceRule.EVERYONE,
        completion_rule=CompletionRule.EVERYONE_PROCESSED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.COMPLETE),
        next_stages=(FlowStage.INVITATION.value,),
    ),
    FlowStage.INVITATION: dict(
        trigger=Trigger.SCHEDULED, audience_rule=AudienceRule.EVERYONE,
        completion_rule=CompletionRule.RSVP_COMPLETED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.GUEST_OPENS, FlowStep.GUEST_RESPONDS,
                    FlowStep.COLLECT_RSVP, FlowStep.COLLECT_GUEST_COUNT, FlowStep.COLLECT_NOTES, FlowStep.COMPLETE),
        next_stages=(FlowStage.REMINDER.value,),
    ),
    FlowStage.REMINDER: dict(
        # Repeatable: any number of Reminder instances may run, each a separate
        # campaign on its own date; they all execute this exact stage logic.
        trigger=Trigger.SCHEDULED, audience_rule=AudienceRule.PENDING_RSVP,
        completion_rule=CompletionRule.RSVP_COMPLETED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.GUEST_RESPONDS, FlowStep.COLLECT_RSVP, FlowStep.COMPLETE),
        next_stages=(FlowStage.FINAL_REMINDER.value,),
    ),
    FlowStage.FINAL_REMINDER: dict(
        # The day-before message: its copy speaks to BOTH confirmed guests
        # ("see you tomorrow", navigation) and non-responders ("last chance to
        # RSVP") - but never to guests who already declined.
        trigger=Trigger.SCHEDULED, audience_rule=AudienceRule.NOT_DECLINED,
        completion_rule=CompletionRule.TIMEOUT_REACHED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.COMPLETE),
        next_stages=(FlowStage.TABLE_ASSIGNMENT.value, FlowStage.THANK_YOU.value),
    ),
    FlowStage.TABLE_ASSIGNMENT: dict(
        # Independent stage with its own schedule, template and audience. Supports
        # BOTH manual execution (release a campaign immediately) and scheduled
        # execution (a campaign with a schedule_time) - same campaign mechanism as
        # every other stage, so no behavior changes.
        trigger=Trigger.SCHEDULED, audience_rule=AudienceRule.WITH_TABLE,
        completion_rule=CompletionRule.EVERYONE_PROCESSED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.GUEST_OPENS, FlowStep.COMPLETE),
        next_stages=(FlowStage.THANK_YOU.value,),
    ),
    FlowStage.THANK_YOU: dict(
        trigger=Trigger.AFTER_EVENT, audience_rule=AudienceRule.CONFIRMED,
        completion_rule=CompletionRule.EVERYONE_PROCESSED,
        flow_steps=(FlowStep.SEND_MESSAGE, FlowStep.COMPLETE),
        next_stages=(),
    ),
}


def _build_stage(stage: FlowStage) -> StageDefinition:
    m = _STAGE_META[stage]
    copy = STAGE_COPY.get(stage.value, {})
    return StageDefinition(
        id=stage.value, title=copy.get("title", ""), description=copy.get("description", ""),
        event_types=(),
        trigger=m["trigger"], audience_rule=m["audience_rule"], completion_rule=m["completion_rule"],
        flow_steps=m["flow_steps"], next_stages=m["next_stages"], variants=_build_variants(stage),
    )


STAGE_DEFINITIONS: Dict[str, StageDefinition] = {
    stage.value: _build_stage(stage) for stage in FlowStage
}

# reverse index: template key -> (stage_id, variant_id)
_STAGE_VARIANT_OF_TEMPLATE: Dict[str, Tuple[str, str]] = {}
for _sid, _sd in STAGE_DEFINITIONS.items():
    for _v in _sd.variants:
        for _ci in _v.channels:
            _STAGE_VARIANT_OF_TEMPLATE[_ci.template_key] = (_sid, _v.id)


# --- resolution helpers ------------------------------------------------------

def stage_by_id(stage_id) -> Optional[StageDefinition]:
    cs = canonical_stage(stage_id)
    return STAGE_DEFINITIONS.get(cs.value) if cs else None


def stage_variant_for_template(template_key: str) -> Optional[Tuple[str, str]]:
    """(stage_id, variant_id) that a template implements, or None (e.g. a custom
    DB template not in the built-in catalog)."""
    return _STAGE_VARIANT_OF_TEMPLATE.get((template_key or "").strip())


def resolve_stage_channel(stage_id, variant_id: str, channel: str = "whatsapp") -> Optional[Template]:
    """The catalog Template that implements (stage, variant) for a channel. This is
    the "Run Stage X, Variant Y" → concrete message resolution. Returns the SAME
    Template the legacy key path returns, so delivery is identical."""
    sd = stage_by_id(stage_id)
    if not sd:
        return None
    variant = next((v for v in sd.variants if v.id == (variant_id or "").strip()), None)
    if not variant:
        return None
    impl = next((c for c in variant.channels if c.channel == channel), None)
    if not impl:
        return None
    return BUILTIN_CATALOG.get(impl.template_key)
