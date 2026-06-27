"""Plan-tier entitlements: the single source of truth for which FEATURES each
billing plan unlocks (the "RBAC for tiers").

This is the tier/package analogue of `roles.py`. Where `roles.py` answers "may
this *member* perform this action", this module answers "does this *plan* include
this feature at all". Both gates apply: a request must pass the role check AND the
plan-feature check.

Kept as pure code (not DB) for the same reasons as the role matrix: deterministic,
testable, and importable by core-service with no runtime cross-service call. The
Mongo `plans` collection still owns marketing copy, price, and numeric limits
(e.g. guest `count_limit`); this module owns the feature gate.

Plans with an unknown / None id (legacy pre-tiering events) are treated as fully
entitled so the migration never breaks existing events — mirrors the legacy
owner-bridge in `authz.py`.
"""
from __future__ import annotations

from enum import Enum


class Feature(str, Enum):
    # Available on every plan, including Free
    DASHBOARD = "dashboard"                  # view event dashboard / RSVP stats (read-only)
    CSV_EXPORT = "csv_export"                # export the guest list to CSV
    WEB_INVITATION = "web_invitation"        # public web invitation + open-form web RSVP + editor

    # Paid tiers
    INVITATION_CUSTOMIZATION = "invitation_customization"  # advanced invite styling (fonts/textures)
    WHATSAPP_CAMPAIGNS = "whatsapp_campaigns"             # send WhatsApp rounds/reminders
    TEMPLATES = "templates"                               # WhatsApp message templates
    ADVANCED_SCHEDULING = "advanced_scheduling"          # multi-step / follow-up scheduling
    TAGS = "tags"
    CUSTOM_FIELDS = "custom_fields"
    SEATING = "seating"
    TEAM_MEMBERS = "team_members"                         # invite producers / members
    AI_ASSISTANT = "ai_assistant"                         # WhatsApp AI assistant


# Canonical plan tier ids (mirror the `id` field of the Mongo `plans` docs).
PLAN_FREE = "free"
PLAN_BASIC = "basic"
PLAN_PLUS = "plus"
PLAN_PRO = "pro"

_ALL = set(Feature)

# Explicit grants per plan. Anything not listed is denied (default-deny).
_MATRIX: dict[str, set[Feature]] = {
    PLAN_FREE: {
        Feature.DASHBOARD,
        Feature.CSV_EXPORT,
        Feature.WEB_INVITATION,
    },
    PLAN_BASIC: {
        Feature.DASHBOARD,
        Feature.CSV_EXPORT,
        Feature.WEB_INVITATION,
        Feature.INVITATION_CUSTOMIZATION,
        Feature.WHATSAPP_CAMPAIGNS,
        Feature.TEMPLATES,
    },
    PLAN_PLUS: {
        Feature.DASHBOARD,
        Feature.CSV_EXPORT,
        Feature.WEB_INVITATION,
        Feature.INVITATION_CUSTOMIZATION,
        Feature.WHATSAPP_CAMPAIGNS,
        Feature.TEMPLATES,
        Feature.ADVANCED_SCHEDULING,
        Feature.TAGS,
        Feature.CUSTOM_FIELDS,
        Feature.SEATING,
        Feature.TEAM_MEMBERS,
    },
    PLAN_PRO: set(_ALL),
}


def features_for(plan_id: str | None) -> set[Feature]:
    """The set of features unlocked by a plan.

    None / unknown plan id => fully entitled (legacy bridge). Any plan id present
    in the matrix => its explicit grant set (default-deny for the rest).
    """
    if plan_id is None:
        return set(_ALL)
    return _MATRIX.get(str(plan_id).strip().lower(), set(_ALL))


def has_feature(plan_id: str | None, feature: Feature) -> bool:
    """True if the plan unlocks the feature."""
    return feature in features_for(plan_id)


def feature_keys_for(plan_id: str | None) -> list[str]:
    """Sorted feature string keys for a plan — for API exposure to the frontend."""
    return sorted(f.value for f in features_for(plan_id))


def entitlement_matrix() -> dict[str, list[str]]:
    """Full {plan_id: [feature_key, ...]} matrix — for the public entitlements API."""
    return {plan_id: sorted(f.value for f in feats) for plan_id, feats in _MATRIX.items()}
