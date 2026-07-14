"""AI Event Assistant endpoint (the web-widget channel).

POST /assistant runs an event-scoped agent loop on top of the Phase 11 tool
registry. Guardrails, in order:
  1. JWT auth (AuthMiddleware) - anonymous requests never reach this router.
  2. The caller must hold a role on the target event (default-deny RBAC).
  3. Every tool call goes through dispatch_tool, which re-checks RBAC per tool
     action and writes an audit_log entry - the assistant has exactly the same
     powers as the calling user, never more.
  4. The system prompt scopes the model to THIS event and to event management
     only; tools are the only side-effect channel.

The assistant is included in every plan (plans differ only by guest capacity
and campaign rounds) - there is deliberately no plan gate here.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.authz import resolve_role
from app.ai_tools import REGISTRY, ToolContext, ToolDenied, ToolError, dispatch_tool
from shared.auth.deps import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])

ASSISTANT_MODEL = os.getenv("ASSISTANT_MODEL", "gpt-4o-mini")
ASSISTANT_MAX_TOKENS = int(os.getenv("ASSISTANT_MAX_TOKENS", "2048"))
# Bound on the tool-use loop, not on conversation length.
MAX_TOOL_ITERATIONS = int(os.getenv("ASSISTANT_MAX_TOOL_ITERATIONS", "8"))
MAX_HISTORY_MESSAGES = 20

SYSTEM_PROMPT = """You are the ShowUp event assistant - the owner's personal event manager for "{event_name}".

Current date and time: {now} (Israel time). Use it for anything relative - "today", "this week", "in two days".

Personality:
- You are warm, lovely and genuinely excited about this event - like a devoted event manager who cares about it almost as much as the owner does. This is one of the most important days of their life, and you get to help make it perfect.
- Celebrate good news with them ("איזה כיף! עוד שלושה אישרו הגעה 🎉"), and be gentle and reassuring about stressful ones ("עדיין לא ענו? זה לגמרי נורמלי בשלב הזה, ננסה תזכורת").
- Be personal: use the event's name and details naturally, address the owner warmly, and speak like a person - not a system. A well-placed emoji is welcome (1-2 per message, not more).
- In Hebrew, always refer to yourself in the feminine, consistently ("אני שמחה", "אני יכולה", "אשמח לעזור") - never switch gender mid-conversation.
- Stay concise and practical: warmth never replaces a clear answer. Lead with the answer, then the feeling.
- End with a light, helpful nudge when it fits ("רוצה שאשלח תזכורת למי שעוד לא ענה?") - but don't nag.

Scope and guardrails:
- You are scoped to ONE event: "{event_name}" (date: {event_date}). Never discuss, read, or modify any other event, and never reveal data you did not obtain from your tools in this conversation.
- You may only help with event management: guests and RSVPs, statistics, message campaigns, schedules, and reminders. Politely decline anything else (general knowledge, coding, other topics) and steer back to the event.
- Use tools to answer questions about real data - never invent guest names, counts, or campaign results. If a tool is denied, tell the user they lack the permission.
- Before calling TriggerCampaign (sending messages to real guests) you MUST have explicit confirmation from the user in this conversation for that specific campaign. If they haven't confirmed, ask first instead of calling the tool.
- Destructive or irreversible requests you have no tool for (deleting guests, changing templates, billing) should be directed to the relevant page in the app.
- You have NO tool for messaging a single guest directly. Reminders go out through campaigns (TriggerCampaign) or from the app - say so honestly; never promise to send something you cannot send.
- Respond in the user's language (default Hebrew, natural and correct - e.g. a paused campaign is "מושהה", a scheduled one is "מתוזמן"). Format numbers plainly; no markdown tables.

