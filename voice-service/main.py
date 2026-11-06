"""voice-service - automated RSVP phone calls (Twilio + ElevenLabs).

Backend only. Four parts:
  * admin API  (/admin/*, admin JWT): voice check, test call, schedule / list /
    cancel an event's phone round, per-event on/off override.
  * Twilio webhooks (/twilio/*, X-Twilio-Signature): TwiML for each IVR step and
    the final status callback. The keypad answer is applied to the guest here.
  * public sample call (/public/demo-call): the landing page's "נסו שיחת טלפון".
  * dialer thread: starts due rounds, prepares clips, places calls inside the
    call window with a concurrency cap, retries unanswered calls.

nginx maps /api/voice/<path> -> this service's /<path>.
"""
from __future__ import annotations

import dataclasses
import hashlib
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from shared.auth.admin import get_admin_user_id
from shared.auth.middleware import AuthMiddleware
from shared.domain import round_plan
from shared.domain import voice_calls as vc
from shared.domain.delivery import canonical_phone_digits
from shared.domain.messaging.resolver import VariableResolver

import db
import telephony
import tts

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("voice")

IL = ZoneInfo("Asia/Jerusalem")
PUBLIC_BASE = (os.getenv("VOICE_PUBLIC_BASE_URL") or os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
PUBLIC_PREFIX = os.getenv("VOICE_PUBLIC_PREFIX", "/api/voice")
MAX_CONCURRENT = int(os.getenv("VOICE_MAX_CONCURRENT", "5"))
RETRY_MINUTES = int(os.getenv("VOICE_RETRY_MINUTES", "120"))
POLL_SECONDS = float(os.getenv("VOICE_POLL_SECONDS", "5"))
COST_PER_ANSWERED_ILS = float(os.getenv("VOICE_COST_PER_ANSWERED_ILS", "0.7"))
SKIP_SIGNATURE = os.getenv("VOICE_SKIP_SIGNATURE") == "1"   # tests only
DIALER_ENABLED = os.getenv("VOICE_DIALER_ENABLED", "1") == "1"
AUTO_PLAN_SECONDS = float(os.getenv("VOICE_AUTO_PLAN_SECONDS", "300"))
INTERNAL_SECRET = os.getenv("INTERNAL_API_SECRET") or ""
CORE_URL = (os.getenv("CORE_SERVICE_URL") or "http://core-service:8000").rstrip("/")

app = FastAPI(title="voice-service")
app.add_middleware(AuthMiddleware, allow_unauthenticated_paths=["/health"],
                   allow_unauthenticated_prefixes=["/twilio/", "/clips/", "/public/", "/internal/"])


def public_url(path: str) -> str:
    return f"{PUBLIC_BASE}{PUBLIC_PREFIX}{path}"


def clip_url(key: str) -> str:
    return public_url("/clips/" + key.removeprefix("voice/"))


def e164(phone: str) -> Optional[str]:
    d = canonical_phone_digits(phone)
    return f"+{d}" if len(d) >= 10 else None


def now_il() -> datetime:
    return datetime.now(timezone.utc).astimezone(IL)


# ---- script context -------------------------------------------------------------

def _local(value):
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(IL)
    return value


def event_context(event: Dict[str, Any], guest_name: str = "") -> Dict[str, Any]:
    vals = VariableResolver(dict(event), media_base="", public_base="").values_for({"name": guest_name})
    hosts = (vc.couple_with_last_names(event.get("subjects")) if event.get("event_type") == "wedding" else "") \
        or (vals.get("host_display_name") or "").strip()
    return {"event_type": event.get("event_type"), "hosts": hosts,
            "honoree": vals.get("celebrant_name") or vals.get("baby_name") or "",
            "event_date": _local(event.get("event_date"))}


def call_context(call: Dict[str, Any]) -> Dict[str, Any]:
    if call.get("is_test"):
        ctx = dict(call.get("test_context") or {})
        if call.get("event_id") and not ctx.get("hosts"):
            ev = db.get_event(str(call["event_id"]))
            if ev:
                ctx = {**event_context(ev), **{k: v for k, v in ctx.items() if v}}
        return ctx
    ev = db.get_event(str(call["event_id"])) or {}
    return event_context(ev, call.get("guest_name") or "")


def opening_clips(call: Dict[str, Any], inbound: bool = False) -> tuple[str, str]:
    """Voice the opening from cached parts (greeting per name, body per event, the
    menu - vc.opening_parts), joined into one seamless WAV -> (key, tone)."""
    ctx = call_context(call)
    vid = tts.voice_id()
    if ctx.get("demo"):
        return tts.stitched([vc.demo_opening_text(call.get("guest_name") or "")], vid), "demo"
    et = ctx.get("event_type")
    parts = vc.opening_parts(et, call.get("guest_name") or "", ctx.get("hosts") or "", ctx.get("event_date"),
                             ctx.get("honoree") or "", inbound=inbound)
    return tts.stitched(parts, vid), vc.tone_key(et)


def opening_for(call: Dict[str, Any], inbound: bool = False) -> tuple[str, str]:
    ctx = call_context(call)
    if ctx.get("demo"):
        return vc.demo_opening_text(call.get("guest_name") or ""), "demo"
    et = ctx.get("event_type")
    make = vc.inbound_opening_text if inbound else vc.opening_text
    text = make(et, call.get("guest_name") or "", ctx.get("hosts") or "", ctx.get("event_date"),
                ctx.get("honoree") or "")
    return text, vc.tone_key(et)


# ---- dialer -------------------------------------------------------------------------

def dial(call: Dict[str, Any]) -> None:
    cid = str(call["id"])
    try:
        if not call["is_test"] and call.get("guest_id") and not db.guest_still_pending(str(call["guest_id"])):
            db.mark_canceled(cid, "already_answered")
            return
        opening, tone = opening_clips(call)
        vid = tts.voice_id()
        for t in vc.fixed_texts(tone).values():
            tts.clip(t, vid)
        sid = telephony.place_call(call["phone"], public_url(f"/twilio/answer?c={cid}"),
                                   public_url(f"/twilio/status?c={cid}"), amd_url=public_url(f"/twilio/amd?c={cid}"))
        db.mark_dialing(cid, sid, opening, tone)
        log.info("voice call placed call=%s attempt=%s", cid, call["attempt"] + 1)
    except Exception as e:  # TTS / Twilio / DB - retry later, never lose the row
        log.warning("voice call failed to start call=%s: %s", cid, e)
        db.requeue_or_fail(cid, str(e), RETRY_MINUTES, vc.MAX_ATTEMPTS)


def plan_auto_rounds(now: Optional[datetime] = None) -> int:
    """Give every dated event its automatic phone rounds (round_plan.call_rounds)
    and re-plan them when the event date changes. Rounds the owner moved or
    added by hand are kept; a round the owner canceled is not brought back."""
    now = now or datetime.now(timezone.utc)
    made = 0
    for ev in db.auto_plan_candidates():
        allowed = vc.included_call_rounds(ev["plan_id"], ev["override"])
        starts = round_plan.call_rounds(ev["event_type"], ev["plan_id"], ev["event_date"], now, rounds=allowed) \
            if allowed else []
        made += db.replace_auto_rounds(str(ev["id"]), ev["event_date"], starts, allowed)
    if made:
        log.info("voice auto rounds planned: %d", made)
    return made


_last_plan = 0.0


def tick() -> int:
    global _last_plan
    if time.monotonic() - _last_plan >= AUTO_PLAN_SECONDS:
        _last_plan = time.monotonic()
        try:
            plan_auto_rounds()
        except Exception:
            log.exception("voice auto round planning failed")
    if not (telephony.configured() and tts.configured()):
        return 0
    db.start_due_rounds(e164)
    db.reap_stale()
    free = MAX_CONCURRENT - db.active_count()
    calls = db.claim_due(free, vc.is_call_time(now_il()))
    for c in calls:
        dial(c)
    return len(calls)


def _dialer_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            tick()
        except Exception:
            log.exception("voice dialer tick failed")
        stop.wait(POLL_SECONDS)


_stop = threading.Event()


@app.on_event("startup")
def _startup() -> None:
    try:
        from shared.obs import bootstrap
        bootstrap("voice-service")
    except Exception:
        pass
    db.ensure_schema()
    if DIALER_ENABLED:
        threading.Thread(target=_prewarm_clips, daemon=True, name="voice-prewarm").start()
        threading.Thread(target=_dialer_loop, args=(_stop,), daemon=True, name="voice-dialer").start()


def _prewarm_clips() -> None:
    """Shared clips for every tone, so a call back (no dial step to prepare
    them) never points Twilio at a clip that does not exist yet."""
    if not tts.configured():
        return
    try:
        vid = tts.voice_id()
        for tone in ("celebration", "family", "business", "demo"):
            for t in vc.fixed_texts(tone).values():
                tts.clip(t, vid)
        tts.clip(vc.UNKNOWN_CALLER_TEXT, vid)
    except Exception as e:  # best effort - dial() / call backs generate on demand
        log.warning("voice clip prewarm failed: %s", e)


@app.on_event("shutdown")
def _shutdown() -> None:
    _stop.set()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/clips/{a}/{b}")
def clips(a: str, b: str):
    p = tts.clip_path(f"voice/{a}/{b}")
    if not p:
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/wav" if p.suffix == ".wav" else "audio/mpeg",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ---- Twilio webhooks --------------------------------------------------------------------

async def twilio_params(request: Request) -> Dict[str, str]:
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    url = public_url(request.url.path + (f"?{request.url.query}" if request.url.query else ""))
    if not SKIP_SIGNATURE and not vc.valid_twilio_signature(
            telephony.auth_token(), url, params, request.headers.get("X-Twilio-Signature", "")):
        log.warning("voice webhook bad signature path=%s", request.url.path)
        raise HTTPException(403, "bad signature")
    return params


def _xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


def render(call: Dict[str, Any], step: vc.Step) -> Response:
    fixed = vc.fixed_texts(call.get("tone") or "family")
    vid = tts.voice_id()
    urls = tuple(clip_url(k) for n in step.play
                 for k in ((call["opening_clip"] or "").split("|") if n == "opening" else (tts.key_for(fixed[n], vid),)))
    action = None
    if step.gather:
        action = public_url(f"/twilio/step?c={call['id']}&s={step.gather}&t={step.tries}")
    return _xml(vc.twiml(urls, gather_action=action, count=step.gather == "count", hangup=step.hangup))


def _call_or_hangup(request: Request) -> Optional[Dict[str, Any]]:
    cid = request.query_params.get("c") or ""
    try:
        return db.get_call(cid)
    except Exception:
        return None


@app.post("/twilio/answer")
async def twilio_answer(request: Request):
    params = await twilio_params(request)
    call = _call_or_hangup(request)
    if not call or call["status"] == "canceled" or not call.get("opening_clip"):
        return _xml(vc.twiml((), hangup=True))
    answered_by = params.get("AnsweredBy") or None
    db.mark_in_progress(str(call["id"]), answered_by)
    if vc.result_from_status("in-progress", answered_by) == vc.CallResult.MACHINE:
        return _xml(vc.twiml((), hangup=True))
    return render(call, vc.on_answer())


@app.post("/twilio/amd")
async def twilio_amd(request: Request):
    """Async AMD verdict, while the opening is already playing. Voicemail -> hang
    up (finish_call then records MACHINE and retries). Never hang up on someone
    who already pressed a key - AMD misreads long hellos as machines."""
    params = await twilio_params(request)
    answered_by = params.get("AnsweredBy") or None
    row = db.set_answered_by(request.query_params.get("c") or "", answered_by)
    # "-" is a menu that timed out with no key: still nobody pressed (pilot: a
    # voicemail kept the menu playing for 71s because AMD came after one timeout).
    pressed = any(d.strip() not in ("", "-") for d in str((row or {}).get("digits") or "").split(","))
    if row and not pressed and not row["result"] \
            and vc.result_from_status("in-progress", answered_by) == vc.CallResult.MACHINE:
        try:
            telephony.hangup(params.get("CallSid") or row["twilio_sid"])
        except Exception as e:
            log.warning("voice hangup after machine failed call=%s: %s", row["id"], e)
    return Response(status_code=204)


@app.post("/twilio/step")
async def twilio_step(request: Request):
    params = await twilio_params(request)
    call = _call_or_hangup(request)
    if not call:
        return _xml(vc.twiml((), hangup=True))
    digits = params.get("Digits", "")
    try:
        tries = int(request.query_params.get("t", "1"))
    except ValueError:
        tries = 1
    db.record_digits(str(call["id"]), digits)
    step = vc.on_digits(request.query_params.get("s", ""), digits, tries)
    if step.result == vc.CallResult.WHATSAPP:
        step = dataclasses.replace(step, play=(_send_invitation_on_whatsapp(call),))
    if step.result:
        db.apply_result(str(call["id"]), step.result, step.count)
    return render(call, step)


# ---- calls back to our number ------------------------------------------------------------
# The Twilio number's Voice URL points here. A call back is about the last call we
# placed to that number (14 days); otherwise about the caller's upcoming
# invitations - one goes straight to it, several get a short "which event" menu.
# Anyone else hears who we are and how to answer on WhatsApp.

def _answer_inbound(sid: str, phone: str, *, guest_id: Optional[str] = None, event_id: Optional[str] = None,
                    guest_name: str = "", is_test: bool = False,
                    test_context: Optional[Dict[str, Any]] = None) -> Response:
    probe = {"is_test": is_test, "event_id": event_id, "test_context": test_context or {}, "guest_name": guest_name}
    opening, tone = opening_clips(probe, inbound=True)
    vid = tts.voice_id()
    for t in vc.fixed_texts(tone).values():
        tts.clip(t, vid)
    call = db.create_inbound_call(sid, phone, guest_id=guest_id, event_id=event_id, guest_name=guest_name,
                                  is_test=is_test, test_context=test_context, opening_clip=opening, tone=tone)
    log.info("voice call back answered call=%s guest=%s", call["id"], guest_id or "-")
    return render(call, vc.on_answer())


def _unknown_caller() -> Response:
    return _xml(vc.twiml((clip_url(tts.clip(vc.UNKNOWN_CALLER_TEXT, tts.voice_id())),), hangup=True))


def _choice_menu(invitations, tries: int) -> Response:
    hosts = [event_context(db.get_event(str(i["event_id"])) or {}).get("hosts") or "" for i in invitations]
    key = tts.clip(vc.inbound_choice_text(hosts), tts.voice_id())
    ids = ",".join(str(i["guest_id"]) for i in invitations)
    return _xml(vc.twiml((clip_url(key),), gather_action=public_url(f"/twilio/inbound/pick?g={ids}&t={tries}")))


@app.post("/twilio/inbound")
async def twilio_inbound(request: Request):
    params = await twilio_params(request)
    sid, phone = params.get("CallSid") or "", e164(params.get("From") or "")
    if not sid or not phone or not tts.configured():
        return _xml(vc.twiml((), hangup=True))
    try:
        recent = db.recent_outbound_call(phone)
        if recent:
            return _answer_inbound(sid, phone, guest_id=str(recent["guest_id"]) if recent["guest_id"] else None,
                                   event_id=str(recent["event_id"]) if recent["event_id"] else None,
                                   guest_name=recent["guest_name"] or "", is_test=recent["is_test"],
                                   test_context=recent["test_context"])
        invitations = db.guest_invitations(phone, vc.MAX_INBOUND_CHOICES)
        if len(invitations) == 1:
            i = invitations[0]
            return _answer_inbound(sid, phone, guest_id=str(i["guest_id"]), event_id=str(i["event_id"]),
                                   guest_name=i["guest_name"] or "")
        if invitations:
            return _choice_menu(invitations, 1)
        return _unknown_caller()
    except Exception:
        log.exception("voice call back failed sid=%s", sid)
        return _xml(vc.twiml((), hangup=True))


@app.post("/twilio/inbound/pick")
async def twilio_inbound_pick(request: Request):
    params = await twilio_params(request)
    sid, phone = params.get("CallSid") or "", e164(params.get("From") or "")
    ids = [g for g in (request.query_params.get("g") or "").split(",") if g][:vc.MAX_INBOUND_CHOICES]
    digit = (params.get("Digits") or "").strip()[:1]
    try:
        tries = int(request.query_params.get("t", "1"))
    except ValueError:
        tries = 1
    try:
        if digit.isdigit() and 1 <= int(digit) <= len(ids):
            i = db.get_invitation(ids[int(digit) - 1])
            if i and phone:
                return _answer_inbound(sid, phone, guest_id=str(i["guest_id"]), event_id=str(i["event_id"]),
                                       guest_name=i["guest_name"] or "")
        if tries < vc.MENU_TRIES and ids:
            invitations = [x for x in (db.get_invitation(g) for g in ids) if x]
            return _choice_menu(invitations, tries + 1)
        return _xml(vc.twiml((clip_url(tts.clip(vc.fixed_texts("family")["goodbye"], tts.voice_id())),),
                             hangup=True))
    except Exception:
        log.exception("voice call back pick failed sid=%s", sid)
        return _xml(vc.twiml((), hangup=True))


def _send_invitation_on_whatsapp(call: Dict[str, Any]) -> str:
    """Pressed 9: core sends the event's invitation to this guest (RSVP buttons
    answer for them). Returns the clip to play - never claims a send that failed."""
    if call.get("is_test") or not call.get("guest_id") or not call.get("event_id"):
        return "whatsapp_test"
    try:
        r = httpx.post(f"{CORE_URL}/internal/voice/send-invitation", timeout=6,
                       json={"event_id": str(call["event_id"]), "guest_id": str(call["guest_id"])},
                       headers={"X-Internal-Secret": INTERNAL_SECRET})
        if r.status_code == 200:
            return "whatsapp_sent"
        log.warning("voice whatsapp send refused call=%s status=%s", call["id"], r.status_code)
    except httpx.HTTPError as e:
        log.warning("voice whatsapp send failed call=%s: %s", call["id"], e)
    return "whatsapp_failed"


@app.post("/twilio/status")
async def twilio_status(request: Request):
    params = await twilio_params(request)
    sid = params.get("CallSid")
    if sid:
        try:
            duration = int(params.get("CallDuration") or 0)
        except ValueError:
            duration = 0
        db.finish_call(sid, params.get("CallStatus", ""), params.get("AnsweredBy"), duration, None,
                       RETRY_MINUTES, vc.MAX_ATTEMPTS)
    return Response(status_code=204)


# ---- admin API --------------------------------------------------------------------------

@app.get("/admin/status")
def admin_status(_: Any = Depends(get_admin_user_id)):
    return {
        "twilio_configured": telephony.configured(),
        "elevenlabs_configured": tts.configured(),
        "public_base_url": PUBLIC_BASE,
        "voice_name": os.getenv("VOICE_NAME") or vc.DEFAULT_VOICE_NAME,
        "voice_id": os.getenv("ELEVENLABS_VOICE_ID") or db.kv_get(tts.KV_VOICE),
        "call_window_open": vc.is_call_time(now_il()),
        "active_calls": db.active_count(),
    }


class VoiceCheck(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    text: Optional[str] = Field(default=None, max_length=400)
    use: bool = True


@app.post("/admin/voice-check")
def admin_voice_check(body: VoiceCheck, _: Any = Depends(get_admin_user_id)):
    """Find the voice by name, synthesize a Hebrew sample, return its URL."""
    try:
        v = tts.find_voice(body.name)
        text = body.text or vc.opening_text("wedding", "דנה", "מיכל ויוסי", "2026-11-12T19:30:00")
        key = tts.clip(text, v["voice_id"])
    except tts.TTSError as e:
        raise HTTPException(400, str(e))
    if body.use:
        db.kv_set(tts.KV_VOICE, v["voice_id"])
    return {"voice": v, "sample_text": text, "sample_url": clip_url(key), "in_use": body.use}


class TestCall(BaseModel):
    phone: str = Field(..., max_length=32)
    name: str = Field(default="", max_length=80)
    event_id: Optional[str] = None
    event_type: Optional[str] = Field(default="wedding", max_length=20)
    hosts: Optional[str] = Field(default=None, max_length=120)
    event_date: Optional[str] = Field(default=None, max_length=40)


@app.post("/admin/test-call")
def admin_test_call(body: TestCall, _: Any = Depends(get_admin_user_id)):
    """Call one number now (ignores the call window; never touches a guest)."""
    phone = e164(body.phone)
    if not phone:
        raise HTTPException(400, "invalid phone")
    ctx = {"event_type": body.event_type, "hosts": body.hosts or ("" if body.event_id else "מיכל ויוסי"),
           "event_date": body.event_date}
    row = db.create_test_call(phone, body.name, ctx, body.event_id)
    text, _tone = opening_for({**row, "is_test": True, "event_id": body.event_id,
                               "test_context": ctx, "guest_name": body.name})
    return {"call": row, "opening_text": text,
            "will_dial": telephony.configured() and tts.configured()}


# ---- owner API (via core, which checks event permissions) ------------------------------
# core-service proxies /events/{id}/call-rounds here with X-Internal-Secret after
# its RBAC check; this service never sees the owner's JWT.

def _internal(secret: Optional[str]) -> None:
    import hmac as _hmac
    if not INTERNAL_SECRET:
        raise HTTPException(503, "internal auth not configured")
    if not _hmac.compare_digest(str(secret or ""), INTERNAL_SECRET):
        raise HTTPException(403, "forbidden")


def _when(value: datetime, ev: Dict[str, Any]) -> datetime:
    at = value if value.tzinfo else value.replace(tzinfo=IL)
    if at <= datetime.now(timezone.utc):
        raise HTTPException(422, {"error": "in_past"})
    if ev.get("event_date") and at >= ev["event_date"]:
        raise HTTPException(422, {"error": "after_event"})
    return at


@app.get("/internal/events/{event_id}/call-rounds")
def owner_list(event_id: str, x_internal_secret: Optional[str] = Header(None)):
    _internal(x_internal_secret)
    ev = _event_or_404(event_id)
    guests = db.pending_guests(event_id)
    return {**_allowance(ev), "pending_guests": len(guests), "rounds": db.list_rounds(event_id),
            "call_hours": {"start": vc.CALL_HOURS[0], "end": vc.CALL_HOURS[1], "friday_end": vc.FRIDAY_LAST_HOUR}}


class OwnerRoundIn(BaseModel):
    start_at: datetime
    created_by: Optional[str] = None


@app.post("/internal/events/{event_id}/call-rounds", status_code=201)
def owner_add(event_id: str, body: OwnerRoundIn, x_internal_secret: Optional[str] = Header(None)):
    _internal(x_internal_secret)
    ev = _event_or_404(event_id)
    if not _allowance(ev)["can_schedule"]:
        raise HTTPException(409, {"error": "no_phone_rounds_left"})
    return db.add_round(event_id, _when(body.start_at, ev), body.created_by)


def _owned_round(event_id: str, round_id: str) -> Dict[str, Any]:
    r = db.get_round(round_id)
    if not r or str(r["event_id"]) != event_id:
        raise HTTPException(404, "round not found")
    return r


@app.put("/internal/events/{event_id}/call-rounds/{round_id}")
def owner_move(event_id: str, round_id: str, body: OwnerRoundIn, x_internal_secret: Optional[str] = Header(None)):
    _internal(x_internal_secret)
    ev = _event_or_404(event_id)
    _owned_round(event_id, round_id)
    if not db.move_round(round_id, _when(body.start_at, ev)):
        raise HTTPException(409, {"error": "already_started"})
    return db.get_round(round_id)


@app.post("/internal/events/{event_id}/call-rounds/{round_id}/cancel")
def owner_cancel(event_id: str, round_id: str, x_internal_secret: Optional[str] = Header(None)):
    _internal(x_internal_secret)
    _owned_round(event_id, round_id)
    return {"canceled_calls": db.cancel_round(round_id)}


# ---- public sample call (landing page) ---------------------------------------------
# Anyone can type a name + number, so this is the abuse-sensitive door: Israeli
# mobiles only, sociable hours only, one call per number a day (3 a week), 3
# per IP a day, and a global daily cap. The call says up front that it was
# requested on the site, and only a short letters-only first name is spoken.
DEMO_DAILY_CAP = int(os.getenv("VOICE_DEMO_DAILY_CAP", "60"))
DEMO_PER_IP_DAY = 3


class DemoCall(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    phone: str = Field(..., min_length=9, max_length=20)


def _client_ip(request: Request) -> str:
    return (request.headers.get("X-Real-IP") or (request.client.host if request.client else "") or "").strip()


def local_number(e164_number: str) -> str:
    d = canonical_phone_digits(e164_number)
    if d.startswith("972"):
        d = "0" + d[3:]
    return f"{d[:2]}-{d[2:]}" if len(d) == 9 else (f"{d[:3]}-{d[3:]}" if len(d) == 10 else d)


@app.post("/public/demo-call", status_code=202)
def public_demo_call(body: DemoCall, request: Request):
    phone = e164(body.phone)
    if not phone or not phone.startswith("+9725") or len(phone) != 13:
        raise HTTPException(400, {"error": "israeli_mobile_required"})
    if not (telephony.configured() and tts.configured()):
        raise HTTPException(503, {"error": "unavailable"})
    if not vc.is_demo_call_time(now_il()):
        raise HTTPException(409, {"error": "outside_hours"})
    ip_hash = hashlib.sha256(_client_ip(request).encode("utf-8")).hexdigest()[:24]
    # A lead even when we can't call right now (night, busy, already called).
    db.record_demo_lead(body.name, phone, ip_hash, request.headers.get("User-Agent"))
    usage = db.demo_usage(phone, ip_hash)
    if usage["phone_day"] >= 1 or usage["phone_week"] >= 3:
        raise HTTPException(429, {"error": "already_called"})
    if usage["ip_day"] >= DEMO_PER_IP_DAY or usage["all_day"] >= DEMO_DAILY_CAP:
        raise HTTPException(429, {"error": "busy"})
    db.create_test_call(phone, body.name.strip(), {"demo": True, "ip": ip_hash}, None)
    log.info("voice demo call queued to=%s…%s", phone[:5], phone[-2:])
    return {"status": "calling", "from": local_number(telephony.from_number())}


@app.get("/admin/calls/{call_id}")
def admin_get_call(call_id: str, _: Any = Depends(get_admin_user_id)):
    c = db.get_call(call_id)
    if not c:
        raise HTTPException(404)
    return c


def _allowance(event: Dict[str, Any]) -> Dict[str, Any]:
    eid = str(event["id"])
    override = db.event_override(eid)
    allowed = vc.included_call_rounds(event.get("plan_id"), override)
    used = db.rounds_used(eid)
    return {"plan_id": event.get("plan_id"), "override": override, "rounds_allowed": allowed,
            "rounds_used": used, "can_schedule": used < allowed}


def _event_or_404(event_id: str) -> Dict[str, Any]:
    try:
        ev = db.get_event(event_id)
    except Exception:
        ev = None
    if not ev:
        raise HTTPException(404, "event not found")
    return ev


@app.get("/admin/events/{event_id}/preview")
def admin_preview(event_id: str, _: Any = Depends(get_admin_user_id)):
    ev = _event_or_404(event_id)
    guests = db.pending_guests(event_id)
    ctx = event_context(ev, guests[0]["name"] if guests else "")
    sample = vc.opening_text(ctx["event_type"], guests[0]["name"] if guests else "", ctx["hosts"],
                             ctx["event_date"], ctx["honoree"])
    return {**_allowance(ev), "pending_guests": len(guests),
            "callable": sum(1 for g in guests if e164(g["phone"])),
            "sample_opening": sample, "tone": vc.tone_key(ev.get("event_type")),
            "estimated_cost_ils": round(len(guests) * COST_PER_ANSWERED_ILS, 2)}


class RoundIn(BaseModel):
    start_at: Optional[datetime] = None


@app.post("/admin/events/{event_id}/rounds", status_code=201)
def admin_create_round(event_id: str, body: RoundIn, user_id: Any = Depends(get_admin_user_id)):
    ev = _event_or_404(event_id)
    allow = _allowance(ev)
    if not allow["can_schedule"]:
        raise HTTPException(409, {"error": "no_phone_rounds_left", **allow})
    guests = db.pending_guests(event_id)
    if not guests:
        raise HTTPException(409, {"error": "no_pending_guests"})
    start = body.start_at or datetime.now(timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=IL)
    return db.create_round(event_id, start, str(user_id), guests, e164)


@app.get("/admin/events/{event_id}/rounds")
def admin_list_rounds(event_id: str, _: Any = Depends(get_admin_user_id)):
    ev = _event_or_404(event_id)
    return {**_allowance(ev), "rounds": db.list_rounds(event_id)}


@app.post("/admin/rounds/{round_id}/cancel")
def admin_cancel_round(round_id: str, _: Any = Depends(get_admin_user_id)):
    return {"canceled_calls": db.cancel_round(round_id)}


class SettingsIn(BaseModel):
    enabled: Optional[bool] = None


@app.put("/admin/events/{event_id}/settings")
def admin_settings(event_id: str, body: SettingsIn, _: Any = Depends(get_admin_user_id)):
    ev = _event_or_404(event_id)
    db.set_event_override(event_id, body.enabled)
    return _allowance(ev)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8090")))
