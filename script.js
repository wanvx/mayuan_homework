/* ============================================================
 * 马原方法工具箱 · 交互与计分逻辑
 * 依赖 data.js 中的 questions / dimensions / scoreBounds 等
 * ============================================================ */

/* ---------- 运行时状态 ---------- */

let appState = {
  current: 0,     // 当前题号（0 起）
  answers: [],    // 每题所选选项下标，-1 表示未作答
  locked: false   // 动画期间的点击锁
};

let el = {};

/* ---------- 计分（纯函数） ---------- */

function computeRawScores(answers) {
  const raw = {};
  dimensions.forEach(function (dim) { raw[dim] = 0; });
  answers.forEach(function (optionIndex, questionIndex) {
    const question = questions[questionIndex];
    if (!question || optionIndex < 0) return;
    const option = question.options[optionIndex];
    dimensions.forEach(function (dim) {
      raw[dim] += option.scores[dim] || 0;
    });
  });
  return raw;
}

function toStandardScore(dim, rawScore) {
  const bound = scoreBounds[dim];
  const value = ((rawScore - bound.min) / (bound.max - bound.min)) * 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeStandardScores(answers) {
  const raw = computeRawScores(answers);
  const standard = {};
  dimensions.forEach(function (dim) {
    standard[dim] = toStandardScore(dim, raw[dim]);
  });
  return standard;
}

function pickTopDimension(standard) {
  return dimensions.slice().sort(function (a, b) {
    return standard[b] - standard[a] ||
      tieTopPriority.indexOf(a) - tieTopPriority.indexOf(b);
  })[0];
}

function pickBottomDimension(standard) {
  return dimensions.slice().sort(function (a, b) {
    return standard[a] - standard[b] ||
      tieBottomPriority.indexOf(a) - tieBottomPriority.indexOf(b);
  })[0];
}

function tierOf(score) {
  if (score <= 39) return "tier-low";
  if (score <= 59) return "tier-mid";
  if (score <= 79) return "tier-good";
  return "tier-high";
}

function buildResult(answers) {
  const standard = computeStandardScores(answers);
  const top = pickTopDimension(standard);
  const bottom = pickBottomDimension(standard);
  return {
    standard: standard,
    top: top,
    bottom: bottom,
    combo: combinationTypes[top + "-" + bottom] || "综合型"
  };
}

/* ---------- 视图切换 ---------- */

function showView(name) {
  Object.keys(el.views).forEach(function (key) {
    el.views[key].classList.toggle("active", key === name);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function quizHasProgress() {
  const answered = appState.answers.filter(function (a) { return a !== -1; }).length;
  return answered > 0 && answered < questions.length;
}

function goHome() {
  if (el.views.quiz.classList.contains("active") && quizHasProgress()) {
    if (!window.confirm("答题尚未完成，返回首页后需要重新开始，确定离开吗？")) return;
  }
  showView("home");
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
      renderResult(buildResult(appState.answers));
      showView("result");
    }
  }, 340);
}

function goPrev() {
  if (appState.current === 0) return;
  appState.current -= 1;
  renderQuestion();
}

/* ---------- 结果页 ---------- */

function renderResult(result) {
  const topScore = result.standard[result.top];
  const bottomScore = result.standard[result.bottom];

  el.statTop.textContent = result.top + " · " + topScore + " 分";
  el.statBottom.textContent = result.bottom + " · " + bottomScore + " 分";
  el.statCombo.textContent = result.combo;

  el.summaryLine.textContent =
    "你的最高维是「" + result.top + "」（" + topScore + " 分），最低维是「" +
    result.bottom + "」（" + bottomScore + " 分），组合类型为「" + result.combo + "」。";

  el.diagnosis.textContent = strengths[result.top] + "但" + weaknesses[result.bottom];

  el.actionLead.textContent = "从最低维「" + result.bottom + "」入手：";
  el.action.textContent = actions[result.bottom];

  renderChart(result.standard);
}

function renderChart(standard) {
  el.chart.innerHTML = "";
  const bars = [];

  dimensions.forEach(function (dim) {
    const score = standard[dim];

    const col = document.createElement("div");
    col.className = "bar-col";

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = score;

    const track = document.createElement("div");
    track.className = "bar-track";

    const bar = document.createElement("div");
    bar.className = "bar " + tierOf(score);
    bar.dataset.height = Math.max(score, 2);
    track.appendChild(bar);

    const name = document.createElement("span");
    name.className = "bar-name";
    name.textContent = dim;
    name.title = dim + "（" + dimensionFullNames[dim] + "）";

    col.appendChild(value);
    col.appendChild(track);
    col.appendChild(name);
    el.chart.appendChild(col);
    bars.push(bar);
  });

  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      bars.forEach(function (bar, index) {
        window.setTimeout(function () {
          bar.style.height = bar.dataset.height + "%";
        }, index * 80);
      });
    });
  });
}

/* ---------- 启动 ---------- */

function initApp() {
  el = {
    views: {
      home: document.getElementById("view-home"),
      quiz: document.getElementById("view-quiz"),
      result: document.getElementById("view-result"),
      about: document.getElementById("view-about")
    },
    progressText: document.getElementById("progress-text"),
    progressFill: document.getElementById("progress-fill"),
    questionText: document.getElementById("question-text"),
    options: document.getElementById("options"),
    btnPrev: document.getElementById("btn-prev"),
    chart: document.getElementById("chart"),
    statTop: document.getElementById("stat-top"),
    statBottom: document.getElementById("stat-bottom"),
    statCombo: document.getElementById("stat-combo"),
    summaryLine: document.getElementById("summary-line"),
    diagnosis: document.getElementById("diagnosis"),
    actionLead: document.getElementById("action-lead"),
    action: document.getElementById("action")
  };

  appState.answers = new Array(questions.length).fill(-1);

  document.getElementById("btn-start").addEventListener("click", startQuiz);
  document.getElementById("btn-retest").addEventListener("click", startQuiz);
  document.getElementById("btn-home").addEventListener("click", function () { showView("home"); });
  document.getElementById("btn-prev").addEventListener("click", goPrev);
  document.getElementById("btn-about").addEventListener("click", function () { showView("about"); });
  document.getElementById("btn-nav-home").addEventListener("click", goHome);
  document.getElementById("btn-logo").addEventListener("click", goHome);

  showView("home");
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}
