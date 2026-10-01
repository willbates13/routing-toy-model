"""The optimiser.

Given a target SKU vector for site A, split the boxes between the two sites so
that site A's realised SKU totals land as close to that target as possible:

    min_x  sum_k |A_k(x) - target_k|  +  lambda_move * (boxes that changed site)

    subject to  - each site gets the same number of boxes
                - a box only goes where all of its SKUs are hosted
                - boxes are whole: a box goes to exactly one site

Solved exactly with PuLP/CBC when PuLP is installed. If it is not, a pure-Python
swap search stands in, so the repo still runs with nothing but the standard
library.
"""

import os
import warnings

from .model import Site

warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"pulp\..*")

try:  # PuLP ships CBC with it, so this is the only real dependency.
    import pulp
except ImportError:  # pragma: no cover - exercised only without PuLP
    pulp = None


def _thread_count():
    return max(1, min(8, os.cpu_count() or 1))


def build_execution_data(volume, hosted_A, hosted_B):
    """Pre-compute per-box SKU sums, eligibility and the forced assignments."""
    vol = list(volume)
    if not vol:
        raise ValueError("Volume must be non-empty.")
    if len(vol) % 2 != 0:
        raise ValueError("Volume size must be even so each site gets the same box count.")

    sku_dim = len(vol[0].skus)
    if len(hosted_A) != sku_dim or len(hosted_B) != sku_dim:
        raise ValueError("Eligibility mask length does not match the number of SKUs.")

    probe_A = Site(hosted_skus=hosted_A)
    probe_B = Site(hosted_skus=hosted_B)

    box_skus, eligible_A, eligible_B = [], [], []
    total_skus = [0] * sku_dim
    forced_A_idx, forced_B_idx = [], []

    for i, b in enumerate(vol):
        bs = b.skus
        box_skus.append(bs)
        for k, v in enumerate(bs):
            total_skus[k] += v

        a_ok, b_ok = probe_A.is_eligible(b), probe_B.is_eligible(b)
        if not a_ok and not b_ok:
            raise ValueError(f"Unroutable box: {b}")
        eligible_A.append(a_ok)
        eligible_B.append(b_ok)
        if a_ok and not b_ok:
            forced_A_idx.append(i)
        elif b_ok and not a_ok:
            forced_B_idx.append(i)

    n = len(vol)
    if len(forced_A_idx) > n // 2 or len(forced_B_idx) > n // 2:
        raise ValueError("Equal-box routing is infeasible under these eligibility masks.")

    lb_A = [0] * sku_dim
    forced_B_skus = [0] * sku_dim
    for i in forced_A_idx:
        for k, v in enumerate(box_skus[i]):
            lb_A[k] += v
    for i in forced_B_idx:
        for k, v in enumerate(box_skus[i]):
            forced_B_skus[k] += v

    return {
        "boxes": vol,
        "n": n,
        "sku_dim": sku_dim,
        "box_skus": box_skus,
        "total_skus": total_skus,
        "eligible_A": eligible_A,
        "eligible_B": eligible_B,
        "forced_A_idx": forced_A_idx,
        "forced_B_idx": forced_B_idx,
        "lb_A": lb_A,
        "ub_A": [total_skus[k] - forced_B_skus[k] for k in range(sku_dim)],
    }


def solve_assignment_to_target(
    volume,
    target_A,
    hosted_A,
    hosted_B,
    prev_site_A=None,
    lambda_move=0.05,
    time_limit_s=10,
    clip_target_to_bounds=True,
):
    """Return (site_A, site_B) for one execution."""
    data = build_execution_data(volume, hosted_A, hosted_B)
    sku_dim = data["sku_dim"]

    if len(target_A) != sku_dim:
        raise ValueError(f"Target has {len(target_A)} entries, expected {sku_dim}.")

    target = [float(v) for v in target_A]
    if clip_target_to_bounds:
        target = [
            min(max(target[k], float(data["lb_A"][k])), float(data["ub_A"][k]))
            for k in range(sku_dim)
        ]

    prev_A_ids = {b.id for b in prev_site_A.boxes} if prev_site_A is not None else set()

    if pulp is not None:
        to_A = _solve_milp(data, target, prev_A_ids, lambda_move, time_limit_s)
    else:  # pragma: no cover
        to_A = _solve_swap_search(data, target, prev_A_ids, lambda_move)

    site_A = Site(hosted_skus=hosted_A)
    site_B = Site(hosted_skus=hosted_B)
    for i, b in enumerate(data["boxes"]):
        if to_A[i]:
            site_A += b
        else:
            site_B += b

    if len(site_A) != len(site_B):
        raise ValueError("Solver returned unequal box counts.")
    return site_A, site_B


