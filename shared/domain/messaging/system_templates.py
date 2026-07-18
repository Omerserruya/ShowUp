"""System / owner-notification WhatsApp templates (SSOT loader).

Owner-facing business-initiated messages (team invite, AI-assistant intro,
daily summary) live in `shared/content/system_templates.yaml` - deliberately
outside the guest messaging catalog, which is Stage x EventType x Variant.
This loader is the single way services resolve a system template's Meta name,
language and parameter contract, so the copy, the approved Meta template and
every sender always agree.

Env overrides (ops): WA_SYSTEM_TEMPLATE_<KIND> replaces the Meta template name
for one kind, e.g. WA_SYSTEM_TEMPLATE_DAILY_SUMMARY=daily_summary_v3.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

import yaml

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "content" / "system_templates.yaml"
SYSTEM_TEMPLATES_PATH = Path(os.getenv("SYSTEM_TEMPLATES_PATH", str(_DEFAULT_PATH)))

_cache: Optional[Dict[str, "SystemTemplate"]] = None


@dataclass(frozen=True)
class SystemTemplate:
    key: str
    meta_name: str
    meta_category: str
    language: str
    body: str
    params: Dict[str, str]  # positional param -> human description

    @property
    def param_count(self) -> int:
        return len(self.params)


def _load() -> Dict[str, SystemTemplate]:
    global _cache
    if _cache is not None:
        return _cache
    raw = yaml.safe_load(SYSTEM_TEMPLATES_PATH.read_text(encoding="utf-8")) or {}
    out: Dict[str, SystemTemplate] = {}
    for key, t in (raw.get("templates") or {}).items():
        meta = t.get("meta") or {}
        env_override = os.getenv(f"WA_SYSTEM_TEMPLATE_{key.upper()}")
        out[key] = SystemTemplate(
            key=key,
            meta_name=env_override or meta.get("name") or key,
            meta_category=meta.get("category") or "UTILITY",
            language=t.get("language") or "he",
            body=t.get("body") or "",
            params={str(k): str(v) for k, v in (t.get("params") or {}).items()},
        )
    _cache = out
    return out


def get_system_template(key: str) -> Optional[SystemTemplate]:
    """The system template for `key` ('team_invite', 'assistant_intro',
    'daily_summary'), or None if the catalog doesn't define it."""
    return _load().get(key)


def all_system_templates() -> Dict[str, SystemTemplate]:
    return dict(_load())
