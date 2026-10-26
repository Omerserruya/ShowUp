"""Server-side safety rails for the AI assistant (readiness review 4.1, 4.4).

The model is NOT trusted to ask before acting. High-impact tool calls are
two-phase, enforced here:

  1. The model calls e.g. TriggerCampaign. Nothing happens; the call is parked
     in `assistant_pending_actions` (one per user+event, 10 min TTL) and the
     model receives {"needs_confirmation": true, "summary": ..., "confirm_token"}.
  2. The model asks the user. Only in a LATER turn, and only when that turn's
     user message is itself an affirmation ("כן", "מאשרת", "yes"...), may the
     model call ConfirmAction (or re-call the same tool with the same args /
     the confirm_token). The stored args are what runs - never new ones.

At most ONE high-impact action executes per turn.

Also here: the per-user rate limit and daily turn budget, counted from the
`assistant_turns` table (core has no Redis), plus token-usage recording.
Tables are created by migrations.ensure_assistant_tables.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PENDING_TTL = dt.timedelta(minutes=10)
DAILY_TURN_LIMIT = int(os.getenv("ASSISTANT_DAILY_TURN_LIMIT", "200"))
PER_MINUTE_TURN_LIMIT = int(os.getenv("ASSISTANT_PER_MINUTE_TURN_LIMIT", "10"))

CONFIRM_TOOL_NAME = "ConfirmAction"

# Tools that ALWAYS need confirmation, and tools that need it conditionally.
# CreateCampaign consumes one of the plan's (billable) rounds and schedules a
# send, so it is always confirmed.
ALWAYS_CONFIRM = frozenset({"TriggerCampaign", "DeleteGuest", "CreateCampaign"})
CONDITIONAL_CONFIRM = frozenset({"UpdateCampaign", "UpdateEvent"})
HIGH_IMPACT_TOOLS = ALWAYS_CONFIRM | CONDITIONAL_CONFIRM


# --------------------------------------------------------------------------
# Affirmation detection
# --------------------------------------------------------------------------

_AFFIRM_WORDS = {
    "כן", "כןכן", "מאשר", "מאשרת", "מאשרים", "אישור", "מאושר", "אשר", "תאשר", "תאשרי",
    "בטח", "בטוח", "בטוחה", "נכון", "סגור", "יאללה", "קדימה", "אוקיי", "אוקי", "אוקיי.", "בסדר",
    "תשלח", "תשלחי", "שלח", "שלחי", "תמחק", "תמחקי", "מחק", "מחקי", "תעדכן", "תעדכני", "עדכן",
    "עדכני", "בצע", "בצעי", "תבצע", "תבצעי", "צור", "צרי", "תיצור", "תיצרי", "תזמן", "תזמני",
    "תתזמן", "תתזמני", "לגמרי", "ברור", "אכן", "יופי", "מעולה", "סבבה",
    "yes", "y", "yeah", "yep", "sure", "ok", "okay", "confirm", "confirmed", "go", "do", "it",
    "send", "delete", "please", "בבקשה", "את", "זה", "אותו", "אותה", "עכשיו", "רק", "כמובן",
    "👍", "✅", "👌",
}
_STRONG_AFFIRM = {
    "כן", "מאשר", "מאשרת", "מאשרים", "אישור", "מאושר", "אשר", "בטח", "נכון", "סגור", "יאללה",
    "קדימה", "אוקיי", "אוקי", "בסדר", "סבבה", "לגמרי", "ברור", "כמובן",
    "תשלח", "תשלחי", "שלח", "שלחי", "תמחק", "תמחקי", "מחק", "מחקי", "בצע", "בצעי", "תבצע", "תבצעי",
    "צור", "צרי", "תיצור", "תיצרי", "תזמן", "תזמני", "תתזמן", "תתזמני",
    "yes", "y", "yeah", "yep", "sure", "ok", "okay", "confirm", "confirmed", "👍", "✅", "👌",
}
_NEGATION = {
    "לא", "אל", "אין", "רגע", "חכה", "חכי", "עצור", "עצרי", "ביטול", "תבטל", "תבטלי", "בטל",
    "no", "not", "don't", "dont", "stop", "wait", "cancel", "אבל", "אולי", "?",
}
_TOKEN_RX = re.compile(r"[\w֐-׿']+|[👍✅👌?]")


def is_affirmation(message: Optional[str]) -> bool:
    """True only for a SHORT, unambiguous yes ("כן", "כן תשלח", "מאשרת 👍").

    Deliberately strict: anything long, conditional, questioning or negated is
    not a confirmation - the user can always just say "כן".
    """
    if not message:
        return False
    msg = message.strip().lower()
    if not msg or len(msg) > 60:
        return False
    tokens = _TOKEN_RX.findall(msg)
    if not tokens or len(tokens) > 8:
        return False
    if any(t in _NEGATION for t in tokens):
        return False
    if not any(t in _STRONG_AFFIRM for t in tokens):
        return False
    # Every word must be affirmation-ish filler (rejects "כן אבל רק למשפחה").
    return all(t in _AFFIRM_WORDS for t in tokens)


# --------------------------------------------------------------------------
# Turn state
# --------------------------------------------------------------------------

@dataclass
class TurnState:
    user_id: uuid.UUID
    event_id: uuid.UUID
    user_message: str
    turn_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    high_impact_executed: int = 0

    @property
    def affirmed(self) -> bool:
        return is_affirmation(self.user_message)


# --------------------------------------------------------------------------
# Which calls need confirmation, and the human summary for them
# --------------------------------------------------------------------------

def _canonical_args(args: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in sorted((args or {}).items()):
        if k == "confirm_token" or v is None or v == "":
            continue
        if k in ("schedule_time", "event_date"):
            try:
                parsed = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=dt.timezone.utc)
                v = parsed.astimezone(dt.timezone.utc).isoformat()
            except ValueError:
                pass
        out[k] = v
    return out


def args_hash(tool: str, args: Dict[str, Any]) -> str:
    blob = json.dumps({"tool": tool, "args": _canonical_args(args)}, sort_keys=True,
                      ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _fmt_time(value) -> str:
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        try:
            from zoneinfo import ZoneInfo
            parsed = parsed.astimezone(ZoneInfo("Asia/Jerusalem"))
        except Exception:
            pass
        return parsed.strftime("%d/%m/%Y %H:%M")
    except (ValueError, TypeError):
        return str(value)


_AUDIENCE_HE = {
    "everyone": "כל האורחים", "confirmed": "מי שאישר הגעה", "declined": "מי שסירב",
    "no_response": "מי שעוד לא ענה", "custom": "קבוצה מותאמת",
}


def precheck_permission(ctx, tool: str) -> None:
    """Deny BEFORE asking the user to confirm something their role can't do."""
    from app import ai_tools
    t = ai_tools.REGISTRY.get(tool)
    if t is not None:
        ai_tools._require_action(ctx, t.required_action)


