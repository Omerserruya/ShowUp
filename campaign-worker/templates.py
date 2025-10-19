from __future__ import annotations

import logging
from typing import Dict, Any, List

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


class TemplateSpec(BaseModel):
    name: str
    required_params: List[str] = Field(default_factory=list)
    defaults: Dict[str, Any] = Field(default_factory=dict)


def validate_params(spec: TemplateSpec, params: Dict[str, Any]) -> None:
    missing = [p for p in spec.required_params if p not in params or params[p] in (None, "")]
    if missing:
        raise ValueError(f"Missing required template params: {', '.join(missing)}")


def merge_params(spec: TemplateSpec, params: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**spec.defaults, **(params or {})}
    validate_params(spec, merged)
    return merged


def build_whatsapp_template_payload(template_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    # Minimal, generic WhatsApp template payload structure
    # Align with WhatsApp Cloud API template payload
    return {
        "template": {
            "name": template_name,
            "language": {"code": params.get("lang", "en_US")},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": str(params[k])}
                        for k in params
                        if k not in ("lang",)
                    ],
                }
            ],
        }
    }