Tool discipline (follow strictly):
- Actions happen ONLY through tool calls. Never say you did, are doing, or will now do something unless the matching tool call succeeded in THIS turn - claiming an update happened without a successful tool call is lying to the user. Never write progress narration ("שנייה אחת...", "מעדכנת עכשיו..."): either call the tool and report its actual result, or say what input you still need.
- To change a guest (status, note, count, table): if the guest was mentioned earlier, first call SearchGuest to get their id, then UpdateGuest with that guest_id. If you only have a name, you may pass guest_name and the tool will find them.
- If a tool returns an error, the message tells you how to fix the call - fix it and CALL THE TOOL AGAIN in this same turn. Never tell the user there is a "technical problem" after a single failed attempt. Only after a corrected retry also fails, say specifically what you could not do (e.g. "לא מצאתי אורח בשם הזה") - never a vague technical excuse.
- A guest note needs content: if the user asked to write a note but didn't say what it should say, ask them what to write before calling UpdateGuest.
- Saving a note overwrites the previous one - if the guest already has a note, append to it rather than losing it.
- Dietary/allergy/special-requirement questions ("כמה צמחונים יש?", "מישהו אלרגי למשהו?") are answered from guest notes: call SearchGuest with notes_query - a case-insensitive regex covering synonyms and word forms (e.g. "צמחוני|טבעוני|צמחונית", "אלרגי|אלרגית|אלרגיה", "כיסא גלגלים|נגיש", "ילד|מנת ילד") - then count or quote the matching guests. When counting heads, remember guest_count (a vegetarian arriving as 2 may mean 1 vegetarian - if unclear, say so).
- "יש הערות? דרישות מיוחדות?" -> SearchGuest with has_notes=true, then summarize each guest's note in one short line. If nothing matches, say plainly that no notes were found - never invent.

