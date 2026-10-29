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
  const lo = {};   // 该维在已答题目上的理论最低分
  const hi = {};   // 该维在已答题目上的理论最高分
  dims.forEach(function (d) { U[d] = 0; lo[d] = 0; hi[d] = 0; });

  // 只统计真正作答的题：-1、undefined、越界索引都算未作答
  answers.forEach(function (optIndex, qIndex) {
    const question = questions[qIndex];
    if (!question) return;
    if (typeof optIndex !== "number" || optIndex < 0) return;
    const option = question.options[optIndex];
    if (!option || !option.scores) return;

    dims.forEach(function (d, i) {
      U[d] += option.scores[i];
      // 边界取「这道题四个选项在该维上的最小 / 最大值」。
      // 每维只由真正考它的题撑开，这样归一化之后六维都能用满 0—100，
      // 不会被大量恒为 0 的题目把分数压到中间。
      const col = question.options.map(function (o) { return o.scores[i]; });
      lo[d] += Math.min.apply(null, col);
      hi[d] += Math.max.apply(null, col);
    });
  });

  // 一道都没答：六维一律给中位，避免除零
  const anyAnswer = dims.some(function (d) { return hi[d] !== lo[d]; });
  if (!anyAnswer) {
    dims.forEach(function (d) { U[d] = 50; });
    return U;
  }

  dims.forEach(function (d) {
    const span = hi[d] - lo[d];
    if (span <= 0) { U[d] = 50; return; }
    const norm = (U[d] - lo[d]) / span * 100;
    U[d] = Math.max(0, Math.min(100, Math.round(norm)));
  });
  return U;
}

/* 偏差超过这个值，视为与所有类型都差得较远，触发按最高维度兜底。
 * 27 分是 v2 实测定的：随机作答的偏差中位数约 20.8，P90 约 25.4，
 * 取 27 只兜住最不像的 5% 左右，不会误伤正常结果。 */
const DEVIATION_CAP = 27;

/* 加权均方差：core 维度权重 1.5，再除以权重和。
 * 除以权重和这一步很关键——不除的话，core 有三个维度的模板
 * 会天然得到更低的距离分母，被系统性地抬高分数。 */
function deviation(U, T, core) {
  let sum = 0, wsum = 0;
  dims.forEach(function (d, i) {
    const w = core.indexOf(d) >= 0 ? 1.5 : 1.0;
    const diff = U[d] - T[i];
    sum += w * diff * diff;
    wsum += w;
  });
  return Math.sqrt(sum / wsum); // 0—100，可直接读作「平均偏差几分」
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

  // 14 个模板全部参与排序。v2 的六维彼此独立，一个人很难六维全高或全低，
  // 所以「全面发展者」「偶然个人」不再只靠特殊判定，也参与正常比较——
  // 否则这两个模板永远抽不到。
  const normal = templates.slice();
  const ranked = normal
    .map(function (t) {
      return { name: t.name, core: t.core, dev: deviation(U, t.vec, t.core) };
    })
    .sort(function (a, b) { return a.dev - b.dev; });

  // 前三名
  let top3;
  if (special) {
    const sp = findTemplate(special);
    const spEntry = { name: special, core: sp.core, dev: deviation(U, sp.vec, sp.core) };
    top3 = [spEntry].concat(ranked.filter(function (r) { return r.name !== special; })).slice(0, 3);
  } else {
    top3 = ranked.slice(0, 3);
  }

  // 最终人格
  let finalTemplate, fallback = false, fallbackDim = null;
  if (special) {
    finalTemplate = findTemplate(special);
  } else if (ranked[0].dev > DEVIATION_CAP) {
    fallback = true;
    fallbackDim = order[0];
    finalTemplate = findTemplate(fallbackMap[order[0]]);
  } else {
    finalTemplate = findTemplate(ranked[0].name);
  }

  const finalDev = deviation(U, finalTemplate.vec, finalTemplate.core);
  const rank = (special || fallback)
    ? null
    : ranked.findIndex(function (r) { return r.name === finalTemplate.name; }) + 1;

  return {
    U: U,
    answers: answers.slice(),   // 拷贝一份：重测时 appState.answers 会被重置
    finalTemplate: finalTemplate,
    finalDev: finalDev,
    special: special,
    rank: rank,
    normalCount: normal.length,
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

  // 光给一个分数，读者不知道几分算好，补一个定性标签
  const fit = result.finalDev <= 8 ? ["fit-close", "贴合"]
    : result.finalDev <= 13 ? ["fit-near", "大致贴合"]
    : result.finalDev <= 18 ? ["fit-loose", "有点勉强"]
    : ["fit-far", "不太贴合"];
  el.resultMatch.innerHTML = "六维平均偏差 " + result.finalDev.toFixed(1) + " 分"
    + '<span class="fit-tag ' + fit[0] + '">' + fit[1] + "</span>";

  if (result.special) {
    el.resultRank.textContent = "六维全落在同一侧，由特殊规则判定，不参与排序";
  } else if (result.fallback) {
    el.resultRank.textContent = "与任何一类都差得较远，按你的最高维度兜底";
  } else {
    el.resultRank.textContent = "在 " + result.normalCount + " 种类型里排第 " + result.rank;
  }

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
    el.resultFallbackNote.textContent = "六个维度和哪一类都差得较远——最近的一类也差 "
      + result.top3[0].dev.toFixed(1) + " 分。所以改用你的最高维度「"
      + dimMeta[result.fallbackDim].name + "」来判定，得到「" + t.name + "」。";
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
    match.textContent = "差 " + item.dev.toFixed(1) + " 分";

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
    resultRank: document.getElementById("result-rank"),
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
  ["dim-analysis", "review-box", "review-list", "result-principle", "result-rank"].forEach(function (id) {
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
