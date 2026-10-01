/* AOA toy model - the page.

   One Stage class draws three stacked layers: the boxes, one SKU's journey, and
   the error curve. The walkthrough reveals them one at a time as you scroll -
   each step names the layers it wants. The explorer shows all of them at once,
   with the numbers turned on. */

window.AOA_APP_BUILD = 9;

const COLORS = {
  ink: "#16150f",
  muted: "#86847a",
  line: "#ddd9cd",
  lineSoft: "#e9e6dc",
  panel: "#fbfaf7",
  surface: "#fcfcfb",
  A: "#2a78d6",
  B: "#eb6834",
  net: "#4a3aa7",
  site: "#b23b32",
  compare: "#1baf7a",
  clash: "#b23b32",
  good: "#1b7f4b",
  textSecondary: "#57564f",
};

const SERIF = "'Iowan Old Style', Palatino, Georgia, serif";
const MONO = "ui-monospace, Menlo, monospace";
const SANS = "ui-sans-serif, -apple-system, sans-serif";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const pct = (v, dp = 1) => `${(v * 100).toFixed(dp)}%`;

const errOf = (s, i) => Math.round(s.data[i] - s.final);
const signedText = (v) => (v > 0 ? `+${v}` : v < 0 ? `-${Math.abs(v)}` : "0");

const AGENT_PROMPT = `You are writing a Python target-setting strategy for an interactive factory-routing challenge.

The simulation has 14 SKUs, 48 indivisible customer boxes, two factories, and 12 executions. Every box contains several SKUs. Each execution changes the global order volume. Factory A cannot host SKU 2; factory B hosts every SKU. The optimiser must send exactly half the boxes to each factory, keep boxes whole, and respect eligibility.

Your only job is to decide the target SKU-volume vector for factory A. The browser will optimise the box assignment toward that target and score the result. Lower is better. The score is the sum of squared gaps between site WMAPE and global WMAPE across executions. Added site error occurs when the signed forecast errors at the two factories point in opposite directions.

Write exactly one plain Python function with this signature:

def set_targets(skus, context):
    # return one finite target number per SKU for factory A

Inputs:
- skus: an array of current global units for SKU 0, SKU 1, and so on.
- context["execution"]: zero-based execution number.
- context["nExecutions"]: total execution count.
- context["history"]: earlier executions only, as {"skus": [...], "target": [...]} dictionaries.
- context["hostedAtA"] / context["hostedAtB"]: Boolean eligibility lists by SKU.

Output:
- Return a list with exactly the same length as skus. Each number is factory A's target units for that SKU.
- Return 0 for any SKU factory A cannot host.

Constraints:
- Use no external packages, network calls, browser APIs, or external state.
- The function must finish quickly and be deterministic.
- Do not include Markdown fences or explanation in your answer—return only the function code, ready to paste.

My idea for the strategy:
[DESCRIBE YOUR IDEA HERE]`;

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r, topOnly = false) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  if (topOnly) {
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  }
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/* ------------------------------------------------------------------ Stage */

class Stage {
  constructor(root, { mode = "split", skuMode = "sites", values = false, layers = "boxes sku chart" } = {}) {
    this.root = root;
    this.mode = mode; // "pool" = the order book, "split" = the two factories
    this.skuMode = skuMode; // "global" = network total, "sites" = per factory
    this.values = values; // print numbers, or stay purely visual
    this.canvas = root.querySelector("canvas.flow");
    this.chart = root.querySelector("canvas.chart");
    this.skuCanvas = root.querySelector("canvas.sku");
    this.ctx = this.canvas.getContext("2d");
    this.cctx = this.chart ? this.chart.getContext("2d") : null;
    this.sctx = this.skuCanvas ? this.skuCanvas.getContext("2d") : null;
    this.host = root.querySelector(".stage") || root;
    this.run = null;
    this.compare = null;
    this.sku = 0;
    this.t = 0;
    this.setLayers(layers, false);
    window.addEventListener("resize", () => this.resize());
  }

  setLayers(spec, redraw = true) {
    this.layers = new Set(spec.split(" ").filter(Boolean));
    this.host.dataset.layers = [...this.layers].join(" ");
    if (redraw && this.run) this.resize();
  }

  setRun(run, compare = null) {
    this.run = run;
    this.compare = compare;
    this.maxSku = 1;
    run.executions.forEach((ex) => ex.totals.forEach((v) => (this.maxSku = Math.max(this.maxSku, v))));
    this.resize();
  }

  setSku(k) {
    this.sku = k;
    if (this.run) this.render(this.t);
  }

