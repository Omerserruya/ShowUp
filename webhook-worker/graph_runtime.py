"""Flow-graph runtime: runs the guest RSVP conversation from an admin-edited
graph (shared/domain/flow_graph.py) instead of the hardcoded states.

FlowManager calls `run_graph` from `_run_state_machine` ONLY when an enabled
graph resolves for the event (`load_flow_graph`: 60s cache, own short
connection, any problem -> None -> the legacy state machine). Everything
around the RSVP conversation stays in FlowManager and is untouched: opt-out,
wamid dedupe, the per-guest lock, the multi-event chooser (evsel__), the 24h
stale-reply rule and the qans__ host-question routing.

Per inbound message:
  1. already-answered acknowledge (flow settings) - same rule as legacy, using
     the node's `answered` marker;
  2. log incoming + credit the campaign reply (before anything can fail);
  3. start node = flow_graph.start_node (template RSVP tap -> stage entry;
     unknown state -> stage entry);
  4. pure step -> effects + sends;
  5. effects + stamp + conversations.current_state in ONE transaction (raises
     on DB error so the message is retried - never silently loses an RSVP);
  6. render + enqueue each send via the existing priority outpost path.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Conversation
from shared.domain import flow_config as fc
from shared.domain import flow_graph as fg
from shared.domain.delivery import canonical_phone_digits, canonical_phone_sql
from states.base_state import BaseState
from states.question_answer import _options, build_question_interactive
from utils.phone import normalize_phone

logger = logging.getLogger("flow_graph_runtime")

_DEFAULTS = fg.Graph(fg.DEFAULT_GRAPH)
NOTES_TOTAL_MAX = 4000


async def load_flow_graph(event_id: Any) -> Optional[fg.ResolvedGraph]:
    """Enabled graph for the event, or None (legacy). Never raises."""
    hit = fg.cached_graph_for_event(event_id)
    if not fg.is_miss(hit):
        return hit
    try:
        from db.session import engine
        async with engine.connect() as conn:
            return await fg.aresolve_graph_for_event(conn, event_id)
    except Exception as exc:
        logger.warning("flow graph unavailable (%s) - legacy flow", exc)
        return None


async def replied_stage(context_id: Optional[str]) -> Optional[str]:
    """Stage of the campaign message the guest replied to (entry selection)."""
    if not context_id:
        return None
    try:
        from db.session import engine
        async with engine.connect() as conn:
            res = await conn.execute(
                text(
                    "SELECT c.stage_id, c.template_key, c.template FROM messages_sent ms "
                    "JOIN campaigns c ON c.id::text = ms.campaign_id::text "
                    "WHERE ms.wa_message_id = :w LIMIT 1"
                ),
                {"w": context_id},
            )
            row = res.first()
    except Exception as exc:
        logger.debug("stage lookup failed: %s", exc)
        return None
    if not row:
        return None
    for v in row:
        key = fg.stage_entry_key(v)
        if key != "default":
            return key
    return None


# ---------------------------------------------------------------------------
# Guest + questions
# ---------------------------------------------------------------------------

async def target_guest_id(session: AsyncSession, conv: Conversation) -> Optional[str]:
    """Same targeting as BaseState.update_guest: guest_id, else (phone, event)."""
    gid = getattr(conv, "guest_id", None)
    if gid:
        row = (await session.execute(text("SELECT id::text FROM guests WHERE id = CAST(:g AS uuid)"),
                                     {"g": str(gid)})).first()
        if row:
            return row[0]
    phone = canonical_phone_digits(normalize_phone(conv.guest_phone))
    if not phone or not conv.event_id:
        return None
    row = (await session.execute(
        text("SELECT id::text FROM guests WHERE CAST(event_id AS text) = :eid "
             f"AND {canonical_phone_sql('phone')} = :phone LIMIT 1"),
        {"eid": str(conv.event_id), "phone": phone},
    )).first()
    return row[0] if row else None


async def pending_questions(session: AsyncSession, conv: Conversation, guest_id: Optional[str]) -> List[Dict[str, Any]]:
    """All unanswered ask_in_rsvp enum questions, in ask order (same query and
    filters as states.question_answer.fetch_pending_question)."""
    if not guest_id:
        return []
    try:
        res = await session.execute(
            text(
                """
                SELECT f.id::text, f.label, f.options
                FROM event_field_defs f
                WHERE CAST(f.event_id AS text) = :eid
                  AND f.ask_in_rsvp = TRUE
                  AND f.data_type = 'enum'
                  AND NOT EXISTS (
                      SELECT 1 FROM guest_custom_values v
                      WHERE v.field_def_id = f.id AND v.guest_id = CAST(:gid AS uuid)
                  )
                ORDER BY f.sort_order, f.created_at
                """
            ),
            {"eid": str(conv.event_id), "gid": guest_id},
        )
        rows = res.all()
    except Exception as exc:
        logger.warning("Question lookup failed, skipping questions: %s", exc)
        await session.rollback()
        return []
    out = []
    for fid, label, options in rows:
        opts = _options(options)
        if len(opts) >= 2:
            out.append({"id": fid, "label": label, "options": opts[:fg.MAX_LIST_ROWS]})
    return out


async def build_ctx(session: AsyncSession, conv: Conversation, graph: fg.Graph,
                    guest_id: Optional[str]) -> fg.Ctx:
    ctx = fg.Ctx()
    if guest_id:
        row = (await session.execute(text("SELECT guest_count FROM guests WHERE id = CAST(:g AS uuid)"),
                                     {"g": guest_id})).first()
        ctx.guest_count = row[0] if row else None
        if graph.has_guest_questions():
            ctx.questions = await pending_questions(session, conv, guest_id)
    return ctx


# ---------------------------------------------------------------------------
# Effects (one transaction)
# ---------------------------------------------------------------------------

def _to_int(v: Any) -> Optional[int]:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


async def _add_tag(session: AsyncSession, conv: Conversation, guest_id: str, tag: str) -> None:
    """Account-scoped tag (tags/guest_tags). Best-effort inside a SAVEPOINT."""
    try:
        async with session.begin_nested():
            acc = (await session.execute(
                text("SELECT account_id::text FROM events WHERE CAST(id AS text) = :e"), {"e": str(conv.event_id)},
            )).first()
            if not acc or not acc[0]:
                logger.info("add_tag skipped: event has no account (tag=%s)", tag)
                return
            await session.execute(
                text("INSERT INTO tags (id, account_id, name, created_at) VALUES "
                     "(gen_random_uuid(), CAST(:a AS uuid), :n, now()) ON CONFLICT (account_id, name) DO NOTHING"),
                {"a": acc[0], "n": tag[:50]},
            )
            await session.execute(
                text("INSERT INTO guest_tags (guest_id, tag_id) SELECT CAST(:g AS uuid), t.id FROM tags t "
                     "WHERE t.account_id = CAST(:a AS uuid) AND t.name = :n ON CONFLICT DO NOTHING"),
                {"g": guest_id, "a": acc[0], "n": tag[:50]},
            )
    except Exception as exc:
        logger.warning("add_tag failed (tag=%s): %s", tag, exc)


async def _set_field(session: AsyncSession, conv: Conversation, guest_id: str, fld: str, value: Optional[str]) -> None:
    if value is None:
        return
    if fld.startswith(fg.CUSTOM_FIELD_PREFIX):
        key = fld[len(fg.CUSTOM_FIELD_PREFIX):]
        row = (await session.execute(
            text("SELECT id::text FROM event_field_defs WHERE CAST(event_id AS text) = :e AND key = :k"),
            {"e": str(conv.event_id), "k": key},
        )).first()
        if not row:
            logger.info("set_field skipped: no custom field %r on this event", key)
            return
        await session.execute(
            text("INSERT INTO guest_custom_values (id, guest_id, field_def_id, value) VALUES "
                 "(gen_random_uuid(), CAST(:g AS uuid), CAST(:f AS uuid), CAST(:v AS json)) "
                 "ON CONFLICT (guest_id, field_def_id) DO UPDATE SET value = EXCLUDED.value"),
            {"g": guest_id, "f": row[0], "v": json.dumps(value, ensure_ascii=False)},
        )
        return
    spec = fg.GUEST_FIELDS.get(fld)
    if not spec:
        return
    if fld == "notes_append":
        note = value.strip()
        if not note or note == fg.GUEST_NOTE_PREFIX.strip():
            return  # empty guest text -> nothing appended (states/note_info.py)
        await session.execute(
            text("UPDATE guests SET notes = LEFT(CASE WHEN notes IS NULL OR btrim(notes) = '' THEN :note "
                 "ELSE notes || E'\\n' || :note END, :cap) WHERE id = CAST(:g AS uuid)"),
            {"note": value, "cap": NOTES_TOTAL_MAX, "g": guest_id},
        )
        return
    col = spec["column"]
    if spec["type"] == "int":
        n = _to_int(value)
        if n is None or not (spec["min"] <= n <= spec["max"]):
            logger.info("set_field %s skipped: %r is not a valid number", fld, value)
            return
        await session.execute(text(f"UPDATE guests SET {col} = :v WHERE id = CAST(:g AS uuid)"), {"v": n, "g": guest_id})
    else:
        await session.execute(text(f"UPDATE guests SET {col} = :v WHERE id = CAST(:g AS uuid)"),
                              {"v": value[:spec["max"]], "g": guest_id})


async def apply_step(session: AsyncSession, conv: Conversation, guest_id: Optional[str],
                     effects: List[Dict[str, Any]], new_state: Optional[str], *, stamp: bool = True) -> List[Dict[str, Any]]:
    """Run the effects + state change in one transaction. Returns the effects
    that still need sending (notify_host -> notify_hosts)."""
    skipped: List[Dict[str, Any]] = []
    try:
        if guest_id and stamp:
            await session.execute(text("UPDATE guests SET last_response = :ts WHERE id = CAST(:g AS uuid)"),
                                  {"ts": datetime.now(), "g": guest_id})
        for eff in effects:
            t = eff.get("type")
            if t == "notify_host":
                # Sent after the step by notify_hosts() (needs the flow renderer).
                skipped.append(eff)
                continue
            if not guest_id:
                logger.info("flow graph effect %s skipped: no guest row", t)
                continue
            if t == "set_rsvp":
                status = fg.RSVP_DB_VALUE.get(eff.get("value"))
                if status:
                    await session.execute(text("UPDATE guests SET status = :s WHERE id = CAST(:g AS uuid)"),
                                          {"s": status, "g": guest_id})
                    logger.info("Guest status -> %s (graph node=%s)", status, eff.get("node_id"))
            elif t == "set_field":
                await _set_field(session, conv, guest_id, str(eff.get("field") or ""), eff.get("value"))
            elif t == "store_answer":
                v = eff.get("value")
                await session.execute(
                    text("INSERT INTO guest_custom_values (id, guest_id, field_def_id, value) VALUES "
                         "(gen_random_uuid(), CAST(:g AS uuid), CAST(:f AS uuid), CAST(:v AS json)) "
                         "ON CONFLICT (guest_id, field_def_id) DO UPDATE SET value = EXCLUDED.value"),
                    {"g": guest_id, "f": eff.get("field_id"),
                     "v": json.dumps(v, ensure_ascii=False) if v is not None else None},
                )
            elif t == "add_tag":
                if eff.get("tag"):
                    await _add_tag(session, conv, guest_id, eff["tag"])
            elif t == "stop_reminders":
                # Recorded as the 'no_reminders' tag. Reminder audiences
                # (campaign-worker/audience.py) must exclude it to enforce.
                await _add_tag(session, conv, guest_id, fg.NO_REMINDERS_TAG)
        if new_state:
            await session.execute(
                text("UPDATE conversations SET current_state = :s, updated_at = now() WHERE id = :id"),
                {"s": new_state, "id": conv.id},
            )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    await session.refresh(conv)
    return skipped


# ---------------------------------------------------------------------------
# Rendering (identical payloads to the legacy states)
# ---------------------------------------------------------------------------

class _NodeRenderer(BaseState):
    def __init__(self, flow: Any, node_id: str, cfg: Any):
        super().__init__(flow)
        self.id = node_id
        self.set_cfg(cfg)


def _legacy(text_value: str, extra: Dict[str, Any]) -> str:
    return fc.to_legacy_placeholders(text_value or "", {k: ("" if v is None else v) for k, v in extra.items()})


async def render_send(flow: Any, session: AsyncSession, conv: Conversation, send: Dict[str, Any],
                      cfg: Any) -> Optional[Dict[str, Any]]:
    r = _NodeRenderer(flow, send["node_id"], cfg)
    extra = send.get("extra") or {}
    kind = send["kind"]
    if kind == "template":
        return await r.build_template(session, conv, send["template"], send.get("language") or "he",
                                      [_legacy(p, extra) for p in send.get("params") or []])
    if kind == "question":
        q = send["question"]
        prefix = await r._render_text(session, conv, _legacy(send.get("text") or "", extra))
        return {
            "platform": "WA",
            "recipient": conv.guest_phone,
            "message_type": "interactive",
            "interactive": build_question_interactive(q["id"], q["label"], q["options"],
                                                      prefix=f"{prefix}\n\n" if prefix else ""),
            "event_id": str(conv.event_id),
            "state": send["node_id"],
            "source": "webhook_worker",
        }
    body = _legacy(send.get("text") or "", extra)
    if kind == "buttons":
        return await r.build_interactive(session, conv, body, list(send.get("buttons") or []))
    if kind == "list":
        rendered = await r._render_text(session, conv, body)
        return {
            "platform": "WA",
            "recipient": conv.guest_phone,
            "message_type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": rendered},
                "action": {
                    "button": str(send.get("list_button") or fg.DEFAULT_LIST_BUTTON)[:fg.BUTTON_LABEL_MAX],
                    "sections": [{"title": "אפשרויות", "rows": [
                        {"id": bid, "title": str(label)[:fg.LIST_ROW_MAX]}
                        for bid, label in zip(send.get("button_ids") or [], send.get("buttons") or [])
                    ]}],
                },
            },
            "event_id": str(conv.event_id),
            "state": send["node_id"],
            "source": "webhook_worker",
        }
    return await r.build_text(session, conv, body)


HOST_ALERT_KIND = "host_alert"  # shared/content/system_templates.yaml


def _one_line(value: str, limit: int) -> str:
    """Meta rejects newlines, tabs and 4+ consecutive spaces inside parameters."""
    out = " ".join(str(value or "").replace("\t", " ").split())
    return out[:limit]


def _dedupe_key(key: str) -> str:
    """owner_notifications.dedupe_key is VARCHAR(160)."""
    if len(key) <= 160:
        return key
    return f"{HOST_ALERT_KIND}:{hashlib.sha1(key.encode('utf-8')).hexdigest()}"


async def notify_hosts(flow: Any, session: AsyncSession, conv: Conversation, guest_id: Optional[str],
                       effects: List[Dict[str, Any]], cfg: Any) -> int:
    """notify_host effects -> owner_notifications outbox rows (template host_alert),
    one per event owner with a phone. The scheduler dispatches them. Best-effort:
    a failure here never breaks the guest's conversation."""
    effects = [e for e in effects or [] if e.get("type") == "notify_host"]
    if not effects:
        return 0
    queued = 0
    try:
        async with session.begin_nested():
            ev = (await session.execute(text("SELECT name, owners FROM events WHERE id = CAST(:e AS uuid)"),
                                        {"e": str(conv.event_id)})).first()
            if ev is None:
                return 0
            owners = ev.owners
            if isinstance(owners, str):
                owners = json.loads(owners or "[]")
            owner_ids = [str(o) for o in (owners or []) if o]
            phones = []
            if owner_ids:
                rows = await session.execute(
                    text("SELECT phone FROM users WHERE id::text = ANY(:ids) AND phone IS NOT NULL AND phone <> ''"),
                    {"ids": owner_ids})
                phones = sorted({r.phone for r in rows})
            if not phones:
                logger.info("notify_host: event %s has no owner phone", conv.event_id)
                return 0
            guest_name = ""
            if guest_id:
                g = (await session.execute(text("SELECT name FROM guests WHERE id = CAST(:g AS uuid)"),
                                           {"g": guest_id})).first()
                guest_name = (g.name if g else "") or ""
            r = _NodeRenderer(flow, "notify_host", cfg)
            for eff in effects:
                body = await r._render_text(session, conv, _legacy(str(eff.get("text") or ""), eff.get("turn") or {}))
                params = {"1": _one_line(ev.name or "האירוע", 200),
                          "2": _one_line(guest_name or conv.guest_phone or "אורח", 120),
                          "3": _one_line(body, 700) or "-"}
                digest = hashlib.sha1(params["3"].encode("utf-8")).hexdigest()[:12]
                for phone in phones:
                    res = await session.execute(
                        text("INSERT INTO owner_notifications (kind, recipient_phone, event_id, params, dedupe_key) "
                             "VALUES (:k, :p, CAST(:e AS uuid), CAST(:params AS jsonb), :d) "
                             "ON CONFLICT (dedupe_key) DO NOTHING RETURNING id"),
                        {"k": HOST_ALERT_KIND, "p": phone, "e": str(conv.event_id),
                         "params": json.dumps(params, ensure_ascii=False),
                         "d": _dedupe_key(f"{HOST_ALERT_KIND}:{conv.event_id}:{guest_id or conv.guest_phone}:"
                                          f"{eff.get('edge_id')}:{digest}:{phone}")})
                    queued += 1 if res.first() is not None else 0
        logger.info("notify_host queued %s owner notification(s)", queued,
                    extra={"event_id": str(conv.event_id)})
    except Exception as exc:  # never break the guest flow
        logger.warning("notify_host failed for event %s: %s", conv.event_id, exc)
    return queued


