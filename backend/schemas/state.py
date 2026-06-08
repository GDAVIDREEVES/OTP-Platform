"""Request bodies for the Phase 2 state endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DraftIn(BaseModel):
    user_id: str
    process_id: str
    record_ref: str
    step: str
    step_index: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "in_progress"


class ReviewItemIn(BaseModel):
    process_id: str
    record_ref: str
    maker: str


class ReviewDecisionIn(BaseModel):
    checker: str
    comments: str | None = None


class PrepareIn(BaseModel):
    """Request for the Research Brain's agentic 'prepare steps' hand-off."""

    process_id: str
    record_ref: str
    entity_id: str | None = None
    gap_pp: float | None = None
    postings: int | None = None
    summary: str | None = None


class AskIn(BaseModel):
    """A process-aware TP knowledge question for the Research Brain."""

    question: str
    process_id: str | None = None
    jurisdiction: str | None = None
    tp_method: str | None = None


class EntityFunctionIn(BaseModel):
    rbukrs: str
    tp_function_code: str
    tested_party: bool = False
    applies_to: list[str] = Field(default_factory=list)
    is_primary: bool = False
    actor: str


class OverlayIn(BaseModel):
    policy_ref: str | None = None
    ica_ref: str | None = None
    apa_ref: str | None = None
    target_override: float | None = None
    notes: str | None = None
    actor: str


class MappingSubmitIn(BaseModel):
    maker: str


class MappingDecisionIn(BaseModel):
    checker: str
    comments: str | None = None


class PromoteFlowIn(BaseModel):
    flow_id: str
    payer_rbukrs: str
    counterparty_rbukrs: str
    label: str | None = None
    amount: float | None = None


class CaseIn(BaseModel):
    process_id: str
    kind: str
    title: str
    owner: str
    counterparty: str | None = None
    jurisdiction: str | None = None
    exposure: float | None = None
    due_at: str | None = None
    checklist: list[dict] = Field(default_factory=list)
    actor: str


class CaseStatusIn(BaseModel):
    status: str
    actor: str


class CaseStepIn(BaseModel):
    step_key: str
    done: bool
    actor: str
