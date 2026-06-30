"""Phase 7 - Semantic RSVP resolution tests.

The resolver is the SSOT for turning a reply into a meaning. These prove the
audit's core concern is fixed: meaning derives from semantic signals, all
confirm/decline/maybe display variants collapse to one action, and confirmed
maps to the canonical 'confirmed' status (not legacy 'attending').
"""
from __future__ import annotations

from shared.domain.rsvp import resolve_rsvp_action
from shared.domain.enums import RsvpAction, GuestStatus


def test_semantic_payload_beats_text():
    # A semantic payload wins even if the visible label says something else.
    assert resolve_rsvp_action(button_payload="rsvp_confirm", text="totally different") == RsvpAction.CONFIRMED
    assert resolve_rsvp_action(button_payload="rsvp_decline") == RsvpAction.DECLINED
    assert resolve_rsvp_action(button_payload="rsvp_maybe") == RsvpAction.MAYBE


def test_button_id_is_semantic_and_case_insensitive():
    assert resolve_rsvp_action(button_id="rsvp_invite__BTN_1") == RsvpAction.CONFIRMED
    assert resolve_rsvp_action(button_id="rsvp_invite__BTN_2") == RsvpAction.DECLINED
    assert resolve_rsvp_action(button_id="rsvp_invite__BTN_3") == RsvpAction.MAYBE


def test_all_confirm_variants_map_to_confirmed():
    for label in ["ברור שאני בא!", "ברור שנגיע !", "ברור שאגיע!"]:
        assert resolve_rsvp_action(text=label) == RsvpAction.CONFIRMED


def test_decline_and_maybe_text():
    assert resolve_rsvp_action(text="לצערי לא אוכל להגיע ):") == RsvpAction.DECLINED
    assert resolve_rsvp_action(text="עוד מתלבט, תחזרו אלי?") == RsvpAction.MAYBE


def test_unknown_returns_unknown():
    assert resolve_rsvp_action(text="random gibberish") == RsvpAction.UNKNOWN
    assert resolve_rsvp_action() == RsvpAction.UNKNOWN


def test_confirmed_maps_to_canonical_status():
    assert RsvpAction.CONFIRMED.to_guest_status() == GuestStatus.CONFIRMED
    assert GuestStatus.CONFIRMED.value == "confirmed"   # not legacy 'attending'
    assert RsvpAction.UNKNOWN.to_guest_status() is None
