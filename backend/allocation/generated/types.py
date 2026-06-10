"""GENERATED - do not edit. Rendered by allocation/codegen.py from docs/allocation/intercompany-allocation-schema.json.

TypedDicts mirror the entity sheets field-for-field (snake_case data_element
names). Decimal/Percent fields are exact decimal STRINGS; never floats.
"""

from __future__ import annotations

from enum import Enum
from typing import NotRequired, TypedDict

SCHEMA_SHA256 = "75225bb2db361e0856dce7db047260264deccfd3018ef00009f50c7ba4443d3b"

class FlowType(str, Enum):
    """Enumeration "flow_type" (used in: 1_CostLine)."""

    SERVICE = "Service"
    GOODS = "Goods"
    ROYALTY = "Royalty"
    CSA = "CSA"
    FINANCING = "Financing"


class CostNature(str, Enum):
    """Enumeration "cost_nature" (used in: 1_CostLine)."""

    PAYROLL = "Payroll"
    DEPRECIATION = "Depreciation"
    THIRD_PARTY_FEE = "Third-party fee"
    TRAVEL = "Travel"
    SOFTWARE = "Software"
    FACILITIES = "Facilities"
    INTERCOMPANY_CHARGE_RECEIVED = "Intercompany charge received"
    OTHER = "Other"


class FunctionServiceLine(str, Enum):
    """Enumeration "function / service_line" (used in: 1,2,3)."""

    IT = "IT"
    HR = "HR"
    FINANCE = "Finance"
    LEGAL = "Legal"
    PROCUREMENT = "Procurement"
    MARKETING_SUPPORT = "Marketing (support)"
    MANAGEMENT = "Management"
    FACILITIES = "Facilities"
    R_D_SUPPORT = "R&D support"


class ChargeMethod(str, Enum):
    """Enumeration "charge_method" (used in: 1_CostLine, 3_Pool)."""

    DIRECT = "Direct"
    INDIRECT = "Indirect"


class Characterization(str, Enum):
    """Enumeration "characterization" (used in: 3_Pool)."""

    ROUTINE_BENCHMARKED = "Routine-benchmarked"
    LVAIGS = "LVAIGS"
    SCM = "SCM"
    PASS_THROUGH = "Pass-through"


class CoreOrSupport(str, Enum):
    """Enumeration "core_or_support" (used in: 3_Pool)."""

    CORE = "Core"
    SUPPORT = "Support"


class CostBaseDefinition(str, Enum):
    """Enumeration "cost_base_definition" (used in: 3_Pool)."""

    FULL_COST = "Full cost"
    TOTAL_SERVICES_COST = "Total services cost"
    MARGINAL_COST = "Marginal cost"


class Regime(str, Enum):
    """Enumeration "regime" (used in: 4_MarkupPolicy)."""

    LVAIGS_5 = "LVAIGS (5%)"
    SCM_0 = "SCM (0%)"
    BENCHMARKED = "Benchmarked"
    PASS_THROUGH_0 = "Pass-through (0%)"


class ScmEligibilityBasis(str, Enum):
    """Enumeration "scm_eligibility_basis" (used in: 4_MarkupPolicy)."""

    SPECIFIED_COVERED_SERVICE_IRS_LIST = "Specified covered service (IRS list)"
    LOW_MARGIN_7 = "Low-margin <=7%"
    N_A = "n/a"


class ExclusionType(str, Enum):
    """Enumeration "exclusion_type" (used in: 5_Exclusions)."""

    STEWARDSHIP = "Stewardship"
    DUPLICATIVE = "Duplicative"
    INCIDENTAL_PASSIVE_ASSOCIATION = "Incidental/passive association"
    ON_CALL = "On-call"


class KeyFactor(str, Enum):
    """Enumeration "key_factor" (used in: 6_KeyDef)."""

    HEADCOUNT = "Headcount"
    REVENUE = "Revenue"
    TOTAL_COST = "Total cost"
    SEATS = "Seats"
    DEVICES = "Devices"
    TRANSACTIONS = "Transactions"
    FLOOR_AREA = "Floor area"
    SPEND = "Spend"
    MULTI_FACTOR = "Multi-factor"


class StaticOrDynamic(str, Enum):
    """Enumeration "static_or_dynamic" (used in: 6_KeyDef)."""

    STATIC = "Static"
    DYNAMIC = "Dynamic"


