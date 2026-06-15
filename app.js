const els = {};
let activeExam = null;
let importedSubmissions = null;
let clockTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  configureTeacherAccess();
  renderScheduleNotice(getExamWindowState());
  renderTeacher();
});

function bindElements() {
  [
    "studentTab", "teacherTab", "studentView", "teacherView", "studentForm",
    "studentStart", "examArea", "examForm", "examStudentName", "examMeta",
    "examScheduleNotice", "examClock", "resetExam", "studentDone", "doneMessage", "newSubmission", "refreshStats",
    "exportCsv", "exportJson", "importJson", "clearLocal", "statSubmissions",
    "statAverage", "statMedian", "statRange", "questionStats", "submissionsTable"
  ].forEach(id => els[id] = document.getElementById(id));
}

function bindEvents() {
  els.studentTab.addEventListener("click", () => switchView("student"));
  els.teacherTab.addEventListener("click", () => switchView("teacher"));
  els.studentForm.addEventListener("submit", startExam);
  els.examForm.addEventListener("submit", submitExam);
  els.resetExam.addEventListener("click", resetStudent);
  els.newSubmission.addEventListener("click", resetStudent);
  els.refreshStats.addEventListener("click", renderTeacher);
  els.exportCsv.addEventListener("click", exportCsv);
  els.exportJson.addEventListener("click", exportJson);
  els.importJson.addEventListener("change", importJson);
  els.clearLocal.addEventListener("click", clearLocal);
}

function configureTeacherAccess() {
  const params = new URLSearchParams(window.location.search);
  const teacherMode = params.get("teacher") === "1";
  els.teacherTab.hidden = !teacherMode;
  if (!teacherMode) {
    switchView("student");
  }
}

function switchView(view) {
  const teacher = view === "teacher";
  els.studentView.classList.toggle("active", !teacher);
  els.teacherView.classList.toggle("active", teacher);
  els.studentTab.classList.toggle("active", !teacher);
  els.teacherTab.classList.toggle("active", teacher);
  if (teacher) renderTeacher();
}

function startExam(event) {
  event.preventDefault();
  const windowState = getExamWindowState();
  if (!windowState.canStart) {
    renderScheduleNotice(windowState);
    return;
  }
  const name = document.getElementById("studentName").value.trim();
  const id = document.getElementById("studentId").value.trim();
  const seed = hashString(`${name}|${id}|${EXAM_CONFIG.title}`);
  activeExam = buildExam(name, id, seed);
  renderExam(activeExam);
  startClock();
  els.studentStart.classList.add("hidden");
  els.studentDone.classList.add("hidden");
  els.examArea.classList.remove("hidden");
}

function buildExam(name, studentId, seed) {
  const rng = mulberry32(seed);
  const topics = shuffle(Object.keys(EXAM_BANK), rng);
  const selectedSets = {};
  const questions = [];

  for (const topicId of topics) {
    const topic = EXAM_BANK[topicId];
    const setIndex = Math.floor(rng() * topic.sets.length);
    const set = topic.sets[setIndex];
    selectedSets[topicId] = set.id;

    const topicQuestions = shuffle(set.questions.slice(), rng)
      .slice(0, EXAM_CONFIG.questionsPerTopic[topicId])
      .map(question => prepareQuestion(topicId, topic.title, set, question, rng));
    questions.push(...topicQuestions);
  }

  return {
    submissionId: `${Date.now()}-${seed}`,
    name,
    studentId,
    seed,
    selectedSets,
    topicOrder: topics,
    questions
  };
}

function prepareQuestion(topicId, topicTitle, set, question, rng) {
  const options = question.options.map((text, index) => ({
    text,
    originalIndex: index,
    isCorrect: index === question.correctIndex
  }));
  const shuffledOptions = shuffle(options, rng);
  return {
    instanceId: `${topicId}:${set.id}:${question.id}`,
    topicId,
    topicTitle,
    setId: set.id,
    datasetHtml: set.datasetHtml,
    questionId: question.id,
    prompt: question.prompt,
    options: shuffledOptions,
    correctOption: shuffledOptions.findIndex(option => option.isCorrect)
  };
}

