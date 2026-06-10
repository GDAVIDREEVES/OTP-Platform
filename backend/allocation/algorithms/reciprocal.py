"""Reciprocal allocation — cycle detection + simultaneous equations (SPEC §5.3).

If the cascade graph has cycles (A provides to B, B provides to A),
topological ordering fails. Cycles are detected with Tarjan's strongly-
connected-components algorithm; for each SCC the standard reciprocal-method
system is solved::

    S_i = C_i + Σ_j (S_j × a_ji)        (a_ji = share of department j's
    S = C + AᵀS  →  S = (I − Aᵀ)⁻¹ C     services consumed by department i)

``solve_reciprocal`` uses Gaussian elimination with partial pivoting on
``decimal.Decimal`` (SCCs are small — a handful of entities) and SELF-VERIFIES
the solution against the system within ``TOLERANCE``; a singular/near-singular
matrix falls back to iterative substitution with convergence tolerance 1e-10,
and an unconverged system after 1,000 iterations raises
``ReciprocalSolverError`` — the caller maps it to a V-C1 BLOCK (SPEC §7).

All math is full-precision Decimal (context precision 28, ROUND_HALF_EVEN —
ENGINE-CLAUDE.md); this module performs NO rounding: quantization happens only
at SPEC §5.6's boundaries, downstream of the solve.

Determinism: nodes are processed in ascending ID order everywhere (SPEC §5.1
tie-break convention); ``tarjan_scc`` output is therefore reproducible.

Pure module — no I/O (ENGINE-CLAUDE.md "Engine purity").
"""

from __future__ import annotations

from decimal import Decimal
from typing import Iterable, Mapping, Sequence

ZERO = Decimal("0")
ONE = Decimal("1")

#: SPEC §5.3 — iterative-substitution convergence tolerance and iteration cap.
TOLERANCE = Decimal("1E-10")
MAX_ITERATIONS = 1000


class ReciprocalSolverError(ValueError):
    """The reciprocal system could not be solved (near-singular and the
    iterative fallback did not converge) — V-C1 BLOCK at the caller."""


def tarjan_scc(
    nodes: Iterable[str],
    edges: Mapping[str, Iterable[str]],
) -> list[list[str]]:
    """Strongly connected components (Tarjan, iterative).

    Returns SCCs in REVERSE topological order of the condensation DAG (an SCC
    is emitted only after every SCC it points to); each SCC is sorted
    ascending. Deterministic: roots and neighbors are visited in ascending ID
    order. Edges to nodes outside ``nodes`` are ignored.
    """
    order = sorted(set(nodes))
    known = set(order)
    adj = {n: sorted({m for m in edges.get(n, ()) if m in known}) for n in order}

    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    sccs: list[list[str]] = []
    counter = 0

    for root in order:
        if root in index:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        work: list[tuple[str, "object"]] = [(root, iter(adj[root]))]
        while work:
            node, neighbors = work[-1]
            descended = False
            for child in neighbors:  # type: ignore[union-attr]
                if child not in index:
                    index[child] = low[child] = counter
                    counter += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(adj[child])))
                    descended = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if descended:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                scc: list[str] = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    scc.append(member)
                    if member == node:
                        break
                sccs.append(sorted(scc))
    return sccs


def condensation_order(
    nodes: Iterable[str],
    edges: Mapping[str, Iterable[str]],
) -> list[list[str]]:
    """SCC groups in TOPOLOGICAL order (sources first) — the cascade run
    order of SPEC §5.2. Tarjan emits reverse-topological; reverse it."""
    return list(reversed(tarjan_scc(nodes, edges)))


def is_cyclic(group: Sequence[str], edges: Mapping[str, Iterable[str]]) -> bool:
    """True when the SCC group needs the reciprocal method: more than one
    member, or a single member that consumes its own services (self-edge)."""
    return len(group) > 1 or group[0] in set(edges.get(group[0], ()))


def _residual(
    solution: Mapping[str, Decimal],
    own_cost: Mapping[str, Decimal],
    consumption: Mapping[tuple[str, str], Decimal],
) -> Decimal:
    """max_i |S_i − (C_i + Σ_j a_ji S_j)| — the self-verification metric."""
    worst = ZERO
    for i in own_cost:
        rhs = own_cost[i] + sum(
            (consumption.get((j, i), ZERO) * solution[j] for j in own_cost),
            ZERO,
        )
        worst = max(worst, abs(solution[i] - rhs))
    return worst


