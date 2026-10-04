/* Browser-only Python strategy runner used by the GitHub Pages build.

   A visitor supplies one Python function:

     def set_targets(skus, context): return target_for_factory_a

   The function is evaluated by Pyodide inside a Web Worker. Routing then uses
   the same whole-box, equal-count and eligibility constraints as the Python
   model, solved to optimality by HiGHS compiled to WebAssembly.
*/

(function (global) {
  "use strict";

  global.AOA_SOLVER_BUILD = 3;

  const STRATEGY_TIMEOUT_MS = 2000;
  const PYTHON_LOAD_TIMEOUT_MS = 60000;
  const SOLVER_LOAD_TIMEOUT_MS = 60000;
  const SOLVE_TIMEOUT_MS = 15000;
  let pythonWorker = null;
  let pythonReady = null;
  let pythonSequence = 0;
  const pythonPending = new Map();
  let solverWorker = null;
  let solverReady = null;
  let solverSequence = 0;
  const solverPending = new Map();

  const sumVectors = (vectors, n) => {
    const out = Array(n).fill(0);
    vectors.forEach((values) => values.forEach((v, k) => (out[k] += v)));
    return out;
  };

  const l1 = (values, target) =>
    values.reduce((total, value, k) => total + Math.abs(value - target[k]), 0);

  function validateTarget(value, nSkus) {
    if (!Array.isArray(value) || value.length !== nSkus) {
      throw new Error(`set_targets must return a list of ${nSkus} numbers.`);
    }
    return value.map((entry, k) => {
      const number = Number(entry);
      if (!Number.isFinite(number)) throw new Error(`Target for SKU ${k} is not a finite number.`);
      return number;
    });
  }

  function stopPythonWorker(error) {
    if (pythonWorker) pythonWorker.terminate();
    pythonWorker = null;
    pythonReady = null;
    for (const pending of pythonPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pythonPending.clear();
  }

  function ensurePythonWorker(onStatus) {
    if (pythonReady) return pythonReady;
    if (onStatus) onStatus("Loading the Python runtime (first run only)...");
    pythonWorker = new Worker(new URL("python-worker.mjs", window.location.href), { type: "module" });
    pythonReady = new Promise((resolve, reject) => {
      const loadTimer = setTimeout(() => {
        const error = new Error("The Python runtime took too long to load. Check your connection and try again.");
        stopPythonWorker(error);
        reject(error);
      }, PYTHON_LOAD_TIMEOUT_MS);

      pythonWorker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "ready") {
          clearTimeout(loadTimer);
          if (onStatus) onStatus("Python ready. Running your strategy...");
          resolve(pythonWorker);
          return;
        }
        if (message.type !== "result") return;
        const pending = pythonPending.get(message.id);
        if (!pending) return;
        pythonPending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error));
      };
      pythonWorker.onerror = (event) => {
        clearTimeout(loadTimer);
        const error = new Error(event.message || "The Python runtime failed to load.");
        stopPythonWorker(error);
        reject(error);
      };
    });
    return pythonReady;
  }

  async function evaluateStrategy(
    code,
    skus,
    context,
    timeoutMs = STRATEGY_TIMEOUT_MS,
    onStatus = null
  ) {
    const worker = await ensurePythonWorker(onStatus);
    const id = ++pythonSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Strategy took longer than ${timeoutMs} ms at execution ${context.execution + 1}.`);
        stopPythonWorker(error);
      }, timeoutMs);
      pythonPending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: "run", id, code, skus, context });
    });
  }

  function stopSolverWorker(error) {
    if (solverWorker) solverWorker.terminate();
    solverWorker = null;
    solverReady = null;
    for (const pending of solverPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    solverPending.clear();
  }

  function ensureSolverWorker(onStatus) {
    if (solverReady) return solverReady;
    if (onStatus) onStatus("Loading the exact optimiser (first run only)...");
    solverWorker = new Worker(new URL("highs-worker.mjs", window.location.href), { type: "module" });
    solverReady = new Promise((resolve, reject) => {
      const loadTimer = setTimeout(() => {
        const error = new Error("The exact optimiser took too long to load. Check your connection and try again.");
        stopSolverWorker(error);
        reject(error);
      }, SOLVER_LOAD_TIMEOUT_MS);

      solverWorker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "ready") {
          clearTimeout(loadTimer);
          if (onStatus) onStatus("Exact optimiser ready. Routing the boxes...");
          resolve(solverWorker);
          return;
        }
        if (message.type !== "result") return;
        const pending = solverPending.get(message.id);
        if (!pending) return;
        solverPending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message);
        else pending.reject(new Error(message.error));
      };
      solverWorker.onerror = (event) => {
        clearTimeout(loadTimer);
        const error = new Error(event.message || "The exact optimiser failed to load.");
        stopSolverWorker(error);
        reject(error);
      };
    });
    return solverReady;
  }

  function buildExecutionData(boxes, hostedA, hostedB) {
    const n = boxes.length;
    const nSkus = hostedA.length;
    if (!n || n % 2) throw new Error("Every execution needs a non-empty, even number of boxes.");

    const eligibleA = boxes.map((box) =>
      typeof box.eligibleA === "boolean"
        ? box.eligibleA
        : box.skus.every((v, k) => !v || hostedA[k])
    );
    const eligibleB = boxes.map((box) => box.skus.every((v, k) => !v || hostedB[k]));
    const forcedA = [];
    const forcedB = [];
    boxes.forEach((box, i) => {
      if (!eligibleA[i] && !eligibleB[i]) throw new Error(`Box ${box.id} cannot be routed to either factory.`);
      if (eligibleA[i] && !eligibleB[i]) forcedA.push(i);
      if (!eligibleA[i] && eligibleB[i]) forcedB.push(i);
    });
    if (forcedA.length > n / 2 || forcedB.length > n / 2) {
      throw new Error("Equal box counts are infeasible for this execution.");
    }

    const totals = sumVectors(boxes.map((box) => box.skus), nSkus);
    const lowerA = sumVectors(forcedA.map((i) => boxes[i].skus), nSkus);
    const forcedBSkus = sumVectors(forcedB.map((i) => boxes[i].skus), nSkus);
    return {
      n,
      nSkus,
      boxes,
      eligibleA,
      eligibleB,
      forcedA,
      forcedB,
      totals,
      lowerA,
      upperA: totals.map((v, k) => v - forcedBSkus[k]),
    };
  }

  function movedCount(data, toA, previousAIds) {
    if (!previousAIds.size) return 0;
    return data.boxes.reduce(
      (count, box, i) => count + (previousAIds.has(box.id) !== toA[i] ? 1 : 0),
      0
    );
  }

  async function solveAssignmentExact(
    boxes,
    requestedTarget,
    hostedA,
    hostedB,
    previousAIds,
    lambdaMove,
    onStatus = null
  ) {
    const data = buildExecutionData(boxes, hostedA, hostedB);
    const target = requestedTarget.map((v, k) =>
      Math.min(Math.max(Number(v), data.lowerA[k]), data.upperA[k])
    );
    const worker = await ensureSolverWorker(onStatus);
    const id = ++solverSequence;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("The exact optimiser took longer than 15 seconds.");
        stopSolverWorker(error);
      }, SOLVE_TIMEOUT_MS);
      solverPending.set(id, { resolve, reject, timer });
      worker.postMessage({
        type: "solve",
        id,
        problem: {
          boxes,
          target,
          eligibleA: data.eligibleA,
          eligibleB: data.eligibleB,
          previousAIds: [...previousAIds],
          lambdaMove,
        },
      });
    });
    const aTotals = sumVectors(
      boxes.filter((_, i) => result.toA[i]).map((box) => box.skus),
      data.nSkus
    );
    return { toA: result.toA, target, aTotals, status: result.status, objective: result.objective };
  }

  function solveAssignment(boxes, requestedTarget, hostedA, hostedB, previousAIds, lambdaMove) {
    const data = buildExecutionData(boxes, hostedA, hostedB);
    const target = requestedTarget.map((v, k) =>
      Math.min(Math.max(Number(v), data.lowerA[k]), data.upperA[k])
    );
    const toA = Array(data.n).fill(false);
    data.forcedA.forEach((i) => (toA[i] = true));

    let aTotals = sumVectors(data.forcedA.map((i) => boxes[i].skus), data.nSkus);
    const forced = new Set([...data.forcedA, ...data.forcedB]);
    const flexible = boxes.map((_, i) => i).filter((i) => !forced.has(i));
    const remaining = new Set(flexible);

    while (toA.filter(Boolean).length < data.n / 2) {
      let best = null;
      let bestCost = Infinity;
      for (const i of remaining) {
        const candidate = aTotals.map((v, k) => v + boxes[i].skus[k]);
        const cost = l1(candidate, target);
        if (cost < bestCost) {
          best = i;
          bestCost = cost;
        }
      }
      if (best === null) throw new Error("Could not construct an equal-box assignment.");
      toA[best] = true;
      remaining.delete(best);
      aTotals = aTotals.map((v, k) => v + boxes[best].skus[k]);
    }

    let improved = true;
    let passes = 0;
    while (improved && passes < 200) {
      improved = false;
      passes += 1;
      let current = l1(aTotals, target) + lambdaMove * movedCount(data, toA, previousAIds);
      for (const i of flexible) {
        if (!toA[i]) continue;
        for (const j of flexible) {
          if (toA[j]) continue;
          const candidate = aTotals.map((v, k) => v - boxes[i].skus[k] + boxes[j].skus[k]);
          toA[i] = false;
          toA[j] = true;
          const cost = l1(candidate, target) + lambdaMove * movedCount(data, toA, previousAIds);
          if (cost < current - 1e-9) {
            aTotals = candidate;
            current = cost;
            improved = true;
            break;
          }
          toA[i] = true;
          toA[j] = false;
        }
        if (improved) break;
      }
    }

    return { toA, target, aTotals };
  }

  function evaluateRun(executions, aHistory, bHistory) {
    const finalTotals = executions[executions.length - 1].totals;
    const denominator = finalTotals.reduce((a, b) => a + b, 0) || 1;
    const finalA = aHistory[aHistory.length - 1];
    const finalB = bHistory[bHistory.length - 1];
    const globalWmape = executions.map((execution) => l1(execution.totals, finalTotals) / denominator);
    const siteWmape = executions.map(
      (_, i) => (l1(aHistory[i], finalA) + l1(bHistory[i], finalB)) / denominator
    );
    const gap = siteWmape.map((value, i) => value - globalWmape[i]);
    return {
      globalWmape,
      siteWmape,
      gap,
      score: gap.reduce((total, value) => total + value * value, 0),
      meanGap: gap.reduce((a, b) => a + b, 0) / gap.length,
      maxGap: Math.max(...gap),
    };
  }

  async function runCustomStrategy(baseline, code, options = {}) {
    const lambdaMove = Number.isFinite(options.lambdaMove) ? options.lambdaMove : 0.05;
    const hostedA = baseline.hostedA.slice();
    const hostedB = baseline.hostedB.slice();
    const history = [];
    const aHistory = [];
    const bHistory = [];
    const routedExecutions = [];
    let previousAIds = new Set();

    for (let i = 0; i < baseline.executions.length; i += 1) {
      const source = baseline.executions[i];
      const skus = source.totals.slice();
      const context = {
        execution: i,
        nExecutions: baseline.executions.length,
        history: history.map((entry) => ({ skus: entry.skus.slice(), target: entry.target.slice() })),
        hostedAtA: hostedA.slice(),
        hostedAtB: hostedB.slice(),
      };
      const rawTarget = await evaluateStrategy(
        code,
        skus.slice(),
        context,
        options.timeoutMs,
        options.onStatus
      );
      const requestedTarget = validateTarget(rawTarget, baseline.nSkus);
      const solved = await solveAssignmentExact(
        source.boxes,
        requestedTarget,
        hostedA,
        hostedB,
        previousAIds,
        lambdaMove,
        options.onStatus
      );
      const inA = new Set(source.boxes.filter((_, boxIndex) => solved.toA[boxIndex]).map((box) => box.id));
      const siteA = solved.aTotals.slice();
      const siteB = skus.map((v, k) => v - siteA[k]);
      const moved = i === 0 ? 0 : [...inA].filter((id) => !previousAIds.has(id)).length;

      aHistory.push(siteA);
      bHistory.push(siteB);
      history.push({ skus: skus.slice(), target: solved.target.slice() });
      routedExecutions.push({
        index: i,
        boxes: source.boxes.map((box) => ({ ...box, site: inA.has(box.id) ? "A" : "B" })),
        totals: skus,
        targetA: solved.target.map((v) => Math.round(v * 100) / 100),
        siteA: { skus: siteA, boxes: inA.size, units: siteA.reduce((a, b) => a + b, 0) },
        siteB: { skus: siteB, boxes: source.boxes.length - inA.size, units: siteB.reduce((a, b) => a + b, 0) },
        moved,
      });
      previousAIds = inA;
    }

    const metrics = evaluateRun(routedExecutions, aHistory, bHistory);
    routedExecutions.forEach((execution, i) => {
      execution.globalWmape = metrics.globalWmape[i];
      execution.siteWmape = metrics.siteWmape[i];
      execution.gap = metrics.gap[i];
    });

    return {
      label: options.label || "Your code",
      rule: { mode: "custom code", lambda_move: lambdaMove },
      score: metrics.score,
      meanGap: metrics.meanGap,
      maxGap: metrics.maxGap,
      globalWmape: metrics.globalWmape,
      siteWmape: metrics.siteWmape,
      gap: metrics.gap,
      executions: routedExecutions,
      hostedA,
      hostedB,
      nSkus: baseline.nSkus,
      nBoxes: baseline.nBoxes,
    };
  }

  global.AOABrowser = {
    evaluateStrategy,
    runCustomStrategy,
    solveAssignment,
    solveAssignmentExact,
    validateTarget,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.AOABrowser;
  }
})(typeof window !== "undefined" ? window : globalThis);