class EntityRole(str, Enum):
    """Enumeration "entity_role" (used in: 8_Entity)."""

    PROVIDER = "Provider"
    RECIPIENT = "Recipient"
    BOTH = "Both"


class ParticipationRole(str, Enum):
    """Enumeration "participation_role" (used in: 9_Participation)."""

    PROVIDER = "Provider"
    BENEFICIARY = "Beneficiary"


class BudgetOrActual(str, Enum):
    """Enumeration "budget_or_actual" (used in: 10_ChargeLedger)."""

    BUDGET = "Budget"
    ACTUAL = "Actual"
    TRUE_UP = "True-up"


class FxRateType(str, Enum):
    """Enumeration "fx_rate_type" (used in: 10_ChargeLedger)."""

    SPOT = "Spot"
    MONTHLY_AVERAGE = "Monthly average"
    FIXED_BUDGET = "Fixed/budget"


class VatGstTreatment(str, Enum):
    """Enumeration "vat_gst_treatment" (used in: 10_ChargeLedger)."""

    REVERSE_CHARGE = "Reverse charge"
    STANDARD_RATED = "Standard-rated"
    EXEMPT = "Exempt"
    OUT_OF_SCOPE = "Out-of-scope"


class ReconStatus(str, Enum):
    """Enumeration "recon_status" (used in: 11_Recon)."""

    BALANCED = "Balanced"
    BREAK = "Break"


class Status(str, Enum):
    """Enumeration "status" (used in: 3_Pool, 8_Entity)."""

    ACTIVE = "Active"
    INACTIVE = "Inactive"


# enumeration name -> allowed values (V-R2)
ENUM_VALUES: dict[str, tuple[str, ...]] = {
    "flow_type": ("Service", "Goods", "Royalty", "CSA", "Financing",),
    "cost_nature": ("Payroll", "Depreciation", "Third-party fee", "Travel", "Software", "Facilities", "Intercompany charge received", "Other",),
    "function / service_line": ("IT", "HR", "Finance", "Legal", "Procurement", "Marketing (support)", "Management", "Facilities", "R&D support",),
    "charge_method": ("Direct", "Indirect",),
    "characterization": ("Routine-benchmarked", "LVAIGS", "SCM", "Pass-through",),
    "core_or_support": ("Core", "Support",),
    "cost_base_definition": ("Full cost", "Total services cost", "Marginal cost",),
    "regime": ("LVAIGS (5%)", "SCM (0%)", "Benchmarked", "Pass-through (0%)",),
    "scm_eligibility_basis": ("Specified covered service (IRS list)", "Low-margin <=7%", "n/a",),
    "exclusion_type": ("Stewardship", "Duplicative", "Incidental/passive association", "On-call",),
    "key_factor": ("Headcount", "Revenue", "Total cost", "Seats", "Devices", "Transactions", "Floor area", "Spend", "Multi-factor",),
    "static_or_dynamic": ("Static", "Dynamic",),
    "entity_role": ("Provider", "Recipient", "Both",),
    "participation_role": ("Provider", "Beneficiary",),
    "budget_or_actual": ("Budget", "Actual", "True-up",),
    "fx_rate_type": ("Spot", "Monthly average", "Fixed/budget",),
    "vat_gst_treatment": ("Reverse charge", "Standard-rated", "Exempt", "Out-of-scope",),
    "recon_status": ("Balanced", "Break",),
    "status": ("Active", "Inactive",),
}

# enumeration name -> Enum class
ENUMS: dict[str, type[Enum]] = {
    "flow_type": FlowType,
    "cost_nature": CostNature,
    "function / service_line": FunctionServiceLine,
    "charge_method": ChargeMethod,
    "characterization": Characterization,
    "core_or_support": CoreOrSupport,
    "cost_base_definition": CostBaseDefinition,
    "regime": Regime,
    "scm_eligibility_basis": ScmEligibilityBasis,
    "exclusion_type": ExclusionType,
    "key_factor": KeyFactor,
    "static_or_dynamic": StaticOrDynamic,
    "entity_role": EntityRole,
    "participation_role": ParticipationRole,
    "budget_or_actual": BudgetOrActual,
    "fx_rate_type": FxRateType,
    "vat_gst_treatment": VatGstTreatment,
    "recon_status": ReconStatus,
    "status": Status,
}

