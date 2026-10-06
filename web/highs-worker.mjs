import loadHighs from "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/highs.mjs";

const HIGHS_ROOT = "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/";
const highs = await loadHighs({ locateFile: (file) => `${HIGHS_ROOT}${file}` });

self.postMessage({ type: "ready" });

const term = (coefficient, name) => {
  if (!coefficient) return "";
  const sign = coefficient < 0 ? " - " : " + ";
  const magnitude = Math.abs(coefficient);
  const number = magnitude === 1 ? "" : `${magnitude} `;
  return `${sign}${number}${name}`;
};

const expression = (terms) => {
  const text = terms.map(([coefficient, name]) => term(coefficient, name)).join("");
  if (!text) return "0";
  return text.startsWith(" + ") ? text.slice(3) : text.startsWith(" - ") ? `-${text.slice(3)}` : text;
};

function buildModel({ boxes, target, eligibleA, eligibleB, previousAIds, referenceAIds, lambdaMove }) {
  const boxNames = boxes.map((_, i) => `x${i}`);
  const deviationNames = target.map((_, k) => `d${k}`);
  const previous = new Set(previousAIds);
  const reference = new Set(referenceAIds || []);
  // Work in half-units with an integer objective. The integral lower bound lets
  // HiGHS prune the wide routing tree much earlier than the equivalent
  // fractional model, which matters once the browser is routing dozens of boxes.
  const objectiveTerms = deviationNames.map((name) => [5000, name]);
  const moveWeight = Math.round(10000 * lambdaMove);

  if (previous.size) {
    boxes.forEach((box, i) => {
      objectiveTerms.push([previous.has(box.id) ? -moveWeight : moveWeight, boxNames[i]]);
    });
  }
  // A final, tiny deterministic tie-break favours the cached reference route.
  // It cannot outweigh one move or half a unit of target error.
  boxes.forEach((box, i) => {
    objectiveTerms.push([reference.has(box.id) ? -1 : 1, boxNames[i]]);
  });

  const rows = [` half: ${expression(boxNames.map((name) => [1, name]))} = ${boxes.length / 2}`];
  target.forEach((value, k) => {
    const target2x = Math.round(Number(value) * 2);
    const skuTerms = boxes.map((box, i) => [Number(box.skus[k] || 0) * 2, boxNames[i]]);
    rows.push(` sku_pos_${k}: ${expression([...skuTerms, [-1, deviationNames[k]]])} <= ${target2x}`);
    rows.push(` sku_neg_${k}: ${expression([...skuTerms.map(([coef, name]) => [-coef, name]), [-1, deviationNames[k]]])} <= ${-target2x}`);
  });

  const bounds = [];
  boxes.forEach((_, i) => {
    if (!eligibleA[i]) bounds.push(` ${boxNames[i]} = 0`);
    if (!eligibleB[i]) bounds.push(` ${boxNames[i]} = 1`);
  });
  deviationNames.forEach((name) => bounds.push(` ${name} >= 0`));

  return [
    "Minimize",
    ` objective: ${expression(objectiveTerms)}`,
    "Subject To",
    ...rows,
    "Bounds",
    ...bounds,
    "Generals",
    ` ${deviationNames.join(" ")}`,
    "Binaries",
    ` ${boxNames.join(" ")}`,
    "End",
  ].join("\n");
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "solve") return;

  try {
    const model = buildModel(message.problem);
    const result = highs.solve(model, {
      output_flag: false,
      presolve: "on",
      mip_rel_gap: 0,
      time_limit: 10,
    });
    if (result.Status !== "Optimal") {
      throw new Error(`Exact optimiser finished with status: ${result.Status}`);
    }
    const toA = message.problem.boxes.map((_, i) => result.Columns[`x${i}`].Primal >= 0.5);
    self.postMessage({
      type: "result",
      id: message.id,
      ok: true,
      toA,
      objective: result.ObjectiveValue,
      status: result.Status,
    });
  } catch (error) {
    self.postMessage({
      type: "result",
      id: message.id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
