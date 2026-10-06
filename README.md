# AOA toy model

A small, self-contained version of the AOA routing dynamics: boxes of SKUs, two factories, an
optimiser that splits the boxes, and an interactive page that animates the whole thing so you
can watch the error build up, follow individual SKUs, and try to beat the baseline.

The model classes come from the *AOA Toy Model — Including Eligibility* notebook. This repo keeps
those classes, drops the exploratory cells, and wraps the result in a web page.

**Live site:** <https://willbates13.github.io/routing-toy-model/>

## Quick start

```bash
./run.sh
```

That creates a virtual environment if one is missing, installs the single dependency, builds the
baseline run, and opens <http://127.0.0.1:8000>. On Windows, double-click `run.bat`.

Nothing to install by hand and no network needed at run time. If PuLP is missing entirely, a
pure-Python swap search stands in so the page still works on the standard library alone, but the
default path is the exact solver.

```bash
./setup.sh                                     # venv only
./.venv/bin/python main.py --port 8080         # different port
./.venv/bin/python -m unittest discover tests  # tests
```

## What the model is

| Piece | What it is |
|---|---|
| `Box` | A vector of SKU quantities - three to five of the twenty SKUs carry one to nine units, the rest are zero. A box goes to exactly one factory. |
| `Site` | A factory. Adds up the vectors it holds, and refuses any box needing a SKU it does not host. |
| Execution | One routing run over the current order volume. Between executions ten orders churn. |

Factory A does not host SKUs 2 or 15, so every box needing either is stuck at factory B. Both factories
always take the same number of boxes.

## What the optimiser does

Given a target SKU vector for factory A, it solves

```
min  sum_k |A_k - target_k|  +  lambda_move * (boxes that changed site)
```

subject to equal box counts, eligibility, and whole boxes. That is a mixed-integer program,
solved to proven optimality with CBC through PuLP on the local server and HiGHS WebAssembly in
the published browser experience. The optimiser never changes — the target does.

Two details keep it quick. Everything is scaled to whole numbers, so the objective is integral
and CBC can round its bound up and prune instead of chasing fractions; and CBC gets several
threads. A full sixteen-execution run takes a few seconds.

## The baseline

Every execution targets 56.06% of the current global SKU volume at factory A and 43.94% at
factory B. A sweep of constant shares—coarse five-point steps followed by a finer search around
the winner—selected this split for the fixed scenario. The target moves live with the orders;
eligibility still forces SKUs 2 and 15's targets at A to zero. This rule is the score to beat.

The baseline run is computed once and cached in `baseline.json`. Delete that file to rebuild it,
for example after changing the scenario.

## The two errors, and why they differ

Every execution before the last is a forecast of what each factory will pick; the last
execution is the actual. Both errors are the forecast measured against that actual.

Both are WMAPEs — absolute error summed across SKUs and divided by actual volume, so the large
SKUs carry more weight.

- **Global error** — `sum_k |forecast_k - actual_k| / sum_k actual_k` over global volume. It
  depends only on customer churn, so no routing rule can change it. It is the floor.
- **Site error** — `sum_k (|forecast A_k - actual A_k| + |forecast B_k - actual B_k|) / sum_k actual_k`.
  The same sum, but each factory's miss is taken before the sizes are added. The denominator is
  unchanged, because the two factories' actuals add up to the global actual, so the two errors are
  directly comparable.

Why they come apart is worth stating precisely. For one SKU, write the signed error at each
factory as `a = forecast A - actual A` and `b = forecast B - actual B`. The global error for
that SKU is `a + b`, because the two factories hold the whole volume between them.

- Same sign — both factories over their actual, or both under: `|a| + |b| = |a + b|`. Site
  error equals global error and the split costs nothing.
- Opposite signs: `|a| + |b| = |a + b| + 2·min(|a|, |b|)`. The two misses cancel in the global
  total, but both factories are still wrong, and that surplus is pure routing error.

So the gap between the curves is the sign disagreement, summed over SKUs. The follow-one-SKU
plot shows this arithmetic outright. Under the lines, each execution gets a column of numbers:

```
A forecast - actual     +8
B forecast - actual    -24
sites wrong by           32     <- |a| + |b|
global wrong by          16     <- |a + b|
the split costs          16     <- the difference, and 2 x min(|a|, |b|)
```