function renderExam(exam) {
  els.examStudentName.textContent = `${exam.name} - ${exam.studentId}`;
  els.examMeta.textContent = `מספר שאלות: ${exam.questions.length}. סדר נושאים: ${exam.topicOrder.map(t => EXAM_BANK[t].title).join(" ← ")}`;
  els.examForm.innerHTML = "";

  const template = document.getElementById("questionTemplate");
  exam.questions.forEach((question, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".question-number").textContent = `שאלה ${index + 1}`;
    node.querySelector(".question-topic").textContent = `${question.topicTitle} | ${question.setId}`;
    const prompt = node.querySelector(".prompt");
    const isFirstQuestionInTopic = index === 0 || exam.questions[index - 1].topicId !== question.topicId;
    prompt.innerHTML = `${isFirstQuestionInTopic ? `<div class="dataset">${question.datasetHtml}</div>` : ""}<p>${question.prompt}</p>`;

    const options = node.querySelector(".options");
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.innerHTML = `
        <input type="radio" name="q${index}" value="${optionIndex}" required>
        <span>${optionIndex + 1}. ${option.text}</span>
      `;
      options.appendChild(label);
    });
    els.examForm.appendChild(node);
  });
}

async function submitExam(event) {
  event.preventDefault();
  if (!activeExam) return;
  const windowState = getExamWindowState();
  if (windowState.isAfterHardEnd) {
    alert("מועד ההגשה הסתיים.");
    return;
  }

  const answers = activeExam.questions.map((question, index) => {
    const selected = Number(new FormData(els.examForm).get(`q${index}`));
    const selectedOption = question.options[selected];
    return {
      order: index + 1,
      instanceId: question.instanceId,
      topicId: question.topicId,
      topicTitle: question.topicTitle,
      setId: question.setId,
      questionId: question.questionId,
      prompt: question.prompt,
      selectedIndex: selected,
      selectedText: selectedOption?.text || "",
      correctIndex: question.correctOption,
      correctText: question.options[question.correctOption].text,
      isCorrect: selected === question.correctOption,
      optionOrder: question.options.map(option => option.text)
    };
  });

  const correct = answers.filter(answer => answer.isCorrect).length;
  const scorePoints = correct * 10;
  const totalPoints = activeExam.questions.length * 10;
  const submission = {
    submissionId: activeExam.submissionId,
    submittedAt: new Date().toISOString(),
    name: activeExam.name,
    studentId: activeExam.studentId,
    seed: activeExam.seed,
    selectedSets: activeExam.selectedSets,
    topicOrder: activeExam.topicOrder,
    score: scorePoints,
    correctCount: correct,
    total: activeExam.questions.length,
    totalPoints,
    percent: Math.round((correct / activeExam.questions.length) * 100),
    answers
  };

  saveLocalSubmission(submission);
  await sendToSheet(submission);
  els.examArea.classList.add("hidden");
  els.studentDone.classList.remove("hidden");
  els.doneMessage.textContent = `תודה ${submission.name}. ההגשה נקלטה. מספר אישור: ${submission.submissionId}`;
}

async function sendToSheet(submission) {
  const url = EXAM_CONFIG.googleScriptUrl.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(submission)
    });
  } catch (error) {
    console.warn("Google Sheet submission failed", error);
  }
}

function resetStudent() {
  activeExam = null;
  stopClock();
  els.studentForm.reset();
  els.examForm.innerHTML = "";
  els.studentStart.classList.remove("hidden");
  els.examArea.classList.add("hidden");
  els.studentDone.classList.add("hidden");
  renderScheduleNotice(getExamWindowState());
}

