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
    n_boxes: int = 48
    n_skus: int = 14
    n_executions: int = 12
    churn_per_execution: int = 8
    seed: int = 2026
    # factory A cannot host SKU 2, so every box needing it is stuck at factory B
    hosted_skus_A: tuple = (True, True, False) + (True,) * 11
    hosted_skus_B: tuple = (True,) * 14

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

    volume = Box.random(cfg.n_boxes, cfg.n_skus, rand)
    executions = []
    for _ in range(cfg.n_executions):
        for __ in range(cfg.churn_per_execution):
            idx = rand.randrange(len(volume))
            volume[idx] = Box.random(1, cfg.n_skus, rand)[0]
        executions.append(volume.copy())

    return Scenario(config=cfg, executions=executions)