class CostLine(TypedDict):
    """1_CostLine — 1. Cost Line (source GL / ACDOCA)."""

    cost_line_id: str
    provider_entity_id: str
    company_code: str
    cost_center: str
    profit_center: NotRequired[str]
    cost_element: str
    cost_nature: str  # enum: cost_nature
    function: str  # enum: function / service_line
    amount_local: str
    currency_local: str
    posting_date: str
    fiscal_period: str
    fiscal_year: str
    flow_type: str  # enum: flow_type
    charge_method: str  # enum: charge_method
    traceable_recipient_id: NotRequired[str]
    pass_through_flag: bool
    pool_id: NotRequired[str]
    source_document_ref: str


class CCMapping(TypedDict):
    """2_CCMapping — 2. Cost Center -> Service Line Mapping (reference data)."""

    mapping_id: str
    company_code: str
    cost_center: str
    service_line_id: str
    function: str  # enum: function / service_line
    allocation_split_pct: NotRequired[str]
    effective_from: str
    effective_to: NotRequired[str]
    version: int
    owner: str
    rationale: NotRequired[str]


class Pool(TypedDict):
    """3_Pool — 3. Service Pool / Catalogue."""

    pool_id: str
    pool_name: str
    service_line: str  # enum: function / service_line
    service_description: str
    provider_entity_id: str
    characterization: str  # enum: characterization
    core_or_support: str  # enum: core_or_support
    unique_intangible_flag: bool
    significant_risk_flag: bool
    cost_base_definition: str  # enum: cost_base_definition
    default_key_id: str
    direct_charge_flag: bool
    documentation_ref: NotRequired[str]
    effective_from: str
    effective_to: NotRequired[str]
    status: str  # enum: status


class MarkupPolicy(TypedDict):
    """4_MarkupPolicy — 4. Markup Policy (per pool, per jurisdiction)."""

    markup_policy_id: str
    pool_id: str
    jurisdiction: str
    regime: str  # enum: regime
    markup_pct: str
    scm_eligibility_basis: NotRequired[str]  # enum: scm_eligibility_basis
    business_judgment_conclusion: NotRequired[str]
    benchmark_study_ref: NotRequired[str]
    effective_from: str
    effective_to: NotRequired[str]


class Exclusions(TypedDict):
    """5_Exclusions — 5. Exclusion Rules (benefit-test gating)."""

    exclusion_id: str
    pool_id: str
    exclusion_type: str  # enum: exclusion_type
    exclusion_pct: NotRequired[str]
    exclusion_amount: NotRequired[str]
    basis_rationale: str
    effective_from: str
    effective_to: NotRequired[str]
    owner: str


class KeyDef(TypedDict):
    """6_KeyDef — 6. Allocation Key Definition."""

    key_id: str
    key_name: str
    key_factor: str  # enum: key_factor
    factor_components: NotRequired[str]
    source_system: str
    static_or_dynamic: str  # enum: static_or_dynamic
    recompute_frequency: NotRequired[str]
    description: NotRequired[str]
    owner: str


class KeyValue(TypedDict):
    """7_KeyValue — 7. Allocation Key Value (per recipient, per period)."""

    key_value_id: str
    key_id: str
    pool_id: str
    recipient_entity_id: str
    period: str
    factor_value: str
    total_factor_value: str
    allocation_ratio: str
    as_of_date: str
    source_ref: NotRequired[str]


class Entity(TypedDict):
    """8_Entity — 8. Legal Entity Master."""

    entity_id: str
    legal_entity_name: str
    company_code: str
    jurisdiction: str
    functional_currency: str
    tax_registration_id: NotRequired[str]
    entity_role: str  # enum: entity_role
    tier: NotRequired[int]
    parent_entity_id: NotRequired[str]
    effective_from: str
    effective_to: NotRequired[str]
    status: str  # enum: status


class Participation(TypedDict):
    """9_Participation — 9. Pool Participation (entity <-> pool)."""

    participation_id: str
    pool_id: str
    entity_id: str
    role: str  # enum: participation_role
    benefit_rationale: NotRequired[str]
    effective_from: str
    effective_to: NotRequired[str]


