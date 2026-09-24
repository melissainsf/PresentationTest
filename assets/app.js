/* ==========================================================================
   Customer Success demo dashboard - rendering layer.

   Design note: assets/data.js holds only base facts (accounts, survey
   responses, quarterly goals). Every headline metric is DERIVED here from
   those facts, so a roll-up can never disagree with its parts - the whole
   book, a single account manager and a single segment all run through the
   same two functions, retention() and nps().

   Charts are hand-rolled inline SVG: no CDN, no build step, works offline
   and from file://.
   ========================================================================== */
(function () {
  "use strict";

  var D = window.CS_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:24px'>Could not load assets/data.js</p>"; return; }

  var SERIES = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6"];
  var LS_KEY = "csdash.health.v1";

  /* ---------------------------------------------------------------- utils */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, "") + "M";
    if (a >= 1e3) return "$" + Math.round(v / 1e3) + "K";
    return "$" + Math.round(v);
  }
  function moneyFull(v) { return "$" + Math.round(v).toLocaleString("en-US"); }
  function pct(v, dp) { return (v === null || v === undefined) ? "—" : v.toFixed(dp === undefined ? 1 : dp) + "%"; }
  function signed(v, dp) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp === undefined ? 1 : dp); }

  /* ------------------------------------------------------ derived metrics */
  // One definition of retention, used for every scope on every tab.
  function retention(rows) {
    var start = 0, exp = 0, con = 0, chn = 0, lost = 0;
    rows.forEach(function (a) {
      start += a.arrStart; exp += a.expansion; con += a.contraction; chn += a.churnedArr;
      if (a.status === "churned") lost++;
    });
    if (!start) return { n: rows.length, start: 0, nrr: null, grr: null, revChurn: null, logoChurn: null };
    return {
      n: rows.length, start: start, expansion: exp, contraction: con, churnedArr: chn, lostLogos: lost,
      arrNow: rows.reduce(function (s, a) { return s + a.arrNow; }, 0),
      nrr: 100 * (start + exp - con - chn) / start,
      grr: 100 * (start - con - chn) / start,
      revChurn: 100 * chn / start,
      logoChurn: rows.length ? 100 * lost / rows.length : 0
    };
  }

  // One definition of NPS, used for every scope on every tab.
  function nps(resps) {
    var p = 0, pa = 0, d = 0;
    resps.forEach(function (r) { if (r.score >= 9) p++; else if (r.score >= 7) pa++; else d++; });
    var n = resps.length;
    return {
      n: n, promoters: p, passives: pa, detractors: d,
      score: n ? Math.round(100 * (p - d) / n) : null
    };
  }

  var ACCOUNTS = D.accounts.slice();
  var ACTIVE = ACCOUNTS.filter(function (a) { return a.status === "active"; });
  var RESP = D.npsResponses.slice();
  var CURQ = D.meta.quarter, PREVQ = D.meta.priorQuarter;
  var respBy = function (fn) { return RESP.filter(fn); };

  /* ---------------------------------------------- editable health (local) */
  var healthOverrides = {};
  try { healthOverrides = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { healthOverrides = {}; }
  function healthOf(a) { return healthOverrides[a.id] || a.health; }
  function setHealth(id, v) {
    var base = ACCOUNTS.find(function (a) { return a.id === id; });
    if (!base) return;
    if (v === base.health) delete healthOverrides[id]; else healthOverrides[id] = v;
    try { localStorage.setItem(LS_KEY, JSON.stringify(healthOverrides)); } catch (e) { /* private mode */ }
  }
  var HEALTH_CLASS = { Healthy: "good", Watch: "warning", "At Risk": "critical", Churned: "muted" };
  var HEALTH_ICON = { Healthy: "●", Watch: "▲", "At Risk": "■", Churned: "—" };

  /* ------------------------------------------------- chart re-render pool */
  var charts = [];
  function chart(host, draw) {
    charts.push({ host: host, draw: draw });
    var w = host.clientWidth || 600;
    draw(host, w);
  }
  var rt;
  function redrawAll() {
    charts.forEach(function (c) {
      if (!c.host.isConnected) return;
      var w = c.host.clientWidth;
      if (!w) return;                 // hidden panel - redrawn when shown
      c.host.innerHTML = "";
      c.draw(c.host, w);
    });
  }
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(redrawAll, 120); });

  /* ------------------------------------------------------------- tooltips */
  function tipFor(host) {
    var t = el("div", { class: "tip", role: "status", "aria-live": "polite" });
    host.appendChild(t);
    return {
      node: t,
      show: function (html, x, y) {
        t.innerHTML = html;
        t.setAttribute("data-show", "true");
        var hw = host.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
        var left = Math.max(2, Math.min(x + 12, hw - tw - 2));
        var top = Math.max(2, y - th - 10);
        t.style.left = left + "px";
        t.style.top = top + "px";
      },
      hide: function () { t.setAttribute("data-show", "false"); }
    };
  }
  function swatchRow(color, label, value) {
    return '<div class="tip-row"><span class="k">' +
      (color ? '<span class="sw" style="background:' + color + '"></span>' : "") +
      esc(label) + '</span><span class="v">' + esc(value) + "</span></div>";
  }

  /* ----------------------------------------------------- bar path helpers */
  // 4px rounded data-end, square at the baseline (per the mark spec).
  function hBarPath(x0, y, w, h, r) {
    var dir = w >= 0 ? 1 : -1, len = Math.abs(w);
    r = Math.min(r, len, h / 2);
    if (len < 0.5) return "";
    var xe = x0 + dir * len;
    if (r <= 0.5) return "M" + x0 + "," + y + "H" + xe + "V" + (y + h) + "H" + x0 + "Z";
    return "M" + x0 + "," + y +
      "H" + (xe - dir * r) +
      "A" + r + "," + r + " 0 0 " + (dir > 0 ? 1 : 0) + " " + xe + "," + (y + r) +
      "V" + (y + h - r) +
      "A" + r + "," + r + " 0 0 " + (dir > 0 ? 1 : 0) + " " + (xe - dir * r) + "," + (y + h) +
      "H" + x0 + "Z";
  }

  // Smallest clean axis top that covers the data with 3-5 round tick steps.
  // A plain "round up to 1/2/2.5/5 x 10^n" ceiling pushed an NRR max of 119 to
  // 200, throwing away half the plot width, so the tick count is part of the fit.
  function niceScale(maxNeeded) {
    if (!(maxNeeded > 0)) return { max: 1, step: 1, n: 1 };
    var mults = [1, 2, 2.5, 5];
    for (var e = -4; e <= 9; e++) {
      for (var m = 0; m < mults.length; m++) {
        var step = mults[m] * Math.pow(10, e);
        for (var n = 3; n <= 5; n++) {
          if (step * n >= maxNeeded - 1e-9) return { max: step * n, step: step, n: n };
        }
      }
    }
    return { max: maxNeeded, step: maxNeeded / 4, n: 4 };
  }

  /* =========================================================== sparkline */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 132, h = opts.height || 30, pad = 3;
    var s = svgEl("svg", { class: "spark", width: w, height: h, viewBox: "0 0 " + w + " " + h,
      role: "img", "aria-label": opts.label || "trend" });
    var vs = values.filter(function (v) { return v !== null; });
    if (vs.length < 2) return s;
    var min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
    if (max - min < 1e-9) { min -= 1; max += 1; }
    var X = function (i) { return pad + i * (w - 2 * pad) / (values.length - 1); };
    var Y = function (v) { return h - pad - (v - min) / (max - min) * (h - 2 * pad); };
    var d = values.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join("");
    s.appendChild(svgEl("path", { d: d, fill: "none", stroke: css("--text-muted"),
      "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.55 }));
    var li = values.length - 1;
    s.appendChild(svgEl("circle", { cx: X(li), cy: Y(values[li]), r: 3.5,
      fill: opts.accent || css("--series-1"), stroke: css("--surface-1"), "stroke-width": 2 }));
    return s;
  }

  /* ========================================================== stat tile */
  function statTile(cfg) {
    var deltaNode = null;
    if (cfg.delta !== null && cfg.delta !== undefined) {
      var up = cfg.delta > 0, flat = Math.abs(cfg.delta) < 0.05;
      var good = flat ? null : (cfg.higherIsBetter ? up : !up);
      deltaNode = el("span", {
        class: "delta " + (flat ? "flat" : good ? "good" : "bad"),
        text: (flat ? "±" : up ? "▲" : "▼") + " " + signed(cfg.delta, cfg.deltaDp === undefined ? 1 : cfg.deltaDp) + (cfg.deltaUnit || "")
      });
    }
    var foot = el("div", { class: "tile-foot" }, [
      deltaNode,
      cfg.note ? el("span", { class: "tile-note", text: cfg.note }) : null
    ]);
    return el("div", { class: "card" + (cfg.hero ? " tile-hero" : "") }, [
      el("p", { class: "tile-label", text: cfg.label }),
      el("div", { class: "tile-value", text: cfg.value }),
      foot,
      cfg.spark ? sparkline(cfg.spark, { label: cfg.label + " trend", accent: css("--series-1") }) : null
    ]);
  }

  /* ================================================ horizontal bar chart */
  /* One series -> one colour (no legend: the title names it). Diverging
     blue/red only where the measure is genuinely signed (NPS). Every bar is
     directly labelled, which is also the required relief for the light-mode
     contrast warning on some palette slots. */
  function hBarChart(host, cfg) {
    var rows = cfg.rows;                     // [{label, value, tip?}]
    var w = host.clientWidth || 560;
    var LEFT = cfg.labelWidth || 116, RIGHT = 54, TOP = 6, BOT = 24;
    var rowH = 30, barH = Math.min(24, rowH - 8);
    var plotW = Math.max(60, w - LEFT - RIGHT);
    var h = TOP + rows.length * rowH + BOT;

    var vals = rows.map(function (r) { return r.value; });
    var diverging = cfg.diverging && Math.min.apply(null, vals) < 0;
    var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat([cfg.minScale || 0]));
    var sc = niceScale(maxAbs * 1.08);
    var top = sc.max;
    var x0, X;
    if (diverging) {
      x0 = LEFT + plotW / 2;
      X = function (v) { return x0 + (v / top) * (plotW / 2); };
    } else {
      x0 = LEFT;
      X = function (v) { return LEFT + Math.max(0, v / top) * plotW; };
    }

    var svg = svgEl("svg", { class: "chart", viewBox: "0 0 " + w + " " + h, height: h,
      role: "img", "aria-label": cfg.aria || cfg.title });

    // gridlines: solid hairlines, recessive
    var ticks = [];
    if (diverging) {
      ticks = [-top, -top / 2, 0, top / 2, top];
    } else {
      for (var ti = 0; ti <= sc.n; ti++) ticks.push(sc.step * ti);
    }
    ticks.forEach(function (t) {
      var x = X(t);
      svg.appendChild(svgEl("line", { x1: x, y1: TOP, x2: x, y2: TOP + rows.length * rowH,
        class: (t === 0 && diverging) ? "baseline" : "gridline" }));
      var tk = svgEl("text", { x: x, y: h - 8, "text-anchor": "middle", class: "tick" });
      tk.textContent = cfg.fmtTick ? cfg.fmtTick(t) : String(Math.round(t));
      svg.appendChild(tk);
    });

    // optional reference line (e.g. 100% retention)
    if (cfg.refValue !== undefined && cfg.refValue <= top) {
      var rx = X(cfg.refValue);
      svg.appendChild(svgEl("line", { x1: rx, y1: TOP - 2, x2: rx, y2: TOP + rows.length * rowH, class: "refline" }));
      var rl = svgEl("text", { x: rx, y: TOP - 6, class: "reflabel", "text-anchor": "middle" });
      rl.textContent = cfg.refLabel || "";
      svg.appendChild(rl);
    }

    var posColor = cfg.color || css("--series-1");
    var negColor = css("--diverge-neg");
    var tip = tipFor(host);

    rows.forEach(function (r, i) {
      var y = TOP + i * rowH + (rowH - barH) / 2;
      var isNeg = r.value < 0;
      var color = diverging ? (isNeg ? negColor : css("--diverge-pos")) : posColor;
      var xv = X(r.value);

      // category label
      var lab = svgEl("text", { x: LEFT - 10, y: y + barH / 2 + 4, class: "cat-label", "text-anchor": "end" });
      lab.textContent = r.label;
      svg.appendChild(lab);

      var bar = svgEl("path", { d: hBarPath(x0, y, xv - x0, barH, 4), fill: color });
      svg.appendChild(bar);

      // direct value label, always outside the bar end so it can never be clipped
      var vt = svgEl("text", {
        x: isNeg ? xv - 7 : xv + 7, y: y + barH / 2 + 4,
        class: "val-label", "text-anchor": isNeg ? "end" : "start"
      });
      vt.textContent = cfg.fmtValue ? cfg.fmtValue(r.value) : String(r.value);
      svg.appendChild(vt);

      // hit target spans the whole row, comfortably bigger than the mark
      var hit = svgEl("rect", { x: 0, y: TOP + i * rowH, width: w, height: rowH,
        fill: "transparent", tabindex: 0, role: "img",
        "aria-label": r.label + ": " + (cfg.fmtValue ? cfg.fmtValue(r.value) : r.value) });
      function show(ev) {
        var b = host.getBoundingClientRect();
        var cx = (ev.clientX !== undefined ? ev.clientX - b.left : xv);
        var cy = (ev.clientY !== undefined ? ev.clientY - b.top : TOP + i * rowH + rowH / 2);
        tip.show('<div class="tip-title">' + esc(r.label) + "</div>" +
          swatchRow(color, cfg.title, cfg.fmtValue ? cfg.fmtValue(r.value) : r.value) +
          (r.tip || ""), cx, cy);
      }
      hit.addEventListener("mousemove", show);
      hit.addEventListener("mouseleave", tip.hide);
      hit.addEventListener("focus", show);
      hit.addEventListener("blur", tip.hide);
      svg.appendChild(hit);
    });

    host.appendChild(svg);
  }

  function barCard(title, sub, cfg) {
    var wrap = el("div", { class: "chart-wrap" });
    var card = el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [el("h3", { class: "card-title", text: title })]),
      sub ? el("p", { class: "card-sub", text: sub }) : null,
      wrap
    ]);
    chart(wrap, function (host) { hBarChart(host, cfg); });
    return card;
  }

  /* ============================================ multi-series line chart */
  function lineChart(host, cfg) {
    var w = host.clientWidth || 640;
    var LEFT = 54, RIGHT = 16, TOP = 14, BOT = 34;
    var h = cfg.height || 260;
    var plotW = Math.max(80, w - LEFT - RIGHT), plotH = h - TOP - BOT;
    var labels = cfg.labels;
    var series = cfg.series.filter(function (s) { return s.visible !== false; });

    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null) all.push(v); }); });
    if (cfg.refSeries) cfg.refSeries.forEach(function (v) { if (v !== null) all.push(v); });
    if (!all.length) { host.appendChild(el("p", { class: "empty", text: "Nothing selected." })); return; }

    var lo = cfg.yMin !== undefined ? cfg.yMin : Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    if (cfg.yFromZero) lo = 0;
    var padY = (hi - lo) * 0.12 || 1;
    var yLo = cfg.yFromZero ? 0 : lo - padY, yHi = hi + padY;

    var X = function (i) { return LEFT + (labels.length === 1 ? plotW / 2 : i * plotW / (labels.length - 1)); };
    var Y = function (v) { return TOP + plotH - (v - yLo) / (yHi - yLo) * plotH; };

    var svg = svgEl("svg", { class: "chart", viewBox: "0 0 " + w + " " + h, height: h,
      role: "img", "aria-label": cfg.aria || cfg.title });

    // y gridlines + ticks
    var steps = 4;
    for (var g = 0; g <= steps; g++) {
      var v = yLo + (yHi - yLo) * g / steps, y = Y(v);
      svg.appendChild(svgEl("line", { x1: LEFT, y1: y, x2: LEFT + plotW, y2: y,
        class: g === 0 ? "baseline" : "gridline" }));
      var t = svgEl("text", { x: LEFT - 9, y: y + 4, class: "tick", "text-anchor": "end" });
      t.textContent = cfg.fmtY ? cfg.fmtY(v) : Math.round(v);
      svg.appendChild(t);
    }

    // x ticks - thinned so labels never collide
    var every = Math.max(1, Math.ceil(labels.length / Math.max(3, Math.floor(plotW / 62))));
    labels.forEach(function (lb, i) {
      if (i % every && i !== labels.length - 1) return;
      var t = svgEl("text", { x: X(i), y: h - 12, class: "tick", "text-anchor": "middle" });
      t.textContent = lb;
      svg.appendChild(t);
    });

    // goal pace reference (a reference line on the SAME axis - never a 2nd scale)
    if (cfg.refSeries) {
      var rd = "";
      cfg.refSeries.forEach(function (v, i) { if (v !== null) rd += (rd ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1); });
      svg.appendChild(svgEl("path", { d: rd, fill: "none", stroke: css("--axis"), "stroke-width": 1.5 }));
      var rlab = svgEl("text", { x: LEFT + plotW, y: Y(cfg.refSeries[cfg.refSeries.length - 1]) - 7,
        class: "reflabel", "text-anchor": "end" });
      rlab.textContent = cfg.refLabel || "Goal pace";
      svg.appendChild(rlab);
    }

    // series lines + end markers
    series.forEach(function (s) {
      var d = "", lastI = -1;
      s.values.forEach(function (v, i) {
        if (v === null) return;
        d += (d ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
        lastI = i;
      });
      if (!d) return;
      svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: s.color,
        "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      if (lastI >= 0) {
        // 2px surface ring keeps the marker legible where lines overlap
        svg.appendChild(svgEl("circle", { cx: X(lastI), cy: Y(s.values[lastI]), r: 4.5,
          fill: s.color, stroke: css("--surface-1"), "stroke-width": 2 }));
      }
    });

    /* crosshair + shared tooltip */
    var tip = tipFor(host);
    var cross = svgEl("line", { y1: TOP, y2: TOP + plotH, class: "gridline", opacity: 0 });
    svg.appendChild(cross);
    var dots = svgEl("g", { opacity: 0 });
    svg.appendChild(dots);

    var overlay = svgEl("rect", { x: LEFT, y: TOP, width: plotW, height: plotH,
      fill: "transparent", tabindex: 0, "aria-label": (cfg.title || "chart") + " - use the table view for exact values" });
    function at(i, px, py) {
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
      dots.innerHTML = ""; dots.setAttribute("opacity", 1);
      var html = '<div class="tip-title">' + esc(labels[i]) + "</div>";
      var shown = series.filter(function (s) { return s.values[i] !== null && s.values[i] !== undefined; })
        .sort(function (a, b) { return b.values[i] - a.values[i]; });
      if (!shown.length) { tip.hide(); return; }
      shown.forEach(function (s) {
        html += swatchRow(s.color, s.name, cfg.fmtValue ? cfg.fmtValue(s.values[i]) : s.values[i]);
        dots.appendChild(svgEl("circle", { cx: X(i), cy: Y(s.values[i]), r: 4,
          fill: s.color, stroke: css("--surface-1"), "stroke-width": 2 }));
      });
      if (cfg.refSeries && cfg.refSeries[i] !== null) {
        html += swatchRow(css("--axis"), cfg.refLabel || "Goal pace",
          cfg.fmtValue ? cfg.fmtValue(cfg.refSeries[i]) : cfg.refSeries[i]);
      }
      tip.show(html, px !== undefined ? px : X(i), py !== undefined ? py : TOP + plotH / 2);
    }
    var focusI = Math.max(0, labels.length - 1);
    overlay.addEventListener("mousemove", function (ev) {
      var b = host.getBoundingClientRect();
      var px = ev.clientX - b.left;
      var i = Math.round((px - LEFT) / (plotW / Math.max(1, labels.length - 1)));
      i = Math.max(0, Math.min(labels.length - 1, i));
      focusI = i;
      at(i, px, ev.clientY - b.top);
    });
    function clear() { cross.setAttribute("opacity", 0); dots.setAttribute("opacity", 0); tip.hide(); }
    overlay.addEventListener("mouseleave", clear);
    overlay.addEventListener("blur", clear);
    overlay.addEventListener("focus", function () { at(focusI); });
    overlay.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      focusI = Math.max(0, Math.min(labels.length - 1, focusI + (ev.key === "ArrowRight" ? 1 : -1)));
      at(focusI);
    });
    svg.appendChild(overlay);
    host.appendChild(svg);
  }

  /* =============================================== generic table builder */
  function table(cols, rows, opts) {
    opts = opts || {};
    var thead = el("thead", {}, [el("tr", {}, cols.map(function (c) {
      return el("th", { class: (c.num ? "num " : "") + (c.sortable ? "sortable" : ""), scope: "col",
        title: c.title || null, text: c.head });
    }))]);
    var tb = el("tbody", {});
    rows.forEach(function (r) { tb.appendChild(r); });
    var t = el("table", { class: "data" }, [thead, tb]);
    if (opts.caption) t.appendChild(el("caption", { class: "sr-only", text: opts.caption }));
    return t;
  }
  function td(content, cls) {
    if (content instanceof Node) return el("td", { class: cls || null }, [content]);
    return el("td", { class: cls || null, text: content === null || content === undefined ? "—" : String(content) });
  }

  /* ====================================================================
     TAB 1 - KPIs
     ==================================================================== */
  var METRICS = [
    { key: "nrr", label: "Net Revenue Retention", short: "NRR", fmt: function (v) { return pct(v); }, higherIsBetter: true, ref: 100, refLabel: "100%" },
    { key: "grr", label: "Gross Revenue Retention", short: "GRR", fmt: function (v) { return pct(v); }, higherIsBetter: true, ref: 100, refLabel: "100%" },
    { key: "nps", label: "NPS", short: "NPS", fmt: function (v) { return String(Math.round(v)); }, higherIsBetter: true, diverging: true },
    { key: "revChurn", label: "Revenue churn", short: "Churn %", fmt: function (v) { return pct(v); }, higherIsBetter: false }
  ];

  function renderBookTiles() {
    var host = document.getElementById("bookTiles");
    var book = retention(ACCOUNTS);
    var trend = D.bookTrend;
    var prev = trend[trend.length - 2];
    var curQ = nps(respBy(function (r) { return r.quarter === CURQ; }));
    var prvQ = nps(respBy(function (r) { return r.quarter === PREVQ; }));

    document.getElementById("bookContext").textContent =
      ACCOUNTS.length + " accounts · " + moneyFull(book.start) + " opening ARR · " + moneyFull(book.arrNow) + " today";

    host.innerHTML = "";
    host.appendChild(statTile({
      label: "Net Revenue Retention", value: pct(book.nrr), hero: true,
      delta: book.nrr - prev.nrr, deltaUnit: " pts", higherIsBetter: true,
      note: "vs " + prev.quarter, spark: trend.map(function (t) { return t.nrr; })
    }));
    host.appendChild(statTile({
      label: "Gross Revenue Retention", value: pct(book.grr),
      delta: book.grr - prev.grr, deltaUnit: " pts", higherIsBetter: true,
      note: "vs " + prev.quarter, spark: trend.map(function (t) { return t.grr; })
    }));
    host.appendChild(statTile({
      label: "NPS (this quarter)", value: curQ.score === null ? "—" : String(curQ.score),
      delta: (curQ.score !== null && prvQ.score !== null) ? curQ.score - prvQ.score : null,
      deltaDp: 0, higherIsBetter: true,
      note: curQ.n + " responses · vs " + PREVQ,
      spark: ["2026-Q1", "2026-Q2", "2026-Q3"].map(function (q) {
        return nps(respBy(function (r) { return r.quarter === q; })).score;
      })
    }));
    host.appendChild(statTile({
      label: "Revenue churn", value: pct(book.revChurn),
      delta: book.revChurn - prev.revChurn, deltaUnit: " pts", higherIsBetter: false,
      note: book.lostLogos + " logos lost · " + pct(book.logoChurn) + " logo churn",
      spark: trend.map(function (t) { return t.revChurn; })
    }));
  }

  // rows for a dimension: [{label, retention, nps}]
  function dimRows(values, pick) {
    return values.map(function (v) {
      var accts = ACCOUNTS.filter(function (a) { return pick(a) === v; });
      var rs = RESP.filter(function (r) { return pick(r) === v; });
      return { label: v, ret: retention(accts), np: nps(rs) };
    });
  }

  function renderDimension(chartHostId, tableHostId, values, pick, dimName) {
    var data = dimRows(values, pick);
    var chost = document.getElementById(chartHostId);
    chost.innerHTML = "";

    METRICS.forEach(function (m) {
      var rows = data.map(function (d) {
        var v = m.key === "nps" ? d.np.score : d.ret[m.key];
        var extra = m.key === "nps"
          ? swatchRow(null, "Responses", String(d.np.n)) +
            swatchRow(null, "Promoters / detractors", d.np.promoters + " / " + d.np.detractors)
          : swatchRow(null, "Accounts", String(d.ret.n)) +
            swatchRow(null, "Opening ARR", moneyFull(d.ret.start));
        return { label: d.label, value: v, tip: extra };
      }).filter(function (r) { return r.value !== null && r.value !== undefined; });

      chost.appendChild(barCard(m.label, m.key === "nps" ? "Year to date, from survey responses" : "Trailing twelve months", {
        title: m.short, rows: rows, diverging: !!m.diverging,
        refValue: m.ref, refLabel: m.refLabel,
        minScale: m.key === "nps" ? 40 : undefined,
        fmtValue: m.fmt, fmtTick: m.key === "nps" ? function (t) { return String(Math.round(t)); } : function (t) { return Math.round(t) + "%"; },
        aria: m.label + " by " + dimName
      }));
    });

    // table-view twin: the WCAG-clean equivalent of all four charts
    var thost = document.getElementById(tableHostId);
    thost.innerHTML = "";
    var cols = [{ head: dimName }, { head: "Accounts", num: true }, { head: "Opening ARR", num: true },
      { head: "NRR", num: true }, { head: "GRR", num: true }, { head: "Revenue churn", num: true },
      { head: "NPS", num: true }, { head: "Responses", num: true }];
    var rows = data.map(function (d) {
      return el("tr", {}, [
        td(d.label), td(d.ret.n, "num"), td(moneyFull(d.ret.start), "num"),
        td(pct(d.ret.nrr), "num"), td(pct(d.ret.grr), "num"), td(pct(d.ret.revChurn), "num"),
        td(d.np.score === null ? "—" : d.np.score, "num"), td(d.np.n, "num")
      ]);
    });
    var book = retention(ACCOUNTS), bnp = nps(RESP);
    rows.push(el("tr", { style: "font-weight:650" }, [
      td("All"), td(book.n, "num"), td(moneyFull(book.start), "num"),
      td(pct(book.nrr), "num"), td(pct(book.grr), "num"), td(pct(book.revChurn), "num"),
      td(bnp.score, "num"), td(bnp.n, "num")
    ]));
    thost.appendChild(el("div", { class: "table-scroll" }, [
      table(cols, rows, { caption: "Retention and NPS by " + dimName })
    ]));
    thost.appendChild(el("p", { class: "table-cap", text: "NRR, GRR and churn are trailing twelve months. NPS is year to date." }));
  }

  function wireViewToggle(sectionSel, chartId, tableId) {
    var seg = document.querySelector(sectionSel + " .seg");
    if (!seg) return;
    seg.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-view]");
      if (!b) return;
      seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var isChart = b.dataset.view === "chart";
      document.getElementById(chartId).hidden = !isChart;
      document.getElementById(tableId).hidden = isChart;
      if (isChart) redrawAll();
    });
  }

  /* ====================================================================
     TAB 2 - Team
     ==================================================================== */
  var teamMetric = "upsell";
  var hiddenAms = {};

  function goalPace(goal, weeks) {
    var out = [];
    for (var i = 0; i < weeks; i++) out.push(goal * (i + 1) / weeks);
    return out;
  }

  function renderGoalsTable() {
    var host = document.getElementById("goalsTable");
    host.innerHTML = "";
    var cols = [{ head: "Account manager" }, { head: "NRR goal", num: true }, { head: "NRR actual", num: true },
      { head: "vs goal", num: true }, { head: "Upsell goal", num: true }, { head: "Upsell booked", num: true },
      { head: "Attainment" }];
    var rows = D.goals.map(function (g, i) {
      var gap = g.nrrActual - g.nrrGoal;
      var att = g.upsellGoal ? g.upsellActual / g.upsellGoal : 0;
      var cls = att >= 0.95 ? "is-good" : att >= 0.8 ? "is-warn" : "is-bad";
      var meter = el("div", { style: "display:flex;align-items:center;gap:8px" }, [
        el("div", { class: "meter " + cls, role: "img", "aria-label": Math.round(att * 100) + "% of upsell goal" },
          [el("i", { style: "width:" + Math.min(100, att * 100).toFixed(1) + "%" })]),
        el("span", { style: "font-variant-numeric:tabular-nums;min-width:38px", text: Math.round(att * 100) + "%" })
      ]);
      return el("tr", {}, [
        el("td", {}, [
          el("span", { class: "dot-key", style: "background:" + css(SERIES[i % SERIES.length]) }),
          document.createTextNode(g.am)
        ]),
        td(pct(g.nrrGoal), "num"), td(pct(g.nrrActual), "num"),
        el("td", { class: "num" }, [el("span", {
          class: "delta " + (Math.abs(gap) < 0.05 ? "flat" : gap > 0 ? "good" : "bad"),
          text: signed(gap) + " pts"
        })]),
        td(moneyFull(g.upsellGoal), "num"), td(moneyFull(g.upsellActual), "num"),
        el("td", {}, [meter])
      ]);
    });
    host.appendChild(table(cols, rows, { caption: "Quarter goals and attainment by account manager" }));
  }

  function renderTrack() {
    var host = document.getElementById("trackChart");
    var weeks = D.meta.weekLabels, elapsed = D.meta.weeksElapsed;
    var isUpsell = teamMetric === "upsell";

    document.getElementById("trackSub").textContent = isUpsell
      ? "Cumulative booked upsell per account manager against an even goal pace. Data runs to week " + elapsed + " of " + weeks.length + "."
      : "Net Revenue Retention across the quarter. The reference line is each manager's own goal, so it is shown in the tooltip and table rather than as one line.";

    var series = D.goals.map(function (g, i) {
      return {
        name: g.am, color: css(SERIES[i % SERIES.length]),
        values: isUpsell ? g.upsellSeries : g.nrrSeries,
        visible: !hiddenAms[g.am]
      };
    });

    // Goal pace only makes sense for the additive measure; a single pace line
    // across differing NRR goals would be meaningless, so it is omitted there.
    var ref = null, refLabel = null;
    if (isUpsell) {
      var totalGoal = D.goals.filter(function (g) { return !hiddenAms[g.am]; })
        .reduce(function (s, g) { return s + g.upsellGoal; }, 0);
      // per-manager average pace, so it sits in the same range as the lines
      var vis = D.goals.filter(function (g) { return !hiddenAms[g.am]; }).length || 1;
      ref = goalPace(totalGoal / vis, weeks.length);
      refLabel = "Avg goal pace";
    }

    host.innerHTML = "";
    chart(host, function (h) {
      lineChart(h, {
        title: isUpsell ? "Cumulative upsell" : "NRR",
        labels: weeks, series: series, refSeries: ref, refLabel: refLabel,
        yFromZero: isUpsell, height: 280,
        fmtY: isUpsell ? function (v) { return money(v); } : function (v) { return Math.round(v) + "%"; },
        fmtValue: isUpsell ? function (v) { return moneyFull(v); } : function (v) { return pct(v); },
        aria: (isUpsell ? "Cumulative upsell" : "NRR") + " by week for each account manager"
      });
    });

    // legend doubles as a per-series toggle; colour follows the person, never the rank
    var lg = document.getElementById("trackLegend");
    lg.innerHTML = "";
    D.goals.forEach(function (g, i) {
      var on = !hiddenAms[g.am];
      var li = el("li", { "aria-pressed": String(on) }, [
        el("button", { type: "button", "aria-pressed": String(on) }, [
          el("span", { class: "key", style: "background:" + css(SERIES[i % SERIES.length]) }),
          el("span", { text: g.am })
        ])
      ]);
      li.querySelector("button").addEventListener("click", function () {
        if (hiddenAms[g.am]) delete hiddenAms[g.am]; else hiddenAms[g.am] = true;
        renderTrack();
      });
      lg.appendChild(li);
    });

    // table view twin
    var thost = document.getElementById("trackTable");
    thost.innerHTML = "";
    var cols = [{ head: "Week" }].concat(D.goals.map(function (g) { return { head: g.am, num: true }; }));
    var rows = weeks.map(function (wk, wi) {
      return el("tr", {}, [td(wk)].concat(D.goals.map(function (g) {
        var v = (isUpsell ? g.upsellSeries : g.nrrSeries)[wi];
        return td(v === null ? "—" : (isUpsell ? moneyFull(v) : pct(v)), "num");
      })));
    });
    thost.appendChild(table(cols, rows, { caption: "Weekly values by account manager" }));
  }

  /* ---- active customer list ---- */
  var custScope = "team", custAm = null, custSort = { key: "daysToRenewal", dir: 1 };

  function renderCustomers() {
    var host = document.getElementById("custTable");
    var rows = ACTIVE.filter(function (a) { return custScope === "team" || a.am === custAm; });

    var sk = custSort.key, dir = custSort.dir;
    rows = rows.slice().sort(function (a, b) {
      var x, y;
      if (sk === "health") { var o = { "At Risk": 0, Watch: 1, Healthy: 2 }; x = o[healthOf(a)]; y = o[healthOf(b)]; }
      else if (sk === "arrNow" || sk === "daysToRenewal") { x = a[sk]; y = b[sk]; }
      else { x = String(a[sk]).toLowerCase(); y = String(b[sk]).toLowerCase(); }
      return x < y ? -dir : x > y ? dir : String(a.name).localeCompare(String(b.name));
    });

    var cols = [
      { head: "Account", key: "name", sortable: true },
      { head: "Account manager", key: "am", sortable: true },
      { head: "Company stage", key: "segment", sortable: true },
      { head: "Company ARR", key: "arrNow", sortable: true, num: true },
      { head: "Customer health", key: "health", sortable: true },
      { head: "Days until renewal", key: "daysToRenewal", sortable: true, num: true }
    ];

    var trs = rows.map(function (a) {
      var sel = el("select", { class: "health", "aria-label": "Customer health for " + a.name });
      D.healthStates.forEach(function (hv) {
        sel.appendChild(el("option", { value: hv, selected: healthOf(a) === hv ? "selected" : null, text: hv }));
      });
      var cell = el("td", { class: healthOverrides[a.id] ? "edited" : null }, [sel]);
      sel.addEventListener("change", function () {
        setHealth(a.id, sel.value);
        renderCustomers();
        renderNpsTab();   // health feeds nothing in NPS maths, but the summary counts move
      });

      var d = a.daysToRenewal;
      var urgency = d <= 30 ? "critical" : d <= 60 ? "warning" : null;
      var daysCell = el("td", { class: "num" }, [
        urgency
          ? el("span", { class: "pill " + urgency }, [
              el("span", { class: "ic", text: urgency === "critical" ? "■" : "▲" }),
              el("span", { text: String(d) })
            ])
          : document.createTextNode(String(d))
      ]);

      return el("tr", {}, [
        td(a.name), td(a.am), td(a.segment), td(moneyFull(a.arrNow), "num"), cell, daysCell
      ]);
    });

    host.innerHTML = "";
    if (!trs.length) {
      host.appendChild(el("p", { class: "empty", text: "No active accounts for this selection." }));
    } else {
      var t = table(cols, trs, { caption: "Active customers" });
      t.querySelectorAll("th.sortable").forEach(function (th, i) {
        var c = cols[i];
        if (c.key === custSort.key) {
          th.appendChild(el("span", { class: "arrow", text: custSort.dir === 1 ? "▲" : "▼" }));
          th.setAttribute("aria-sort", custSort.dir === 1 ? "ascending" : "descending");
        }
        th.tabIndex = 0;
        function go() {
          if (custSort.key === c.key) custSort.dir *= -1;
          else custSort = { key: c.key, dir: 1 };
          renderCustomers();
        }
        th.addEventListener("click", go);
        th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
      host.appendChild(t);
    }

    var counts = { Healthy: 0, Watch: 0, "At Risk": 0 };
    rows.forEach(function (a) { counts[healthOf(a)] = (counts[healthOf(a)] || 0) + 1; });
    var arr = rows.reduce(function (s, a) { return s + a.arrNow; }, 0);
    document.getElementById("custSummary").textContent =
      rows.length + " accounts · " + moneyFull(arr) + " ARR · " +
      counts.Healthy + " healthy / " + counts.Watch + " watch / " + counts["At Risk"] + " at risk";

    var edits = Object.keys(healthOverrides).length;
    document.getElementById("custCap").textContent =
      "Sorted by " + (cols.find(function (c) { return c.key === custSort.key; }) || {}).head +
      ". Churned accounts are excluded from this list." +
      (edits ? " " + edits + " health value" + (edits === 1 ? "" : "s") + " edited in this browser." : "");
  }

  /* ====================================================================
     TAB 3 - NPS
     ==================================================================== */
  function renderNpsTiles() {
    var host = document.getElementById("npsTiles");
    host.innerHTML = "";
    var cur = nps(respBy(function (r) { return r.quarter === CURQ; }));
    var prv = nps(respBy(function (r) { return r.quarter === PREVQ; }));
    var ytd = nps(respBy(function (r) { return r.date.slice(0, 4) === String(D.meta.year); }));
    var qs = ["2026-Q1", "2026-Q2", "2026-Q3"];

    host.appendChild(statTile({
      label: "NPS this quarter (" + CURQ + ")", value: cur.score === null ? "—" : String(cur.score), hero: true,
      delta: (cur.score !== null && prv.score !== null) ? cur.score - prv.score : null, deltaDp: 0,
      higherIsBetter: true, note: cur.n + " responses · vs " + PREVQ,
      spark: qs.map(function (q) { return nps(respBy(function (r) { return r.quarter === q; })).score; })
    }));
    host.appendChild(statTile({
      label: "NPS last quarter (" + PREVQ + ")", value: prv.score === null ? "—" : String(prv.score),
      note: prv.n + " responses"
    }));
    host.appendChild(statTile({
      label: "NPS year to date (" + D.meta.year + ")", value: ytd.score === null ? "—" : String(ytd.score),
      note: ytd.n + " responses across " + qs.length + " quarters"
    }));

    // promoter / passive / detractor mix, as counts with a proportion bar
    var mix = el("div", { class: "card" }, [
      el("p", { class: "tile-label", text: "Response mix, year to date" }),
      el("div", { class: "tile-value", style: "font-size:22px", text: ytd.n + " responses" })
    ]);
    var bar = el("div", { style: "display:flex;gap:2px;margin-top:12px;height:8px" });
    [["Promoters", ytd.promoters, css("--diverge-pos")],
     ["Passives", ytd.passives, css("--axis")],
     ["Detractors", ytd.detractors, css("--diverge-neg")]].forEach(function (p) {
      if (!p[1]) return;
      bar.appendChild(el("div", {
        style: "flex:" + p[1] + ";background:" + p[2] + ";border-radius:3px",
        role: "img", "aria-label": p[0] + ": " + p[1]
      }));
    });
    mix.appendChild(bar);
    var lg = el("ul", { class: "legend" });
    [["Promoters", ytd.promoters, css("--diverge-pos")],
     ["Passives", ytd.passives, css("--axis")],
     ["Detractors", ytd.detractors, css("--diverge-neg")]].forEach(function (p) {
      lg.appendChild(el("li", {}, [
        el("span", { class: "key dot", style: "background:" + p[2] }),
        el("span", { text: p[0] + " " + p[1] + " (" + Math.round(100 * p[1] / (ytd.n || 1)) + "%)" })
      ]));
    });
    mix.appendChild(lg);
    host.appendChild(mix);
  }

  function renderNpsBreakdown() {
    var host = document.getElementById("npsBreakdown");
    host.innerHTML = "";
    [["Company stage", "segment", D.segments],
     ["Industry", "industry", D.industries],
     ["Account manager", "am", D.ams]].forEach(function (spec) {
      var label = spec[0], key = spec[1], values = spec[2];
      var rows = values.map(function (v) {
        var rs = RESP.filter(function (r) { return r[key] === v; });
        var s = nps(rs);
        return {
          label: v, value: s.score,
          tip: swatchRow(null, "Responses", String(s.n)) +
               swatchRow(null, "Promoters", String(s.promoters)) +
               swatchRow(null, "Passives", String(s.passives)) +
               swatchRow(null, "Detractors", String(s.detractors))
        };
      }).filter(function (r) { return r.value !== null; })
        .sort(function (a, b) { return b.value - a.value; });

      var wrap = el("div", { class: "chart-wrap" });
      var card = el("div", { class: "card" }, [
        el("div", { class: "card-head" }, [el("h3", { class: "card-title", text: "NPS by " + label.toLowerCase() })]),
        el("p", { class: "card-sub", text: "Year to date · " + RESP.length + " responses" }),
        wrap
      ]);
      chart(wrap, function (h) {
        hBarChart(h, {
          title: "NPS", rows: rows, diverging: true, minScale: 40,
          labelWidth: key === "am" ? 118 : 110,
          fmtValue: function (v) { return String(Math.round(v)); },
          fmtTick: function (t) { return String(Math.round(t)); },
          aria: "NPS by " + label
        });
      });
      // table twin
      var det = el("details", { style: "margin-top:10px" }, [
        el("summary", { style: "cursor:pointer;font-size:12.5px;color:var(--text-secondary)", text: "Table view" })
      ]);
      var trs = rows.map(function (r) {
        var rs = RESP.filter(function (x) { return x[key] === r.label; });
        var s = nps(rs);
        return el("tr", {}, [td(r.label), td(s.score === null ? "—" : s.score, "num"), td(s.n, "num"),
          td(s.promoters, "num"), td(s.passives, "num"), td(s.detractors, "num")]);
      });
      det.appendChild(el("div", { class: "table-scroll", style: "margin-top:8px" }, [
        table([{ head: label }, { head: "NPS", num: true }, { head: "n", num: true },
          { head: "Prom.", num: true }, { head: "Pass.", num: true }, { head: "Detr.", num: true }], trs,
          { caption: "NPS by " + label })
      ]));
      card.appendChild(det);
      host.appendChild(card);
    });
  }

  var npsFilter = { period: "all", band: "all", am: "all" };

  function renderNpsResponses() {
    var host = document.getElementById("npsTable");
    var rows = RESP.filter(function (r) {
      if (npsFilter.period !== "all" && r.quarter !== npsFilter.period) return false;
      if (npsFilter.am !== "all" && r.am !== npsFilter.am) return false;
      if (npsFilter.band === "promoter" && r.score < 9) return false;
      if (npsFilter.band === "passive" && (r.score < 7 || r.score > 8)) return false;
      if (npsFilter.band === "detractor" && r.score > 6) return false;
      return true;
    });

    var s = nps(rows);
    document.getElementById("npsRespCount").textContent =
      rows.length + " of " + RESP.length + " responses" + (s.score === null ? "" : " · NPS " + s.score);
    document.getElementById("npsRespSub").textContent =
      "Each response is tied to an account, so every breakdown above is derived from this same list.";

    var cols = [{ head: "Date" }, { head: "Score", num: true }, { head: "Band" }, { head: "Company" },
      { head: "Respondent" }, { head: "Stage" }, { head: "Account manager" }, { head: "Comment" }];

    var trs = rows.map(function (r) {
      var band = r.score >= 9 ? ["Promoter", "good", "●"] : r.score >= 7 ? ["Passive", "muted", "▲"] : ["Detractor", "critical", "■"];
      return el("tr", {}, [
        td(r.date),
        el("td", { class: "num", style: "font-weight:650" }, [document.createTextNode(String(r.score))]),
        el("td", {}, [el("span", { class: "pill " + band[1] }, [
          el("span", { class: "ic", text: band[2] }), el("span", { text: band[0] })
        ])]),
        td(r.company),
        el("td", {}, [
          document.createTextNode(r.respondent),
          el("div", { style: "color:var(--text-muted);font-size:12px", text: r.title })
        ]),
        td(r.segment), td(r.am), td(r.comment, "wrap")
      ]);
    });

    host.innerHTML = "";
    if (!trs.length) host.appendChild(el("p", { class: "empty", text: "No responses match these filters." }));
    else host.appendChild(table(cols, trs, { caption: "NPS survey responses" }));
  }

  function renderNpsTab() {
    renderNpsTiles();
    renderNpsResponses();
  }

  /* ====================================================================
     wiring
     ==================================================================== */
  function initTabs() {
    var tabs = [].slice.call(document.querySelectorAll(".tab"));
    function select(t) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute("aria-selected", String(on));
        document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
      });
      redrawAll();   // charts in a previously hidden panel had no width to measure
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (ev) {
        var d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        ev.preventDefault();
        var n = tabs[(i + d + tabs.length) % tabs.length];
        n.focus(); select(n);
      });
    });
  }

  function initTheme() {
    var btn = document.getElementById("themeToggle");
    var stored = null;
    try { stored = localStorage.getItem("csdash.theme"); } catch (e) { /* ignore */ }
    if (stored) document.documentElement.setAttribute("data-theme", stored);
    function label() {
      var dark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      btn.textContent = dark ? "Light mode" : "Dark mode";
    }
    label();
    btn.addEventListener("click", function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("csdash.theme", next); } catch (e) { /* ignore */ }
      label();
      renderAll();   // colours are read from CSS vars at draw time
    });
  }

  function initTeamControls() {
    document.getElementById("teamQuarterLabel").textContent =
      CURQ + " · week " + D.meta.weeksElapsed + " of " + D.meta.weekLabels.length;

    var seg = document.querySelector("#panel-team .card-head .seg");
    seg.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-metric]");
      if (!b) return;
      seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      teamMetric = b.dataset.metric;
      renderTrack();
    });

    var picker = document.getElementById("amPicker");
    D.ams.forEach(function (a) { picker.appendChild(el("option", { value: a, text: a })); });
    custAm = D.ams[0];
    picker.value = custAm;
    picker.addEventListener("change", function () { custAm = picker.value; renderCustomers(); });

    var scopeSeg = document.querySelector("#panel-team .toolbar .seg");
    scopeSeg.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-scope]");
      if (!b) return;
      scopeSeg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      custScope = b.dataset.scope;
      document.getElementById("amPickerWrap").hidden = custScope !== "am";
      renderCustomers();
    });
  }

  function initNpsControls() {
    var per = document.getElementById("npsPeriod");
    per.appendChild(el("option", { value: "all", text: "Year to date" }));
    var qs = [];
    RESP.forEach(function (r) { if (qs.indexOf(r.quarter) < 0) qs.push(r.quarter); });
    qs.sort().reverse().forEach(function (q) {
      per.appendChild(el("option", { value: q, text: q + (q === CURQ ? " (current)" : "") }));
    });
    per.addEventListener("change", function () { npsFilter.period = per.value; renderNpsResponses(); });

    document.getElementById("npsBand").addEventListener("change", function (e) {
      npsFilter.band = e.target.value; renderNpsResponses();
    });

    var am = document.getElementById("npsAm");
    am.appendChild(el("option", { value: "all", text: "All" }));
    D.ams.forEach(function (a) { am.appendChild(el("option", { value: a, text: a })); });
    am.addEventListener("change", function () { npsFilter.am = am.value; renderNpsResponses(); });
  }

  function renderAll() {
    charts.length = 0;
    renderBookTiles();
    renderDimension("byAmCharts", "byAmTable", D.ams, function (x) { return x.am; }, "Account manager");
    renderDimension("bySegCharts", "bySegTable", D.segments, function (x) { return x.segment; }, "Segment");
    renderGoalsTable();
    renderTrack();
    renderCustomers();
    renderNpsBreakdown();
    renderNpsTab();
    redrawAll();
  }

  document.getElementById("asOf").textContent = D.meta.asOf;
  document.getElementById("footStamp").textContent =
    "Dataset seed " + D.meta.seed + " · " + D.accounts.length + " accounts · " +
    D.npsResponses.length + " survey responses · generated for " + D.meta.asOf + ".";

  initTabs();
  initTheme();
  initTeamControls();
  initNpsControls();
  wireViewToggle("#panel-kpis .section:nth-of-type(2)", "byAmCharts", "byAmTable");
  wireViewToggle("#panel-kpis .section:nth-of-type(3)", "bySegCharts", "bySegTable");
  renderAll();
})();
