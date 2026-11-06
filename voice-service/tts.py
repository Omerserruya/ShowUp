"""ElevenLabs TTS + the clip store.

Clips are content-addressed (shared.domain.voice_calls.clip_key): the same text
in the same voice is synthesized once and served forever from VOICE_CLIP_DIR
(a docker volume), at PUBLIC_BASE_URL/api/voice/clips/<key> for Twilio to fetch.

The voice is picked by NAME (VOICE_NAME, default "Nimrod"): first among the
account's own voices, then in the shared Voice Library (Hebrew), which is added
to the account so the API can use it. ELEVENLABS_VOICE_ID skips the lookup.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from shared.domain import voice_calls as vc

import db

log = logging.getLogger("voice.tts")

API = "https://api.elevenlabs.io"
CLIP_DIR = Path(os.getenv("VOICE_CLIP_DIR", "/data/clips"))
KV_VOICE = "elevenlabs.voice"
# Extra speed-up after synthesis, pitch kept (ffmpeg atempo). 1.0 = off.
TEMPO = float(os.getenv("VOICE_TEMPO", "1.1"))
# Everything that changes the sound is part of a clip's cache key.
VARIANT = f"{json.dumps(vc.VOICE_SETTINGS, sort_keys=True)}|t{TEMPO}"


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


def key_for(text: str, vid: str) -> str:
    """Where clip(text) lives: a WAV, keyed by text + voice + VARIANT."""
    return vc.clip_key(text, f"{vid}|{VARIANT}")[:-4] + ".wav"


def clip(text: str, vid: Optional[str] = None) -> str:
    """Ensure the clip exists on disk (WAV, sped up, edges trimmed); return its key."""
    vid = vid or voice_id()
    key = key_for(text, vid)
    path = CLIP_DIR / key
    if path.exists() and path.stat().st_size > 0:
        return key
    audio = _wav(trim_silence(pcm_clip(text, vid)))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(audio)
    tmp.replace(path)
    log.info("voice clip generated key=%s bytes=%d", key, len(audio))
    return key


def tempo(pcm: bytes, factor: float = None) -> bytes:
    """Speed 16-bit mono PCM up by `factor` keeping the pitch (ffmpeg atempo)."""
    factor = TEMPO if factor is None else factor
    if abs(factor - 1.0) < 1e-3 or not pcm:
        return pcm
    r = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "-i", "pipe:0",
         "-filter:a", f"atempo={factor}", "-f", "s16le", "-ar", str(PCM_RATE), "-ac", "1", "pipe:1"],
        input=pcm, capture_output=True, timeout=60)
    if r.returncode != 0 or not r.stdout:
        raise TTSError(f"tempo failed: {r.stderr[:200]!r}")
    return r.stdout


def clip_path(key: str) -> Optional[Path]:
    """Resolve a published key safely (no traversal)."""
    p = (CLIP_DIR / key).resolve()
    root = CLIP_DIR.resolve()
    if root not in p.parents or p.suffix not in (".mp3", ".wav") or not p.exists():
        return None
    return p


# ---- the opening, as ONE seamless file ----------------------------------------------------
# The opening is voiced in parts so each is generated once (greeting per name,
# body per event, the menu once - vc.opening_parts). Played as separate <Play>s
# the joins were audible: every clip carries its own lead-in/tail silence and
# Twilio adds a gap. So the parts are fetched as raw PCM, their edge silence is
# trimmed, and they are joined with a short breath-length gap into one WAV per
# (name, event) - no extra TTS cost, only disk. eleven_v3 has no request
# stitching (previous_text/next_text), so this is where continuity comes from.

PCM_RATE = 16000
_SILENCE = 350            # |sample| below this (16-bit) counts as silence
_KEEP_HEAD_MS = 15
_KEEP_TAIL_MS = 60        # keep the natural decay of the last syllable
GAP_MS = 140
# The opening plays the instant the guest picks up; a person waits for their
# "הלו" first. Without this the greeting talked over it.
LEAD_MS = 700


def _pcm_key(text: str, vid: str) -> str:
    return vc.clip_key(text, f"{vid}|pcm{PCM_RATE}|{VARIANT}")[:-4] + ".pcm"


def pcm_clip(text: str, vid: Optional[str] = None) -> bytes:
    vid = vid or voice_id()
    path = CLIP_DIR / _pcm_key(text, vid)
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    audio = tempo(synthesize_pcm(text, vid))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(audio)
    tmp.replace(path)
    log.info("voice pcm clip generated key=%s bytes=%d", path.name, len(audio))
    return audio


def synthesize_pcm(text: str, vid: str) -> bytes:
    body = {"text": text, "model_id": vc.TTS_MODEL, "language_code": vc.TTS_LANGUAGE,
            "voice_settings": vc.VOICE_SETTINGS}
    with _client() as c:
        r = c.post(f"/v1/text-to-speech/{vid}", params={"output_format": f"pcm_{PCM_RATE}"}, json=body)
    if r.status_code >= 400 or not r.content:
        raise TTSError(f"TTS failed: {r.status_code} {r.text[:300]}")
    return r.content


def trim_silence(pcm: bytes) -> bytes:
    """Cut leading/trailing silence of 16-bit mono PCM, keeping a few ms."""
    import array
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    loud = [i for i in range(0, len(a), 40) if abs(a[i]) > _SILENCE]
    if not loud:
        return pcm
    per_ms = PCM_RATE // 1000
    start = max(0, loud[0] - _KEEP_HEAD_MS * per_ms)
    end = min(len(a), loud[-1] + _KEEP_TAIL_MS * per_ms)
    return a[start:end].tobytes()


def _wav(pcm: bytes) -> bytes:
    import struct
    n = len(pcm)
    return (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, PCM_RATE, PCM_RATE * 2, 2, 16) + b"data" + struct.pack("<I", n) + pcm)


def stitched(parts: List[str], vid: Optional[str] = None) -> str:
    """One WAV of the parts, joined seamlessly; returns its clip key."""
    import hashlib
    vid = vid or voice_id()
    digest = hashlib.sha256(("\x00".join([vid, str(GAP_MS), str(LEAD_MS), VARIANT] + parts)).encode()).hexdigest()
    key = f"voice/{digest[:2]}/{digest}.wav"
    path = CLIP_DIR / key
    if path.exists() and path.stat().st_size > 0:
        return key
    gap = b"\x00\x00" * (PCM_RATE * GAP_MS // 1000)
    lead = b"\x00\x00" * (PCM_RATE * LEAD_MS // 1000)
    audio = lead + gap.join(trim_silence(pcm_clip(p, vid)) for p in parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(_wav(audio))
    tmp.replace(path)
    return key
