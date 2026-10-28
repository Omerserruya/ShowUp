"""voice-service - automated RSVP phone calls (Twilio + ElevenLabs).

Backend only. Three parts:
  * admin API  (/admin/*, admin JWT): voice check, test call, schedule / list /
    cancel an event's phone round, per-event on/off override.
  * Twilio webhooks (/twilio/*, X-Twilio-Signature): TwiML for each IVR step and
    the final status callback. The keypad answer is applied to the guest here.
  * dialer thread: starts due rounds, prepares clips, places calls inside the
    call window with a concurrency cap, retries unanswered calls.

nginx maps /api/voice/<path> -> this service's /<path>.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from shared.auth.admin import get_admin_user_id
from shared.auth.middleware import AuthMiddleware
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

app = FastAPI(title="voice-service")
app.add_middleware(AuthMiddleware, allow_unauthenticated_paths=["/health"],
                   allow_unauthenticated_prefixes=["/twilio/", "/clips/"])


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
    hosts = (vals.get("host_display_name") or "").strip()
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


def opening_for(call: Dict[str, Any]) -> tuple[str, str]:
    ctx = call_context(call)
    et = ctx.get("event_type")
    text = vc.opening_text(et, call.get("guest_name") or "", ctx.get("hosts") or "", ctx.get("event_date"),
                           ctx.get("honoree") or "")
    return text, vc.tone_key(et)


# ---- dialer -------------------------------------------------------------------------

def dial(call: Dict[str, Any]) -> None:
    cid = str(call["id"])
    try:
        if not call["is_test"] and call.get("guest_id") and not db.guest_still_pending(str(call["guest_id"])):
            db.mark_canceled(cid, "already_answered")
            return
        text, tone = opening_for(call)
        vid = tts.voice_id()
        opening = tts.clip(text, vid)
        for t in vc.fixed_texts(tone).values():
            tts.clip(t, vid)
        sid = telephony.place_call(call["phone"], public_url(f"/twilio/answer?c={cid}"),
                                   public_url(f"/twilio/status?c={cid}"))
        db.mark_dialing(cid, sid, opening, tone)
        log.info("voice call placed call=%s attempt=%s", cid, call["attempt"] + 1)
    except Exception as e:  # TTS / Twilio / DB - retry later, never lose the row
        log.warning("voice call failed to start call=%s: %s", cid, e)
        db.requeue_or_fail(cid, str(e), RETRY_MINUTES, vc.MAX_ATTEMPTS)


def tick() -> int:
    if not (telephony.configured() and tts.configured()):
        return 0
    db.start_due_rounds()
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
        threading.Thread(target=_dialer_loop, args=(_stop,), daemon=True, name="voice-dialer").start()


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
    return FileResponse(p, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


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
    urls = tuple(clip_url(call["opening_clip"] if n == "opening" else vc.clip_key(fixed[n], vid)) for n in step.play)
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
    if step.result:
        db.apply_result(str(call["id"]), step.result, step.count)
    return render(call, step)


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
