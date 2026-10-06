"""Run a target rule over the whole execution stream and shape the result for
the web page. Also owns the swept constant-share baseline everyone is measured against.
"""

import json
import os

from .metrics import evaluate, churn_between
from .model import Site, count_volume_skus
from .rules import BASELINE_RULE, TargetRule, targets_for_execution
from .scenario import ScenarioConfig, build_scenario
from .solver import solve_assignment_to_target

BASELINE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "baseline.json"
)


def run_rule(scenario, rule, time_limit_s=10):
    """Route every execution under `rule` and return a JSON-ready payload."""
    hosted_A, hosted_B = scenario.hosted_A, scenario.hosted_B
    state = {"frozen_target": None, "anchor_totals": None}

    A_history, B_history, targets = [], [], []

    for volume in scenario.executions:
        totals = count_volume_skus(volume)
        target = targets_for_execution(rule, state, totals, hosted_A, hosted_B)
        site_A, site_B = solve_assignment_to_target(
            volume=volume,
            target_A=target,
            hosted_A=hosted_A,
            hosted_B=hosted_B,
            prev_site_A=A_history[-1] if A_history else None,
            lambda_move=rule.lambda_move,
            time_limit_s=time_limit_s,
            clip_target_to_bounds=(rule.mode != "fixed"),
        )
        A_history.append(site_A)
        B_history.append(site_B)
        targets.append(target)

    metrics = evaluate(scenario.executions, A_history, B_history)
    moved = churn_between(A_history)

    executions = []
    for t, volume in enumerate(scenario.executions):
        in_A = {b.id for b in A_history[t].boxes}
        probe_A = Site(hosted_skus=hosted_A)
        executions.append(
            {
                "index": t,
                "boxes": [
                    {
                        "id": b.id,
                        "site": "A" if b.id in in_A else "B",
                        "skus": b.skus,
                        "units": b.units,
                        "lines": b.lines,
                        "eligibleA": probe_A.is_eligible(b),
                    }
                    for b in volume
                ],
                "totals": count_volume_skus(volume),
                "targetA": [round(v, 2) for v in targets[t]],
                "siteA": _site_summary(A_history[t]),
                "siteB": _site_summary(B_history[t]),
                "globalWmape": metrics["global_wmape"][t],
                "siteWmape": metrics["site_wmape"][t],
                "gap": metrics["gap"][t],
                "moved": moved[t],
            }
        )

    return {
        "label": rule.label,
        "rule": rule.to_dict(),
        "score": metrics["score"],
        "meanGap": metrics["mean_gap"],
        "maxGap": metrics["max_gap"],
        "globalWmape": metrics["global_wmape"],
        "siteWmape": metrics["site_wmape"],
        "gap": metrics["gap"],
        "executions": executions,
        "hostedA": hosted_A,
        "hostedB": hosted_B,
        "nSkus": scenario.config.n_skus,
        "nBoxes": scenario.config.n_boxes,
    }


def _site_summary(site):
    return {"skus": site.skus, "boxes": len(site), "units": sum(site.skus)}


def get_baseline(scenario, time_limit_s=10, cache_path=BASELINE_PATH, refresh=False):
    """The swept live-share reference run. Computed once, then read from disk.

    Every execution targets 56.06% of the current global volume at site A, with
    eligibility overriding that share. This is the number to beat.
    """
    key = scenario.config.key()
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                cached = json.load(f)
            if cached.get("scenarioKey") == key:
                return cached["payload"]
        except (ValueError, KeyError, OSError):
            pass

    payload = run_rule(scenario, BASELINE_RULE, time_limit_s=time_limit_s)
    with open(cache_path, "w") as f:
        json.dump({"scenarioKey": key, "payload": payload}, f)
    return payload


def load_scenario(config=None):
    return build_scenario(config or ScenarioConfig())


def run_challenger(scenario, rule_dict, time_limit_s=10):
    return run_rule(scenario, TargetRule.from_dict(rule_dict), time_limit_s=time_limit_s)
