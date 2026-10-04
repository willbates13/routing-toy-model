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

function buildModel({ boxes, target, eligibleA, eligibleB, previousAIds, lambdaMove }) {
  const boxNames = boxes.map((_, i) => `x${i}`);
  const deviationNames = target.map((_, k) => `d${k}`);
  const previous = new Set(previousAIds);
  const objectiveTerms = deviationNames.map((name) => [1, name]);

  if (previous.size) {
    boxes.forEach((box, i) => {
      objectiveTerms.push([previous.has(box.id) ? -lambdaMove : lambdaMove, boxNames[i]]);
    });
  }

  const rows = [` half: ${expression(boxNames.map((name) => [1, name]))} = ${boxes.length / 2}`];
  target.forEach((value, k) => {
    const skuTerms = boxes.map((box, i) => [Number(box.skus[k] || 0), boxNames[i]]);
    rows.push(` sku_pos_${k}: ${expression([...skuTerms, [-1, deviationNames[k]]])} <= ${value}`);
    rows.push(` sku_neg_${k}: ${expression([...skuTerms.map(([coef, name]) => [-coef, name]), [-1, deviationNames[k]]])} <= ${-value}`);
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