  resize() {
    if (!this.run) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.parentElement.clientWidth - 28;
    const vh = window.innerHeight;
    const showSku = this.layers.has("sku") && this.skuCanvas;
    const showChart = this.layers.has("chart") && this.chart;

    this.chartHeight = showChart ? clamp(vh * 0.15, 106, 150) : 0;
    this.skuHeight = showSku ? clamp(vh * 0.38, 275, 360) : 0;
    const overhead = 150 + (showSku ? 46 : 0);
    this.height = clamp(vh - overhead - this.chartHeight - this.skuHeight, 195, 560);
    this.w = w;

    const surfaces = [[this.canvas, this.height]];
    if (showChart) surfaces.push([this.chart, this.chartHeight]);
    if (showSku) surfaces.push([this.skuCanvas, this.skuHeight]);
    for (const [cv, h] of surfaces) {
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.height = `${h}px`;
      cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.layout();
    this.render(this.t);
  }

  /* Geometry, plus a fixed slot for every box in every execution, so a box can
     be tweened from where it sat last execution to where it sits now. */
  layout() {
    const PAD = 14;
    const W = this.w;
    const H = this.height;

    if (this.mode === "pool") {
      this.panels = { P: { x: PAD, y: 0, w: W - PAD * 2, h: H } };
    } else {
      const panelW = (W - PAD * 3) / 2;
      this.panels = {
        A: { x: PAD, y: 0, w: panelW, h: H },
        B: { x: PAD * 2 + panelW, y: 0, w: panelW, h: H },
      };
    }

    const perPanel = this.mode === "pool" ? this.run.nBoxes : Math.ceil(this.run.nBoxes / 2);
    const anyPanel = Object.values(this.panels)[0];
    const bandTop = 48;
    const bandH = Math.max(60, H - 158);
    let pitch = 16;
    for (let cand = 58; cand >= 16; cand -= 1) {
      const cols = Math.max(3, Math.floor((anyPanel.w - 24) / cand));
      if (Math.ceil(perPanel / cols) * cand <= bandH) {
        pitch = cand;
        break;
      }
    }
    this.grid = { pitch, size: Math.round(pitch * 0.84) };

    const slotOf = this.stableSlots();
    this.positions = this.run.executions.map((ex) => {
      const counters = { P: 0, A: 0, B: 0 };
      const map = new Map();
      for (const box of [...ex.boxes].sort((a, b) => slotOf.get(a.id) - slotOf.get(b.id))) {
        const key = this.mode === "pool" ? "P" : box.site;
        const pan = this.panels[key];
        const cols = Math.max(3, Math.floor((pan.w - 24) / pitch));
        const rows = Math.ceil(perPanel / cols);
        const i = counters[key]++;
        map.set(box.id, {
          x: pan.x + (pan.w - cols * pitch) / 2 + pitch / 2 + (i % cols) * pitch,
          y: bandTop + Math.max(0, (bandH - rows * pitch) / 2) + Math.floor(i / cols) * pitch,
          site: key,
          box,
        });
      }
      return map;
    });
  }

  /* A box keeps its place in the grid for as long as it is in the order book,
     and a new order takes the slot the box it replaced has just left. Without
     this every tile shuffles along by one whenever a single order changes. */
  stableSlots() {
    const slotOf = new Map();
    const occupant = [];
    for (const ex of this.run.executions) {
      const present = new Set(ex.boxes.map((b) => b.id));
      occupant.forEach((id, i) => {
        if (id !== undefined && !present.has(id)) occupant[i] = undefined;
      });
      for (const box of ex.boxes) {
        if (slotOf.has(box.id)) continue;
        let slot = occupant.findIndex((id) => id === undefined);
        if (slot === -1) slot = occupant.length;
        occupant[slot] = box.id;
        slotOf.set(box.id, slot);
      }
    }
    return slotOf;
  }

  render(t) {
    if (!this.run) return;
    this.t = t;
    const n = this.run.executions.length;
    const i0 = clamp(Math.floor(t), 0, n - 1);
    const i1 = clamp(i0 + 1, 0, n - 1);
    const raw = clamp(t - i0, 0, 1);
    const p = ease(clamp(raw / 0.65, 0, 1)); // boxes land, then the lines settle
    this.head = clamp(i0 + clamp(raw / 0.65, 0, 1), 0, n - 1);
    this.drawFlow(i0, i1, p);
    if (this.cctx && this.layers.has("chart")) this.drawChart();
    if (this.sctx && this.layers.has("sku")) this.drawSkuPanel();
  }

  /* ------------------------------------------------------------ the boxes */

  drawFlow(i0, i1, p) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.height);

    const exA = this.run.executions[i0];
    const exB = this.run.executions[i1];

    if (this.mode === "pool") {
      this.drawPanel("P", exA, exB, p, "All orders");
    } else {
      this.drawPanel("A", exA, exB, p, "Factory A");
      this.drawPanel("B", exA, exB, p, "Factory B");
    }

    const from = this.positions[i0];
    const to = this.positions[i1];
    const ids = new Set([...from.keys(), ...to.keys()]);