function getExamWindowState(now = new Date()) {
  const params = new URLSearchParams(window.location.search);
  const hasExtension = params.get("extra") === "1" || params.get("extension") === "1";
  const isPreview = params.get("teacher") === "1" && params.get("preview") === "1";
  const config = EXAM_CONFIG.examWindow;
  const startsAt = new Date(config.startsAt);
  const displayedEndsAt = new Date(hasExtension ? config.displayedExtendedEndsAt : config.displayedRegularEndsAt);
  const hardEndsAt = new Date(config.hardEndsAt);
  return {
    now,
    hasExtension,
    startsAt,
    displayedEndsAt,
    hardEndsAt,
    isPreview,
    canStart: isPreview || (now >= startsAt && now <= hardEndsAt),
    isBeforeStart: now < startsAt,
    isAfterDisplayedEnd: now > displayedEndsAt,
    isAfterHardEnd: !isPreview && now > hardEndsAt
  };
}

function renderScheduleNotice(state) {
  if (!els.examScheduleNotice) return;
  const visibleEnd = formatHebrewDateTime(state.displayedEndsAt);
  const start = formatHebrewDateTime(state.startsAt);
  els.examScheduleNotice.classList.remove("open", "blocked");
  els.studentForm.querySelector("button[type='submit']").disabled = !state.canStart;

  if (state.isPreview) {
    els.examScheduleNotice.classList.add("open");
    els.examScheduleNotice.textContent = `מצב בדיקה פעיל. בבחינה האמיתית הבחינה תיפתח ביום ${start}. זמן הסיום שיוצג עבורך: ${visibleEnd}.`;
  } else if (state.isBeforeStart) {
    els.examScheduleNotice.classList.add("blocked");
    els.examScheduleNotice.textContent = `הבחינה תיפתח ביום ${start}. זמן הסיום שיוצג עבורך: ${visibleEnd}.`;
  } else if (state.isAfterHardEnd) {
    els.examScheduleNotice.classList.add("blocked");
    els.examScheduleNotice.textContent = "מועד הבחינה הסתיים.";
  } else {
    els.examScheduleNotice.classList.add("open");
    els.examScheduleNotice.textContent = `הבחינה פתוחה. זמן הסיום שיוצג עבורך: ${visibleEnd}.`;
  }
}