async def emit(flow: Any, session: AsyncSession, conv: Conversation, sends: List[Dict[str, Any]], cfg: Any,
               *, stale: bool) -> None:
    if stale:
        return  # outside the 24h window - the answer is recorded, no reply
    for send in sends:
        outgoing = await render_send(flow, session, conv, send, cfg)
        if not outgoing:
            continue
        outgoing.setdefault("conversation_id", str(conv.id))
        outgoing.setdefault("guest_id", str(conv.guest_id) if conv.guest_id else None)
        await flow.log_message(
            session, conversation_id=conv.id, wa_message_id=None, direction="outgoing",
            message_type=outgoing.get("message_type", "template"), reply_to_id=None,
            payload=json.dumps(outgoing, ensure_ascii=False)[:4000], state=send["node_id"],
        )
        await flow.publish_outgoing(outgoing)


# ---------------------------------------------------------------------------
# Entry points (called by FlowManager)
# ---------------------------------------------------------------------------

async def run_graph(flow: Any, session: AsyncSession, conv: Conversation, resolved: fg.ResolvedGraph, cfg: Any, *,
                    effective_state: str, message_type: str, text_value: str, raw: Dict[str, Any],
                    context_id: Optional[str], action: Any, button_id: Optional[str], reply_kind: Optional[str],
                    stale: bool) -> None:
    graph = resolved.graph
    action_v = fg._action_value(action)
    inbound = fg.Inbound(text=text_value or "", button_id=button_id, action=action_v, reply_kind=reply_kind)

    # 1. Already answered + "acknowledge": a repeat template tap of the answer
    #    the guest is already in changes nothing.
    if reply_kind == "template_button" and action_v and cfg.get("already_answered.behavior") == "acknowledge":
        cur = graph.node(conv.current_state)
        if cur is not None and cur.get("answered") == action_v:
            await _acknowledge(flow, session, conv, cur, cfg, message_type=message_type, raw=raw,
                               context_id=context_id, stale=stale)
            return

    stage = None
    if reply_kind == "template_button" or graph.node(effective_state) is None:
        stage = await replied_stage(context_id)
    here = fg.start_node(graph, effective_state, inbound, stage)

    # 2. Log + credit the reply before anything can fail.
    await flow.log_message(
        session, conversation_id=conv.id, wa_message_id=raw.get("message_id"), direction="incoming",
        message_type=message_type, reply_to_id=context_id,
        payload=json.dumps(raw, ensure_ascii=False)[:4000], state=here or effective_state,
    )
    await flow._record_reply(session, guest_phone=conv.guest_phone, event_id=conv.event_id, context_id=context_id)

    if here is None:
        logger.error("flow graph %s/%s v%s has no usable entry node", resolved.scope, resolved.scope_key,
                     resolved.version)
        return
    guest_id = await target_guest_id(session, conv)
    ctx = await build_ctx(session, conv, graph, guest_id)
    res = fg.step(graph, here, inbound, ctx, _DEFAULTS)
    logger.info("Graph transition %s -> %s (edges=%s, graph=%s/%s v%s)", here, res.node_id, res.edge_ids,
                resolved.scope, resolved.scope_key, resolved.version)
    pending = await apply_step(session, conv, guest_id, res.effects, res.node_id or here)
    await notify_hosts(flow, session, conv, guest_id, pending, cfg)
    await emit(flow, session, conv, res.sends, cfg, stale=stale)