    if (this.mode === "split") {
      ctx.lineWidth = 1;
      for (const id of ids) {
        const a = from.get(id);
        const b = to.get(id);
        if (!a || !b || a.site === b.site) continue;
        ctx.strokeStyle = hexToRgba(COLORS[b.site], 0.2 * (1 - Math.abs(p - 0.5) * 2) + 0.05);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 70, b.x, b.y);
        ctx.stroke();
      }
    }

    for (const id of ids) {
      const a = from.get(id);
      const b = to.get(id);
      if (a && b) {
        const hop = a.site !== b.site;
        this.drawBox(
          lerp(a.x, b.x, p),
          lerp(a.y, b.y, p) - (hop ? Math.sin(p * Math.PI) * 55 : 0),
          p < 0.5 ? a.box : b.box,
          p < 0.5 ? a.site : b.site,
          1,
          hop ? 1 + Math.sin(p * Math.PI) * 0.2 : 1
        );
      } else if (b) {
        this.drawBox(b.x, b.y - (1 - p) * 24, b.box, b.site, p, 1); // new order
      } else if (a) {
        this.drawBox(a.x, a.y + p * 24, a.box, a.site, 1 - p, 1); // order changed away
      }
    }
  }

  boxColor(site) {
    return site === "P" ? COLORS.net : COLORS[site];
  }

  drawBox(x, y, box, site, alpha, scale) {
    const ctx = this.ctx;
    const s = this.grid.size * scale;
    const nSku = this.run.nSkus;
    const cols = Math.min(5, nSku);
    const rows = Math.ceil(nSku / cols);
    const tint = this.boxColor(site);
    const dim = this.layers.has("sku") && !box.skus[this.sku] ? 0.28 : 1;
    const stuck = this.mode === "split" && !box.eligibleA;

    ctx.globalAlpha = clamp(alpha, 0, 1) * dim;
    roundRect(ctx, x - s / 2, y - s / 2, s, s, 5);
    ctx.fillStyle = hexToRgba(tint, 0.08);
    ctx.fill();
    ctx.strokeStyle = stuck ? COLORS.ink : hexToRgba(tint, 0.4);
    ctx.lineWidth = stuck ? 1.6 : 1;
    ctx.stroke();

    // the box is its SKU vector, so draw the vector: one cell per SKU
    const inset = s * 0.12;
    const cw = (s - inset * 2) / cols;
    const ch = (s - inset * 2) / rows;
    for (let k = 0; k < nSku; k++) {
      const cx = x - s / 2 + inset + (k % cols) * cw;
      const cy = y - s / 2 + inset + Math.floor(k / cols) * ch;
      const units = box.skus[k];
      ctx.fillStyle = units ? hexToRgba(tint, 0.3 + 0.7 * (units / 9)) : hexToRgba(COLORS.muted, 0.12);
      roundRect(ctx, cx + 0.3, cy + 0.3, cw - 1, ch - 1, 1.2);
      ctx.fill();
      if (k === this.sku && units && this.layers.has("sku")) {
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 1.2;
        roundRect(ctx, cx - 0.3, cy - 0.3, cw - 0.4, ch - 0.4, 1.8);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawPanel(key, exA, exB, p, title) {
    const ctx = this.ctx;
    const pan = this.panels[key];
    const pool = key === "P";
    const hosted = pool ? null : key === "A" ? this.run.hostedA : this.run.hostedB;
    const tint = this.boxColor(key);

    roundRect(ctx, pan.x, pan.y + 1, pan.w, pan.h - 2, 14);
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    const pick = (ex) =>
      pool
        ? { skus: ex.totals, boxes: ex.boxes.length }
        : key === "A"
        ? ex.siteA
        : ex.siteB;
    const sA = pick(exA);
    const sB = pick(exB);

    ctx.fillStyle = COLORS.ink;
    ctx.font = `500 16px ${SERIF}`;
    ctx.textAlign = "left";
    ctx.fillText(title, pan.x + 16, pan.y + 25);

    if (this.values) {
      ctx.font = `11.5px ${MONO}`;
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(lerp(sA.boxes, sB.boxes, p))} boxes`, pan.x + pan.w - 16, pan.y + 25);
      ctx.textAlign = "left";
    }

    // SKU bars along the foot, with a marker at the final execution's level
    const nSku = this.run.nSkus;
    const last = this.run.executions[this.run.executions.length - 1];
    const finalLevel = pool ? last.totals : key === "A" ? last.siteA.skus : last.siteB.skus;
    const barsX = pan.x + 16;
    const barsW = pan.w - 32;
    const slot = barsW / nSku;
    const baseY = pan.y + pan.h - 28;
    const maxH = 78;

    ctx.strokeStyle = COLORS.lineSoft;
    ctx.beginPath();
    ctx.moveTo(barsX, baseY + 0.5);
    ctx.lineTo(barsX + barsW, baseY + 0.5);
    ctx.stroke();

    for (let k = 0; k < nSku; k++) {
      const v = lerp(sA.skus[k] || 0, sB.skus[k] || 0, p);
      const h = (v / this.maxSku) * maxH;
      const x = barsX + k * slot + 2;
      const w = slot - 4;
      const faded = this.layers.has("sku") && k !== this.sku;

      if (hosted && !hosted[k]) {
        ctx.fillStyle = hexToRgba(COLORS.muted, 0.1);
        roundRect(ctx, x, baseY - maxH, w, maxH, 3);
        ctx.fill();
      } else if (h > 0.5) {
        ctx.fillStyle = hexToRgba(tint, faded ? 0.3 : 0.85);
        roundRect(ctx, x, baseY - h, w, h, 3, true);
        ctx.fill();
      }

      const fy = baseY - ((finalLevel[k] || 0) / this.maxSku) * maxH;
      ctx.strokeStyle = hexToRgba(COLORS.ink, faded ? 0.2 : 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x - 1, fy);
      ctx.lineTo(x + w + 1, fy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = k === this.sku && this.layers.has("sku") ? COLORS.ink : COLORS.muted;
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText(k, x + w / 2, baseY + 13);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = COLORS.muted;
    ctx.font = `10.5px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText("forecast units per SKU · dashed = actual", barsX, baseY + 26);
  }

  /* -------------------------------------------------- one SKU, one plot */

  /* One SKU across the run. Each factory's line has a dashed finish line - where
     that SKU ends up - and a column at every execution showing how far off it
     is. The strip underneath does the arithmetic: the two signed errors, their
     absolute sum (what the sites are wrong by) and the absolute sum of the two
     signed errors (what the network is wrong by). The two agree while the signs
     agree; when they clash the site row runs ahead, and that difference is the
     cost of the split. */
  drawSkuPanel() {
    const ctx = this.sctx;
    const W = this.w;
    const H = this.skuHeight;
    const k = this.sku;
    ctx.clearRect(0, 0, W, H);

    const ex = this.run.executions;
    const n = ex.length;
    const last = ex[n - 1];
    const sites = this.skuMode === "sites";

    const totals = {
      data: ex.map((e) => e.totals[k] || 0),
      final: last.totals[k] || 0,
      color: COLORS.net,
      label: "All orders",
    };
    const series = sites
      ? [
          { ...totals, thin: true },
          {
            data: ex.map((e) => e.siteA.skus[k] || 0),
            final: last.siteA.skus[k] || 0,
            color: COLORS.A,
            label: "Factory A",
            cols: true,
          },
          {
            data: ex.map((e) => e.siteB.skus[k] || 0),
            final: last.siteB.skus[k] || 0,
            color: COLORS.B,
            label: "Factory B",
            cols: true,
          },
        ]
      : [{ ...totals, cols: true }];

    const rows = sites
      ? [
          { label: "A forecast − actual", color: COLORS.A, get: (i) => signedText(errOf(series[1], i)) },
          { label: "B forecast − actual", color: COLORS.B, get: (i) => signedText(errOf(series[2], i)) },
          {
            label: "sites wrong by",
            color: COLORS.site,
            strong: true,
            get: (i) => `${Math.abs(errOf(series[1], i)) + Math.abs(errOf(series[2], i))}`,
          },
          {
            label: "network wrong by",
            color: COLORS.net,
            strong: true,
            get: (i) => `${Math.abs(errOf(series[1], i) + errOf(series[2], i))}`,
          },
          {
            label: "the split costs",
            color: COLORS.clash,
            strong: true,
            cost: true,
            get: (i) => {
              const a = errOf(series[1], i);
              const b = errOf(series[2], i);
              return `${Math.abs(a) + Math.abs(b) - Math.abs(a + b)}`;
            },
          },
        ]
      : [
          { label: "forecast − actual", color: COLORS.net, get: (i) => signedText(errOf(series[0], i)) },
          { label: "wrong by", color: COLORS.ink, strong: true, get: (i) => `${Math.abs(errOf(series[0], i))}` },
        ];

    const rowH = 15;
    const m = { l: 96, r: 92, t: 28 };
    const stripH = rows.length * rowH + 16;
    const plotW = W - m.l - m.r;
    const plotH = H - m.t - stripH - 8;
    const maxY = Math.max(...series.flatMap((s) => s.data), ...series.map((s) => s.final), 1) * 1.16;
    const X = (i) => m.l + (plotW * i) / (n - 1);
    const Y = (v) => m.t + plotH - (v / maxY) * plotH;
    const slot = plotW / (n - 1);
    const head = this.head;
    const iHead = Math.round(head);

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `500 15px ${SERIF}`;
    ctx.fillText(`SKU ${k}`, 4, 15);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `11px ${SANS}`;
    ctx.fillText(
      sites
        ? "forecast units at each factory · columns show forecast minus actual"
        : "forecast units · columns show forecast minus actual",
      52,
      15
    );

    // executions where the two factories drift opposite ways
    const clash = [];
    if (sites) {
      for (let i = 0; i < n; i++) {
        const a = errOf(series[1], i);
        const b = errOf(series[2], i);
        clash.push(a * b < 0 ? 2 * Math.min(Math.abs(a), Math.abs(b)) : 0);
      }
    }

    // the execution being looked at
    ctx.fillStyle = hexToRgba(COLORS.ink, 0.05);
    ctx.fillRect(X(iHead) - slot * 0.36, m.t, slot * 0.72, plotH + stripH - 10);

    ctx.strokeStyle = COLORS.lineSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.l, m.t + plotH + 0.5);
    ctx.lineTo(m.l + plotW, m.t + plotH + 0.5);
    ctx.stroke();

    const labels = [];
    for (const s of series) {
      // a column per execution, from the finish line to where it actually is
      if (s.cols) {
        s.data.forEach((v, i) => {
          const y0 = Y(s.final);
          const y1 = Y(v);
          ctx.fillStyle = hexToRgba(s.color, i === iHead ? 0.55 : 0.32);
          ctx.fillRect(X(i) - 4, Math.min(y0, y1), 8, Math.max(1, Math.abs(y1 - y0)));
        });
      }

      ctx.strokeStyle = hexToRgba(s.color, s.thin ? 0.4 : 0.7);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(m.l, Y(s.final));
      ctx.lineTo(m.l + plotW, Y(s.final));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = s.thin ? hexToRgba(s.color, 0.5) : s.color;
      ctx.lineWidth = s.thin ? 1.5 : 2.5;
      ctx.beginPath();
      s.data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();

      const vy = Y(s.data[iHead]);
      ctx.beginPath();
      ctx.arc(X(iHead), vy, s.thin ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = s.thin ? hexToRgba(s.color, 0.5) : s.color;
      ctx.fill();
      ctx.strokeStyle = COLORS.panel;
      ctx.lineWidth = 2;
      ctx.stroke();

      labels.push({ y: vy + 4, text: s.label, color: s.color, font: `12px ${SANS}` });
      labels.push({
        y: Y(s.final) - 4,
        text: this.values ? `actual ${Math.round(s.final)}` : "actual",
        color: hexToRgba(s.color, 0.8),
        font: `10.5px ${MONO}`,
      });
    }

    const taken = [];
    labels
      .sort((a, b) => a.y - b.y)
      .forEach((l) => {
        let y = clamp(l.y, m.t + 8, m.t + plotH + 4);
        while (taken.some((q) => Math.abs(q - y) < 13)) y += 13;
        taken.push(y);
        ctx.fillStyle = l.color;
        ctx.font = l.font;
        ctx.fillText(l.text, m.l + plotW + 8, y);
      });

    // ---- the arithmetic for the execution you are on, under its own column
    const stripTop = m.t + plotH + 16;
    const numX = clamp(X(iHead), m.l + 26, m.l + plotW - 26);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 11px ${MONO}`;
    ctx.fillText(`execution ${iHead + 1}`, numX, stripTop);

    rows.forEach((row, r) => {
      const y = stripTop + 16 + r * rowH;
      ctx.textAlign = "right";
      ctx.fillStyle = hexToRgba(row.color, 0.85);
      ctx.font = `${row.strong ? 500 : 400} 10.5px ${SANS}`;
      ctx.fillText(row.label, numX - 14, y);

      const costly = row.cost && clash[iHead] > 0;
      ctx.textAlign = "left";
      ctx.fillStyle = costly ? COLORS.clash : hexToRgba(row.color, row.cost ? 0.35 : 1);
      ctx.font = `600 12px ${MONO}`;
      ctx.fillText(row.get(iHead), numX + 14, y);
    });
    ctx.textAlign = "left";
  }

  /* ------------------------------------------------------- the error curve */

  drawChart() {
    const ctx = this.cctx;
    const W = this.w;
    const H = this.chartHeight;
    ctx.clearRect(0, 0, W, H);

    const split = this.mode === "split";
    const lines = [];
    if (split) {
      lines.push({
        data: this.run.siteWmape,
        color: COLORS.site,
        label: this.values ? `Site error · ${this.run.label}` : "Site error",
        dash: false,
      });
      if (this.compare) {
        lines.push({
          data: this.compare.siteWmape,
          color: COLORS.compare,
          label: `Site error · ${this.compare.label}`,
          dash: false,
        });
      }
    }
    lines.push({ data: this.run.globalWmape, color: COLORS.net, label: "Network error", dash: split });

    const n = this.run.globalWmape.length;
    const m = { l: 42, r: 124, t: 14, b: 22 };
    const plotW = W - m.l - m.r;
    const plotH = H - m.t - m.b;
    const maxY = Math.max(...lines.flatMap((l) => l.data)) * 1.12 || 1;
    const X = (i) => m.l + (plotW * i) / (n - 1);
    const Y = (v) => m.t + plotH - (v / maxY) * plotH;

    ctx.strokeStyle = COLORS.lineSoft;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `10.5px ${MONO}`;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const v = (maxY / 2) * g;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(m.l, y);
      ctx.lineTo(m.l + plotW, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(pct(v, 0), m.l - 8, y + 3.5);
    }
    ctx.textAlign = "left";

    // the gap between site error and network error is the routing cost
    if (split && !this.compare) {
      ctx.beginPath();
      this.run.siteWmape.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(this.run.globalWmape[i]));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(COLORS.clash, 0.12);
      ctx.fill();
    }

    const head = this.head;
    const upto = Math.floor(head);
    const f = head - upto;
    const tips = [];
    for (const l of lines) {
      ctx.setLineDash(l.dash ? [4, 4] : []);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRgba(l.color, 0.18);
      ctx.beginPath();
      l.data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();

      ctx.strokeStyle = l.color;
      ctx.beginPath();
      for (let i = 0; i <= upto; i++) i ? ctx.lineTo(X(i), Y(l.data[i])) : ctx.moveTo(X(i), Y(l.data[i]));
      if (f > 0 && upto + 1 < n) {
        ctx.lineTo(lerp(X(upto), X(upto + 1), f), lerp(Y(l.data[upto]), Y(l.data[upto + 1]), f));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      const vy = lerp(Y(l.data[upto]), Y(l.data[Math.min(upto + 1, n - 1)]), f);
      ctx.beginPath();
      ctx.arc(X(head), vy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = l.color;
      ctx.fill();
      ctx.strokeStyle = COLORS.panel;
      ctx.lineWidth = 2;
      ctx.stroke();
      tips.push([vy, l.label, l.color]);
    }

    ctx.font = `11.5px ${SANS}`;
    const placed = [];
    tips
      .sort((a, b) => a[0] - b[0])
      .forEach(([vy, label, color]) => {
        let y = vy + 4;
        while (placed.some((q) => Math.abs(q - y) < 13)) y += 13;
        placed.push(y);
        ctx.fillStyle = color;
        ctx.fillText(label, m.l + plotW + 8, y);
      });

    ctx.fillStyle = COLORS.muted;
    ctx.font = `10.5px ${MONO}`;
    ctx.fillText("first execution", m.l, H - 6);
    ctx.textAlign = "right";
    ctx.fillText("last execution", m.l + plotW, H - 6);
    ctx.textAlign = "left";
    ctx.font = `9.5px ${SANS}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("% error (WMAPE)", m.l, 10);
  }
}

/* --------------------------------------------- target-setting explainer */

class SolutionStage {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector("canvas.solution");
    this.ctx = this.canvas.getContext("2d");
    this.scene = "direction";
    this.t = 0;
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  setLayers(scene) {
    this.scene = scene || "direction";
    this.root.dataset.layers = this.scene;
    this.draw();
  }

  render(t) {
    this.t = t;
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(280, this.canvas.parentElement.clientWidth - 28);
    this.h = clamp(window.innerHeight - 190, 440, 610);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  text(text, x, y, opts = {}) {
    const ctx = this.ctx;
    ctx.fillStyle = opts.color || COLORS.ink;
    ctx.font = `${opts.weight || 400} ${opts.size || 13}px ${opts.family || SANS}`;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  panel(x, y, w, h, tint = null) {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = tint ? hexToRgba(tint, 0.045) : COLORS.surface;
    ctx.fill();
    ctx.strokeStyle = tint ? hexToRgba(tint, 0.28) : COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  arrow(x1, y1, x2, y2, color = COLORS.ink, width = 2) {
    const ctx = this.ctx;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * Math.cos(angle - Math.PI / 6), y2 - 8 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - 8 * Math.cos(angle + Math.PI / 6), y2 - 8 * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  heading(kicker, title) {
    this.text(kicker.toUpperCase(), 18, 22, { color: COLORS.muted, size: 10, family: MONO, weight: 600 });
    this.text(title, 18, 48, { size: 21, family: SERIF, weight: 500 });
  }

  pill(text, x, y, w, color = COLORS.ink) {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, 30, 15);
    ctx.fillStyle = hexToRgba(color, 0.08);
    ctx.fill();
    this.text(text, x + w / 2, y + 16, { color, size: 11, family: MONO, weight: 600, align: "center", baseline: "middle" });
  }

  stackedBar(x, y, w, total, a, label) {
    const ctx = this.ctx;
    this.text(label, x, y - 9, { color: COLORS.muted, size: 11, family: MONO });
    const full = w * (total / 120);
    const aw = w * (a / 120);
    roundRect(ctx, x, y, full, 54, 8);
    ctx.fillStyle = hexToRgba(COLORS.B, 0.82);
    ctx.fill();
    roundRect(ctx, x, y, aw, 54, 8);
    ctx.fillStyle = hexToRgba(COLORS.A, 0.9);
    ctx.fill();
    this.text(`${a}`, x + aw / 2, y + 28, { color: COLORS.surface, size: 13, family: MONO, weight: 600, align: "center", baseline: "middle" });
    this.text(`${total - a}`, x + aw + (full - aw) / 2, y + 28, { color: COLORS.surface, size: 13, family: MONO, weight: 600, align: "center", baseline: "middle" });
    this.text(`${total} units`, x + full + 9, y + 31, { color: COLORS.net, size: 11, family: MONO });
  }

  drawBox(x, y, values, site, opts = {}) {
    const ctx = this.ctx;
    const size = opts.size || 76;
    const color = site === "A" ? COLORS.A : site === "B" ? COLORS.B : COLORS.net;
    roundRect(ctx, x, y, size, size, 10);
    ctx.fillStyle = hexToRgba(color, 0.08);
    ctx.fill();
    ctx.strokeStyle = opts.locked ? COLORS.ink : hexToRgba(color, 0.5);
    ctx.lineWidth = opts.locked ? 2 : 1.2;
    ctx.stroke();
    const cols = 3;
    const gap = 4;
    const cell = (size - 20 - gap * 2) / cols;
    values.forEach((v, k) => {
      const cx = x + 10 + (k % cols) * (cell + gap);
      const cy = y + 10 + Math.floor(k / cols) * (cell + gap);
      roundRect(ctx, cx, cy, cell, cell, 3);
      ctx.fillStyle = v ? hexToRgba(color, 0.25 + Math.min(v, 6) * 0.1) : hexToRgba(COLORS.muted, 0.1);
      ctx.fill();
      if (opts.lockSku === k) {
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      this.text(`${v}`, cx + cell / 2, cy + cell / 2 + 1, {
        color: v >= 4 ? COLORS.surface : COLORS.textSecondary,
        size: 10,
        family: MONO,
        align: "center",
        baseline: "middle",
      });
    });
  }

  draw() {
    if (!this.ctx || !this.w) return;
    this.ctx.clearRect(0, 0, this.w, this.h);
    const fn = {
      direction: () => this.drawDirection(),
      fixed: () => this.drawFixed(),
      proportional: () => this.drawProportional(),
      bundles: () => this.drawBundles(),
      eligibility: () => this.drawEligibility(),
      optimise: () => this.drawOptimise(),
    }[this.scene];
    (fn || (() => this.drawDirection()))();
  }

  drawDirection() {
    const ctx = this.ctx;
    this.heading("the equality condition", "Make the two site errors point the same way");
    const pad = 24;
    const gap = 18;
    const pw = (this.w - pad * 2 - gap) / 2;
    const top = 82;
    const ph = Math.min(300, this.h - 170);
    const drawCase = (x, same) => {
      this.panel(x, top, pw, ph, same ? COLORS.good : COLORS.clash);
      this.text(same ? "SIGNS ALIGNED" : "SIGNS OPPOSED", x + 16, top + 25, {
        color: same ? "#1b7f4b" : COLORS.clash, size: 10, family: MONO, weight: 600,
      });
      this.text(same ? "No cancellation" : pw < 190 ? "Errors cancel" : "Cancellation hides site misses", x + 16, top + 49, {
        size: pw < 190 ? 13 : 15, family: SERIF, weight: 500,
      });
      const axisX = x + pw * 0.48;
      ["Factory A", "Factory B"].forEach((name, i) => {
        const y = top + 105 + i * 78;
        ctx.strokeStyle = COLORS.line;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 26, y);
        ctx.lineTo(x + pw - 24, y);
        ctx.stroke();
        ctx.fillStyle = COLORS.ink;
        ctx.beginPath();
        ctx.arc(axisX, y, 4, 0, Math.PI * 2);
        ctx.fill();
        this.text("actual", axisX, y + 20, { color: COLORS.muted, size: 10, family: MONO, align: "center" });
        const dir = same || i === 0 ? 1 : -1;
        const len = i === 0 ? pw * 0.22 : pw * 0.14;
        this.arrow(axisX, y, axisX + dir * len, y, i === 0 ? COLORS.A : COLORS.B, 4);
        this.text(i === 0 ? "a = +12" : same ? "b = +8" : "b = −8", axisX + dir * len, y - 12, {
          color: i === 0 ? COLORS.A : COLORS.B, size: 11, family: MONO, weight: 600, align: "center",
        });
        this.text(pw < 190 ? name.slice(-1) : name, x + 16, y - 15, { color: COLORS.muted, size: 11 });
      });
      const site = same ? 20 : 20;
      const global = same ? 20 : 4;
      this.text(`site: |a| + |b| = ${site}`, x + 16, top + ph - 43, { color: COLORS.site, size: 12, family: MONO, weight: 600 });
      this.text(`global: |a + b| = ${global}`, x + 16, top + ph - 20, { color: COLORS.net, size: 12, family: MONO, weight: 600 });
    };
    drawCase(pad, true);
    drawCase(pad + pw + gap, false);
    this.pill("same sign  ⇒  site error = global error", Math.max(20, (this.w - 330) / 2), this.h - 55, Math.min(330, this.w - 40), COLORS.ink);
  }

  drawFixed() {
    this.heading("method one", "Anchor one site; let the other follow global volume");
    const x = 34;
    const w = this.w - 68;
    const y = 100;
    this.stackedBar(x, y, w * 0.78, 100, 40, "ACTUAL");
    this.stackedBar(x, y + 105, w * 0.78, 120, 40, "FORECAST");
    this.text("Factory A stays fixed at 40", x, y + 186, { color: COLORS.A, size: 12, family: MONO, weight: 600 });
    this.text("Factory B absorbs the +20 global change", x, y + 209, { color: COLORS.B, size: 12, family: MONO, weight: 600 });
    const cardY = Math.min(this.h - 156, y + 255);
    this.panel(x, cardY, w, 112);
    const thirds = w / 3;
    [["A error", "0", COLORS.A], ["B error", "+20", COLORS.B], ["Global error", "+20", COLORS.net]].forEach(([label, value, color], i) => {
      const cx = x + thirds * i + thirds / 2;
      this.text(label, cx, cardY + 31, { color: COLORS.muted, size: 10, family: MONO, align: "center" });
      this.text(value, cx, cardY + 66, { color, size: 25, family: SERIF, weight: 500, align: "center" });
      if (i < 2) {
        this.ctx.strokeStyle = COLORS.lineSoft;
        this.ctx.beginPath();
        this.ctx.moveTo(x + thirds * (i + 1), cardY + 18);
        this.ctx.lineTo(x + thirds * (i + 1), cardY + 92);
        this.ctx.stroke();
      }
    });
    this.pill("|0| + |20| = |20|", Math.max(20, (this.w - 220) / 2), this.h - 38, Math.min(220, this.w - 40), COLORS.good);
  }

  drawProportional() {
    this.heading("method two", "Keep a constant 40 / 60 split at both sites");
    const x = 34;
    const w = this.w - 68;
    const y = 100;
    this.stackedBar(x, y, w * 0.78, 100, 40, "ACTUAL · 40% / 60%");
    this.stackedBar(x, y + 105, w * 0.78, 120, 48, "FORECAST · 40% / 60%");
    const cardY = Math.min(this.h - 170, y + 245);
    this.panel(x, cardY, w, 126);
    const thirds = w / 3;
    [["A follows 40%", "+8", COLORS.A], ["B follows 60%", "+12", COLORS.B], ["Global change", "+20", COLORS.net]].forEach(([label, value, color], i) => {
      const cx = x + thirds * i + thirds / 2;
      this.text(label, cx, cardY + 32, { color: COLORS.muted, size: 10, family: MONO, align: "center" });
      this.arrow(cx - 28, cardY + 76, cx + 18, cardY + 76, color, 4);
      this.text(value, cx + 28, cardY + 80, { color, size: 14, family: MONO, weight: 600 });
    });
    this.pill("|8| + |12| = |20|", Math.max(20, (this.w - 230) / 2), this.h - 38, Math.min(230, this.w - 40), COLORS.good);
  }

  drawBundles() {
    this.heading("whole-box routing", "A single SKU target becomes a bundle of changes");
    const y = 110;
    const left = 26;
    const boxX = this.w * 0.43;
    const resultX = this.w - 190;
    this.panel(left, y, 160, 170, COLORS.net);
    this.text("TARGET CHANGE", left + 16, y + 27, { color: COLORS.muted, size: 10, family: MONO, weight: 600 });
    [4, 0, 0].forEach((v, i) => {
      this.text(`SKU ${i}`, left + 18, y + 65 + i * 32, { color: COLORS.muted, size: 11, family: MONO });
      this.text(v ? `+${v}` : "0", left + 126, y + 65 + i * 32, { color: v ? COLORS.net : COLORS.muted, size: 14, family: MONO, weight: 600, align: "right" });
    });
    this.arrow(left + 172, y + 85, boxX - 16, y + 85, COLORS.ink, 2);
    this.drawBox(boxX, y + 42, [4, 3, 2, 0, 0, 0], "B", { size: 92 });
    this.text("one movable box", boxX + 46, y + 153, { color: COLORS.muted, size: 11, align: "center" });
    this.arrow(boxX + 104, y + 85, resultX - 14, y + 85, COLORS.ink, 2);
    this.panel(resultX, y, 164, 170, COLORS.clash);
    this.text("ACTUAL CHANGE", resultX + 16, y + 27, { color: COLORS.muted, size: 10, family: MONO, weight: 600 });
    [[4, COLORS.net], [3, COLORS.clash], [2, COLORS.clash]].forEach(([v, color], i) => {
      this.text(`SKU ${i}`, resultX + 18, y + 65 + i * 32, { color: COLORS.muted, size: 11, family: MONO });
      this.text(`+${v}`, resultX + 130, y + 65 + i * 32, { color, size: 14, family: MONO, weight: 600, align: "right" });
    });
    const lowerY = Math.min(this.h - 170, y + 230);
    this.panel(26, lowerY, this.w - 52, 116);
    this.text("The optimiser cannot take just the blue cell", 46, lowerY + 34, { size: 16, family: SERIF, weight: 500 });
    this.text("Moving the box fixes SKU 0, but pushes SKU 1 and SKU 2 away from their targets.", 46, lowerY + 62, { color: COLORS.textSecondary || "#57564f", size: 12 });
    this.text("It must search combinations of indivisible box vectors.", 46, lowerY + 86, { color: COLORS.muted, size: 11, family: MONO });
  }

  drawEligibility() {
    this.heading("factory eligibility", "A changed box can lose its previous route");
    const y = 102;
    const bw = 82;
    const beforeX = 34;
    const afterX = this.w * 0.37;
    this.text("BEFORE BOX CHANGE", beforeX, y - 14, { color: COLORS.muted, size: 10, family: MONO, weight: 600 });
    this.drawBox(beforeX, y, [4, 2, 0, 0, 0, 1], "A", { size: bw });
    this.pill("eligible for A", beforeX - 2, y + 101, 116, COLORS.A);
    this.arrow(beforeX + bw + 16, y + bw / 2, afterX - 18, y + bw / 2, COLORS.ink, 2);
    this.text("SIMULATED BOX CHANGES", afterX, y - 14, { color: COLORS.muted, size: 10, family: MONO, weight: 600 });
    this.drawBox(afterX, y, [4, 2, 5, 0, 0, 1], "A", { size: bw, locked: true, lockSku: 2 });
    this.text("SKU 2 added", afterX + bw / 2, y + 105, { color: COLORS.clash, size: 11, family: MONO, weight: 600, align: "center" });
    const factoryX = this.w - 215;
    this.panel(factoryX, y - 20, 185, 177, COLORS.A);
    this.text("FACTORY A", factoryX + 16, y + 8, { color: COLORS.A, size: 10, family: MONO, weight: 600 });
    this.text("hosts", factoryX + 16, y + 39, { color: COLORS.muted, size: 11 });
    this.text("SKU 0 · SKU 1 · SKU 3…", factoryX + 16, y + 63, { size: 12, family: MONO });
    this.text("does not host", factoryX + 16, y + 96, { color: COLORS.muted, size: 11 });
    this.pill("SKU 2", factoryX + 16, y + 108, 72, COLORS.clash);
    const routeY = Math.min(this.h - 175, y + 225);
    this.panel(34, routeY, this.w - 68, 118);
    this.text("The whole box is now forced to factory B", 54, routeY + 34, { size: 16, family: SERIF, weight: 500 });
    this.arrow(58, routeY + 77, this.w - 76, routeY + 77, COLORS.B, 4);
    this.text("perfect target move", 58, routeY + 102, { color: COLORS.muted, size: 10, family: MONO });
    this.text("only feasible site", this.w - 76, routeY + 102, { color: COLORS.B, size: 10, family: MONO, weight: 600, align: "right" });
  }

  drawOptimise() {
    this.heading("the practical problem", "Find the closest feasible split, execution by execution");
    const top = 88;
    const gap = 18;
    const panelW = (this.w - 52 - gap) / 2;
    const panelH = Math.min(260, this.h - 250);
    const ax = 26;
    const bx = ax + panelW + gap;
    this.panel(ax, top, panelW, panelH, COLORS.A);
    this.panel(bx, top, panelW, panelH, COLORS.B);
    this.text("FACTORY A", ax + 16, top + 27, { color: COLORS.A, size: 11, family: MONO, weight: 600 });
    this.text("FACTORY B", bx + 16, top + 27, { color: COLORS.B, size: 11, family: MONO, weight: 600 });
    const size = Math.min(58, (panelW - 50) / 3);
    const boxes = [
      [[4, 0, 2, 0, 0, 1], "A", false], [[0, 3, 0, 2, 1, 0], "A", false],
      [[2, 1, 4, 0, 0, 0], "B", true], [[0, 2, 0, 3, 0, 2], "B", false],
    ];
    boxes.forEach(([vals, site, locked], i) => {
      const local = i % 2;
      const x = (site === "A" ? ax : bx) + 18 + local * (size + 12);
      this.drawBox(x, top + 53, vals, site, { size, locked, lockSku: locked ? 2 : -1 });
    });
    this.text("target vector", ax + 16, top + panelH - 55, { color: COLORS.muted, size: 10, family: MONO });
    this.text("[ 40, 32, 0, 28… ]", ax + 16, top + panelH - 30, { color: COLORS.A, size: 12, family: MONO, weight: 600 });
    this.text("target vector", bx + 16, top + panelH - 55, { color: COLORS.muted, size: 10, family: MONO });
    this.text("[ 60, 48, 80, 42… ]", bx + 16, top + panelH - 30, { color: COLORS.B, size: 12, family: MONO, weight: 600 });
    const chipY = top + panelH + 24;
    const chipW = Math.min(150, (this.w - 72) / 3);
    [
      ["whole boxes", COLORS.net],
      ["eligible sites", COLORS.clash],
      ["equal box counts", COLORS.ink],
    ].forEach(([label, color], i) => this.pill(label, 26 + i * (chipW + 10), chipY, chipW, color));
    const questionY = Math.min(this.h - 92, chipY + 70);
    this.panel(26, questionY, this.w - 52, 70, COLORS.net);
    this.text("Which SKU target rule stays closest to the ideal?", this.w / 2, questionY + 31, {
      size: 17, family: SERIF, weight: 500, align: "center",
    });
    this.text("That is the experiment below.", this.w / 2, questionY + 53, {
      color: COLORS.net, size: 11, family: MONO, weight: 600, align: "center",
    });
  }
}

/* ------------------------------------------------------------ page wiring */

const state = { baseline: null, challenger: null, sku: 0, stages: [], chipSets: [] };

function pickSku(k) {
  state.sku = k;
  state.stages.forEach((s) => s.setSku(k));
  state.chipSets.forEach((set) =>
    set.forEach((chip) => chip.classList.toggle("is-on", Number(chip.dataset.sku) === k))
  );
}

function buildChips(container) {
  const chips = [];
  for (let k = 0; k < state.baseline.nSkus; k++) {
    const locked = !state.baseline.hostedA[k];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${locked ? " locked" : ""}`;
    chip.dataset.sku = k;
    chip.textContent = k;
    chip.title = locked ? `SKU ${k} - factory A cannot host it` : `SKU ${k}`;
    chip.addEventListener("click", () => pickSku(k));
    container.appendChild(chip);
    chips.push(chip);
  }
  state.chipSets.push(chips);
}

/* The SKU worth showing first: the one that moves most against where it finally
   lands, among those both factories can host. */
function interestingSku(run) {
  const last = run.executions[run.executions.length - 1];
  let best = 0;
  let bestSwing = -1;
  for (let k = 0; k < run.nSkus; k++) {
    if (!run.hostedA[k]) continue;
    const swing = Math.max(...run.executions.map((e) => Math.abs((e.totals[k] || 0) - (last.totals[k] || 0))));
    if (swing > bestSwing) {
      bestSwing = swing;
      best = k;
    }
  }
  return best;
}

async function boot() {
  state.baseline = await loadBaseline();

  const demand = new Stage(document.querySelector("#demand-stage"), {
    mode: "pool",
    skuMode: "global",
    values: false,
    layers: "boxes",
  });
  const routing = new Stage(document.querySelector("#routing-stage"), {
    mode: "split",
    skuMode: "sites",
    values: false,
    layers: "boxes",
  });
  const lab = new Stage(document.querySelector("#lab"), {
    mode: "split",
    skuMode: "sites",
    values: true,
    layers: "boxes sku chart",
  });
  state.stages = [demand, routing, lab];
  state.stages.forEach((s) => s.setRun(state.baseline));
  const solution = new SolutionStage(document.querySelector("#solution-stage"));

  document.querySelectorAll(".chips").forEach(buildChips);
  pickSku(interestingSku(state.baseline));

  document.querySelectorAll("[data-n-exec]").forEach((el) => (el.textContent = state.baseline.executions.length));
  document.querySelectorAll("[data-n-boxes]").forEach((el) => (el.textContent = state.baseline.nBoxes));
  document.querySelectorAll("[data-n-skus]").forEach((el) => (el.textContent = state.baseline.nSkus));
  document.querySelectorAll("#baseline-score, #baseline-score-2").forEach(
    (el) => (el.textContent = state.baseline.score.toFixed(4))
  );
  renderTable();

  wireScroll(document.querySelector("#demand"), demand);
  wireScroll(document.querySelector("#routing"), routing);
  wireScroll(document.querySelector("#targets"), solution);
  wireExplorer(lab);
}

async function loadBaseline() {
  const isPublished = window.location.hostname.endsWith("github.io");
  const sources = isPublished ? ["baseline-cache.json", "/api/baseline"] : ["/api/baseline", "baseline-cache.json"];
  let lastError = null;
  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      const payload = json.payload || json;
      if (!payload.executions || !payload.nSkus) throw new Error("Baseline file has the wrong shape.");
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load the baseline: ${lastError ? lastError.message : "unknown error"}`);
}

function wireScroll(section, stage) {
  const steps = [...section.querySelectorAll(".step")];
  const n = state.baseline.executions.length;
  let shown = null;

  const tick = () => {
    const rect = section.getBoundingClientRect();
    const span = section.offsetHeight - window.innerHeight;
    const progress = clamp(-rect.top / Math.max(span, 1), 0, 1);

    const mid = window.innerHeight * 0.45;
    let active = 0;
    steps.forEach((s, i) => {
      if (s.getBoundingClientRect().top < mid) active = i;
    });
    steps.forEach((s, i) => s.classList.toggle("is-active", i === active));

    const want = steps[active].dataset.layers || "boxes";
    if (want !== shown) {
      shown = want;
      stage.setLayers(want); // resize redraws at the current position
    }
    stage.render(progress * (n - 1));
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      tick();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  tick();
}

function wireExplorer(stage) {
  const form = document.querySelector("#rule-form");
  const status = document.querySelector("#status");
  const runBtn = document.querySelector("#run");
  const scrub = document.querySelector("#scrub");
  const scrubLabel = document.querySelector("#scrub-label");
  const code = document.querySelector("#strategy-code");
  const copyNote = document.querySelector("#copy-note");
  const n = state.baseline.executions.length;
  const defaultCode = code.value;

  document.querySelector("#reset-code").addEventListener("click", () => {
    code.value = defaultCode;
    copyNote.textContent = "Example restored.";
    code.focus();
  });

  document.querySelector("#copy-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      copyNote.textContent = "Agent prompt copied — add your idea, then paste it into an agent.";
    } catch (error) {
      copyNote.textContent = "Clipboard access was blocked. Select and copy the prompt from the browser console.";
      console.info(AGENT_PROMPT);
    }
  });

  const play = (t) => {
    stage.render(t);
    scrubLabel.textContent = `execution ${Math.floor(t) + 1} / ${n}`;
  };
  scrub.addEventListener("input", () => play((scrub.value / 1000) * (n - 1)));
  play(0);

  document.querySelector("#animate").addEventListener("click", () => {
    const start = performance.now();
    const dur = 900 * n;
    const step = (now) => {
      const p = clamp((now - start) / dur, 0, 1);
      scrub.value = p * 1000;
      play(p * (n - 1));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    status.className = "status";
    status.textContent = "Running your code and routing every execution in this browser...";
    try {
      if (!window.AOABrowser) throw new Error("The browser solver did not load.");
      const payload = await window.AOABrowser.runCustomStrategy(state.baseline, code.value, {
        lambdaMove: 0.05,
        label: "Your Python",
        onStatus: (message) => (status.textContent = message),
      });
      state.challenger = payload;
      stage.setRun(payload, state.baseline);
      stage.setSku(state.sku);
      play((scrub.value / 1000) * (n - 1));
      showVerdict();
      renderTable();
      status.textContent = "Done. Scrub or press play to watch your strategy route the boxes.";
    } catch (err) {
      status.className = "status err";
      status.textContent = `Could not run that rule: ${err.message}`;
    } finally {
      runBtn.disabled = false;
    }
  });
}

function showVerdict() {
  const base = state.baseline.score;
  const mine = state.challenger.score;
  const delta = ((base - mine) / base) * 100;
  document.querySelector("#your-score").textContent = mine.toFixed(4);
  const v = document.querySelector("#verdict");
  v.textContent = `${delta >= 0 ? "-" : "+"}${Math.abs(delta).toFixed(1)}%`;
  v.className = `v ${delta >= 0 ? "win" : "lose"}`;
  document.querySelector("#verdict-note").textContent =
    delta >= 0 ? "lower score — you beat the baseline" : "higher score — the baseline wins";
}

function renderTable() {
  const rows = [["Baseline (frozen first-execution target)", state.baseline]];
  if (state.challenger) rows.push(["Your rule", state.challenger]);
  document.querySelector("#results-body").innerHTML = rows
    .map(
      ([name, r]) => `<tr>
        <td>${name}</td>
        <td class="num">${r.rule.mode}</td>
        <td class="num">${r.score.toFixed(4)}</td>
        <td class="num">${pct(r.meanGap, 2)}</td>
        <td class="num">${pct(r.maxGap, 2)}</td>
        <td class="num">${r.executions.reduce((a, e) => a + e.moved, 0)}</td>
      </tr>`
    )
    .join("");
}

boot();
