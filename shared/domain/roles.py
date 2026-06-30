"""RBAC single source of truth: roles, actions, and the permission matrix.

Primary customer is the event OWNER; producers (Manager/Editor/Viewer/Guest
Coordinator) are supported but intentionally simple - a flat per-account role,
not a complex per-resource ACL.
"""
from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    EDITOR = "editor"
    VIEWER = "viewer"
    GUEST_COORDINATOR = "guest_coordinator"


class Action(str, Enum):
    # Guests
    GUEST_READ = "guest:read"
    GUEST_WRITE = "guest:write"        # create / update / manual override
    GUEST_DELETE = "guest:delete"
    # Campaigns / rounds
    CAMPAIGN_READ = "campaign:read"
    CAMPAIGN_WRITE = "campaign:write"  # create / update / schedule
    CAMPAIGN_DELETE = "campaign:delete"
    CAMPAIGN_LAUNCH = "campaign:launch"
    # Event
    EVENT_READ = "event:read"
    EVENT_WRITE = "event:write"
    EVENT_DELETE = "event:delete"
    # Membership / billing
    MEMBER_MANAGE = "member:manage"
    BILLING_MANAGE = "billing:manage"


_ALL = set(Action)

# Explicit grants per role. Anything not listed is denied (default-deny).
_MATRIX: dict[Role, set[Action]] = {
    Role.OWNER: set(_ALL),
    Role.MANAGER: _ALL - {Action.EVENT_DELETE, Action.BILLING_MANAGE},
    Role.EDITOR: {
        Action.GUEST_READ, Action.GUEST_WRITE,
        Action.CAMPAIGN_READ, Action.CAMPAIGN_WRITE,
        Action.EVENT_READ,
    },
    Role.VIEWER: {
        Action.GUEST_READ, Action.CAMPAIGN_READ, Action.EVENT_READ,
    },
    Role.GUEST_COORDINATOR: {
        # Edit guests + manual overrides, but no destructive or campaign authority.
        Action.GUEST_READ, Action.GUEST_WRITE,
        Action.CAMPAIGN_READ, Action.EVENT_READ,
    },
}


def can(role: Role, action: Action) -> bool:
    """True if the role is granted the action."""
    if not isinstance(role, Role):
        try:
            role = Role(role)
        except ValueError:
            return False
    return action in _MATRIX.get(role, set())
