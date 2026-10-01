"""AOA toy model: boxes, factories, a routing optimiser and a target rule to beat."""

from .model import Box, Site, count_volume_skus
from .rules import BASELINE_RULE, TargetRule
from .scenario import ScenarioConfig, build_scenario
from .experiment import get_baseline, run_rule, run_challenger, load_scenario

__all__ = [
    "Box", "Site", "count_volume_skus",
    "TargetRule", "BASELINE_RULE",
    "ScenarioConfig", "build_scenario",
    "get_baseline", "run_rule", "run_challenger", "load_scenario",
]
