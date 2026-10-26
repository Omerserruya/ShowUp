"""Data-driven guest WhatsApp conversation ("flow graph" / automation builder).

The hardcoded RSVP state machine in webhook-worker (states/*.py +
flow_manager._apply_flow_steps) is expressed here as DATA: nodes (what the bot
says and how it listens) and edges (when the guest answers X, run actions and
go to node Y). An admin edits it visually; webhook-worker interprets it.

    flow_graphs (core-service migrations.ensure_flow_graphs)
        one row per saved VERSION of a scope's graph; one active row per
        (scope, scope_key); `enabled` on the active row is the feature flag.
    resolution: event -> event_type -> global('default'); the most specific
        ENABLED active graph that validates wins. None -> the legacy code path.

`DEFAULT_GRAPH` / `build_default_graph(flow_cfg)` reproduce TODAY's
conversation exactly: node ids are the legacy state names (so conversations
already in flight - conversations.current_state - keep working), copy and
buttons come from the conversation flow settings (shared/domain/flow_config.py,
yesterday's text/settings layer), and transitions + status writes mirror the
states. webhook-worker/tests/test_flow_graph_equivalence_db.py runs the same
conversations through both engines and compares messages and DB writes.

The interpreter (`step`, `enter`, `after_answer`) is PURE: it receives the
guest's pending host questions and returns effects (DB writes to perform) and
sends (messages to render). webhook-worker executes them; the admin simulator
renders them with sample values. No I/O here except the lazy DB readers at the
bottom (SQLAlchemy imported lazily, like flow_config).

Schema (schema_version 1) - see `SCHEMA_DOC` below and GET /admin/flow-graph/meta.
"""
from __future__ import annotations

import copy
import json
import logging
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from shared.domain import flow_config as fc
from shared.domain.rsvp import GUEST_COUNT_MAX, GUEST_COUNT_MIN, parse_guest_count, tokenize_reply

logger = logging.getLogger(__name__)

TABLE = "flow_graphs"
SCHEMA_VERSION = 1

SCOPE_GLOBAL = fc.SCOPE_GLOBAL
SCOPE_EVENT_TYPE = fc.SCOPE_EVENT_TYPE
SCOPE_EVENT = fc.SCOPE_EVENT
SCOPES = fc.SCOPES
GLOBAL_KEY = fc.GLOBAL_KEY
EVENT_TYPE_KEYS = fc.EVENT_TYPE_KEYS

CACHE_TTL_SECONDS = 60

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

NODE_TYPES = ("template", "message", "question", "end")
INPUT_KINDS = ("buttons", "list", "number", "text", "none")
EDGE_KINDS = ("button", "rsvp", "number", "number_invalid", "text_contains", "any_text", "done", "answered")
ACTION_TYPES = ("set_rsvp", "set_field", "add_tag", "notify_host", "stop_reminders")
RSVP_VALUES = ("confirmed", "declined", "maybe")
SET_RSVP_VALUES = ("confirmed", "declined", "maybe", "invited")
ENTRY_STAGES = ("invitation", "reminder", "final_reminder", "default")

# Which DB value set_rsvp writes. 'confirmed' is written as the legacy spelling
# 'attending' - exactly what the WhatsApp flow writes today (GuestStatus.normalize
# maps it; stats/audiences read both).
RSVP_DB_VALUE = {"confirmed": "attending", "declined": "declined", "maybe": "maybe", "invited": "invited"}

# set_field targets: guest columns (+ custom:<event_field_defs.key>).
GUEST_FIELDS: Dict[str, Dict[str, Any]] = {
    "guest_count": {"type": "int", "label": "כמות מגיעים (מהאורח)", "column": "guest_count", "min": 0, "max": 200},
    "import_count": {"type": "int", "label": "כמות מוזמנים (מהמארח)", "column": "import_count", "min": 0, "max": 200},
    "table_number": {"type": "int", "label": "מספר שולחן", "column": "table_number", "min": 0, "max": 10000},
    "group": {"type": "text", "label": "קבוצה / צד", "column": "guest_group", "max": 100},
    "notes_append": {"type": "text", "label": "הוספה להערות", "column": "notes", "max": 500},
}
CUSTOM_FIELD_PREFIX = "custom:"
_CUSTOM_KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{1,50}$")

# {var} placeholders. BASE vars render from the event/guest (flow_config's
# renderer); the rest are per-turn values.
TURN_VARS = ("answer", "party_size", "min_count", "max_count")
VARIABLES = tuple(fc.BASE_VARS) + TURN_VARS
VARIABLE_LABELS_HE = {
    **fc.VARIABLE_LABELS_HE,
    "answer": "התשובה של האורח",
    "party_size": "כמות המגיעים",
}
# set_field values may only use per-turn values (the worker writes them before
# any rendering of event data).
SET_FIELD_VARS = ("answer", "party_size")

NO_REMINDERS_TAG = "no_reminders"

# WhatsApp limits.
MAX_BUTTONS = fc.WA_MAX_BUTTONS          # 3
BUTTON_LABEL_MAX = fc.WA_BUTTON_LABEL_MAX  # 20
MAX_LIST_ROWS = 10
LIST_ROW_MAX = 24
INTERACTIVE_BODY_MAX = fc.WA_INTERACTIVE_BODY_MAX
TEXT_MAX = fc.WA_TEXT_MAX
NUMBER_HARD_MAX = fc.PARTY_SIZE_HARD_MAX
MAX_NODES = 100
MAX_EDGES = 400
MAX_ACTIONS_PER_EDGE = 10
MAX_ENTER_DEPTH = 12
DEFAULT_LIST_BUTTON = "בחירה"

_NODE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_BUTTON_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,40}$")
_RESERVED_PREFIXES = ("qans", "evsel")

# Catalog quick replies on the invitation/reminder TEMPLATE (simulator only).
TEMPLATE_QUICK_REPLIES = (
    {"id": "rsvp_accepted", "label": "ברור שאגיע!", "action": "confirmed"},
    {"id": "rsvp_declined", "label": "לצערי לא אוכל", "action": "declined"},
    {"id": "rsvp_maybe", "label": "עוד מתלבט/ת, תחזרו אלי?", "action": "maybe"},
)

# Guest notes are appended under this prefix (states/note_info.py).
GUEST_NOTE_PREFIX = "הערת אורח (וואטסאפ): "


# ---------------------------------------------------------------------------
# Host-question option matching (single source; states/question_answer.py
# re-exports these)
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")
QANS_PREFIX = "qans__"


def normalize_answer(value: Any) -> str:
    s = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    return _SPACE_RE.sub(" ", s).strip()


def match_option(text_value: Optional[str], options: List[str]) -> Optional[int]:
    """Match a typed reply to an option index, conservatively.

    1. exact normalized label;  2. the option's number ("2");
    3. exactly ONE option starts with the reply or is contained in it
       ("כן" -> "כן, אשמח"). Anything ambiguous -> None.
    """
    t = normalize_answer(text_value)
    if not t or not options:
        return None
    norm = [normalize_answer(o) for o in options]
    for i, o in enumerate(norm):
        if o and o == t:
            return i
    if t.isdigit():
        n = int(t)
        return n - 1 if 1 <= n <= len(options) else None
    hits = [i for i, o in enumerate(norm) if o and (o.startswith(t + " ") or o.startswith(t) and len(t) >= 2)]
    if len(hits) == 1:
        return hits[0]
    hits = [i for i, o in enumerate(norm) if o and (" " + o + " ") in (" " + t + " ")]
    if len(hits) == 1:
        return hits[0]
    return None


def _parse_qans(button_id: Optional[str]) -> Optional[Tuple[str, int]]:
    if not button_id or not str(button_id).startswith(QANS_PREFIX):
        return None
    rest = str(button_id)[len(QANS_PREFIX):]
    fid, sep, idx = rest.rpartition("__")
    if not sep or not fid:
        return None
    try:
        return fid, int(idx)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# DEFAULT_GRAPH - today's conversation, built from the flow settings
# ---------------------------------------------------------------------------

def _btn(bid: str, label: str, hidden: bool = False) -> Dict[str, Any]:
    b: Dict[str, Any] = {"id": bid, "label": label}
    if hidden:
        b["hidden"] = True
    return b


def _set(value: str) -> Dict[str, Any]:
    return {"type": "set_rsvp", "value": value}


class _EdgeIds:
    def __init__(self) -> None:
        self.n: Dict[str, int] = {}

    def __call__(self, frm: str) -> str:
        self.n[frm] = self.n.get(frm, 0) + 1
        return f"e_{frm}_{self.n[frm]}"


