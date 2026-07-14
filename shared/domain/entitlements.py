"""Plan entitlements - RETIRED as a feature gate, kept as a compatibility shim.

Business model (2026-07): plans differ ONLY by numeric limits -
  1. guest capacity  (plan `count_limit`, enforced in core-service guest CRUD)
  2. campaign rounds (`shared/domain/rounds.py`, enforced on round creation)

Every plan includes the FULL feature set: AI assistant, WhatsApp campaigns,
contact import, guest management, dashboards, invitation builder, seating,
tags, custom fields, analytics, templates, team members - everything. The
product's differentiation is the complete experience, not feature gating.

This module therefore no longer denies anything: `has_feature` is always True
and `features_for` returns the full set for every plan. The Feature enum and
function signatures are preserved so existing imports and the public
/entitlements API keep working (frontends and older services may still call
them). Role-based access control (`roles.py`) is unaffected and still applies.
"""
from __future__ import annotations

from enum import Enum


class Feature(str, Enum):
    DASHBOARD = "dashboard"
    CSV_EXPORT = "csv_export"
    WEB_INVITATION = "web_invitation"
    INVITATION_CUSTOMIZATION = "invitation_customization"
    WHATSAPP_CAMPAIGNS = "whatsapp_campaigns"
    TEMPLATES = "templates"
    ADVANCED_SCHEDULING = "advanced_scheduling"
    TAGS = "tags"
    CUSTOM_FIELDS = "custom_fields"
    SEATING = "seating"
    TEAM_MEMBERS = "team_members"
    AI_ASSISTANT = "ai_assistant"
    READ_ANALYTICS = "read_analytics"
    SMS_CAMPAIGNS = "sms_campaigns"
    CUSTOM_DOMAIN = "custom_domain"


# Canonical plan / edition ids (mirror the `id` field of aub's plans.json docs).
# Editions still exist commercially (price, guest cap, included rounds) - they
# just no longer gate features.
PLAN_FREE = "free"
PLAN_STARTER = "starter"
PLAN_VENUE = "venue"
PLAN_BASIC = "basic"
PLAN_PLUS = "plus"
PLAN_PRO = "pro"

ALL_PLAN_IDS = [PLAN_FREE, PLAN_STARTER, PLAN_VENUE, PLAN_BASIC, PLAN_PLUS, PLAN_PRO]

_ALL = set(Feature)


def features_for(plan_id: str | None) -> set[Feature]:
    """Every plan (and legacy None/unknown ids) gets the full feature set."""
    return set(_ALL)


def has_feature(plan_id: str | None, feature: Feature) -> bool:
    """Always True - features are not plan-gated anymore."""
    return True


def feature_keys_for(plan_id: str | None) -> list[str]:
    """Sorted feature string keys for a plan - for API exposure to the frontend."""
    return sorted(f.value for f in features_for(plan_id))


def entitlement_matrix() -> dict[str, list[str]]:
    """Full {plan_id: [feature_key, ...]} matrix - for the public entitlements API.
    Every plan reports the full set."""
    all_keys = sorted(f.value for f in _ALL)
    return {plan_id: list(all_keys) for plan_id in ALL_PLAN_IDS}