def _solve_milp(data, target, prev_A_ids, lambda_move, time_limit_s):
    """Exact branch and bound, written so CBC can actually prove optimality.

    Two things make the difference between a second and a minute here:

    * Everything is scaled to whole numbers. SKU quantities are doubled and the
      target is rounded to the nearest half unit, so each deviation variable is
      an integer, and the objective weights (50 per half unit of miss, and the
      move cost in hundredths) are integers too. CBC can then round its bound up
      to the next whole number and prune, instead of chasing fractions.
    * CBC gets several threads. The search tree here is wide and shallow, which
      parallelises well.
    """
    n, sku_dim = data["n"], data["sku_dim"]
    prob = pulp.LpProblem("route_boxes_to_target", pulp.LpMinimize)
    x = [pulp.LpVariable(f"x_{i}", cat=pulp.LpBinary) for i in range(n)]

    prob += pulp.lpSum(x) == n // 2
    for i in range(n):
        if not data["eligible_A"][i]:
            prob += x[i] == 0
        if not data["eligible_B"][i]:
            prob += x[i] == 1

    A_sku = [
        pulp.lpSum(x[i] * data["box_skus"][i][k] * 2 for i in range(n))
        for k in range(sku_dim)
    ]
    target_2x = [round(t * 2) for t in target]

    dev = [
        pulp.LpVariable(f"d_{k}", lowBound=0, cat=pulp.LpInteger)
        for k in range(sku_dim)
    ]
    for k in range(sku_dim):
        prob += dev[k] >= A_sku[k] - target_2x[k]
        prob += dev[k] >= target_2x[k] - A_sku[k]

    move_terms = []
    if lambda_move and prev_A_ids:
        for i, b in enumerate(data["boxes"]):
            move_terms.append(1 - x[i] if b.id in prev_A_ids else x[i])

    # objective x 100, so: 50 per half unit of SKU miss, lambda in hundredths
    prob += 50 * pulp.lpSum(dev) + round(100 * lambda_move) * pulp.lpSum(move_terms)
    prob.solve(
        pulp.PULP_CBC_CMD(msg=False, timeLimit=time_limit_s, threads=_thread_count())
    )

    status = pulp.LpStatus[prob.status]
    if status not in {"Optimal", "Not Solved", "Undefined"}:
        raise ValueError(f"Solver failed with status: {status}")

    values = [v.value() for v in x]
    if any(v is None for v in values):
        raise ValueError("Solver returned no usable solution.")
    return [v >= 0.5 for v in values]


def _cost(a_totals, target, moved, lambda_move):
    return sum(abs(a - t) for a, t in zip(a_totals, target)) + lambda_move * moved


def _solve_swap_search(data, target, prev_A_ids, lambda_move):  # pragma: no cover
    """Fallback for when PuLP is missing: greedy fill then improving swaps."""
    n = data["n"]
    half = n // 2
    to_A = [False] * n

    forced_A = set(data["forced_A_idx"])
    forced_B = set(data["forced_B_idx"])
    flexible = [i for i in range(n) if i not in forced_A and i not in forced_B]

    for i in forced_A:
        to_A[i] = True
    a_totals = [0] * data["sku_dim"]
    for i in forced_A:
        for k, v in enumerate(data["box_skus"][i]):
            a_totals[k] += v

    # Greedily add the flexible box that most reduces the distance to target.
    remaining = set(flexible)
    while sum(to_A) < half:
        best, best_cost = None, None
        for i in remaining:
            cand = [a + v for a, v in zip(a_totals, data["box_skus"][i])]
            c = sum(abs(a - t) for a, t in zip(cand, target))
            if best_cost is None or c < best_cost:
                best, best_cost = i, c
        to_A[best] = True
        remaining.discard(best)
        for k, v in enumerate(data["box_skus"][best]):
            a_totals[k] += v

    def moved_count():
        return sum(
            1
            for i, b in enumerate(data["boxes"])
            if (b.id in prev_A_ids) != to_A[i]
        )

    improved = True
    while improved:
        improved = False
        current = _cost(a_totals, target, moved_count(), lambda_move)
        for i in flexible:
            if not to_A[i]:
                continue
            for j in flexible:
                if to_A[j]:
                    continue
                cand = [
                    a - vi + vj
                    for a, vi, vj in zip(a_totals, data["box_skus"][i], data["box_skus"][j])
                ]
                to_A[i], to_A[j] = False, True
                c = _cost(cand, target, moved_count(), lambda_move)
                if c < current - 1e-9:
                    a_totals = cand
                    current = c
                    improved = True
                    break
                to_A[i], to_A[j] = True, False
            if improved:
                break
    return to_A
