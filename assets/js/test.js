/* ============================================================
 * 马原人格测试网 · 交互与计分逻辑
 * 依赖 test-data.js 中的 dims / dimMeta / questions / templates / fallbackMap
 * ============================================================ */

/* ---------- 运行时状态 ---------- */

let appState = {
  current: 0,
  answers: [],
  locked: false
};

let el = {};

/* ---------- 计分（纯函数） ---------- */

function computeScores(answers) {
  const U = {};
  dims.forEach(function (d) { U[d] = 0; });

  // 只统计真正作答的题：-1、undefined、越界索引都算未作答
  let answered = 0;
  answers.forEach(function (optIndex, qIndex) {
    const question = questions[qIndex];
    if (!question) return;
    if (typeof optIndex !== "number" || optIndex < 0) return;
    const option = question.options[optIndex];
    if (!option || !option.scores) return;
    answered += 1;
    dims.forEach(function (d, i) { U[d] += option.scores[i]; });
  });

  // 每题每维贡献 [-2, +2]，故单维理论区间是 [-2n, +2n]
  const span = 2 * answered;

  // 一道都没答：六维一律给中位，避免除零
  if (span === 0) {
    dims.forEach(function (d) { U[d] = 50; });
    return U;
  }

  dims.forEach(function (d) {
    // (raw + span) / (2 * span) * 100，把 [-span, +span] 映射到 [0, 100]
    // 20 题全答时 span = 40，等价于旧版写死的 (raw + 40) / 80 * 100
    const norm = (U[d] + span) / (2 * span) * 100;
    U[d] = Math.max(0, Math.min(100, Math.round(norm)));
  });
  return U;
}

function euclidMatch(U, T, core) {
  let sum = 0, dmax = 0;
  dims.forEach(function (d, i) {
    const w = core.indexOf(d) >= 0 ? 1.5 : 1.0;
    const diff = U[d] - T[i];
    sum += w * diff * diff;
    dmax += w * 100 * 100;
  });
  const d = Math.sqrt(sum);
  const dMax = Math.sqrt(dmax);
  return (1 - d / dMax) * 100;
}

function cosineMatch(U, T) {
  let dot = 0, nu = 0, nt = 0;
  dims.forEach(function (d, i) {
    dot += U[d] * T[i];
    nu += U[d] * U[d];
    nt += T[i] * T[i];
  });
  const denom = Math.sqrt(nu) * Math.sqrt(nt);
  if (denom === 0) return 0;
  return Math.max(0, dot / denom) * 100;
}

function finalMatch(U, T, core) {
  return 0.6 * euclidMatch(U, T, core) + 0.4 * cosineMatch(U, T);
}

function findTemplate(name) {
  return templates.find(function (t) { return t.name === name; });
}

function analyze(answers) {
  const U = computeScores(answers);
  const vals = dims.map(function (d) { return U[d]; });
  const minS = Math.min.apply(null, vals);
  const maxS = Math.max.apply(null, vals);

  const order = dims.slice().sort(function (a, b) { return U[b] - U[a]; });

  // 特殊判定（阈值来自 test-data.js 的 BAND，与结果页的分档共用）
  let special = null;
  if (minS >= BAND.high) special = "全面发展者";
  else if (maxS <= BAND.low) special = "偶然个人";

  // 常规候选
  const top2 = order.slice(0, 2);
  let candidates = templates.filter(function (t) {
    return t.core.some(function (d) { return top2.indexOf(d) >= 0; });
  });
  if (candidates.length === 0) candidates = templates.slice();

  const ranked = candidates
    .map(function (t) {
      return { name: t.name, core: t.core, match: finalMatch(U, t.vec, t.core) };
    })
    .sort(function (a, b) { return b.match - a.match; });

  // 前三名
  let top3;
  if (special) {
    const sp = findTemplate(special);
    const spEntry = { name: special, core: sp.core, match: finalMatch(U, sp.vec, sp.core) };
    top3 = [spEntry].concat(ranked.filter(function (r) { return r.name !== special; })).slice(0, 3);
  } else {
    top3 = ranked.slice(0, 3);
  }

  // 最终人格
  let finalTemplate, fallback = false, fallbackDim = null;
  if (special) {
    finalTemplate = findTemplate(special);
  } else if (ranked[0].match < 60) {
    fallback = true;
    fallbackDim = order[0];
    finalTemplate = findTemplate(fallbackMap[order[0]]);
  } else {
    finalTemplate = findTemplate(ranked[0].name);
  }

  const finalMatchVal = finalMatch(U, finalTemplate.vec, finalTemplate.core);

  return {
    U: U,
    answers: answers.slice(),   // 拷贝一份：重测时 appState.answers 会被重置
    finalTemplate: finalTemplate,
    finalMatch: finalMatchVal,
    fallback: fallback,
    fallbackDim: fallbackDim,
    top3: top3
  };
}