function startClock() {
  stopClock();
  const tick = () => {
    const state = getExamWindowState();
    const visibleEnd = formatTime(state.displayedEndsAt);
    if (state.isAfterHardEnd) {
      els.examClock.textContent = "מועד ההגשה הסתיים.";
      els.examClock.classList.remove("open");
      const submitButton = document.querySelector("#submitPanel button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      return;
    }
    els.examClock.classList.add("open");
    if (state.isPreview) {
      els.examClock.textContent = "מצב בדיקה פעיל. חלון הזמן האמיתי לא נאכף בקישור זה.";
      return;
    }
    if (state.isAfterDisplayedEnd && !state.hasExtension) {
      els.examClock.textContent = `זמן סיום: ${visibleEnd}. זמן נותר: 0:00.`;
      return;
    }
    els.examClock.textContent = `זמן סיום: ${visibleEnd}. זמן נותר: ${formatDuration(state.displayedEndsAt - state.now)}.`;
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
}

function formatHebrewDateTime(date) {
  return date.toLocaleString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function saveLocalSubmission(submission) {
  const submissions = getLocalSubmissions();
  submissions.push(submission);
  localStorage.setItem(EXAM_CONFIG.localStorageKey, JSON.stringify(submissions));
}

function getLocalSubmissions() {
  try {
    return JSON.parse(localStorage.getItem(EXAM_CONFIG.localStorageKey) || "[]");
  } catch {
    return [];
  }
}

function getActiveSubmissions() {
  return importedSubmissions || getLocalSubmissions();
}

function renderTeacher() {
  const submissions = getActiveSubmissions();
  renderSummary(submissions);
  renderQuestionStats(submissions);
  renderSubmissionRows(submissions);
}

function renderSummary(submissions) {
  const scores = submissions.map(s => s.percent).sort((a, b) => a - b);
  els.statSubmissions.textContent = submissions.length;
  els.statAverage.textContent = scores.length ? `${round(avg(scores))}%` : "-";
  els.statMedian.textContent = scores.length ? `${median(scores)}%` : "-";
  els.statRange.textContent = scores.length ? `${scores[0]}%-${scores[scores.length - 1]}%` : "-";
}

function renderQuestionStats(submissions) {
  const tbody = els.questionStats.querySelector("tbody");
  tbody.innerHTML = "";
  const map = new Map();

  for (const submission of submissions) {
    for (const answer of submission.answers || []) {
      if (!map.has(answer.instanceId)) {
        map.set(answer.instanceId, {
          answer,
          total: 0,
          correct: 0,
          choices: new Map()
        });
      }
      const item = map.get(answer.instanceId);
      item.total += 1;
      item.correct += answer.isCorrect ? 1 : 0;
      item.choices.set(answer.selectedText, (item.choices.get(answer.selectedText) || 0) + 1);
    }
  }

  [...map.values()]
    .sort((a, b) => a.answer.topicTitle.localeCompare(b.answer.topicTitle, "he") || a.answer.questionId.localeCompare(b.answer.questionId))
    .forEach(item => {
      const row = document.createElement("tr");
      const distribution = [...item.choices.entries()]
        .map(([choice, count]) => `<span class="pill">${escapeHtml(choice)}: ${count}</span>`)
        .join(" ");
      row.innerHTML = `
        <td>${escapeHtml(item.answer.prompt)}</td>
        <td>${escapeHtml(item.answer.topicTitle)}</td>
        <td>${escapeHtml(item.answer.setId)}</td>
        <td>${round((item.correct / item.total) * 100)}%</td>
        <td>${item.total}</td>
        <td>${distribution}</td>
      `;
      tbody.appendChild(row);
    });
}

function renderSubmissionRows(submissions) {
  const tbody = els.submissionsTable.querySelector("tbody");
  tbody.innerHTML = "";
  submissions.slice().reverse().forEach(submission => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(submission.submittedAt).toLocaleString("he-IL")}</td>
      <td>${escapeHtml(submission.name)}</td>
      <td>${escapeHtml(submission.studentId)}</td>
      <td><span class="correct">${submission.score}/${submission.totalPoints || submission.total * 10}</span> (${submission.correctCount ?? Math.round(submission.percent * submission.total / 100)}/${submission.total} שאלות, ${submission.percent}%)</td>
      <td>${Object.entries(submission.selectedSets).map(([topic, set]) => `<span class="pill">${EXAM_BANK[topic].title}: ${set}</span>`).join(" ")}</td>
      <td>${submission.topicOrder.map(topic => EXAM_BANK[topic].title).join(" ← ")}</td>
    `;
    tbody.appendChild(row);
  });
}

function exportCsv() {
  const submissions = getActiveSubmissions();
  const rows = [[
    "submittedAt", "name", "studentId", "score", "total", "percent", "questionOrder",
    "topic", "setId", "questionId", "prompt", "selectedText", "correctText", "isCorrect"
  ]];
  for (const submission of submissions) {
    for (const answer of submission.answers || []) {
      rows.push([
        submission.submittedAt, submission.name, submission.studentId, submission.score,
        submission.totalPoints || submission.total * 10, submission.percent, answer.order, answer.topicTitle, answer.setId,
        answer.questionId, answer.prompt, answer.selectedText, answer.correctText, answer.isCorrect
      ]);
    }
  }
  download("exam-submissions.csv", rows.map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function exportJson() {
  download("exam-submissions.json", JSON.stringify(getActiveSubmissions(), null, 2), "application/json;charset=utf-8");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importedSubmissions = JSON.parse(reader.result);
    renderTeacher();
  };
  reader.readAsText(file);
}

function clearLocal() {
  if (!confirm("למחוק את כל ההגשות המקומיות בדפדפן הזה?")) return;
  localStorage.removeItem(EXAM_CONFIG.localStorageKey);
  importedSubmissions = null;
  renderTeacher();
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : round((values[mid - 1] + values[mid]) / 2);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
