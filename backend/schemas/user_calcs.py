"""Request bodies for the user-calculation endpoints (Phase 5 W3)."""

from __future__ import annotations

from pydantic import BaseModel


class UserCalcIn(BaseModel):
    """Create a draft calculation. The expression must validate (every term
    resolvable) or the request is rejected with the full error list."""

    name: str
    expression: str
    description: str | None = None
    process_id: str | None = None
    output_grain: str = "group"
    actor: str


class UserCalcPatch(BaseModel):
    """Edit a calculation; omitted fields keep their current value. Editing an
    active calculation bumps the version and returns it to draft."""

    name: str | None = None
    description: str | None = None
    expression: str | None = None
    output_grain: str | None = None
    process_id: str | None = None
    actor: str


class ExpressionIn(BaseModel):
    """Validate an expression (syntax + term resolution; nothing persists)."""

    expression: str


class PreviewIn(BaseModel):
    """Evaluate an expression — the wizard's "Show". Nothing persists."""

    expression: str


class TestRunIn(BaseModel):
    """Run a draft's expression and mark it tested (the activation gate)."""

    actor: str


class SubmitActivationIn(BaseModel):
    """Submit a tested calculation for activation (maker-checker review)."""

    maker: str
