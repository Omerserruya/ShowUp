"""Messaging SSOT - the single source of truth for the whole platform's
templates, flow stages, variables and Meta mappings.

Before this package there were three stage vocabularies, two variable systems,
a hardcoded worker registry and a design/send disconnect (see the template
audit). Everything now resolves from here:

    Wizard → Campaign → Planner → Worker → Outpost → Meta

all read the same catalog, the same stages, the same variables and the same
Meta mapping. Nothing else defines templates.

Public surface:
    stages        - FlowStage (canonical) + legacy alias resolution
    event_types   - EventType registry (one place, no duplicate label maps)
    variables     - canonical logical variable names + metadata
    catalog       - Template + MetaMapping + the built-in catalog
    resolver      - resolve any (legacy or canonical) template ref; resolve
                    canonical variable values from an event + guest
    meta_adapter  - turn a template + resolved variables into a Meta payload
                    (the ONLY place that knows Meta slot numbers)
"""
from .stages import FlowStage, canonical_stage, STAGE_ALIASES
from .event_types import EventType, EVENT_TYPES, event_type_of, event_type_meta
from .variables import Variable, VARIABLES, variable_meta
from .catalog import (
    Template,
    MetaMapping,
    MetaConfig,
    DeliveryKind,
    TemplateCategory,
    Tone,
    CtaType,
    Preview,
    QuickReplyButton,
    UrlButton,
    BUILTIN_CATALOG,
    builtin_by_key,
    builtin_by_meta_name,
    usable_templates,
    default_for_stage,
    stage_recommended_for,
    resolve_event_variant,
    effective_variants_for,
    EVENT_CATALOG,
    ALL_TEMPLATES,
    AVAILABILITY,
    RECOMMENDATIONS,
    BASE_EVENT_TYPE,
    SCHEMA_VERSION,
    CATALOG_VERSION,
)
from .validation import validate_catalog, assert_valid
from .publishing import (
    InternalStatus,
    MetaStatus,
    MetaCategory,
    can_transition,
    default_internal_status,
    default_meta_status,
    compute_checksum,
    build_create_payload,
    select_templates,
    published_name,
    has_placeholder,
    PUBLISHABLE_STATUSES,
)
from .resolver import resolve_template, prefer_event_variant, VariableResolver
from .meta_adapter import build_meta_parameters, build_meta_message, build_free_text
from .stage_definitions import (
    StageDefinition,
    Variant,
    ChannelImpl,
    Trigger,
    AudienceRule,
    CompletionRule,
    FlowStep,
    STAGE_DEFINITIONS,
    DEFAULT_VARIANTS,
    default_variant_for,
    stage_by_id,
    stage_variant_for_template,
    resolve_stage_channel,
    resolve_audience_rule,
)

__all__ = [
    "FlowStage", "canonical_stage", "STAGE_ALIASES",
    "EventType", "EVENT_TYPES", "event_type_of", "event_type_meta",
    "Variable", "VARIABLES", "variable_meta",
    "Template", "MetaMapping", "MetaConfig", "DeliveryKind",
    "TemplateCategory", "Tone", "CtaType", "Preview", "QuickReplyButton", "UrlButton",
    "SCHEMA_VERSION", "CATALOG_VERSION",
    "InternalStatus", "MetaStatus", "MetaCategory",
    "can_transition", "default_internal_status", "default_meta_status",
    "compute_checksum", "build_create_payload", "select_templates",
    "published_name", "has_placeholder",
    "PUBLISHABLE_STATUSES",
    "BUILTIN_CATALOG", "builtin_by_key", "builtin_by_meta_name",
    "usable_templates", "default_for_stage",
    "stage_recommended_for", "resolve_event_variant", "effective_variants_for",
    "EVENT_CATALOG", "ALL_TEMPLATES",
    "AVAILABILITY", "RECOMMENDATIONS", "BASE_EVENT_TYPE",
    "validate_catalog", "assert_valid",
    "resolve_template", "prefer_event_variant", "VariableResolver",
    "build_meta_parameters", "build_meta_message", "build_free_text",
    "StageDefinition", "Variant", "ChannelImpl",
    "Trigger", "AudienceRule", "CompletionRule", "FlowStep",
    "STAGE_DEFINITIONS", "DEFAULT_VARIANTS", "default_variant_for",
    "stage_by_id", "stage_variant_for_template",
    "resolve_stage_channel", "resolve_audience_rule",
]
