"""Run with:  ./.venv/bin/python -m unittest discover tests"""

import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aoa.metrics import evaluate
from aoa.model import Box, Site, count_volume_skus
from aoa.rules import BASELINE_RULE, TargetRule, share_vector, targets_for_execution
from aoa.scenario import ScenarioConfig, build_scenario
from aoa.solver import solve_assignment_to_target


SMALL = ScenarioConfig(
    n_boxes=12,
    n_skus=10,
    n_executions=4,
    churn_per_execution=2,
    hosted_skus_A=(True, True, False) + (True,) * 7,
    hosted_skus_B=(True,) * 10,
)


class TestBuildingBlocks(unittest.TestCase):
    def test_a_box_is_a_sku_vector(self):
        box = Box([1, 0, 2])
        self.assertEqual(box.skus, [1, 0, 2])
        self.assertEqual(box.units, 3)
        self.assertEqual(box.lines, 2)

    def test_random_boxes_are_sparse(self):
        rand = random.Random(1)
        for box in Box.random(20, 10, rand):
            self.assertTrue(2 <= box.lines <= 4)
            self.assertEqual(len(box.skus), 10)

    def test_site_accumulates_and_refuses_unhosted_skus(self):
        site = Site(hosted_skus=[True, False, True])
        ok = Box([1, 0, 1])
        bad = Box([0, 2, 0])
        self.assertTrue(site.is_eligible(ok))
        self.assertFalse(site.is_eligible(bad))
        self.assertEqual((site + ok).skus, [1, 0, 1])
        with self.assertRaises(ValueError):
            site + bad

    def test_boxes_keep_their_identity(self):
        rand = random.Random(0)
        boxes = Box.random(3, 4, rand)
        self.assertEqual(len({b.id for b in boxes}), 3)


class TestSolver(unittest.TestCase):
    def test_split_is_even_and_respects_eligibility(self):
        scenario = build_scenario(SMALL)
        volume = scenario.executions[0]
        totals = count_volume_skus(volume)
        target = [0.5 * v for v in totals]
        A, B = solve_assignment_to_target(
            volume, target, scenario.hosted_A, scenario.hosted_B, lambda_move=0.0
        )
        self.assertEqual(len(A), len(B))
        self.assertTrue(all(A.is_eligible(b) for b in A.boxes))
        self.assertEqual(
            sorted(x + y for x, y in zip(A.skus, B.skus)), sorted(totals)
        )


class TestRules(unittest.TestCase):
    def test_eligibility_overrides_the_players_share(self):
        rule = TargetRule(mode="proportional", share=0.5)
        shares = share_vector(rule, list(SMALL.hosted_skus_A), list(SMALL.hosted_skus_B))
        self.assertEqual(shares[2], 0.0)  # site A cannot host SKU 2
        self.assertEqual(shares[0], 0.5)

    def test_frozen_target_does_not_move(self):
        rule = TargetRule(mode="fixed", share=0.5)
        state = {"frozen_target": None, "anchor_totals": None}
        hosted_A, hosted_B = list(SMALL.hosted_skus_A), list(SMALL.hosted_skus_B)
        first = targets_for_execution(rule, state, [10] * 10, hosted_A, hosted_B)
        second = targets_for_execution(rule, state, [40] * 10, hosted_A, hosted_B)
        self.assertEqual(first, second)

    def test_proportional_target_follows_demand(self):
        rule = TargetRule(mode="proportional", share=0.5)
        state = {"frozen_target": None, "anchor_totals": None}
        hosted_A, hosted_B = list(SMALL.hosted_skus_A), list(SMALL.hosted_skus_B)
        targets_for_execution(rule, state, [10] * 10, hosted_A, hosted_B)
        later = targets_for_execution(rule, state, [40] * 10, hosted_A, hosted_B)
        self.assertEqual(later[0], 20.0)

    def test_baseline_is_live_fifty_fifty(self):
        self.assertEqual(BASELINE_RULE.mode, "proportional")
        self.assertEqual(BASELINE_RULE.share, 0.5)


class TestSignClash(unittest.TestCase):
    """The reason site error can exceed network error, stated as a test."""

    def test_same_signs_cost_nothing(self):
        a, b = 4, 3  # both factories above their final level
        self.assertEqual(abs(a) + abs(b), abs(a + b))

    def test_opposite_signs_add_twice_the_smaller_miss(self):
        a, b = 4, -3  # one above, one below
        self.assertEqual(abs(a) + abs(b), abs(a + b) + 2 * min(abs(a), abs(b)))

    def test_site_error_matches_the_sign_rule_on_a_real_run(self):
        from aoa.experiment import run_rule

        scenario = build_scenario(SMALL)
        payload = run_rule(scenario, BASELINE_RULE, time_limit_s=5)
        last = payload["executions"][-1]
        denom = sum(last["totals"]) or 1

        for t, ex in enumerate(payload["executions"]):
            extra = 0.0
            for k in range(SMALL.n_skus):
                a = ex["siteA"]["skus"][k] - last["siteA"]["skus"][k]
                b = ex["siteB"]["skus"][k] - last["siteB"]["skus"][k]
                if a * b < 0:
                    extra += 2 * min(abs(a), abs(b))
            self.assertAlmostEqual(payload["gap"][t], extra / denom, places=9)


class TestMetrics(unittest.TestCase):
    def test_error_is_zero_at_the_final_execution(self):
        from aoa.experiment import run_rule

        scenario = build_scenario(SMALL)
        payload = run_rule(scenario, BASELINE_RULE, time_limit_s=5)
        self.assertAlmostEqual(payload["globalWmape"][-1], 0.0)
        self.assertAlmostEqual(payload["siteWmape"][-1], 0.0)
        self.assertEqual(len(payload["executions"]), SMALL.n_executions)

    def test_gap_is_never_negative_for_a_consistent_history(self):
        scenario = build_scenario(SMALL)
        from aoa.experiment import run_rule

        payload = run_rule(scenario, BASELINE_RULE, time_limit_s=5)
        metrics = {"gap": payload["gap"]}
        self.assertTrue(all(g > -1e-9 for g in metrics["gap"]))


if __name__ == "__main__":
    unittest.main()