Those numbers are for the execution you are on and follow the scroll, so the sum plays out one
execution at a time. The last line greys out while the signs agree and turns red when they do
not.

Colour is consistent throughout: blue is factory A, orange is factory B, violet is the global
volume, and red is the cost the split adds.

The score is the sum of squared gaps across the horizon, so **lower is better** and one bad
execution hurts.

## The page

The walkthrough builds up one layer at a time as you scroll, and each layer is added in the same
order twice: boxes, then one SKU, then the aggregate.

1. **Demand** — the order volume only, no factories. The boxes and their SKU bars; then orders
   churning; then one SKU's journey; then every SKU added up into global error.
2. **Routing** — the same boxes split between the factories. The split and the box hops; then
   the same SKU at each factory, where the red columns appear; then the aggregate, with site
   error above global error and the gap between them shaded.
3. **Beat the baseline** — change the target rule, re-run every execution, and compare.

SKU chips are live in all three sections and share one selection, so picking a SKU in the first
section follows it all the way down.

## Beating the baseline

The published site includes a browser-based coding challenge. A visitor can paste a Python
function into the editor and run all sixteen executions without a backend. Strategy code runs
through Pyodide in a Web Worker with a two-second per-execution limit and receives two inputs:

```python
def set_targets(skus, context):
    return [
        units * 0.5606 if context["hostedAtA"][sku] else 0
        for sku, units in enumerate(skus)
    ]
```

- `skus` is the current global SKU-volume vector.
- `context["history"]` contains earlier `{"skus": [...], "target": [...]}` values; it also includes the
  execution number and both factories' SKU eligibility.
- The return value is the target SKU-volume vector for factory A.

The browser uses the same whole-box, equal-count and eligibility constraints as the Python model.
HiGHS 1.15.3 runs the MILP in a Web Worker and a result is accepted only when the solver reports
it as optimal. The cached swept-share baseline follows the same optimisation model.
The **Copy agent prompt** button gives an AI coding agent the full contract and scoring objective.
The page saves the visitor's best score and its Python function in local browser storage, so later
iterations cannot overwrite it. The saved code can be copied back to the clipboard from the scorecard.

## Publishing

Every push to `main` publishes the `web/` directory through GitHub Pages. The workflow copies the
cached scenario into the deployment artifact, so the public site is fully static and needs no
Python server. The deployment definition is in `.github/workflows/pages.yml`.

For local development, `./run.sh` still starts the Python server and exact solver.

## Built-in target rules

| Rule | Target for SKU *k* |
|---|---|
| Frozen | `share × total_k` at the first execution, then never moves. |
| Proportional | `share × total_k` at this execution. Follows demand as it drifts. A swept 56.06% share at A is the baseline. |
| Affine | first split, plus `share ×` the change in demand since. |
| Blend | a weighted mix of the frozen and proportional targets. |

You can also set a share per SKU, and change what it costs the optimiser to move a box. Where
eligibility leaves no choice the share is overridden — a SKU only factory B hosts always has a
target of zero at A.

To add a rule of your own, add a mode in `aoa/rules.py` and an option to the dropdown in
`web/index.html`. Everything else stays as it is.

## Layout

```
main.py             start the server
aoa/model.py        Box, Site
aoa/scenario.py     the execution stream and its config
aoa/solver.py       the mixed-integer assignment problem
aoa/rules.py        target rules - the part you change
aoa/metrics.py      the two error curves and the score
aoa/experiment.py   run a rule, shape the result, cache the baseline
aoa/server.py       static page plus two JSON endpoints
web/                the page, Python worker, and HiGHS worker
tests/              unit tests
```

Scenario size, SKU count, churn rate, eligibility and seed all live in `ScenarioConfig` in
`aoa/scenario.py`. The defaults — 64 boxes, 20 SKUs, 16 executions, 10 orders churning between
them, and three to five SKUs per box — create a more coupled routing problem while keeping a run
quick. More churn, denser boxes, and additional eligibility restrictions widen the gap; more boxes
primarily cost solve time.

One constraint when changing it: boxes needing a SKU that only one factory hosts are stuck
there, so if more than half of them end up stuck at the same factory the even split becomes
impossible. Scenario generation rejects any replacement that would cross that limit, while still
keeping the SKUs per box well under the catalogue size.