def build_default_graph(flow: Optional[fc.FlowConfig] = None) -> Dict[str, Any]:
    """Today's conversation as a graph, with `flow`'s copy/toggles/bounds overlaid.

    Mirrors webhook-worker/states/* + FlowManager._apply_flow_steps:
      * rsvp_invite / didnt_understand: semantic RSVP -> status write + branch
      * rsvp_count(+_retry): valid party size writes guest_count + attending
      * question_answer(+_retry): host-question loop (event_field_defs.ask_in_rsvp)
      * typed decline/maybe "change of heart" from count/info/done/update
        (rsvp edges with typed_only)
      * optional steps the settings turn off are `skip` nodes (pass through
        their 'done' edge) - same order: party size -> questions -> notes -> done
    """
    f = flow or fc.default_flow()
    T = lambda p: str(f.get(p, ""))  # noqa: E731
    B = lambda p, k: f.button(p, k)  # noqa: E731
    eid = _EdgeIds()
    number = {"min": f.party_min, "max": f.party_max}
    count_skip = not f.enabled("after_confirm.ask_party_size.enabled")
    q_skip = not f.enabled("after_confirm.ask_guest_questions.enabled")
    notes_skip = not f.enabled("after_confirm.ask_notes.enabled")
    change_mind = f.enabled("after_decline.allow_change_mind")

    def node(nid: str, ntype: str, title: str, *, text: str = "", input_: str = "none",
             buttons: Optional[list] = None, x: int = 0, y: int = 0, **extra: Any) -> Dict[str, Any]:
        n: Dict[str, Any] = {"id": nid, "type": ntype, "title": title, "text": text, "input": input_,
                             "buttons": buttons or [], "guest_questions": False, "position": {"x": x, "y": y}}
        n.update(extra)
        return n

    nodes = [
        node("rsvp_invite", "template", "ההזמנה (תבנית)", x=0, y=300, answered=None,
             resend_template={"name": "event_no_pic", "language": "he",
                              "params": ["{event_date}", "{event_time}", "{venue}", "{host_name}"]}),
        node("didnt_understand", "question", "לא הבנו", text=T("didnt_understand.text"), input_="text",
             x=0, y=620),
        node("rsvp_count", "question", "כמה תגיעו?", text=T("after_confirm.ask_party_size.text"),
             input_="number", number=dict(number), skip=count_skip, x=340, y=0),
        node("rsvp_count_retry", "question", "כמות לא תקינה", text=T("after_confirm.ask_party_size.retry_text"),
             input_="number", number=dict(number), skip=count_skip, x=340, y=-220),
        node("question_answer", "question", "שאלות לאורחים", text="עוד שאלה קטנה ונסיים 🙂",
             input_="text", guest_questions=True, skip=q_skip, x=680, y=0),
        node("question_answer_retry", "question", "שאלות לאורחים - ניסיון נוסף",
             text="לא הצלחנו להבין את התשובה 😅 אפשר לבחור באחת האפשרויות:",
             input_="text", guest_questions=True, skip=q_skip, x=680, y=-220),
        node("rsvp_info_question", "question", "הערות?", text=T("after_confirm.ask_notes.text"),
             input_="buttons", skip=notes_skip, x=1020, y=0,
             buttons=[_btn("no_notes", B("after_confirm.ask_notes.buttons", "no_notes")),
                      _btn("write_note", B("after_confirm.ask_notes.buttons", "write_note"))]),
        node("note_info", "question", "כתיבת הערה", text=T("after_confirm.ask_notes.note_prompt_text"),
             input_="text", x=1020, y=260),
        node("rsvp_done", "end", "סיום", text=T("after_confirm.done_message.text"), input_="buttons",
             answered="confirmed", x=1360, y=0,
             buttons=[_btn("update", B("after_confirm.done_message.buttons", "update"))]),
        node("rsvp_update", "question", "עדכון הגעה", text=T("after_confirm.update_menu.text"),
             input_="buttons", answered="confirmed", x=1360, y=300,
             buttons=[_btn("add_note", B("after_confirm.update_menu.buttons", "add_note")),
                      _btn("decline", B("after_confirm.update_menu.buttons", "decline")),
                      _btn("change_count", B("after_confirm.update_menu.buttons", "change_count"))]),
        node("rsvp_decline", "end", "לא מגיעים", text=T("after_decline.text"), input_="buttons",
             answered="declined", x=340, y=560,
             buttons=[_btn("change_mind", B("after_decline.buttons", "change_mind"), hidden=not change_mind)]),
        node("rsvp_maybe", "question", "מתלבטים", text=T("after_maybe.text"), input_="buttons",
             answered="maybe", x=340, y=860,
             buttons=[_btn("confirm", B("after_maybe.buttons", "confirm")),
                      _btn("decline", B("after_maybe.buttons", "decline"))]),
    ]
    nodes[0].pop("answered")

    def edge(frm: str, to: Optional[str], when: Dict[str, Any], actions: Optional[list] = None,
             priority: int = 0) -> Dict[str, Any]:
        return {"id": eid(frm), "from": frm, "to": to, "when": when, "actions": actions or [],
                "priority": priority}

    def rsvp(value: str, typed_only: bool = False) -> Dict[str, Any]:
        w: Dict[str, Any] = {"kind": "rsvp", "value": value}
        if typed_only:
            w["typed_only"] = True
        return w

    def btn(bid: str) -> Dict[str, Any]:
        return {"kind": "button", "button_id": bid}

    ANY = {"kind": "any_text"}
    DONE = {"kind": "done"}

    def typed_change_of_heart(frm: str) -> List[Dict[str, Any]]:
        # flow_manager.TYPED_CHANGE_OF_HEART_STATES: a TYPED decline/maybe is
        # re-applied as an invite answer.
        return [edge(frm, "rsvp_decline", rsvp("declined", True), [_set("declined")]),
                edge(frm, "rsvp_maybe", rsvp("maybe", True), [_set("maybe")])]

    def invite_answers(frm: str) -> List[Dict[str, Any]]:
        return [edge(frm, "rsvp_count", rsvp("confirmed"), [_set("confirmed")]),
                edge(frm, "rsvp_decline", rsvp("declined"), [_set("declined")]),
                edge(frm, "rsvp_maybe", rsvp("maybe"), [_set("maybe")])]

    count_number_actions = [{"type": "set_field", "field": "guest_count", "value": "{answer}"}, _set("confirmed")]
    edges: List[Dict[str, Any]] = []
    edges += invite_answers("rsvp_invite") + [edge("rsvp_invite", "didnt_understand", ANY)]
    edges += invite_answers("didnt_understand") + [edge("didnt_understand", "rsvp_invite", ANY)]
    for frm in ("rsvp_count", "rsvp_count_retry"):
        edges += typed_change_of_heart(frm)
        edges += [edge(frm, "question_answer", {"kind": "number"}, copy.deepcopy(count_number_actions)),
                  edge(frm, "rsvp_count_retry", {"kind": "number_invalid"}),
                  edge(frm, "question_answer", DONE)]
    edges += [edge("question_answer", "rsvp_info_question", DONE),
              edge("question_answer", "question_answer_retry", ANY),
              edge("question_answer_retry", "rsvp_info_question", DONE),
              edge("question_answer_retry", "question_answer", {"kind": "answered"})]
    edges += [edge("rsvp_info_question", "rsvp_done", btn("no_notes")),
              edge("rsvp_info_question", "note_info", btn("write_note"))]
    edges += typed_change_of_heart("rsvp_info_question")
    edges += [edge("rsvp_info_question", "rsvp_info_question", ANY),
              edge("rsvp_info_question", "rsvp_done", DONE)]
    edges += [edge("note_info", "rsvp_done", ANY,
                   [{"type": "set_field", "field": "notes_append", "value": GUEST_NOTE_PREFIX + "{answer}"}])]
    edges += [edge("rsvp_done", "rsvp_update", btn("update"))]
    edges += typed_change_of_heart("rsvp_done") + [edge("rsvp_done", "rsvp_done", ANY)]
    edges += [edge("rsvp_update", "note_info", btn("add_note")),
              edge("rsvp_update", "rsvp_decline", btn("decline"), [_set("declined")]),
              edge("rsvp_update", "rsvp_count", btn("change_count"))]
    edges += typed_change_of_heart("rsvp_update") + [edge("rsvp_update", "rsvp_update", ANY)]
    edges += [edge("rsvp_decline", "rsvp_count", btn("change_mind"), [_set("confirmed")]),
              edge("rsvp_decline", "rsvp_count", rsvp("confirmed"), [_set("confirmed")]),
              edge("rsvp_decline", "rsvp_decline", ANY)]
    edges += [edge("rsvp_maybe", "rsvp_count", btn("confirm"), [_set("confirmed")]),
              edge("rsvp_maybe", "rsvp_decline", btn("decline"), [_set("declined")]),
              edge("rsvp_maybe", "rsvp_count", rsvp("confirmed"), [_set("confirmed")]),
              edge("rsvp_maybe", "rsvp_decline", rsvp("declined"), [_set("declined")]),
              edge("rsvp_maybe", "rsvp_maybe", ANY)]

    return {
        "schema_version": SCHEMA_VERSION,
        "entry": {"invitation": "rsvp_invite", "reminder": "rsvp_invite", "final_reminder": "rsvp_invite",
                  "default": "rsvp_invite"},
        "nodes": nodes,
        "edges": edges,
    }


