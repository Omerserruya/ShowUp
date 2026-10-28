"""ElevenLabs TTS + the clip store.

Clips are content-addressed (shared.domain.voice_calls.clip_key): the same text
in the same voice is synthesized once and served forever from VOICE_CLIP_DIR
(a docker volume), at PUBLIC_BASE_URL/api/voice/clips/<key> for Twilio to fetch.

The voice is picked by NAME (VOICE_NAME, default "Nimrod"): first among the
account's own voices, then in the shared Voice Library (Hebrew), which is added
to the account so the API can use it. ELEVENLABS_VOICE_ID skips the lookup.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from shared.domain import voice_calls as vc

import db

log = logging.getLogger("voice.tts")

API = "https://api.elevenlabs.io"
CLIP_DIR = Path(os.getenv("VOICE_CLIP_DIR", "/data/clips"))
KV_VOICE = "elevenlabs.voice"


class TTSError(RuntimeError):
    pass


def api_key() -> str:
    return (os.getenv("ELEVENLABS_API_KEY") or "").strip()


def configured() -> bool:
    return bool(api_key())


def _client() -> httpx.Client:
    return httpx.Client(base_url=API, headers={"xi-api-key": api_key()}, timeout=60)


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _name_matches(voice_name: str, wanted: str) -> bool:
    n, w = _norm(voice_name), _norm(wanted)
    return bool(w) and (n == w or n.startswith(w + " ") or n.startswith(w + "-") or w in n.split())


def find_voice(wanted: Optional[str] = None) -> Dict[str, Any]:
    """Locate the voice and return {voice_id, name, source, language, preview_url}.
    Adds a shared-library voice to the account when needed. Raises TTSError."""
    wanted = wanted or os.getenv("VOICE_NAME") or vc.DEFAULT_VOICE_NAME
    if not configured():
        raise TTSError("ELEVENLABS_API_KEY is not set")
    with _client() as c:
        r = c.get("/v1/voices")
        if r.status_code == 401:
            raise TTSError("ElevenLabs rejected the API key (401)")
        r.raise_for_status()
        for v in r.json().get("voices", []):
            if _name_matches(v.get("name", ""), wanted):
                return {"voice_id": v["voice_id"], "name": v.get("name"), "source": "account",
                        "language": (v.get("labels") or {}).get("language"), "preview_url": v.get("preview_url")}
        matches: List[Dict[str, Any]] = []
        for params in ({"search": wanted, "language": "he", "page_size": 50}, {"search": wanted, "page_size": 50}):
            r = c.get("/v1/shared-voices", params=params)
            r.raise_for_status()
            matches = [v for v in r.json().get("voices", []) if _name_matches(v.get("name", ""), wanted)]
            if matches:
                break
        if not matches:
            raise TTSError(f'No ElevenLabs voice named "{wanted}" (account or shared library)')
        # Prefer Hebrew, then the most used.
        matches.sort(key=lambda v: (_norm(v.get("language")) != "he", -(v.get("cloned_by_count") or 0)))
        v = matches[0]
        r = c.post(f"/v1/voices/add/{v['public_owner_id']}/{v['voice_id']}", json={"new_name": v.get("name") or wanted})
        if r.status_code >= 400:
            raise TTSError(f"Could not add library voice {v.get('name')}: {r.status_code} {r.text[:200]}")
        added = r.json().get("voice_id") or v["voice_id"]
        return {"voice_id": added, "name": v.get("name"), "source": "library",
                "language": v.get("language"), "preview_url": v.get("preview_url")}


def voice_id() -> str:
    explicit = (os.getenv("ELEVENLABS_VOICE_ID") or "").strip()
    if explicit:
        return explicit
    cached = db.kv_get(KV_VOICE)
    if cached:
        return cached
    v = find_voice()
    db.kv_set(KV_VOICE, v["voice_id"])
    return v["voice_id"]


def synthesize(text: str, vid: str) -> bytes:
    body = {"text": text, "model_id": vc.TTS_MODEL, "language_code": vc.TTS_LANGUAGE,
            "voice_settings": vc.VOICE_SETTINGS}
    with _client() as c:
        r = c.post(f"/v1/text-to-speech/{vid}", params={"output_format": vc.TTS_OUTPUT_FORMAT}, json=body)
    if r.status_code >= 400:
        raise TTSError(f"TTS failed: {r.status_code} {r.text[:300]}")
    if not r.content:
        raise TTSError("TTS returned no audio")
    return r.content


def clip(text: str, vid: Optional[str] = None) -> str:
    """Ensure the clip exists on disk; return its key."""
    vid = vid or voice_id()
    key = vc.clip_key(text, vid)
    path = CLIP_DIR / key
    if path.exists() and path.stat().st_size > 0:
        return key
    audio = synthesize(text, vid)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(audio)
    tmp.replace(path)
    log.info("voice clip generated key=%s bytes=%d", key, len(audio))
    return key


def clip_path(key: str) -> Optional[Path]:
    """Resolve a published key safely (no traversal)."""
    p = (CLIP_DIR / key).resolve()
    root = CLIP_DIR.resolve()
    if root not in p.parents or p.suffix != ".mp3" or not p.exists():
        return None
    return p
