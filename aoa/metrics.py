"""Scoring.

Two error curves, both measured against the final execution, which is what the
factories actually pick:

global WMAPE  how far the whole-network demand at execution t is from final
              demand. It depends only on customer churn, so no routing rule can
              change it. It is the floor.
site WMAPE    how far each site's demand at execution t is from that site's
              final demand, summed over both sites and divided by the same
              denominator.

The gap between them is the error the routing itself adds. A rule that shuffles
boxes between sites for no reason opens a wide gap; a rule that keeps each site
stable closes it. The score is the sum of squared gaps over the horizon, so
lower is better and a single bad execution is punished.
"""

from .model import count_volume_skus


def evaluate(executions, site_A_history, site_B_history):
    final_total = count_volume_skus(executions[-1])
    denom = float(sum(final_total)) or 1.0

    global_wmape = [
        sum(abs(a - f) for a, f in zip(count_volume_skus(vol), final_total)) / denom
        for vol in executions
    ]

    A_final = site_A_history[-1].skus
    B_final = site_B_history[-1].skus
    site_wmape = [
        (
            sum(abs(a - f) for a, f in zip(A.skus, A_final))
            + sum(abs(b - f) for b, f in zip(B.skus, B_final))
        )
        / denom
        for A, B in zip(site_A_history, site_B_history)
    ]

    gap = [s - g for s, g in zip(site_wmape, global_wmape)]
    return {
        "global_wmape": global_wmape,
        "site_wmape": site_wmape,
        "gap": gap,
        "score": sum(g * g for g in gap),
        "mean_gap": sum(gap) / len(gap),
        "max_gap": max(gap),
    }


def churn_between(site_history):
    """How many boxes changed site from one execution to the next."""
    out = [0]
    for prev, cur in zip(site_history, site_history[1:]):
        prev_ids = {b.id for b in prev.boxes}
        cur_ids = {b.id for b in cur.boxes}
        out.append(len(cur_ids - prev_ids))
    return out
