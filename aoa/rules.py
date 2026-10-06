"""Target rules: how site A's SKU target is set at each execution.

The rule is the only thing the player changes. The optimiser underneath stays
the same, so any improvement over the baseline comes from a better target.

Modes
-----
fixed         target_k = share_k * total_k(first execution), then frozen.
proportional  target_k = share_k * total_k(this execution). Tracks demand drift.
              This is the baseline: a live 56.06/43.94 target selected by a
              sweep of constant shares on the fixed scenario.
affine        target_k = anchor_k + share_k * (total_k(now) - total_k(anchor)).
              Keeps the first split and passes only a share of the change on.
blend         a weighted mix of the frozen and proportional targets.

`share_k` is the fraction of SKU k that site A should hold. Where eligibility
leaves no choice the share is overridden: 1.0 if only A can host the SKU, 0.0 if
only B can.
"""

from dataclasses import dataclass, field, asdict


MODES = ("fixed", "proportional", "affine", "blend")


def _clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, float(v)))


@dataclass
class TargetRule:
    mode: str = "fixed"
    share: float = 0.5
    share_by_sku: list = field(default_factory=list)  # empty = use `share` everywhere
    blend: float = 0.5        # 1.0 = fully frozen, 0.0 = fully proportional
    lambda_move: float = 0.05  # cost of moving a box away from its last site
    label: str = "My rule"

    def __post_init__(self):
        if self.mode not in MODES:
            raise ValueError(f"Unknown mode {self.mode!r}; expected one of {MODES}.")
        self.share = _clamp(self.share)
        self.blend = _clamp(self.blend)
        self.lambda_move = max(0.0, float(self.lambda_move))
        self.share_by_sku = [_clamp(v) for v in self.share_by_sku]

    def to_dict(self):
        return asdict(self)

    @staticmethod
    def from_dict(d):
        d = dict(d or {})
        allowed = {f for f in TargetRule.__dataclass_fields__}
        return TargetRule(**{k: v for k, v in d.items() if k in allowed})


BASELINE_RULE = TargetRule(
    mode="proportional", share=0.5606, blend=0.0, lambda_move=0.05,
    label="Baseline (live 56.06/43.94)"
)


def share_vector(rule, hosted_A, hosted_B):
    """Per-SKU share for site A, with eligibility overriding the player's choice."""
    n = len(hosted_A)
    base = rule.share_by_sku if len(rule.share_by_sku) == n else [rule.share] * n

    out = []
    for k, (a_ok, b_ok) in enumerate(zip(hosted_A, hosted_B)):
        if a_ok and not b_ok:
            out.append(1.0)
        elif b_ok and not a_ok:
            out.append(0.0)
        elif a_ok and b_ok:
            out.append(float(base[k]))
        else:
            raise ValueError(f"SKU {k} is hosted at neither site.")
    return out


def targets_for_execution(rule, state, totals, hosted_A, hosted_B):
    """Target SKU vector for site A this execution.

    `state` carries what the rule remembers between executions: the frozen
    first-execution target, and the anchor used by the affine mode. It is
    updated in place on the first call.
    """
    shares = share_vector(rule, hosted_A, hosted_B)
    proportional = [shares[k] * float(totals[k]) for k in range(len(totals))]

    if state.get("frozen_target") is None:
        state["frozen_target"] = list(proportional)
        state["anchor_totals"] = [float(v) for v in totals]

    frozen = state["frozen_target"]

    if rule.mode == "fixed":
        return list(frozen)

    if rule.mode == "proportional":
        return proportional

    if rule.mode == "affine":
        anchor_totals = state["anchor_totals"]
        return [
            _bounded(
                frozen[k] + shares[k] * (float(totals[k]) - anchor_totals[k]),
                totals[k],
            )
            for k in range(len(totals))
        ]

    w = rule.blend
    return [w * frozen[k] + (1.0 - w) * proportional[k] for k in range(len(totals))]


def _bounded(v, total):
    return max(0.0, min(float(total), v))