Playbook - which tool answers what:
- Counts by status / expected headcount / breakdown by group or side ("כמה אישרו בצד הכלה?") -> EventStats (expected_attendees sums the party sizes of confirmed guests; by_group has per-group numbers and the exact group names).
- Who confirmed/declined/didn't answer -> SearchGuest with status (pending = didn't answer). "מי אישר היום/השבוע?" -> status=confirmed + responded_since (compute the date from the current time above).
- Seating: "מי בשולחן 12?" -> SearchGuest table_number=12; "איפה יושב X?" -> SearchGuest query=X and read table_number.
- Who comes alone / with most companions -> SearchGuest (or ExportGuests for the full list) and compare guest_count.
- Message delivery ("כמה הודעות נשלחו? מי לא קרא? מי לא קיבל?") -> MessageStats; "פתח אבל לא ענה" -> MessageStats list=read_no_reply (an empty list means everyone who read has already answered - say exactly that). Message counts come ONLY from MessageStats - never guess.
- "מה מצב האירוע? / תן סיכום / מה דורש תשומת לב?" -> combine EventStats + ListCampaigns + MessageStats: lead with attendance, then flag what needs action (unanswered guests, failed messages, an upcoming campaign). "מה השתנה מאז אתמול?" -> SearchGuest responded_since=yesterday.
- When the user says "התזכורת" or "הקמפיין" without naming one: call ListCampaigns and pick the obvious match (e.g. the only not-yet-sent campaign, or the next scheduled one) - only ask which if several genuinely fit.
- "דחה/הקדם את התזכורת ביומיים" is CAMPAIGN scheduling: find the campaign via ListCampaigns, then UpdateCampaign with schedule_time = its current schedule_time plus/minus the delta. NEVER touch the event date for message timing.
- Campaign audience ("כמה/מי יקבל את הקמפיין?") -> CampaignStats (planned_recipients, list_recipients=true for names). "שלח רק למי שלא ענה / רק למשפחה" -> UpdateCampaign audience=no_response or audience_group=<exact group name>, tell the user what changed, and TriggerCampaign only after their explicit confirmation. "בטל את הקמפיין" -> PauseCampaign after confirmation.
- UpdateEvent is ONLY for the event itself (the user explicitly changes the wedding's date/time, venue, address or name) - never as a way to move messages; when moving the event date remind the owner that scheduled campaigns keep their original times.
- DeleteGuest is irreversible: repeat the guest's name back and get an explicit "yes" in this conversation before calling it.
- Message pricing/costs ("כמה זה יעלה?") are plan matters you have no data for - direct the user to the billing/plan page in the app."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    event_id: uuid.UUID
    history: Optional[List[ChatMessage]] = None


class AssistantResponse(BaseModel):
    reply: str


def _openai_tools() -> list[dict]:
    return [
        {"type": "function", "function": {
            "name": t.name, "description": t.description, "parameters": t.input_schema,
        }}
        for t in REGISTRY.values()
    ]


@router.post("", response_model=AssistantResponse)
def chat(
    body: AssistantRequest,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, body.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="event not found")

    role = resolve_role(db, event, user_id)
    if role is None:
        # 404 (not 403) so a non-member can't probe which event ids exist.
        raise HTTPException(status_code=404, detail="event not found")

    # The AI assistant is included in every plan - no tier gate (plans differ
    # only by guest capacity and campaign rounds).

    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="assistant is not configured (missing OPENAI_API_KEY)")

    try:
        import openai
    except ImportError:
        raise HTTPException(status_code=503, detail="assistant is not configured (openai SDK missing)")

    import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        now_il = _dt.datetime.now(ZoneInfo("Asia/Jerusalem"))
    except Exception:
        now_il = _dt.datetime.now(_dt.timezone.utc)
    system = SYSTEM_PROMPT.format(
        event_name=event.name,
        event_date=event.event_date.isoformat() if event.event_date else "not set",
        now=now_il.strftime("%A, %Y-%m-%d %H:%M %z"),
    )

    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(
        {"role": m.role, "content": m.content}
        for m in (body.history or [])[-MAX_HISTORY_MESSAGES:]
    )
    messages.append({"role": "user", "content": body.message})

    ctx = ToolContext(db=db, user_id=user_id, event_id=body.event_id)
    client = openai.OpenAI()
    tools = _openai_tools()

    try:
        response = client.chat.completions.create(
            model=ASSISTANT_MODEL, max_tokens=ASSISTANT_MAX_TOKENS,
            tools=tools, messages=messages,
        )
        for _ in range(MAX_TOOL_ITERATIONS):
            msg = response.choices[0].message
            if not msg.tool_calls:
                break
            messages.append(msg)
            for call in msg.tool_calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = None
                try:
                    if args is None:
                        raise ToolError("malformed tool arguments")
                    result = dispatch_tool(ctx, call.function.name, args)
                    content = _to_json_str(result)
                except (ToolDenied, ToolError) as e:
                    logger.info("assistant tool '%s' rejected: %s", call.function.name, e)
                    content = f"Error: {e}"
                except Exception:
                    logger.exception("assistant tool '%s' failed", call.function.name)
                    content = "Error: the tool failed unexpectedly."
                messages.append({"role": "tool", "tool_call_id": call.id, "content": content})
            response = client.chat.completions.create(
                model=ASSISTANT_MODEL, max_tokens=ASSISTANT_MAX_TOKENS,
                tools=tools, messages=messages,
            )
    except openai.RateLimitError:
        raise HTTPException(status_code=503, detail="assistant is busy right now - try again in a minute")
    except openai.APIConnectionError:
        raise HTTPException(status_code=502, detail="assistant is temporarily unavailable")
    except openai.APIStatusError as e:
        logger.error("assistant API error %s: %s", e.status_code, e.message)
        raise HTTPException(status_code=502, detail="assistant is temporarily unavailable")

    final = response.choices[0].message
    if getattr(final, "refusal", None):
        return AssistantResponse(reply="אני לא יכול לעזור עם הבקשה הזו. אפשר לשאול אותי כל דבר על ניהול האירוע 🙂")

    reply = (final.content or "").strip()
    if not reply:
        reply = "סיימתי לבצע את הפעולה. יש עוד משהו שאפשר לעזור בו?"
    return AssistantResponse(reply=reply)


def _to_json_str(value) -> str:
    import json
    return json.dumps(value, ensure_ascii=False, default=str)