async def continue_after_answer(flow: Any, session: AsyncSession, conv: Conversation, resolved: fg.ResolvedGraph,
                                *, stale: bool) -> None:
    """A qans__ tap was stored while the guest is in a guest_questions node:
    move on (next question / the node's 'answered' or 'done' edge)."""
    from states.base_state import load_flow_config
    graph = resolved.graph
    guest_id = await target_guest_id(session, conv)
    ctx = await build_ctx(session, conv, graph, guest_id)
    res = fg.after_answer(graph, conv.current_state, ctx)
    pending = await apply_step(session, conv, guest_id, res.effects, res.node_id or conv.current_state, stamp=False)
    cfg = await load_flow_config(conv.event_id)
    await notify_hosts(flow, session, conv, guest_id, pending, cfg)
    await emit(flow, session, conv, res.sends, cfg, stale=stale)


async def _acknowledge(flow: Any, session: AsyncSession, conv: Conversation, node: Dict[str, Any], cfg: Any, *,
                       message_type: str, raw: Dict[str, Any], context_id: Optional[str], stale: bool) -> None:
    await flow.log_message(
        session, conversation_id=conv.id, wa_message_id=raw.get("message_id"), direction="incoming",
        message_type=message_type, reply_to_id=context_id,
        payload=json.dumps(raw, ensure_ascii=False)[:4000], state=conv.current_state,
    )
    await flow._record_reply(session, guest_phone=conv.guest_phone, event_id=conv.event_id, context_id=context_id)
    guest_id = await target_guest_id(session, conv)
    await apply_step(session, conv, guest_id, [], None)  # stamps last_response only
    logger.info("Already answered (%s) - acknowledging (graph)", conv.current_state)
    if stale:
        return
    r = _NodeRenderer(flow, conv.current_state, cfg)
    body = cfg.legacy_text("already_answered.text")
    labels = [str(b.get("label") or "").strip() for b in fg.visible_buttons(node)][:fg.MAX_BUTTONS]
    outgoing = (await r.build_interactive(session, conv, body, labels) if labels
                else await r.build_text(session, conv, body))
    outgoing.setdefault("conversation_id", str(conv.id))
    outgoing.setdefault("guest_id", str(conv.guest_id) if conv.guest_id else None)
    await flow.log_message(
        session, conversation_id=conv.id, wa_message_id=None, direction="outgoing",
        message_type=outgoing.get("message_type", "interactive"), reply_to_id=None,
        payload=json.dumps(outgoing, ensure_ascii=False)[:4000], state=conv.current_state,
    )
    await flow.publish_outgoing(outgoing)