def confirmation_needed(ctx, tool: str, args: Dict[str, Any]):
    """(summary, exec_args) when this call needs the user's confirmation, else
    None. exec_args are what will run after confirmation (e.g. the guest name
    resolved to a fixed guest_id, so "yes" deletes exactly who was shown)."""
    summary = confirmation_summary(ctx, tool, args)
    if summary is None:
        return None
    exec_args = dict(args)
    if tool == "DeleteGuest":
        from app import ai_tools
        exec_args = {"guest_id": str(ai_tools._resolve_guest(ctx, args).id)}
    return summary, exec_args


def confirmation_summary(ctx, tool: str, args: Dict[str, Any]) -> Optional[str]:
    """Hebrew one-line description of what WOULD happen, or None when this
    call does not need confirmation. May raise ToolError/ToolDenied (e.g. the
    campaign/guest does not exist) - the caller reports that to the model."""
    from app import ai_tools

    if tool == "TriggerCampaign":
        c = ai_tools._get_event_campaign(ctx, args.get("campaign_id"))
        from app.audience import count_audience
        n = count_audience(ctx.db, ctx.event_id, c.audience, c.audience_filter)
        return f'לשלוח עכשיו את הסבב "{c.name}" ל-{n} אורחים ({_AUDIENCE_HE.get(c.audience, c.audience)})'
    if tool == "CreateCampaign":
        # Full validation (template, rounds left, launch permission, schedule)
        # BEFORE asking - never ask to confirm something that would be refused.
        return ai_tools.new_round_summary(ai_tools.plan_new_round(ctx, args))
    if tool == "DeleteGuest":
        g = ai_tools._resolve_guest(ctx, args)
        return f'למחוק לצמיתות את האורח/ת "{g.name}" מהאירוע'
    if tool == "UpdateCampaign":
        c = ai_tools._get_event_campaign(ctx, args.get("campaign_id"))
        parts = []
        if args.get("schedule_time"):
            when = ai_tools._parse_dt(args["schedule_time"], "schedule_time")
            if ai_tools.is_near_launch(when):
                from shared.domain.roles import Action
                ai_tools._require_action(ctx, Action.CAMPAIGN_LAUNCH)
                parts.append(f"להזיז את מועד השליחה ל-{_fmt_time(when)} (בתוך 6 השעות הקרובות)")
        if args.get("audience") and args.get("audience") != c.audience:
            parts.append(f"לשנות את הקהל ל{_AUDIENCE_HE.get(args['audience'], args['audience'])}")
        if args.get("audience_group"):
            parts.append(f'לשלוח רק לקבוצה "{args["audience_group"]}"')
        if not parts:
            return None
        return f'בסבב "{c.name}": ' + ", ".join(parts)
    if tool == "UpdateEvent":
        if not args.get("event_date"):
            return None
        from app.crud import event as event_crud
        ev = event_crud.get_event(ctx.db, ctx.event_id)
        new = ai_tools._parse_dt(args["event_date"], "event_date")
        if ev is not None and ev.event_date is not None:
            cur = ev.event_date if ev.event_date.tzinfo else ev.event_date.replace(tzinfo=dt.timezone.utc)
            if cur == new:
                return None
        return (f"לשנות את תאריך האירוע ל-{_fmt_time(new)} "
                f"(הסבבים שעוד לא נשלחו יזוזו בהתאם)")
    return None