class ChargeLedger(TypedDict):
    """10_ChargeLedger — 10. Charge Ledger (output)."""

    charge_id: str
    pool_id: str
    provider_entity_id: str
    recipient_entity_id: str
    period: str
    fiscal_year: str
    budget_or_actual: str  # enum: budget_or_actual
    allocation_key_id: NotRequired[str]
    allocation_ratio_applied: NotRequired[str]
    cost_recovered_amount: str
    markup_pct_applied: str
    markup_amount: str
    gross_charge_amount: str
    charge_currency: str
    fx_rate: NotRequired[str]
    fx_rate_type: NotRequired[str]  # enum: fx_rate_type
    fx_rate_date: NotRequired[str]
    vat_gst_treatment: NotRequired[str]  # enum: vat_gst_treatment
    vat_amount: NotRequired[str]
    wht_rate: NotRequired[str]
    wht_amount: NotRequired[str]
    invoice_ref: NotRequired[str]
    journal_entry_ref: NotRequired[str]
    settlement_ref: NotRequired[str]
    true_up_parent_charge_id: NotRequired[str]
    posting_date: str
    documentation_ref: NotRequired[str]


class Recon(TypedDict):
    """11_Recon — 11. Reconciliation & Audit Log."""

    recon_id: str
    run_id: str
    run_timestamp: str
    period: str
    pool_id: str
    provider_entity_id: str
    total_pooled_cost: str
    total_exclusions: str
    total_cost_recovered: str
    total_markup: str
    total_charged_out: str
    unallocated_residual: str
    true_up_delta: NotRequired[str]
    recon_status: str  # enum: recon_status
    break_amount: NotRequired[str]