DEFAULT_GRAPH: Dict[str, Any] = build_default_graph()


def default_graph() -> Dict[str, Any]:
    return copy.deepcopy(DEFAULT_GRAPH)


# ---------------------------------------------------------------------------
# Graph access
# ---------------------------------------------------------------------------

class Graph:
    """Indexed read-only view of a graph dict."""

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.nodes: Dict[str, Dict[str, Any]] = {}
        for n in data.get("nodes") or []:
            if isinstance(n, dict) and isinstance(n.get("id"), str):
                self.nodes.setdefault(n["id"], n)
        self.out: Dict[str, List[Dict[str, Any]]] = {}
        for idx, e in enumerate(data.get("edges") or []):
            if isinstance(e, dict) and isinstance(e.get("from"), str):
                self.out.setdefault(e["from"], []).append(e)
        for frm, es in self.out.items():
            # Stable: lower priority number first, then array order.
            es.sort(key=lambda e: _int(e.get("priority"), 0))

    def node(self, nid: Optional[str]) -> Optional[Dict[str, Any]]:
        return self.nodes.get(nid) if nid else None

    def edges_of(self, nid: str, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        es = self.out.get(nid, [])
        return [e for e in es if (e.get("when") or {}).get("kind") == kind] if kind else list(es)

    def first(self, nid: str, kind: str) -> Optional[Dict[str, Any]]:
        es = self.edges_of(nid, kind)
        return es[0] if es else None

    def entry(self, stage: Optional[str] = None) -> Optional[str]:
        entry = self.data.get("entry") or {}
        key = stage if stage in ENTRY_STAGES else "default"
        nid = entry.get(key) or entry.get("default")
        return nid if nid in self.nodes else None

    def has_guest_questions(self) -> bool:
        return any(n.get("guest_questions") for n in self.nodes.values())


def _int(v: Any, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def visible_buttons(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [b for b in (node.get("buttons") or []) if isinstance(b, dict) and not b.get("hidden")]


def node_number(node: Dict[str, Any]) -> Tuple[int, int]:
    num = node.get("number") or {}
    return _int(num.get("min"), GUEST_COUNT_MIN), _int(num.get("max"), GUEST_COUNT_MAX)


def stage_entry_key(value: Any) -> str:
    """Campaign stage/template identifier -> entry key (invitation|reminder|final_reminder|default)."""
    if not value:
        return "default"
    v = str(value).strip().lower()
    if v in ENTRY_STAGES:
        return v
    try:
        from shared.domain.messaging.stages import canonical_stage
        st = canonical_stage(v)
        if st is not None and st.value in ENTRY_STAGES:
            return st.value
    except Exception:
        pass
    for k in ("final_reminder", "reminder", "invitation"):
        if v.startswith(k):
            return k
    return "default"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _issue(code: str, message: str, *, path: str = "", node_id: Optional[str] = None,
           edge_id: Optional[str] = None) -> Dict[str, Any]:
    d: Dict[str, Any] = {"path": path, "code": code, "message": message}
    if node_id is not None:
        d["node_id"] = node_id
    if edge_id is not None:
        d["edge_id"] = edge_id
    return d


def _check_text(text: Any, *, allowed: Tuple[str, ...], max_len: int, path: str, node_id: Optional[str] = None,
                edge_id: Optional[str] = None, required: bool = True) -> List[Dict[str, Any]]:
    errs: List[Dict[str, Any]] = []
    kw = {"path": path, "node_id": node_id, "edge_id": edge_id}
    if text is None or text == "":
        if required:
            errs.append(_issue("empty", "הטקסט לא יכול להיות ריק", **kw))
        return errs
    if not isinstance(text, str):
        return [_issue("type", "ערך חייב להיות טקסט", **kw)]
    if required and not text.strip():
        errs.append(_issue("empty", "הטקסט לא יכול להיות ריק", **kw))
    if len(text) > max_len:
        errs.append(_issue("too_long", f"הטקסט ארוך מדי (מקסימום {max_len} תווים)", **kw))
    if "{{" in text or "}}" in text:
        errs.append(_issue("bad_braces", "יש להשתמש במשתנים בפורמט {event_name}", **kw))
    unknown = sorted({v for v in fc.variables_in(text) if v not in allowed})
    if unknown:
        allowed_s = ", ".join("{" + v + "}" for v in allowed) or "אין משתנים כאן"
        errs.append(_issue("unknown_var", f"משתנה לא מוכר: {', '.join('{' + u + '}' for u in unknown)}. "
                                          f"מותר: {allowed_s}", **kw))
    return errs


def is_known_field(name: Any) -> bool:
    if not isinstance(name, str):
        return False
    if name in GUEST_FIELDS:
        return True
    return name.startswith(CUSTOM_FIELD_PREFIX) and bool(_CUSTOM_KEY_RE.match(name[len(CUSTOM_FIELD_PREFIX):]))


def validate_graph(graph: Any) -> Dict[str, List[Dict[str, Any]]]:
    """{"errors": [...], "warnings": [...]}; each issue has path/code/message
    (+ node_id / edge_id). A graph with errors cannot be saved or run."""
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    if not isinstance(graph, dict):
        return {"errors": [_issue("type", "הגרף חייב להיות אובייקט")], "warnings": []}
    if graph.get("schema_version") != SCHEMA_VERSION:
        errors.append(_issue("schema_version", f"schema_version חייב להיות {SCHEMA_VERSION}", path="schema_version"))
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not nodes:
        errors.append(_issue("no_nodes", "חייב להיות לפחות צומת אחד", path="nodes"))
        nodes = nodes if isinstance(nodes, list) else []
    if not isinstance(edges, list):
        errors.append(_issue("type", "edges חייב להיות רשימה", path="edges"))
        edges = []
    if len(nodes) > MAX_NODES:
        errors.append(_issue("too_many", f"עד {MAX_NODES} צמתים", path="nodes"))
    if len(edges) > MAX_EDGES:
        errors.append(_issue("too_many", f"עד {MAX_EDGES} חיבורים", path="edges"))

    by_id: Dict[str, Dict[str, Any]] = {}
    for i, n in enumerate(nodes):
        p = f"nodes[{i}]"
        if not isinstance(n, dict):
            errors.append(_issue("type", "צומת חייב להיות אובייקט", path=p))
            continue
        nid = n.get("id")
        if not isinstance(nid, str) or not _NODE_ID_RE.match(nid):
            errors.append(_issue("bad_id", "מזהה צומת: אותיות אנגליות קטנות, ספרות וקו תחתון (עד 64)",
                                 path=f"{p}.id", node_id=nid if isinstance(nid, str) else None))
            continue
        if "__" in nid or nid.startswith(_RESERVED_PREFIXES):
            errors.append(_issue("bad_id", "מזהה צומת לא יכול להכיל '__' או להתחיל ב-qans/evsel",
                                 path=f"{p}.id", node_id=nid))
        if nid in by_id:
            errors.append(_issue("duplicate_id", f"מזהה צומת כפול: {nid}", path=f"{p}.id", node_id=nid))
            continue
        by_id[nid] = n
        errors.extend(_validate_node(n, p))

    edge_ids = set()
    graph_view = Graph({"nodes": list(by_id.values()), "edges": [e for e in edges if isinstance(e, dict)]})
    for i, e in enumerate(edges):
        p = f"edges[{i}]"
        if not isinstance(e, dict):
            errors.append(_issue("type", "חיבור חייב להיות אובייקט", path=p))
            continue
        eid = e.get("id")
        if not isinstance(eid, str) or not eid.strip() or len(eid) > 80:
            errors.append(_issue("bad_id", "לחיבור חייב להיות מזהה", path=f"{p}.id"))
            eid = None
        elif eid in edge_ids:
            errors.append(_issue("duplicate_id", f"מזהה חיבור כפול: {eid}", path=f"{p}.id", edge_id=eid))
        else:
            edge_ids.add(eid)
        errors.extend(_validate_edge(e, p, eid, by_id))

    # Per-node edge requirements.
    for nid, n in by_id.items():
        out = graph_view.edges_of(nid)
        kinds = [(e.get("when") or {}).get("kind") for e in out]
        listening = [k for k in kinds if k != "done"]
        ntype = n.get("type")
        if (ntype == "question" or n.get("input") in ("buttons", "list")) and not listening and not n.get("skip"):
            errors.append(_issue("no_edges", "לצומת שמחכה לתשובה חייב להיות לפחות חיבור יוצא אחד",
                                 path="edges", node_id=nid))
        if n.get("skip") and "done" not in kinds:
            errors.append(_issue("skip_without_done", "צומת מדולג חייב חיבור 'המשך' (done)", path="edges", node_id=nid))
        if n.get("guest_questions"):
            if "done" not in kinds:
                errors.append(_issue("questions_without_done",
                                     "צומת שאלות לאורחים חייב חיבור 'סיום השאלות' (done)", path="edges", node_id=nid))
            bad = sorted({k for k in kinds if k not in ("done", "answered", "any_text")})
            if bad:
                errors.append(_issue("bad_edge_kind", "בצומת שאלות לאורחים מותרים רק done / answered / any_text",
                                     path="edges", node_id=nid))
        elif "answered" in kinds:
            errors.append(_issue("bad_edge_kind", "'answered' מותר רק בצומת שאלות לאורחים", path="edges", node_id=nid))
        if len([k for k in kinds if k == "done"]) > 1:
            warnings.append(_issue("multiple_done", "יותר מחיבור 'המשך' אחד - רק הראשון ישמש", node_id=nid))
        for e in out:
            w = e.get("when") or {}
            if (w.get("kind") == "any_text" and e.get("to") == nid and n.get("input") == "none"
                    and not n.get("guest_questions")):
                warnings.append(_issue("self_loop", "הצומת מפנה לעצמו על כל טקסט בלי לבקש קלט",
                                       node_id=nid, edge_id=e.get("id")))
        if ntype == "message" and listening and "done" in kinds:
            warnings.append(_issue("message_auto_advance",
                                   "הודעה עם חיבור 'המשך' ממשיכה מיד - החיבורים האחרים לא יופעלו", node_id=nid))

    # Entry.
    entry = graph.get("entry")
    if not isinstance(entry, dict) or not entry.get("default"):
        errors.append(_issue("no_entry", "חובה להגדיר צומת כניסה ברירת מחדל (entry.default)", path="entry.default"))
        entry = entry if isinstance(entry, dict) else {}
    for k, v in entry.items():
        if k not in ENTRY_STAGES:
            errors.append(_issue("unknown_stage", f"שלב לא מוכר: {k}", path=f"entry.{k}"))
        elif v is not None and v not in by_id:
            errors.append(_issue("missing_node", f"צומת הכניסה לא קיים: {v}", path=f"entry.{k}", node_id=v))

    # Reachability (warning).
    if by_id and not errors:
        seen = set()
        stack = [v for v in entry.values() if v in by_id]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            for e in graph_view.edges_of(cur):
                if e.get("to") in by_id:
                    stack.append(e["to"])
        for nid in by_id:
            if nid not in seen:
                warnings.append(_issue("unreachable", "אין דרך להגיע לצומת הזה מנקודות הכניסה", node_id=nid))
        # Pass-through cycles (skip / message+done / questions done) loop forever.
        for nid in by_id:
            cur, hops, chain = nid, 0, set()
            while cur in by_id and hops <= len(by_id):
                n = by_id[cur]
                auto = n.get("skip") or (n.get("type") == "message")
                if not auto:
                    break
                d = graph_view.first(cur, "done")
                if not d or not d.get("to"):
                    break
                if cur in chain:
                    warnings.append(_issue("pass_through_cycle", "מעגל של צמתים שממשיכים אוטומטית", node_id=nid))
                    break
                chain.add(cur)
                cur, hops = d["to"], hops + 1
    return {"errors": errors, "warnings": warnings}


def _validate_node(n: Dict[str, Any], p: str) -> List[Dict[str, Any]]:
    errs: List[Dict[str, Any]] = []
    nid = n["id"]
    ntype = n.get("type")
    if ntype not in NODE_TYPES:
        errs.append(_issue("bad_type", f"סוג צומת לא מוכר: {ntype}", path=f"{p}.type", node_id=nid))
        return errs
    inp = n.get("input", "none")
    if inp not in INPUT_KINDS:
        errs.append(_issue("bad_input", f"סוג קלט לא מוכר: {inp}", path=f"{p}.input", node_id=nid))
    title = n.get("title")
    if title is not None and (not isinstance(title, str) or len(title) > 100):
        errs.append(_issue("bad_title", "כותרת עד 100 תווים", path=f"{p}.title", node_id=nid))
    buttons = n.get("buttons") or []
    if not isinstance(buttons, list):
        errs.append(_issue("type", "buttons חייב להיות רשימה", path=f"{p}.buttons", node_id=nid))
        buttons = []
    interactive = inp in ("buttons", "list") and bool([b for b in buttons if isinstance(b, dict) and not b.get("hidden")])
    gq = bool(n.get("guest_questions"))
    if ntype == "template":
        if gq:
            errs.append(_issue("bad_type", "צומת תבנית לא יכול להריץ שאלות לאורחים", path=f"{p}.guest_questions",
                               node_id=nid))
        rt = n.get("resend_template")
        if rt is not None:
            if not isinstance(rt, dict) or not isinstance(rt.get("name"), str) or not rt.get("name"):
                errs.append(_issue("bad_template", "resend_template חייב שם תבנית", path=f"{p}.resend_template",
                                   node_id=nid))
            else:
                for j, prm in enumerate(rt.get("params") or []):
                    errs.extend(_check_text(prm, allowed=tuple(fc.BASE_VARS), max_len=1024,
                                            path=f"{p}.resend_template.params[{j}]", node_id=nid))
    else:
        errs.extend(_check_text(n.get("text"), allowed=VARIABLES,
                                max_len=INTERACTIVE_BODY_MAX if (interactive or gq) else TEXT_MAX,
                                path=f"{p}.text", node_id=nid, required=not gq))
    if inp in ("buttons", "list") and not gq:
        limit, lab_max = (MAX_BUTTONS, BUTTON_LABEL_MAX) if inp == "buttons" else (MAX_LIST_ROWS, LIST_ROW_MAX)
        shown = [b for b in buttons if isinstance(b, dict) and not b.get("hidden")]
        if not buttons:
            errs.append(_issue("no_buttons", "צריך לפחות כפתור אחד", path=f"{p}.buttons", node_id=nid))
        if len(shown) > limit:
            errs.append(_issue("too_many_buttons",
                               f"עד {limit} {'כפתורים' if inp == 'buttons' else 'שורות ברשימה'} (וואטסאפ)",
                               path=f"{p}.buttons", node_id=nid))
        seen_ids, seen_labels = set(), set()
        for j, b in enumerate(buttons):
            bp = f"{p}.buttons[{j}]"
            if not isinstance(b, dict):
                errs.append(_issue("type", "כפתור חייב להיות אובייקט", path=bp, node_id=nid))
                continue
            bid, label = b.get("id"), b.get("label")
            if not isinstance(bid, str) or not _BUTTON_ID_RE.match(bid):
                errs.append(_issue("bad_id", "מזהה כפתור: אותיות/ספרות/קו תחתון (עד 40)", path=f"{bp}.id", node_id=nid))
            elif bid in seen_ids:
                errs.append(_issue("duplicate_id", f"מזהה כפתור כפול: {bid}", path=f"{bp}.id", node_id=nid))
            else:
                seen_ids.add(bid)
            if not isinstance(label, str) or not label.strip():
                errs.append(_issue("empty", "תווית כפתור לא יכולה להיות ריקה", path=f"{bp}.label", node_id=nid))
                continue
            if len(label.strip()) > lab_max:
                errs.append(_issue("too_long", f"תווית עד {lab_max} תווים (וואטסאפ)", path=f"{bp}.label", node_id=nid))
            if "{" in label or "}" in label:
                errs.append(_issue("no_vars", "אין להשתמש במשתנים בתווית כפתור", path=f"{bp}.label", node_id=nid))
            if not b.get("hidden"):
                if label.strip() in seen_labels:
                    errs.append(_issue("duplicate_label", "תוויות הכפתורים בהודעה חייבות להיות שונות",
                                       path=f"{bp}.label", node_id=nid))
                seen_labels.add(label.strip())
        lb = n.get("list_button")
        if inp == "list" and lb is not None and (not isinstance(lb, str) or not lb.strip()
                                                 or len(lb.strip()) > BUTTON_LABEL_MAX):
            errs.append(_issue("bad_list_button", f"כפתור הרשימה עד {BUTTON_LABEL_MAX} תווים",
                               path=f"{p}.list_button", node_id=nid))
    if inp == "number":
        num = n.get("number") or {}
        mn, mx = num.get("min", GUEST_COUNT_MIN), num.get("max", GUEST_COUNT_MAX)
        if any(isinstance(v, bool) or not isinstance(v, int) for v in (mn, mx)):
            errs.append(_issue("type", "גבולות המספר חייבים להיות מספרים שלמים", path=f"{p}.number", node_id=nid))
        elif not (0 <= mn <= mx <= NUMBER_HARD_MAX):
            errs.append(_issue("range", f"טווח לא תקין (0 עד {NUMBER_HARD_MAX}, מינימום ≤ מקסימום)",
                               path=f"{p}.number", node_id=nid))
    ans = n.get("answered")
    if ans is not None and ans not in RSVP_VALUES:
        errs.append(_issue("bad_answered", "answered: confirmed / declined / maybe", path=f"{p}.answered", node_id=nid))
    pos = n.get("position")
    if pos is not None and not (isinstance(pos, dict) and all(isinstance(pos.get(k, 0), (int, float))
                                                              for k in ("x", "y"))):
        errs.append(_issue("bad_position", "position חייב {x, y} מספריים", path=f"{p}.position", node_id=nid))
    return errs


def _validate_edge(e: Dict[str, Any], p: str, eid: Optional[str], nodes: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    errs: List[Dict[str, Any]] = []
    frm, to = e.get("from"), e.get("to")
    if frm not in nodes:
        errs.append(_issue("missing_node", f"צומת מקור לא קיים: {frm}", path=f"{p}.from", edge_id=eid))
    if to is not None and to not in nodes:
        errs.append(_issue("missing_node", f"צומת יעד לא קיים: {to}", path=f"{p}.to", edge_id=eid))
    pr = e.get("priority", 0)
    if isinstance(pr, bool) or not isinstance(pr, int):
        errs.append(_issue("type", "priority חייב להיות מספר שלם", path=f"{p}.priority", edge_id=eid))
    w = e.get("when")
    if not isinstance(w, dict) or w.get("kind") not in EDGE_KINDS:
        errs.append(_issue("bad_when", "סוג תנאי לא מוכר", path=f"{p}.when", edge_id=eid))
        return errs
    kind = w["kind"]
    src = nodes.get(frm) or {}
    if kind == "button":
        ids = [b.get("id") for b in (src.get("buttons") or []) if isinstance(b, dict)]
        if w.get("button_id") not in ids:
            errs.append(_issue("unknown_button", "הכפתור לא קיים בצומת המקור", path=f"{p}.when.button_id",
                               edge_id=eid, node_id=frm))
    elif kind == "rsvp":
        if w.get("value") not in RSVP_VALUES:
            errs.append(_issue("bad_value", "ערך RSVP: confirmed / declined / maybe", path=f"{p}.when.value", edge_id=eid))
    elif kind in ("number", "number_invalid"):
        if src and src.get("input") != "number":
            errs.append(_issue("not_number_node", "תנאי מספר רק בצומת שמבקש מספר", path=f"{p}.when", edge_id=eid,
                               node_id=frm))
    elif kind == "text_contains":
        words = w.get("words")
        if (not isinstance(words, list) or not words
                or not all(isinstance(x, str) and x.strip() and len(x) <= 60 for x in words) or len(words) > 50):
            errs.append(_issue("bad_words", "רשימת מילים (1-50, כל אחת עד 60 תווים)", path=f"{p}.when.words",
                               edge_id=eid))
    actions = e.get("actions") or []
    if not isinstance(actions, list):
        errs.append(_issue("type", "actions חייב להיות רשימה", path=f"{p}.actions", edge_id=eid))
        return errs
    if len(actions) > MAX_ACTIONS_PER_EDGE:
        errs.append(_issue("too_many", f"עד {MAX_ACTIONS_PER_EDGE} פעולות לחיבור", path=f"{p}.actions", edge_id=eid))
    for j, a in enumerate(actions):
        ap = f"{p}.actions[{j}]"
        if not isinstance(a, dict) or a.get("type") not in ACTION_TYPES:
            errs.append(_issue("bad_action", "פעולה לא מוכרת", path=ap, edge_id=eid))
            continue
        t = a["type"]
        if t == "set_rsvp" and a.get("value") not in SET_RSVP_VALUES:
            errs.append(_issue("bad_value", "סטטוס: confirmed / declined / maybe / invited", path=f"{ap}.value",
                               edge_id=eid))
        elif t == "set_field":
            fld = a.get("field")
            if not is_known_field(fld):
                errs.append(_issue("unknown_field", f"שדה לא מוכר: {fld}", path=f"{ap}.field", edge_id=eid))
            v = a.get("value")
            if not isinstance(v, (str, int)) or isinstance(v, bool):
                errs.append(_issue("type", "ערך חייב להיות טקסט או מספר", path=f"{ap}.value", edge_id=eid))
            elif isinstance(v, str):
                errs.extend(_check_text(v, allowed=SET_FIELD_VARS, max_len=600, path=f"{ap}.value", edge_id=eid,
                                        required=False))
                spec = GUEST_FIELDS.get(fld or "")
                if spec and spec["type"] == "int" and not fc.variables_in(v):
                    try:
                        int(v.strip())
                    except ValueError:
                        errs.append(_issue("type", "השדה מספרי - ערך חייב להיות מספר או {answer}",
                                           path=f"{ap}.value", edge_id=eid))
        elif t == "add_tag":
            tag = a.get("tag")
            if not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 50:
                errs.append(_issue("bad_tag", "שם תגית 1-50 תווים", path=f"{ap}.tag", edge_id=eid))
        elif t == "notify_host":
            errs.extend(_check_text(a.get("text"), allowed=VARIABLES, max_len=1000, path=f"{ap}.text", edge_id=eid))
    return errs


def is_valid(graph: Any) -> bool:
    return not validate_graph(graph)["errors"]


# ---------------------------------------------------------------------------
# Interpreter (pure)
# ---------------------------------------------------------------------------

@dataclass
class Inbound:
    text: str = ""
    button_id: Optional[str] = None
    action: Optional[str] = None       # 'confirmed' | 'declined' | 'maybe' | None (semantic, resolved upstream)
    reply_kind: Optional[str] = None   # 'template_button' | 'button_reply' | 'list_reply' | None (typed)


@dataclass
class Ctx:
    """What the interpreter may know about the guest. `questions` = pending host
    questions in ask order: [{"id", "label", "options": [...]}] (mutated as the
    step answers/skips them)."""
    questions: List[Dict[str, Any]] = field(default_factory=list)
    guest_count: Optional[int] = None


@dataclass
class StepResult:
    node_id: Optional[str]                       # conversation state after the step
    effects: List[Dict[str, Any]] = field(default_factory=list)
    sends: List[Dict[str, Any]] = field(default_factory=list)
    edge_ids: List[str] = field(default_factory=list)
    trace: List[str] = field(default_factory=list)
    matched: bool = False


def _action_value(action: Any) -> Optional[str]:
    v = getattr(action, "value", action)
    v = str(v) if v is not None else None
    return v if v in RSVP_VALUES else None


def start_node(graph: Graph, current: Optional[str], inbound: Inbound, stage: Optional[str] = None) -> Optional[str]:
    """Where an inbound message is handled.

    A quick-reply on an invitation/reminder TEMPLATE with an RSVP meaning goes to
    that stage's entry node wherever the conversation stands (legacy: such taps
    always re-run rsvp_invite). Otherwise the current node; an unknown node
    (e.g. a legacy state the graph does not have) -> the stage's entry."""
    if inbound.reply_kind == "template_button" and _action_value(inbound.action):
        return graph.entry(stage)
    if current and graph.node(current):
        return current
    return graph.entry(stage)


def _match_button(graph: Graph, node: Dict[str, Any], inbound: Inbound,
                  defaults: Optional[Graph]) -> Optional[Dict[str, Any]]:
    buttons = [b for b in (node.get("buttons") or []) if isinstance(b, dict)]
    if not buttons:
        return None
    nid = node["id"]
    bid = str(inbound.button_id or "")
    low = bid.lower()
    prefix = f"{nid}__btn_"
    if low.startswith(prefix):
        try:
            n = int(bid[len(prefix):])
        except ValueError:
            n = 0
        shown = visible_buttons(node)
        if 1 <= n <= len(shown):
            return shown[n - 1]
        if 1 <= n <= len(buttons):
            return buttons[n - 1]
    if bid:
        for b in buttons:
            if bid == b.get("id") or bid == f"{nid}__{b.get('id')}":
                return b
    txt = (inbound.text or "").strip()
    if not txt:
        return None
    for b in buttons:
        if txt == str(b.get("label") or "").strip():
            return b
    dnode = defaults.node(nid) if defaults else None
    if dnode:
        for db_ in dnode.get("buttons") or []:
            if txt == str(db_.get("label") or "").strip():
                for b in buttons:
                    if b.get("id") == db_.get("id"):
                        return b
    return None


def _contains(text: str, words: List[str]) -> bool:
    toks = tokenize_reply(text)
    if not toks:
        return False
    for w in words or []:
        wt = tokenize_reply(w)
        if not wt:
            continue
        k = len(wt)
        for i in range(len(toks) - k + 1):
            if toks[i:i + k] == wt:
                return True
    return False


def match_edge(graph: Graph, node: Dict[str, Any], inbound: Inbound,
               defaults: Optional[Graph] = None) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """The edge an inbound message takes at `node`, and the turn values
    ({answer, party_size}). Order: button -> rsvp -> number/number_invalid ->
    text_contains -> any_text."""
    nid = node["id"]
    text = (inbound.text or "").strip()
    turn: Dict[str, Any] = {"answer": text}
    tapped = _match_button(graph, node, inbound, defaults)
    if tapped is not None:
        for e in graph.edges_of(nid, "button"):
            if (e.get("when") or {}).get("button_id") == tapped.get("id"):
                turn["answer"] = str(tapped.get("label") or text)
                return e, turn
    action = _action_value(inbound.action)
    if action:
        for e in graph.edges_of(nid, "rsvp"):
            w = e.get("when") or {}
            if w.get("value") == action and (not w.get("typed_only") or not inbound.reply_kind):
                return e, turn
    num_edges = graph.edges_of(nid, "number")
    inv_edges = graph.edges_of(nid, "number_invalid")
    if num_edges or inv_edges:
        mn, mx = node_number(node)
        n = parse_guest_count(text)
        if n is not None and mn <= n <= mx:
            if num_edges:
                turn["answer"] = str(n)
                turn["party_size"] = n
                return num_edges[0], turn
        elif inv_edges:
            return inv_edges[0], turn
    for e in graph.edges_of(nid, "text_contains"):
        if _contains(text, (e.get("when") or {}).get("words") or []):
            return e, turn
    anys = graph.edges_of(nid, "any_text")
    if anys:
        return anys[0], turn
    return None, turn


def _edge_effects(edge: Dict[str, Any], turn: Dict[str, Any], node_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in edge.get("actions") or []:
        t = a.get("type")
        eff = {"type": t, "edge_id": edge.get("id"), "node_id": node_id}
        if t == "set_rsvp":
            eff["value"] = a.get("value")
        elif t == "set_field":
            eff["field"] = a.get("field")
            raw = a.get("value")
            eff["raw"] = raw
            eff["value"] = render_turn_value(raw, turn, field=a.get("field"))
        elif t == "add_tag":
            eff["tag"] = str(a.get("tag") or "").strip()
        elif t == "notify_host":
            eff["text"] = a.get("text")
            eff["turn"] = {k: v for k, v in turn.items() if k in TURN_VARS}
        out.append(eff)
    return out


def render_turn_value(raw: Any, turn: Dict[str, Any], *, field: Optional[str] = None) -> Optional[str]:
    """Substitute {answer}/{party_size} in a set_field value."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return str(raw)
    answer = str(turn.get("answer") or "")
    if field == "notes_append":
        answer = answer[:GUEST_FIELDS["notes_append"]["max"]]
    vals = {"answer": answer,
            "party_size": "" if turn.get("party_size") is None else str(turn.get("party_size"))}
    return fc._VAR_RE.sub(lambda m: vals.get(m.group(1), m.group(0)), raw)


def _send_for(node: Dict[str, Any], turn: Dict[str, Any], ctx: Ctx) -> Optional[Dict[str, Any]]:
    nid = node["id"]
    mn, mx = node_number(node)
    extra = {"answer": turn.get("answer", ""),
             "party_size": turn.get("party_size") if turn.get("party_size") is not None else (
                 ctx.guest_count if ctx.guest_count is not None else ""),
             "min_count": mn, "max_count": mx}
    if node.get("type") == "template":
        rt = node.get("resend_template")
        if not rt:
            return None
        return {"node_id": nid, "kind": "template", "template": rt.get("name"),
                "language": rt.get("language") or "he", "params": list(rt.get("params") or []), "extra": extra}
    if node.get("guest_questions"):
        q = ctx.questions[0]
        return {"node_id": nid, "kind": "question", "text": node.get("text") or "", "question": dict(q),
                "extra": extra}
    inp = node.get("input")
    shown = visible_buttons(node)
    if inp in ("buttons", "list") and shown:
        limit = MAX_BUTTONS if inp == "buttons" else MAX_LIST_ROWS
        shown = shown[:limit]
        return {"node_id": nid, "kind": "buttons" if inp == "buttons" else "list", "text": node.get("text") or "",
                "buttons": [str(b.get("label") or "").strip() for b in shown],
                "button_ids": [f"{nid}__BTN_{i}" for i in range(1, len(shown) + 1)],
                "node_button_ids": [str(b.get("id")) for b in shown],
                "list_button": (node.get("list_button") or DEFAULT_LIST_BUTTON), "extra": extra}
    return {"node_id": nid, "kind": "text", "text": node.get("text") or "", "extra": extra}


def enter(graph: Graph, node_id: Optional[str], ctx: Ctx, res: StepResult, turn: Optional[Dict[str, Any]] = None,
          depth: int = 0) -> StepResult:
    """Enter a node: send its message (or pass through) and set it as state."""
    turn = turn if turn is not None else {"answer": ""}
    node = graph.node(node_id)
    if node is None:
        res.trace.append(f"missing node {node_id} - staying")
        return res
    if depth > MAX_ENTER_DEPTH:
        res.trace.append(f"pass-through depth exceeded at {node_id}")
        res.node_id = node_id
        return res
    nid = node["id"]

    def follow_done() -> bool:
        d = graph.first(nid, "done")
        if not d:
            return False
        res.effects.extend(_edge_effects(d, turn, nid))
        res.edge_ids.append(str(d.get("id")))
        if d.get("to"):
            res.trace.append(f"{nid} -done-> {d['to']}")
            enter(graph, d["to"], ctx, res, turn, depth + 1)
        else:
            res.node_id = nid
        return True

    if node.get("skip"):
        res.trace.append(f"{nid} skipped")
        if not follow_done():
            res.node_id = nid
        return res
    if node.get("guest_questions"):
        if ctx.questions:
            res.sends.append(_send_for(node, turn, ctx))
            res.node_id = nid
            return res
        if not follow_done():
            res.node_id = nid
        return res
    send = _send_for(node, turn, ctx)
    if send:
        res.sends.append(send)
    res.node_id = nid
    if node.get("type") == "message" and graph.first(nid, "done"):
        follow_done()
    return res


def after_answer(graph: Graph, node_id: str, ctx: Ctx, res: Optional[StepResult] = None,
                 turn: Optional[Dict[str, Any]] = None) -> StepResult:
    """A host question at guest_questions node `node_id` was answered/skipped:
    follow its 'answered' edge, else re-enter it (next question or 'done')."""
    res = res or StepResult(node_id=node_id)
    turn = turn or {"answer": ""}
    e = graph.first(node_id, "answered")
    if e:
        res.effects.extend(_edge_effects(e, turn, node_id))
        res.edge_ids.append(str(e.get("id")))
        if e.get("to"):
            return enter(graph, e["to"], ctx, res, turn)
        res.node_id = node_id
        return res
    return enter(graph, node_id, ctx, res, turn)


def step(graph: Graph, node_id: Optional[str], inbound: Inbound, ctx: Ctx,
         defaults: Optional[Graph] = None) -> StepResult:
    """Handle one inbound message at `node_id` (use start_node() first)."""
    res = StepResult(node_id=node_id)
    node = graph.node(node_id)
    if node is None:
        res.trace.append(f"unknown node {node_id}")
        return res
    nid = node["id"]
    if node.get("guest_questions"):
        res.matched = True
        pending = ctx.questions[0] if ctx.questions else None
        if pending is None:
            d = graph.first(nid, "done")
            res.trace.append(f"{nid}: no pending question")
            if d:
                res.effects.extend(_edge_effects(d, {"answer": inbound.text}, nid))
                res.edge_ids.append(str(d.get("id")))
                if d.get("to"):
                    return enter(graph, d["to"], ctx, res)
            return res
        opts = list(pending.get("options") or [])
        idx: Optional[int] = None
        parsed = _parse_qans(inbound.button_id)
        if parsed and parsed[0] == str(pending.get("id")) and 0 <= parsed[1] < len(opts):
            idx = parsed[1]
        if idx is None:
            idx = match_option(inbound.text, opts)
        turn = {"answer": opts[idx] if idx is not None else (inbound.text or "").strip()}
        if idx is not None:
            res.effects.append({"type": "store_answer", "field_id": pending.get("id"), "value": opts[idx],
                                "node_id": nid})
            ctx.questions.pop(0)
            res.trace.append(f"{nid}: answered {pending.get('id')}")
            return after_answer(graph, nid, ctx, res, turn)
        retry = graph.first(nid, "any_text")
        if retry:
            res.effects.extend(_edge_effects(retry, turn, nid))
            res.edge_ids.append(str(retry.get("id")))
            res.trace.append(f"{nid}: unmatched -> {retry.get('to')}")
            if retry.get("to"):
                return enter(graph, retry["to"], ctx, res, turn)
            return res
        res.effects.append({"type": "store_answer", "field_id": pending.get("id"), "value": None, "node_id": nid})
        ctx.questions.pop(0)
        res.trace.append(f"{nid}: skipped {pending.get('id')}")
        return after_answer(graph, nid, ctx, res, turn)

    edge, turn = match_edge(graph, node, inbound, defaults)
    if edge is None:
        res.trace.append(f"{nid}: no edge matched - staying")
        return res
    res.matched = True
    res.edge_ids.append(str(edge.get("id")))
    res.effects.extend(_edge_effects(edge, turn, nid))
    to = edge.get("to")
    res.trace.append(f"{nid} -{(edge.get('when') or {}).get('kind')}-> {to}")
    if not to:
        return res
    return enter(graph, to, ctx, res, turn)


# ---------------------------------------------------------------------------
# Simulator (admin preview; pure)
# ---------------------------------------------------------------------------

def _render_sim(text: str, vals: Dict[str, Any], extra: Dict[str, Any]) -> str:
    return fc.render(text or "", {**vals, **{k: ("" if v is None else v) for k, v in extra.items()}})


def _bot_turn(send: Dict[str, Any], vals: Dict[str, Any]) -> Dict[str, Any]:
    extra = send.get("extra") or {}
    kind = send["kind"]
    turn: Dict[str, Any] = {"from": "bot", "node_id": send["node_id"], "kind": kind, "buttons": []}
    if kind == "template":
        params = [_render_sim(p, vals, extra) for p in send.get("params") or []]
        turn["text"] = f"[תבנית {send.get('template')}] " + " | ".join(params)
        turn["buttons"] = [{"id": q["id"], "label": q["label"]} for q in TEMPLATE_QUICK_REPLIES]
    elif kind == "question":
        q = send["question"]
        prefix = _render_sim(send.get("text") or "", vals, extra)
        turn["text"] = (f"{prefix}\n\n" if prefix else "") + str(q.get("label") or "")
        turn["buttons"] = [{"id": str(i), "label": str(o)} for i, o in enumerate(q.get("options") or [])]
        if len(turn["buttons"]) > MAX_BUTTONS:
            turn["kind"] = "list"
    else:
        turn["text"] = _render_sim(send.get("text") or "", vals, extra)
        turn["buttons"] = [{"id": bid, "label": label} for bid, label in
                           zip(send.get("node_button_ids") or send.get("button_ids") or [], send.get("buttons") or [])]
    return turn


def simulate(graph_data: Dict[str, Any], inputs: List[Dict[str, Any]], *, event_type: Any = None,
             values: Optional[Dict[str, Any]] = None, questions: Optional[List[Dict[str, Any]]] = None,
             stage: str = "invitation", defaults: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run `inputs` ([{kind:'button', button_id} | {kind:'text', text}]) through
    the graph from the `stage` entry. Returns the transcript (bot/guest turns),
    the actions that WOULD run per turn, and the final node. No I/O.

    Buttons: a node button id ('no_notes'), its positional id ('rsvp_done__BTN_1')
    or, on a template node, a catalog quick reply id (rsvp_accepted /
    rsvp_declined / rsvp_maybe). Host questions: answer by option text, or
    button_id = option index ('0', '1', ...)."""
    from shared.domain.rsvp import resolve_rsvp_action

    g = Graph(graph_data)
    dg = Graph(defaults if defaults is not None else DEFAULT_GRAPH)
    vals = fc.sample_values(event_type, values)
    qs = copy.deepcopy(fc.SAMPLE_QUESTIONS if questions is None else questions)
    pending = [{"id": str(q.get("id") or f"q{i}"), "label": q.get("label") or "",
                "options": [str(o) for o in (q.get("options") or [])][:MAX_LIST_ROWS]}
               for i, q in enumerate(qs) if len(q.get("options") or []) >= 2]
    ctx = Ctx(questions=pending)
    transcript: List[Dict[str, Any]] = []
    actions: List[Dict[str, Any]] = []
    node_id = g.entry(stage)
    entry_node = g.node(node_id)
    if entry_node is not None:
        if entry_node.get("type") == "template":
            transcript.append({"from": "bot", "node_id": node_id, "kind": "template",
                               "text": (f"היי {vals['guest_name']}! {vals['host_name']} מזמינים אותך: "
                                        f"{vals['event_name']}, {vals['event_date']} בשעה {vals['event_time']}, "
                                        f"{vals['venue']} 🎉"),
                               "buttons": [{"id": q["id"], "label": q["label"]} for q in TEMPLATE_QUICK_REPLIES],
                               "note": "הודעת ההזמנה (תבנית מהקטלוג)"})
        else:
            r0 = enter(g, node_id, ctx, StepResult(node_id=node_id))
            transcript.extend(_bot_turn(s, vals) for s in r0.sends)
            node_id = r0.node_id
    for i, inp in enumerate(inputs or []):
        node = g.node(node_id) or {}
        kind = (inp or {}).get("kind")
        bid = str(inp.get("button_id") or "") if kind == "button" else None
        text_value = str(inp.get("text") or "") if kind == "text" else ""
        reply_kind = None
        if kind == "button":
            reply_kind = "button_reply"
            label = None
            if node.get("type") == "template" or bid in {q["id"] for q in TEMPLATE_QUICK_REPLIES}:
                q = next((q for q in TEMPLATE_QUICK_REPLIES if q["id"] == bid), None)
                if q:
                    label, reply_kind = q["label"], "template_button"
            if label is None and node.get("guest_questions") and ctx.questions and bid.isdigit():
                opts = ctx.questions[0]["options"]
                if int(bid) < len(opts):
                    label = opts[int(bid)]
                    bid = f"{QANS_PREFIX}{ctx.questions[0]['id']}__{bid}"
            if label is None:
                b = _match_button(g, node, Inbound(button_id=bid), dg) if node else None
                label = str(b.get("label")) if b else bid
            text_value = label
        action = resolve_rsvp_action(button_id=bid, button_payload=bid if reply_kind == "template_button" else None,
                                     text=text_value)
        inbound = Inbound(text=text_value, button_id=bid, action=_action_value(action), reply_kind=reply_kind)
        transcript.append({"from": "guest", "text": text_value, "tap": kind == "button", "turn": i})
        here = start_node(g, node_id, inbound, stage)
        res = step(g, here, inbound, ctx, dg)
        for eff in res.effects:
            actions.append({"turn": i, **{k: v for k, v in eff.items() if k != "turn"}})
        for s in res.sends:
            transcript.append(_bot_turn(s, vals))
        if not res.matched:
            transcript.append({"from": "system", "node_id": here, "text": "אין חיבור שמתאים לתשובה - הבוט לא עונה"})
        node_id = res.node_id or here
    return {"transcript": transcript, "turns": transcript, "actions": actions, "final_node": node_id,
            "questions_left": [q["id"] for q in ctx.questions]}


# ---------------------------------------------------------------------------
# Meta (admin UI)
# ---------------------------------------------------------------------------

def meta() -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "node_types": [
            {"type": "template", "label": "תבנית (הודעת קטלוג)", "note": "נקודת התחלה לטיפול בתשובה לתבנית; לא שולחת (אלא אם resend_template)"},
            {"type": "message", "label": "הודעה", "note": "שולחת טקסט (+כפתורים/רשימה). עם חיבור done ממשיכה מיד"},
            {"type": "question", "label": "שאלה", "note": "שולחת טקסט ומחכה לתשובה"},
            {"type": "end", "label": "סיום", "note": "השיחה הושלמה (עדיין מקשיבה דרך החיבורים שלה)"},
        ],
        "input_kinds": list(INPUT_KINDS),
        "edge_kinds": [
            {"kind": "button", "label": "לחיצה על כפתור", "fields": ["button_id"]},
            {"kind": "rsvp", "label": "תשובת הגעה (מגיע/לא/אולי)", "fields": ["value", "typed_only?"]},
            {"kind": "number", "label": "מספר תקין"},
            {"kind": "number_invalid", "label": "מספר לא תקין"},
            {"kind": "text_contains", "label": "הטקסט מכיל", "fields": ["words"]},
            {"kind": "any_text", "label": "כל תשובה אחרת"},
            {"kind": "done", "label": "המשך (סיום שאלות / דילוג / המשך הודעה)"},
            {"kind": "answered", "label": "שאלה לאורח נענתה (רק בצומת שאלות לאורחים)"},
        ],
        "match_order": ["button", "rsvp", "number", "number_invalid", "text_contains", "any_text"],
        "action_types": [
            {"type": "set_rsvp", "label": "עדכון סטטוס הגעה", "values": list(SET_RSVP_VALUES)},
            {"type": "set_field", "label": "עדכון שדה", "fields": ["field", "value"]},
            {"type": "add_tag", "label": "הוספת תגית", "fields": ["tag"]},
            {"type": "notify_host", "label": "הודעה למארח", "fields": ["text"],
             "note": "נשלח בוואטסאפ לבעלי האירוע בתבנית host_alert (פועל רק אחרי ש-Meta מאשרת את התבנית)"},
            {"type": "stop_reminders", "label": "הפסקת תזכורות",
             "note": f"מוסיף לאורח את התגית '{NO_REMINDERS_TAG}'"},
        ],
        "rsvp_values": list(RSVP_VALUES),
        "set_rsvp_values": list(SET_RSVP_VALUES),
        "fields": [{"field": k, "label": v["label"], "type": v["type"]} for k, v in GUEST_FIELDS.items()],
        "custom_field_prefix": CUSTOM_FIELD_PREFIX,
        "variables": [{"name": v, "label": VARIABLE_LABELS_HE.get(v, v)} for v in VARIABLES],
        "set_field_variables": list(SET_FIELD_VARS),
        "entry_stages": [
            {"stage": "invitation", "label": "הזמנה"},
            {"stage": "reminder", "label": "תזכורת"},
            {"stage": "final_reminder", "label": "תזכורת אחרונה"},
            {"stage": "default", "label": "ברירת מחדל"},
        ],
        "template_quick_replies": [dict(q) for q in TEMPLATE_QUICK_REPLIES],
        "limits": {"buttons": MAX_BUTTONS, "button_label": BUTTON_LABEL_MAX, "list_rows": MAX_LIST_ROWS,
                   "list_row_label": LIST_ROW_MAX, "interactive_body": INTERACTIVE_BODY_MAX, "text": TEXT_MAX,
                   "number_max": NUMBER_HARD_MAX, "nodes": MAX_NODES, "edges": MAX_EDGES,
                   "actions_per_edge": MAX_ACTIONS_PER_EDGE},
        "event_types": list(EVENT_TYPE_KEYS),
        "optional_node_fields": {
            "skip": "bool - pass straight through via the 'done' edge (a step turned off)",
            "hidden": "on a button: not shown, but a tap on an old message still routes",
            "answered": "confirmed|declined|maybe - a guest here has answered this (already-answered acknowledge)",
            "resend_template": "{name, language, params[]} - template node re-sends this template when entered",
            "list_button": "label of the list-open button (input=list)",
            "number": "{min, max}",
        },
        "optional_edge_fields": {"when.typed_only": "rsvp edge only for TYPED replies (not button taps)"},
    }


# ---------------------------------------------------------------------------
# DB readers (async, webhook-worker) + 60s cache
# ---------------------------------------------------------------------------

ACTIVE_ENABLED_SQL = (
    f"SELECT scope, scope_key, graph, version FROM {TABLE} "
    "WHERE is_active AND enabled AND ((scope = 'global' AND scope_key = 'default') "
    "OR (scope = 'event_type' AND scope_key = :etype) "
    "OR (scope = 'event' AND scope_key = :eid))"
)


@dataclass
class ResolvedGraph:
    graph: Graph
    scope: str
    scope_key: str
    version: int


_cache: Dict[str, Tuple[float, Optional[ResolvedGraph]]] = {}
_cache_lock = threading.Lock()
_MISS = object()


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


def cached_graph_for_event(event_id: Any) -> Any:
    """Cache peek (no I/O): a ResolvedGraph, None (= legacy), or _MISS."""
    with _cache_lock:
        hit = _cache.get(str(event_id or ""))
        if hit and hit[0] > time.monotonic():
            return hit[1]
    return _MISS


def is_miss(v: Any) -> bool:
    return v is _MISS


def _cache_put(event_id: Any, value: Optional[ResolvedGraph]) -> None:
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[str(event_id or "")] = (time.monotonic() + CACHE_TTL_SECONDS, value)


def coerce_json(v: Any) -> Optional[dict]:
    if v is None:
        return None
    if isinstance(v, dict):
        return v
    try:
        out = json.loads(v)
        return out if isinstance(out, dict) else None
    except (TypeError, ValueError):
        return None


def pick_graph(rows: List[Any]) -> Optional[ResolvedGraph]:
    """Most specific enabled+valid graph among active rows (event > type > global)."""
    order = {SCOPE_EVENT: 0, SCOPE_EVENT_TYPE: 1, SCOPE_GLOBAL: 2}
    parsed = []
    for r in rows:
        m = r._mapping if hasattr(r, "_mapping") else r
        parsed.append((order.get(m["scope"], 9), m))
    parsed.sort(key=lambda x: x[0])
    for _, m in parsed:
        g = coerce_json(m["graph"])
        if g is None or validate_graph(g)["errors"]:
            logger.error("flow_graph: ignoring invalid enabled graph %s/%s v%s", m["scope"], m["scope_key"],
                         m["version"])
            continue
        return ResolvedGraph(Graph(g), m["scope"], m["scope_key"], int(m["version"]))
    return None


async def aresolve_graph_for_event(conn: Any, event_id: Any, *, use_cache: bool = True) -> Optional[ResolvedGraph]:
    """The enabled graph for an event, or None (= legacy state machine).
    Pass a DEDICATED connection (failure rolls it back). Never raises."""
    eid = str(event_id or "")
    if use_cache:
        hit = cached_graph_for_event(eid)
        if hit is not _MISS:
            return hit
    try:
        from sqlalchemy import text as _text
        res = await conn.execute(_text(fc.EVENT_TYPE_SQL), {"eid": eid})
        row = res.first()
        etype = fc.normalize_event_type(row[0] if row else "")
        res = await conn.execute(_text(ACTIVE_ENABLED_SQL), {"etype": etype, "eid": eid})
        resolved = pick_graph(res.fetchall())
    except Exception as exc:  # table missing, DB hiccup -> legacy
        logger.warning("flow_graph: resolve failed (%s) - legacy flow", exc)
        try:
            await conn.rollback()
        except Exception:
            pass
        resolved = None
    if use_cache:
        _cache_put(eid, resolved)
    return resolved