# --------------------------------------------------------------------------
# Pending-action store
# --------------------------------------------------------------------------

def store_pending(db: Session, turn: TurnState, tool: str, args: Dict[str, Any], summary: str,
                  exec_args: Optional[Dict[str, Any]] = None) -> str:
    """Park a call. `args` (as the model sent them) are hashed for matching a
    re-call; `exec_args` (default: args) are what runs on confirmation."""
    token = secrets.token_hex(4)
    clean = _canonical_args(exec_args if exec_args is not None else args)
    db.execute(text("""
        INSERT INTO assistant_pending_actions
            (user_id, event_id, token, tool, args, args_hash, summary, turn_id, created_at, expires_at)
        VALUES (:u, :e, :t, :tool, CAST(:args AS jsonb), :h, :s, :turn, now(), :exp)
        ON CONFLICT (user_id, event_id) DO UPDATE SET
            token = EXCLUDED.token, tool = EXCLUDED.tool, args = EXCLUDED.args,
            args_hash = EXCLUDED.args_hash, summary = EXCLUDED.summary,
            turn_id = EXCLUDED.turn_id, created_at = now(), expires_at = EXCLUDED.expires_at
    """), {
        "u": str(turn.user_id), "e": str(turn.event_id), "t": token, "tool": tool,
        "args": json.dumps(clean, ensure_ascii=False, default=str),
        "h": args_hash(tool, args), "s": summary, "turn": turn.turn_id,
        "exp": dt.datetime.now(dt.timezone.utc) + PENDING_TTL,
    })
    db.commit()
    return token


def load_pending(db: Session, turn: TurnState) -> Optional[Dict[str, Any]]:
    row = db.execute(text("""
        SELECT token, tool, args, args_hash, summary, turn_id, expires_at
        FROM assistant_pending_actions
        WHERE user_id = :u AND event_id = :e AND expires_at > now()
    """), {"u": str(turn.user_id), "e": str(turn.event_id)}).mappings().first()
    if not row:
        return None
    out = dict(row)
    if isinstance(out.get("args"), str):
        out["args"] = json.loads(out["args"])
    return out


def clear_pending(db: Session, turn: TurnState) -> None:
    db.execute(text("DELETE FROM assistant_pending_actions WHERE user_id = :u AND event_id = :e"),
               {"u": str(turn.user_id), "e": str(turn.event_id)})
    db.commit()