def _gaussian(
    nodes: Sequence[str],
    own_cost: Mapping[str, Decimal],
    consumption: Mapping[tuple[str, str], Decimal],
) -> dict[str, Decimal] | None:
    """Gaussian elimination with partial pivoting on Decimal.

    Solves M·S = C with M[i][j] = δ_ij − a_ji (the equation rows
    S_i − Σ_j a_ji S_j = C_i). Returns None on a zero pivot (singular —
    the caller falls back to iterative substitution per SPEC §5.3).
    """
    n = len(nodes)
    m = [[(ONE if r == c else ZERO) - consumption.get((nodes[c], nodes[r]), ZERO)
          for c in range(n)] for r in range(n)]
    b = [own_cost[nodes[r]] for r in range(n)]

    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(m[r][col]))
        if m[pivot_row][col] == ZERO:
            return None  # singular
        if pivot_row != col:
            m[col], m[pivot_row] = m[pivot_row], m[col]
            b[col], b[pivot_row] = b[pivot_row], b[col]
        for r in range(col + 1, n):
            if m[r][col] == ZERO:
                continue
            factor = m[r][col] / m[col][col]
            for c in range(col, n):
                m[r][c] -= factor * m[col][c]
            b[r] -= factor * b[col]

    solution = [ZERO] * n
    for r in range(n - 1, -1, -1):
        acc = b[r] - sum((m[r][c] * solution[c] for c in range(r + 1, n)), ZERO)
        solution[r] = acc / m[r][r]
    return {nodes[r]: solution[r] for r in range(n)}


def _iterate(
    own_cost: Mapping[str, Decimal],
    consumption: Mapping[tuple[str, str], Decimal],
) -> dict[str, Decimal]:
    """Iterative substitution S ← C + AᵀS (SPEC §5.3 fallback): tolerance
    1e-10, at most 1,000 iterations, else ``ReciprocalSolverError``."""
    solution = {i: own_cost[i] for i in own_cost}
    for _ in range(MAX_ITERATIONS):
        nxt = {
            i: own_cost[i] + sum(
                (consumption.get((j, i), ZERO) * solution[j] for j in own_cost),
                ZERO,
            )
            for i in own_cost
        }
        delta = max((abs(nxt[i] - solution[i]) for i in own_cost), default=ZERO)
        solution = nxt
        if delta <= TOLERANCE:
            return solution
    raise ReciprocalSolverError(
        f"the reciprocal system did not converge within {MAX_ITERATIONS} "
        f"iterations (tolerance {TOLERANCE}) — near-singular consumption matrix"
    )


def solve_reciprocal(
    own_cost: Mapping[str, Decimal],
    consumption: Mapping[tuple[str, str], Decimal],
) -> dict[str, Decimal]:
    """Solve the reciprocal system S = C + AᵀS for one SCC (SPEC §5.3).

    ``own_cost``    — node → direct pool cost C_i (Decimal, full precision).
    ``consumption`` — (j, i) → a_ji, the share of department j's services
                      consumed by department i; absent pairs are zero.

    Gaussian elimination first (self-verified within ``TOLERANCE``); falls
    back to iterative substitution when singular/near-singular; raises
    ``ReciprocalSolverError`` when neither converges (V-C1 at the caller).
    Contract violations (unknown nodes, negative shares) raise ValueError —
    they are upstream gating bugs, not data exceptions.
    """
    nodes = sorted(own_cost)
    known = set(nodes)
    for (j, i), share in consumption.items():
        if j not in known or i not in known:
            raise ValueError(
                f"solve_reciprocal: consumption pair ({j!r}, {i!r}) names a "
                "node outside the SCC")
        if share < ZERO:
            raise ValueError(
                f"solve_reciprocal: negative consumption share {share} for "
                f"({j!r}, {i!r}) — V-K gating must run before the solve")

    solution = _gaussian(nodes, own_cost, consumption)
    if solution is not None and _residual(solution, own_cost, consumption) <= TOLERANCE:
        return solution
    return _iterate(own_cost, consumption)