# sheet -> {class_name, table, primary_key, field_order, fields}
# fields: name -> {type, py, required, enum, references}
ENTITIES: dict[str, dict] = {
    "1_CostLine": {
        "class_name": "CostLine",
        "table": 'cost_lines',
        "primary_key": "cost_line_id",
        "field_order": ("cost_line_id", "provider_entity_id", "company_code", "cost_center", "profit_center", "cost_element", "cost_nature", "function", "amount_local", "currency_local", "posting_date", "fiscal_period", "fiscal_year", "flow_type", "charge_method", "traceable_recipient_id", "pass_through_flag", "pool_id", "source_document_ref",),
        "fields": {
            "cost_line_id": {"type": "String/UUID", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "provider_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "company_code": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "cost_center": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("2_CCMapping", "cost_center")},
            "profit_center": {"type": "String", "py": "str", "required": "Optional", "enum": None, "references": None},
            "cost_element": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "cost_nature": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'cost_nature', "references": None},
            "function": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'function / service_line', "references": None},
            "amount_local": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "currency_local": {"type": "Currency", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "posting_date": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "fiscal_period": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "fiscal_year": {"type": "Text", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "flow_type": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'flow_type', "references": None},
            "charge_method": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'charge_method', "references": None},
            "traceable_recipient_id": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": ("8_Entity", "entity_id")},
            "pass_through_flag": {"type": "Boolean", "py": "bool", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": ("3_Pool", "pool_id")},
            "source_document_ref": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
        },
    },
    "2_CCMapping": {
        "class_name": "CCMapping",
        "table": None,
        "primary_key": "mapping_id",
        "field_order": ("mapping_id", "company_code", "cost_center", "service_line_id", "function", "allocation_split_pct", "effective_from", "effective_to", "version", "owner", "rationale",),
        "fields": {
            "mapping_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "company_code": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "cost_center": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "service_line_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "function": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'function / service_line', "references": None},
            "allocation_split_pct": {"type": "Percent", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
            "version": {"type": "Integer", "py": "int", "required": "Mandatory", "enum": None, "references": None},
            "owner": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "rationale": {"type": "Text", "py": "str", "required": "Recommended", "enum": None, "references": None},
        },
    },
    "3_Pool": {
        "class_name": "Pool",
        "table": None,
        "primary_key": "pool_id",
        "field_order": ("pool_id", "pool_name", "service_line", "service_description", "provider_entity_id", "characterization", "core_or_support", "unique_intangible_flag", "significant_risk_flag", "cost_base_definition", "default_key_id", "direct_charge_flag", "documentation_ref", "effective_from", "effective_to", "status",),
        "fields": {
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_name": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "service_line": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'function / service_line', "references": None},
            "service_description": {"type": "Text", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "provider_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "characterization": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'characterization', "references": None},
            "core_or_support": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'core_or_support', "references": None},
            "unique_intangible_flag": {"type": "Boolean", "py": "bool", "required": "Mandatory", "enum": None, "references": None},
            "significant_risk_flag": {"type": "Boolean", "py": "bool", "required": "Mandatory", "enum": None, "references": None},
            "cost_base_definition": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'cost_base_definition', "references": None},
            "default_key_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("6_KeyDef", "key_id")},
            "direct_charge_flag": {"type": "Boolean", "py": "bool", "required": "Mandatory", "enum": None, "references": None},
            "documentation_ref": {"type": "String", "py": "str", "required": "Recommended", "enum": None, "references": None},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
            "status": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'status', "references": None},
        },
    },
    "4_MarkupPolicy": {
        "class_name": "MarkupPolicy",
        "table": None,
        "primary_key": "markup_policy_id",
        "field_order": ("markup_policy_id", "pool_id", "jurisdiction", "regime", "markup_pct", "scm_eligibility_basis", "business_judgment_conclusion", "benchmark_study_ref", "effective_from", "effective_to",),
        "fields": {
            "markup_policy_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "jurisdiction": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "regime": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'regime', "references": None},
            "markup_pct": {"type": "Percent", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "scm_eligibility_basis": {"type": "Enum", "py": "str", "required": "Conditional", "enum": 'scm_eligibility_basis', "references": None},
            "business_judgment_conclusion": {"type": "Text", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "benchmark_study_ref": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
        },
    },
    "5_Exclusions": {
        "class_name": "Exclusions",
        "table": None,
        "primary_key": "exclusion_id",
        "field_order": ("exclusion_id", "pool_id", "exclusion_type", "exclusion_pct", "exclusion_amount", "basis_rationale", "effective_from", "effective_to", "owner",),
        "fields": {
            "exclusion_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "exclusion_type": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'exclusion_type', "references": None},
            "exclusion_pct": {"type": "Percent", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "exclusion_amount": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "basis_rationale": {"type": "Text", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
            "owner": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
        },
    },
    "6_KeyDef": {
        "class_name": "KeyDef",
        "table": None,
        "primary_key": "key_id",
        "field_order": ("key_id", "key_name", "key_factor", "factor_components", "source_system", "static_or_dynamic", "recompute_frequency", "description", "owner",),
        "fields": {
            "key_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "key_name": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "key_factor": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'key_factor', "references": None},
            "factor_components": {"type": "Text", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "source_system": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "static_or_dynamic": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'static_or_dynamic', "references": None},
            "recompute_frequency": {"type": "Enum", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "description": {"type": "Text", "py": "str", "required": "Recommended", "enum": None, "references": None},
            "owner": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
        },
    },
    "7_KeyValue": {
        "class_name": "KeyValue",
        "table": 'key_values',
        "primary_key": "key_value_id",
        "field_order": ("key_value_id", "key_id", "pool_id", "recipient_entity_id", "period", "factor_value", "total_factor_value", "allocation_ratio", "as_of_date", "source_ref",),
        "fields": {
            "key_value_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "key_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("6_KeyDef", "key_id")},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "recipient_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "period": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "factor_value": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "total_factor_value": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "allocation_ratio": {"type": "Percent", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "as_of_date": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "source_ref": {"type": "String", "py": "str", "required": "Recommended", "enum": None, "references": None},
        },
    },
    "8_Entity": {
        "class_name": "Entity",
        "table": None,
        "primary_key": "entity_id",
        "field_order": ("entity_id", "legal_entity_name", "company_code", "jurisdiction", "functional_currency", "tax_registration_id", "entity_role", "tier", "parent_entity_id", "effective_from", "effective_to", "status",),
        "fields": {
            "entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "legal_entity_name": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "company_code": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "jurisdiction": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "functional_currency": {"type": "Currency", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "tax_registration_id": {"type": "String", "py": "str", "required": "Recommended", "enum": None, "references": None},
            "entity_role": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'entity_role', "references": None},
            "tier": {"type": "Integer", "py": "int", "required": "Conditional", "enum": None, "references": None},
            "parent_entity_id": {"type": "String", "py": "str", "required": "Optional", "enum": None, "references": ("8_Entity", "entity_id")},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
            "status": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'status', "references": None},
        },
    },
    "9_Participation": {
        "class_name": "Participation",
        "table": None,
        "primary_key": "participation_id",
        "field_order": ("participation_id", "pool_id", "entity_id", "role", "benefit_rationale", "effective_from", "effective_to",),
        "fields": {
            "participation_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "role": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'participation_role', "references": None},
            "benefit_rationale": {"type": "Text", "py": "str", "required": "Recommended", "enum": None, "references": None},
            "effective_from": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "effective_to": {"type": "Date", "py": "str", "required": "Optional", "enum": None, "references": None},
        },
    },
    "10_ChargeLedger": {
        "class_name": "ChargeLedger",
        "table": 'charge_ledger',
        "primary_key": "charge_id",
        "field_order": ("charge_id", "pool_id", "provider_entity_id", "recipient_entity_id", "period", "fiscal_year", "budget_or_actual", "allocation_key_id", "allocation_ratio_applied", "cost_recovered_amount", "markup_pct_applied", "markup_amount", "gross_charge_amount", "charge_currency", "fx_rate", "fx_rate_type", "fx_rate_date", "vat_gst_treatment", "vat_amount", "wht_rate", "wht_amount", "invoice_ref", "journal_entry_ref", "settlement_ref", "true_up_parent_charge_id", "posting_date", "documentation_ref",),
        "fields": {
            "charge_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "provider_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "recipient_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "period": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "fiscal_year": {"type": "Text", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "budget_or_actual": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'budget_or_actual', "references": None},
            "allocation_key_id": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": ("6_KeyDef", "key_id")},
            "allocation_ratio_applied": {"type": "Percent", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "cost_recovered_amount": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "markup_pct_applied": {"type": "Percent", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "markup_amount": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "gross_charge_amount": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "charge_currency": {"type": "Currency", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "fx_rate": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "fx_rate_type": {"type": "Enum", "py": "str", "required": "Conditional", "enum": 'fx_rate_type', "references": None},
            "fx_rate_date": {"type": "Date", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "vat_gst_treatment": {"type": "Enum", "py": "str", "required": "Recommended", "enum": 'vat_gst_treatment', "references": None},
            "vat_amount": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "wht_rate": {"type": "Percent", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "wht_amount": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "invoice_ref": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "journal_entry_ref": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "settlement_ref": {"type": "String", "py": "str", "required": "Optional", "enum": None, "references": None},
            "true_up_parent_charge_id": {"type": "String", "py": "str", "required": "Conditional", "enum": None, "references": ("10_ChargeLedger", "charge_id")},
            "posting_date": {"type": "Date", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "documentation_ref": {"type": "String", "py": "str", "required": "Recommended", "enum": None, "references": None},
        },
    },
    "11_Recon": {
        "class_name": "Recon",
        "table": 'recon',
        "primary_key": "recon_id",
        "field_order": ("recon_id", "run_id", "run_timestamp", "period", "pool_id", "provider_entity_id", "total_pooled_cost", "total_exclusions", "total_cost_recovered", "total_markup", "total_charged_out", "unallocated_residual", "true_up_delta", "recon_status", "break_amount",),
        "fields": {
            "recon_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "run_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "run_timestamp": {"type": "DateTime", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "period": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "pool_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("3_Pool", "pool_id")},
            "provider_entity_id": {"type": "String", "py": "str", "required": "Mandatory", "enum": None, "references": ("8_Entity", "entity_id")},
            "total_pooled_cost": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "total_exclusions": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "total_cost_recovered": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "total_markup": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "total_charged_out": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "unallocated_residual": {"type": "Decimal", "py": "str", "required": "Mandatory", "enum": None, "references": None},
            "true_up_delta": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
            "recon_status": {"type": "Enum", "py": "str", "required": "Mandatory", "enum": 'recon_status', "references": None},
            "break_amount": {"type": "Decimal", "py": "str", "required": "Conditional", "enum": None, "references": None},
        },
    },
}

# Append-only ledger sheets (corrections = reversing rows, never UPDATE)
LEDGER_SHEETS: tuple[str, ...] = ("1_CostLine", "7_KeyValue", "10_ChargeLedger", "11_Recon",)

# sheet -> SQLite table (engine-persisted sheets only; the rest are seeds)
TABLES: dict[str, str] = {
    "1_CostLine": "cost_lines",
    "7_KeyValue": "key_values",
    "10_ChargeLedger": "charge_ledger",
    "11_Recon": "recon",
}