def claim_pending(db: Session, turn: TurnState, token: str) -> bool:
    """Atomically consume the pending action (only one request can win, so a
    double-submitted "כן" cannot run the action twice)."""
    row = db.execute(text("""
        DELETE FROM assistant_pending_actions
        WHERE user_id = :u AND event_id = :e AND token = :t AND expires_at > now()
        RETURNING token
    """), {"u": str(turn.user_id), "e": str(turn.event_id), "t": token}).first()
    db.commit()
    return row is not None


class ConfirmationRefused(Exception):
    """A confirmation attempt that the server will not honour (message for the model)."""


def check_confirmable(pending: Optional[Dict[str, Any]], turn: TurnState, *,
                      tool: Optional[str] = None, args: Optional[Dict[str, Any]] = None,
                      token: Optional[str] = None) -> Dict[str, Any]:
    """Validate that `pending` may execute in this turn. Returns it or raises."""
    if pending is None:
        raise ConfirmationRefused("there is no pending action awaiting confirmation (it may have "
                                  "expired) - call the original tool again to prepare it")
    if token and not secrets.compare_digest(str(token), str(pending["token"])):
        raise ConfirmationRefused("confirm_token does not match the pending action")
    if tool is not None and tool != pending["tool"]:
        raise ConfirmationRefused("the pending action is for a different tool")
    if args is not None and args_hash(tool or pending["tool"], args) != pending["args_hash"]:
        raise ConfirmationRefused("the arguments differ from what the user was asked to confirm - "
                                  "ask the user again for the new details")
    if pending.get("turn_id") == turn.turn_id:
        raise ConfirmationRefused("the user has not confirmed yet - ask them now and wait for their reply")
    if not turn.affirmed:
        raise ConfirmationRefused("the user's latest message is not an explicit confirmation - "
                                  "ask them to reply 'כן' to confirm, or treat it as a new request")
    if turn.high_impact_executed >= 1:
        raise ConfirmationRefused("only one high-impact action may run per message")
    return pending


# --------------------------------------------------------------------------
# Rate limiting / budget / usage
# --------------------------------------------------------------------------

_local_lock = threading.Lock()
_local_minute: Dict[str, deque] = defaultdict(deque)


class RateLimited(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def check_rate_limit(db: Session, user_id: uuid.UUID) -> None:
    """10 turns/minute and 200 turns/day per user (env-tunable).

    Counted from assistant_turns so it holds across processes; an in-process
    window is the fallback if the table is unreachable."""
    try:
        row = db.execute(text("""
            SELECT
              COUNT(*) FILTER (WHERE occurred_at > now() - interval '1 minute') AS last_minute,
              COUNT(*) AS last_day
            FROM assistant_turns
            WHERE user_id = :u AND occurred_at > now() - interval '1 day'
        """), {"u": str(user_id)}).mappings().first()
        minute, day = int(row["last_minute"] or 0), int(row["last_day"] or 0)
    except Exception:
        db.rollback()
        now = time.monotonic()
        with _local_lock:
            q = _local_minute[str(user_id)]
            while q and now - q[0] > 60:
                q.popleft()
            minute, day = len(q), 0
            q.append(now)
    if minute >= PER_MINUTE_TURN_LIMIT:
        raise RateLimited("נשלחו הרבה הודעות ברצף 🙂 אפשר לנסות שוב בעוד דקה.")
    if day >= DAILY_TURN_LIMIT:
        raise RateLimited("הגעתם למכסת השיחות היומית עם העוזרת. נמשיך מחר 🙂")


def record_turn(db: Session, turn: TurnState, *, prompt_tokens: int, completion_tokens: int,
                llm_calls: int, outcome: str) -> None:
    try:
        db.execute(text("""
            INSERT INTO assistant_turns (user_id, event_id, prompt_tokens, completion_tokens, llm_calls, outcome)
            VALUES (:u, :e, :p, :c, :n, :o)
        """), {"u": str(turn.user_id), "e": str(turn.event_id), "p": int(prompt_tokens or 0),
               "c": int(completion_tokens or 0), "n": int(llm_calls or 0), "o": outcome[:30]})
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("assistant turn usage not recorded", exc_info=True)