/* ---------- 视图切换 ---------- */

function showView(name) {
  Object.keys(el.views).forEach(function (key) {
    el.views[key].classList.toggle("active", key === name);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- 首页：六维说明 ---------- */

function renderDimGrid() {
  el.dimGrid.innerHTML = "";
  dims.forEach(function (d) {
    const meta = dimMeta[d];
    const card = document.createElement("div");
    card.className = "dim-card";

    const head = document.createElement("div");
    head.className = "dim-head";
    const letter = document.createElement("span");
    letter.className = "dim-letter";
    letter.textContent = d;
    const name = document.createElement("span");
    name.className = "dim-name";
    name.textContent = meta.name;
    head.appendChild(letter);
    head.appendChild(name);

    const desc = document.createElement("p");
    desc.className = "dim-desc";
    desc.textContent = meta.desc;

    const principle = document.createElement("p");
    principle.className = "dim-principle";
    principle.innerHTML = '<span class="dim-principle-label">对应原理</span>'
      + esc(principleName(meta.principle));

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(principle);
    el.dimGrid.appendChild(card);
  });
}

/* ---------- 答题流程 ---------- */

function startQuiz() {
  appState.current = 0;
  appState.answers = new Array(questions.length).fill(-1);
  appState.locked = false;
  renderQuestion();
  showView("quiz");
}

function renderQuestion() {
  const question = questions[appState.current];

  el.progressText.textContent = "第 " + (appState.current + 1) + " / " + questions.length + " 题";
  el.progressFill.style.width = (((appState.current + 1) / questions.length) * 100) + "%";
  el.questionText.textContent = question.text;
  el.btnPrev.disabled = appState.current === 0;

  el.options.innerHTML = "";
  question.options.forEach(function (option, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    if (appState.answers[appState.current] === index) {
      button.classList.add("selected");
    }

    const key = document.createElement("span");
    key.className = "key";
    key.textContent = "ABCD"[index];

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = option.text;

    button.appendChild(key);
    button.appendChild(text);
    button.addEventListener("click", function () { chooseOption(index); });
    el.options.appendChild(button);
  });
}

function chooseOption(optionIndex) {
  if (appState.locked) return;
  appState.locked = true;
  appState.answers[appState.current] = optionIndex;

  el.options.querySelectorAll(".option").forEach(function (button, index) {
    button.classList.toggle("selected", index === optionIndex);
    button.disabled = true;
  });

  window.setTimeout(function () {
    appState.locked = false;
    if (appState.current < questions.length - 1) {
      appState.current += 1;
      renderQuestion();
    } else {
      el.progressFill.style.width = "100%";
      renderResult(analyze(appState.answers));
      showView("result");
    }
  }, 340);
}

function goPrev() {
  if (appState.current === 0) return;
  appState.current -= 1;
  renderQuestion();
}

/* ---------- 文案工具 ---------- */

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function principleName(key) {
  const p = principles[key];
  return p ? p.name : "";
}

function principleList(keys) {
  return (keys || []).map(principleName).filter(Boolean).join(" · ");
}

function bandOf(score) {
  if (score >= BAND.high) return "high";
  if (score <= BAND.low) return "low";
  return "mid";
}

function bandLabel(band) {
  if (band === "high") return "高分档";
  if (band === "low") return "待发展档";
  return "中等档";
}

/* ---------- 结果页 ---------- */

function renderResult(result) {
  const t = result.finalTemplate;

  el.resultName.textContent = t.name;
  el.resultMatch.textContent = "匹配度 " + result.finalMatch.toFixed(1) + "%";

  renderRadar(result.U);
  renderDimAnalysis(result.U);

  // 标签
  el.resultTags.innerHTML = "";
  t.tags.split("/").forEach(function (tag) {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag.trim();
    el.resultTags.appendChild(span);
  });

  el.resultKeywords.textContent = t.keywords;
  el.resultPrinciple.textContent = principleList(t.principle) || "—";
  el.resultAdvice.textContent = t.advice;

  el.resultFigure.textContent = t.figure;
  el.resultFigureDeed.textContent = t.figureDeed;

  if (result.fallback) {
    el.resultFallbackNote.hidden = false;
    el.resultFallbackNote.textContent = "综合匹配度不足 60%，已按你的最高维度「" + dimMeta[result.fallbackDim].name + "」判定为「" + t.name + "」。";
  } else {
    el.resultFallbackNote.hidden = true;
  }

  // 前三名
  el.top3.innerHTML = "";
  result.top3.forEach(function (item) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "t-name";
    name.textContent = item.name;
    const core = document.createElement("span");
    core.className = "t-core";
    core.textContent = "核心维度：" + (item.core.length ? item.core.map(function (d) { return dimMeta[d].name; }).join("·") : "无（特殊判定）");
    const match = document.createElement("span");
    match.className = "t-match";
    match.textContent = item.match.toFixed(1) + "%";

    li.appendChild(name);
    li.appendChild(core);
    li.appendChild(match);
    el.top3.appendChild(li);
  });

  // 答题回顾（每次出结果都回到收起状态）
  renderReview(result.answers);
}

/* ---------- 六维分析 ---------- */

function renderDimAnalysis(U) {
  el.dimAnalysis.innerHTML = dims.map(function (d) {
    const meta = dimMeta[d];
    const score = U[d];
    const band = bandOf(score);
    const p = principles[meta.principle];

    let html = '<article class="da-item">'
      + '<div class="da-head">'
      + '<span class="dim-letter">' + d + '</span>'
      + '<span class="da-name">' + esc(meta.name) + '</span>'
      + '<span class="da-band da-band--' + band + '">' + bandLabel(band) + '</span>'
      + '<span class="da-score">' + score + '<span class="da-score-unit">分</span></span>'
      + '</div>'
      + '<div class="da-bar"><span class="da-bar-fill" style="width:' + score + '%"></span></div>'
      + '<p class="da-text">' + esc(meta.bands[band]) + '</p>';

    if (p) {
      html += '<p class="da-principle">'
        + '<span class="da-principle-label">对应原理</span>' + esc(p.name)
        + '</p>';
      if (p.quote) {
        html += '<blockquote class="da-quote">「' + esc(p.quote) + '」'
          + '<cite>——' + esc(p.author) + '《' + esc(p.work) + '》</cite>'
          + '</blockquote>';
      }
    }

    return html + '</article>';
  }).join("");
}

/* ---------- 答题回顾 ---------- */

function renderReview(answers) {
  el.reviewList.innerHTML = questions.map(function (q, i) {
    const idx = answers[i];
    const picked = (typeof idx === "number" && idx >= 0 && q.options[idx]) ? q.options[idx] : null;

    let html = '<li class="rv-item' + (picked ? '' : ' rv-unanswered') + '">'
      + '<p class="rv-q"><span class="rv-no">' + (i < 9 ? "0" : "") + (i + 1) + '</span>'
      + esc(q.text) + '</p>';

    if (picked) {
      html += '<p class="rv-answer"><span class="rv-key">' + "ABCD"[idx] + '</span>'
        + '<span>' + esc(picked.text) + '</span></p>'
        + '<p class="rv-stance"><span class="rv-stance-label">立场解析</span>'
        + esc(picked.stance) + '</p>';
    } else {
      html += '<p class="rv-answer"><span class="rv-key">—</span>'
        + '<span>本题未作答，不计入六维得分</span></p>';
    }

    html += '<p class="rv-principle">考查原理　' + esc(principleName(q.principle)) + '</p>';
    return html + '</li>';
  }).join("");

  el.reviewBox.open = false;
}

/* ---------- 雷达图 ---------- */

function renderRadar(U) {
  const size = 360;
  const cx = 180, cy = 180, R = 112;
  const angle = function (i) { return (i * 60 - 90) * Math.PI / 180; };
  const pt = function (i, r) {
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  };

  // 环形网格
  let rings = "";
  [25, 50, 75, 100].forEach(function (pct) {
    const r = R * pct / 100;
    const pts = dims.map(function (_, i) {
      const p = pt(i, r);
      return p[0].toFixed(1) + "," + p[1].toFixed(1);
    }).join(" ");
    rings += '<polygon class="radar-ring" points="' + pts + '"></polygon>';
  });

  // 轴线
  let axes = "";
  dims.forEach(function (_, i) {
    const p = pt(i, R);
    axes += '<line class="radar-axis" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"></line>';
  });

  // 数据多边形
  const dataPts = dims.map(function (d, i) {
    const p = pt(i, R * U[d] / 100);
    return p[0].toFixed(1) + "," + p[1].toFixed(1);
  }).join(" ");
  const area = '<polygon class="radar-area" points="' + dataPts + '"></polygon>';

  // 顶点圆点
  let dots = "";
  dims.forEach(function (d, i) {
    const p = pt(i, R * U[d] / 100);
    dots += '<circle class="radar-dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5"></circle>';
  });

  // 维度名称标签
  let labels = "";
  dims.forEach(function (d, i) {
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    const p = pt(i, R + 26);
    let anchor = "middle", dx = 0, dy = 0;
    if (cos > 0.3) { anchor = "start"; dx = 5; }
    else if (cos < -0.3) { anchor = "end"; dx = -5; }
    if (sin > 0.5) dy = 6;
    else if (sin < -0.5) dy = -6;
    labels += '<text class="radar-label" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" dx="' + dx + '" dy="' + dy + '" text-anchor="' + anchor + '">' + dimMeta[d].name + '</text>';
  });

  el.radar.innerHTML = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' +
    rings + axes + area + dots + labels + '</svg>';

  // 图例（含分值）
  el.radarLegend.innerHTML = "";
  dims.forEach(function (d) {
    const li = document.createElement("li");
    const letter = document.createElement("span");
    letter.className = "dim-letter";
    letter.textContent = d;
    li.appendChild(letter);
    li.appendChild(document.createTextNode(dimMeta[d].name + " · " + U[d] + " 分"));
    el.radarLegend.appendChild(li);
  });
}

/* ---------- 启动 ---------- */

function initApp() {
  el = {
    views: {
      home: document.getElementById("view-home"),
      quiz: document.getElementById("view-quiz"),
      result: document.getElementById("view-result")
    },
    dimGrid: document.getElementById("dim-grid"),
    progressText: document.getElementById("progress-text"),
    progressFill: document.getElementById("progress-fill"),
    questionText: document.getElementById("question-text"),
    options: document.getElementById("options"),
    btnPrev: document.getElementById("btn-prev"),
    radar: document.getElementById("radar"),
    radarLegend: document.getElementById("radar-legend"),
    resultName: document.getElementById("result-name"),
    resultMatch: document.getElementById("result-match"),
    resultTags: document.getElementById("result-tags"),
    resultKeywords: document.getElementById("result-keywords"),
    resultAdvice: document.getElementById("result-advice"),
    resultFallbackNote: document.getElementById("result-fallback-note"),
    resultFigure: document.getElementById("result-figure"),
    resultFigureDeed: document.getElementById("result-figure-deed"),
    resultPrinciple: document.getElementById("result-principle"),
    dimAnalysis: document.getElementById("dim-analysis"),
    reviewBox: document.getElementById("review-box"),
    reviewList: document.getElementById("review-list"),
    top3: document.getElementById("top3")
  };

  // 节点缺失会静默失败，先在控制台报出来
  ["dim-analysis", "review-box", "review-list", "result-principle"].forEach(function (id) {
    if (!document.getElementById(id)) console.warn("[马原测试] 缺少节点: #" + id);
  });

  appState.answers = new Array(questions.length).fill(-1);

  renderDimGrid();

  document.getElementById("btn-start").addEventListener("click", startQuiz);
  document.getElementById("btn-retest").addEventListener("click", startQuiz);
  document.getElementById("btn-prev").addEventListener("click", goPrev);

  showView("home");
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}
