"""The demand scenario: one stream of executions, replayed identically for
every routing rule so that comparisons are fair.

An execution is one run of the router. Between executions a few boxes churn:
customers change their order, so the volume the router sees drifts towards the
final, real volume that the factories will actually pick.
"""

import random as r
from dataclasses import dataclass, field, asdict

from .model import Box


@dataclass(frozen=True)
class ScenarioConfig:
    n_boxes: int = 64
    n_skus: int = 20
    n_executions: int = 16
    churn_per_execution: int = 10
    min_lines_per_box: int = 3
    max_lines_per_box: int = 5
    seed: int = 2026
    # Factory A cannot host SKUs 2 or 15, so boxes needing either are stuck at B.
    hosted_skus_A: tuple = tuple(k not in (2, 15) for k in range(20))
    hosted_skus_B: tuple = (True,) * 20

    def key(self):
        return "|".join(f"{k}={v}" for k, v in sorted(asdict(self).items()))


@dataclass
class Scenario:
    config: ScenarioConfig
    executions: list = field(default_factory=list)  # list[list[Box]]

    @property
    def hosted_A(self):
        return list(self.config.hosted_skus_A)

    @property
    def hosted_B(self):
        return list(self.config.hosted_skus_B)

    @property
    def boxes_by_id(self):
        out = {}
        for vol in self.executions:
            for b in vol:
                out[b.id] = b
        return out


def build_scenario(config=None):
    """Generate the execution stream. Deterministic in `config.seed`."""
    cfg = config or ScenarioConfig()
    rand = r.Random(cfg.seed)

    volume = []
    while len(volume) < cfg.n_boxes:
        volume.append(_draw_feasible_box(cfg, rand, volume))
    executions = []
    for _ in range(cfg.n_executions):
        for __ in range(cfg.churn_per_execution):
            idx = rand.randrange(len(volume))
            volume[idx] = _draw_feasible_box(cfg, rand, volume, replace_idx=idx)
        executions.append(volume.copy())

    return Scenario(config=cfg, executions=executions)


def _draw_feasible_box(cfg, rand, volume, replace_idx=None):
    """Draw a routable box without making the equal-count split impossible."""
    half = cfg.n_boxes // 2

    def eligibility(box):
        a_ok = all(not units or cfg.hosted_skus_A[k] for k, units in enumerate(box.skus))
        b_ok = all(not units or cfg.hosted_skus_B[k] for k, units in enumerate(box.skus))
        return a_ok, b_ok

    existing = [box for i, box in enumerate(volume) if i != replace_idx]
    forced_a = sum(eligibility(box) == (True, False) for box in existing)
    forced_b = sum(eligibility(box) == (False, True) for box in existing)

    while True:
        candidate = Box.random(
            1,
            cfg.n_skus,
            rand,
            min_lines=cfg.min_lines_per_box,
            max_lines=cfg.max_lines_per_box,
        )[0]
        a_ok, b_ok = eligibility(candidate)
        if not a_ok and not b_ok:
            continue
        if a_ok and not b_ok and forced_a >= half:
            continue
        if b_ok and not a_ok and forced_b >= half:
            continue
        return candidate
