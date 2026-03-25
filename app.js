/* ════════════════════════════════════════════════════════
   PR INTELLIGENCE PLATFORM — app.js
   Architecture: API → State → Render → Events
   ════════════════════════════════════════════════════════ */

"use strict";

/* ══════════════════════════════════════════════
   ═══  API LAYER — All external integrations  ══
   ══════════════════════════════════════════════ */
const API = {

  async fetchStories() {
    const res = await fetch("/.netlify/functions/getStories");
    if (!res.ok) throw new Error(`Stories API error: ${res.statusText}`);
    const data = await res.json();
    return data.stories || [];
  },

  async fetchCommits({ owner, repo, branch, since }) {
    const res = await fetch("/.netlify/functions/getCommits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, repo, branch, since }),
    });
    if (!res.ok) throw new Error(`Commits API error: ${res.statusText}`);
    return await res.json();
  },

  async generateCombinedDiff(commits) {
    const payload = commits.map((c) => ({ sha: c.sha, url: c.url }));
    const res = await fetch("/.netlify/functions/combine-commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commits: payload }),
    });
    if (!res.ok) throw new Error(`Diff API error: ${res.statusText}`);
    return await res.json();
  },

  async callLLM(prompt) {
    console.log("[LLM] callLLM start", { promptPreview: String(prompt || "").slice(0, 200) });

    const res = await fetch("/.netlify/functions/gemini-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      console.error("[LLM] callLLM response error", { status: res.status, statusText: res.statusText });
      throw new Error(`LLM API error: ${res.statusText}`);
    }

    const data = await res.json();
    console.log("[LLM] callLLM raw JSON response", data);

    const processed = data?.response || data?.reply || data;
    if (processed == null) {
      console.warn("[LLM] callLLM processed output is null/undefined", { data });
    }
    console.log("[LLM] callLLM output", processed);

    return processed;
  },
};

/* ══════════════════════════════════════════════
   ═══  STATE LAYER — Centralized store        ══
   ══════════════════════════════════════════════ */
const State = {
  _data: {
    stories:         [],
    selectedStory:   null,
    commits:         [],
    analysisResult:  null,
    testingResult:   null,
    // Async promise caches to prevent duplicate calls
    _analysisPromise: null,
    _testingPromise:  null,
  },

  get(key)         { return this._data[key]; },
  set(key, value)  { this._data[key] = value; },

  reset() {
    this._data.analysisResult  = null;
    this._data.testingResult   = null;
    this._data._analysisPromise = null;
    this._data._testingPromise  = null;
    // Reset tab load flags
    document.querySelectorAll(".tab-content").forEach((el) => {
      el.dataset.loaded = "";
    });
  },
};

/* ══════════════════════════════════════════════
   ═══  UTILS — Formatting & helpers           ══
   ══════════════════════════════════════════════ */
const Utils = {

  escapeHtml(str) {
    if (!str) return "";
    const s = typeof str === "string" ? str : JSON.stringify(str, null, 2);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  formatCommits(raw) {
    return raw.map((c, i) => ({
      sno:        i + 1,
      sha:        c.sha,
      message:    c.commit.message,
      url:        c.html_url,
      author:     c.commit.author.name,
      date:       c.commit.author.date,
      isVerified: c.commit.verification?.verified ?? false,
      avatar:     c.author?.avatar_url || "",
    }));
  },

  formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      });
    } catch {
      return iso;
    }
  },

  sanitizeLLMText(raw) {
    if (!raw) return "";
    if (typeof raw !== "string") {
      try { raw = JSON.stringify(raw); } catch { return ""; }
    }
    // Strip markdown code fences used as wrappers
    return raw
      .replace(/^```(?:json|markdown)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
  },

  copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 2000);
    });
  },

  exportJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

/* ══════════════════════════════════════════════
   ═══  PROMPTS — LLM prompt templates         ══
   ══════════════════════════════════════════════ */
const Prompts = {

  analysis(diff, storyDescription) {
    return `
**Role:** Staff Software Engineer — Production Gatekeeper.
**Constraint:** Extreme brevity. No conversational filler. Use strictly professional/technical vocabulary. Output must be clean markdown — no system noise.

**Evaluation Criteria:**
1. **Score (0–100):** Rate on Architecture, Security, and Production-Readiness.
2. **Blockers:** Functional bugs or security vulnerabilities requiring immediate rejection.
3. **Refactorings:** Technical debt or efficiency improvements — include exact code diffs.
4. **Security:** Data leakages, sanitization gaps, naming/structural risks.

**Required Output Format (strict):**

# [Score: X/100]

### 🚨 BLOCKERS
* **[Issue Title]**
  * Source: [File/Line if determinable]
  * Problem: [One-line impact statement]
  * Fix:
\`\`\`
[corrected code snippet]
\`\`\`

### 🛠️ REFACTORINGS
* **[Subject]**
  * Observation: [Short description]
  * Code:
\`\`\`
[diff or one-liner]
\`\`\`

### 🔒 SECURITY & BEST PRACTICES
* [Point-form observation]
* [Point-form observation]

---

**JIRA Story Context:**
${storyDescription}

**Commit Diff:**
${diff}
`.trim();
  },

  testing(diff, storyDescription) {
    return `
**Role:** Senior QA Strategist + Test Automation Architect.
**Mandate:** Generate a complete, structured test plan from the given Jira story and code diff.

**Output Format:** Respond ONLY with a valid JSON object. No markdown fences, no prose, no preamble.

JSON Schema:
{
  "coverageScore": <number 0-100>,
  "summary": "<one paragraph summary of what was implemented>",
  "coverageBreakdown": {
    "fullyImplemented": ["<requirement string>"],
    "partiallyImplemented": ["<requirement string>"],
    "missing": ["<requirement string>"]
  },
  "riskZones": ["<risk description>"],
  "testCases": [
    {
      "id": "TC-001",
      "name": "<short test name>",
      "type": "<functional|edge|negative|regression|integration>",
      "priority": "<High|Medium|Low>",
      "description": "<what this test validates>",
      "preconditions": ["<condition>"],
      "steps": ["<step 1>", "<step 2>"],
      "expectedResult": "<what should happen>",
      "predictedOutcome": "<PASS|FAIL|UNKNOWN>",
      "justification": "<why this outcome is predicted>"
    }
  ]
}

Generate at minimum 6 test cases covering: functional, edge, negative, regression, and integration scenarios.
Predict PASS/FAIL based on alignment between the acceptance criteria and the actual diff.

**JIRA Story:**
${storyDescription}

**Code Diff:**
${diff}
`.trim();
  },
};

/* ══════════════════════════════════════════════
   ═══  PARSERS — LLM output normalization     ══
   ══════════════════════════════════════════════ */
const Parsers = {

  analysis(raw) {
    console.log("[Parser] analysis start", { raw });
    const text = Utils.sanitizeLLMText(raw);
    console.log("[Parser] analysis sanitized", { text });

    const scoreMatch = text.match(/Score:\s*(\d+)/i);
    const score = scoreMatch ? `${scoreMatch[1]}/100` : "N/A";

    const extractSection = (emoji) => {
      const escaped = emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex   = new RegExp(`###\\s+${escaped}[^\n]*\n([\\s\\S]*?)(?=###|$)`);
      const match   = text.match(regex);
      return match ? match[1].trim() : "";
    };

    return {
      score,
      blockers:    extractSection("🚨"),
      refactors:   extractSection("🛠️"),
      security:    extractSection("🔒"),
      raw:         text,
    };
  },

  testing(raw) {
    console.log("[Parser] testing start", { raw });
    const text = Utils.sanitizeLLMText(raw);
    console.log("[Parser] testing sanitized", { text });
    try {
      // Strip any stray fences
      const clean = text.replace(/```json?/g, "").replace(/```/g, "").trim();
      console.log("[Parser] testing JSON to parse", { clean });
      const parsed = JSON.parse(clean);
      console.log("[Parser] testing parsed", parsed);
      return parsed;
    } catch (e) {
      console.error("[Parser] Failed to parse testing JSON:", text, e);
      return null;
    }
  },
};

/* ══════════════════════════════════════════════
   ═══  RENDER LAYER — UI Components           ══
   ══════════════════════════════════════════════ */
const Render = {

  /* ─── STORIES SIDEBAR ─── */
  stories() {
    const list    = document.getElementById("storyList");
    const count   = document.getElementById("sidebarCount");
    const badge   = document.getElementById("storyCountBadge");
    const stories = State.get("stories");

    count.textContent = stories.length;
    badge.textContent = `${stories.length} stories loaded`;
    list.innerHTML    = "";

    stories.forEach((s) => {
      const div       = document.createElement("div");
      div.className   = "story-item";
      div.dataset.id  = s.id;
      div.innerHTML   = `
        <div class="story-item-id">${s.id}</div>
        <div class="story-item-title">${Utils.escapeHtml(s.title)}</div>
        <div class="story-item-status">${s.status || ""}</div>
      `;
      div.onclick = () => selectStory(s);
      list.appendChild(div);
    });
  },

  /* ─── OVERVIEW TAB ─── */
  overview() {
    const s   = State.get("selectedStory");
    const c   = State.get("commits");
    const el  = document.getElementById("overview");

    el.innerHTML = `
      <div class="overview-grid">
        <div class="overview-card">
          <div class="overview-card-label">Total Commits</div>
          <div class="overview-card-value">${c.length}</div>
        </div>
        <div class="overview-card">
          <div class="overview-card-label">Story Status</div>
          <div class="overview-card-value" style="font-size:15px">${Utils.escapeHtml(s.status || "—")}</div>
        </div>
      </div>
      <div class="description-block">
        <h3>Description</h3>
        <p>${Utils.escapeHtml(s.description || "No description provided.")}</p>
      </div>
    `;
  },

  /* ─── COMMITS TAB ─── */
  commits() {
    const commits    = State.get("commits");
    const container  = document.getElementById("commits");

    document.getElementById("commitsBadge").textContent = commits.length;

    if (!commits.length) {
      container.innerHTML = `<div class="no-data">No commits found for this story</div>`;
      return;
    }

    let rows = "";
    commits.forEach((c, i) => {
      const msg    = Utils.escapeHtml(c.message.split("\n")[0]);
      const date   = Utils.formatDate(c.date);
      const avatar = c.avatar || "https://i.pravatar.cc/40";
      const status = c.isVerified ? "pr-merged" : "pr-closed";
      const label  = c.isVerified ? "verified"  : "unverified";

      rows += `
        <tr class="pr-expand" data-sha="${c.sha}" data-index="${i}">
          <td><span class="pr-sha">${String(i + 1).padStart(2, "0")}</span></td>
          <td>
            <span class="pr-toggle">▶</span>
            <a href="${c.url}" target="_blank" rel="noopener">${msg}</a>
          </td>
          <td>
            <div class="pr-author">
              <img class="pr-avatar" src="${avatar}" onerror="this.src='https://i.pravatar.cc/40'" />
              <span>${Utils.escapeHtml(c.author)}</span>
            </div>
          </td>
          <td>${date}</td>
          <td><span class="pr-badge ${status}">${label}</span></td>
        </tr>
        <tr class="pr-details-row" data-sha="${c.sha}">
          <td colspan="5">
            <div class="pr-details" id="detail-${c.sha}">
              <div class="pr-details-loading">Click to expand and load file changes…</div>
            </div>
          </td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="commits-toolbar">
        <div class="commits-count">Showing <span>${commits.length}</span> commits</div>
      </div>
      <table class="pr-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Commit Message</th>
            <th>Author</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Bind row expand toggles
    container.querySelectorAll(".pr-expand").forEach((row) => {
      row.onclick = () => toggleCommitRow(row);
    });
  },

  /* ─── ANALYSIS TAB ─── */
  analysisLoading() {
    document.getElementById("analysis").innerHTML = `
      <div class="analysis-loading">
        <div class="spinner"></div>
        <p>Generating analysis…</p>
        <div class="loading-steps">
          <div class="loading-step active" id="lstep1">Fetching combined diff</div>
          <div class="loading-step"        id="lstep2">Sending to LLM</div>
          <div class="loading-step"        id="lstep3">Parsing response</div>
        </div>
      </div>
    `;
  },

  analysisStep(step) {
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`lstep${i}`);
      if (!el) continue;
      el.className = i < step ? "loading-step done" : i === step ? "loading-step active" : "loading-step";
    }
  },

  analysis(result, diff) {
    console.log("[Render] analysis start", { result, diffLength: diff?.length });
    const parsed    = Parsers.analysis(result);
    console.log("[Render] analysis parsed object", parsed);
    if (!parsed || !parsed.score) {
      console.warn("[Render] analysis has no parsed score or empty parsed object", parsed);
    }
    const container = document.getElementById("analysis");

    container.innerHTML = `
      <div class="analysis-container">

        <!-- Score -->
        <div class="score-row">
          <div class="score-card">
            <div>
              <div class="score-label">Analysis Score</div>
              <div class="score-value">${Utils.escapeHtml(parsed.score)}</div>
            </div>
            <div class="score-divider"></div>
            <div class="score-meta">
              Architecture · Security<br>Production-Readiness
            </div>
          </div>
        </div>

        ${Render._analysisSection("🚨 Blockers",                  parsed.blockers,  "blocker")}
        ${Render._analysisSection("🛠️ Refactorings",              parsed.refactors, "refactor")}
        ${Render._analysisSection("🔒 Security & Best Practices", parsed.security,  "security")}

        <!-- Combined Diff -->
        <div class="diff-section">
          <h4>Combined Diff</h4>
          <div class="diff-block">${Utils.escapeHtml(diff)}</div>
        </div>

      </div>
    `;

    // Bind section toggles and copy buttons
    container.querySelectorAll(".section-header").forEach((hdr) => {
      hdr.onclick = () => hdr.closest(".analysis-section").classList.toggle("collapsed");
    });

    container.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pre = btn.nextElementSibling || btn.parentElement.querySelector("pre");
        Utils.copyToClipboard(pre?.textContent || "", btn);
      };
    });
  },

  _analysisSection(title, content, type) {
    if (!content) return "";

    let bodyHtml = "";

    if (type === "security") {
      const items = content
        .split(/\n\*\s+/)
        .map((i) => i.replace(/^\*\s*/, "").trim())
        .filter(Boolean);
      bodyHtml = `<ul class="security-list">${items.map((i) => `<li>${Utils.escapeHtml(i)}</li>`).join("")}</ul>`;
    } else {
      // Parse bullet items
      const items = content.split(/\n\*\s+\*\*/).filter(Boolean);
      bodyHtml = items.map((item) => {
        const titleMatch   = item.match(/^(.*?)\*\*/);
        const cardTitle    = titleMatch ? titleMatch[1] : item.split("\n")[0];
        const sourceMatch  = item.match(/Source:\s*(.*)/);
        const source       = sourceMatch ? sourceMatch[1].trim() : "";
        const problemMatch = item.match(/Problem:\s*([\s\S]*?)(?=\n|Fix:|Code:|Observation:|$)/);
        const problem      = problemMatch ? problemMatch[1].trim() : "";
        const obsMatch     = item.match(/Observation:\s*([\s\S]*?)(?=\n|Code:|$)/);
        const obs          = obsMatch ? obsMatch[1].trim() : "";
        const fixMatch     = item.match(/```([\s\S]*?)```/);
        const fix          = fixMatch ? fixMatch[1].trim() : "";

        return `
          <div class="analysis-card">
            <div class="card-title">${Utils.escapeHtml(cardTitle.replace(/\*\*/g, ""))}</div>
            ${source  ? `<div class="card-meta">📁 ${Utils.escapeHtml(source)}</div>` : ""}
            ${problem ? `<div class="card-text">${Utils.escapeHtml(problem)}</div>`   : ""}
            ${obs     ? `<div class="card-text">${Utils.escapeHtml(obs)}</div>`       : ""}
            ${fix     ? `<div class="code-block" style="position:relative">
                           <button class="copy-btn">Copy</button>
                           <pre>${Utils.escapeHtml(fix)}</pre>
                         </div>` : ""}
          </div>
        `;
      }).join("");
    }

    return `
      <div class="analysis-section ${type}">
        <div class="section-header">
          <h3>${title}</h3>
          <span class="section-toggle">▼</span>
        </div>
        <div class="section-body">
          <div class="analysis-list">${bodyHtml}</div>
        </div>
      </div>
    `;
  },

  /* ─── TESTING SUITE TAB ─── */
  testingLoading() {
    document.getElementById("testing").innerHTML = `
      <div class="analysis-loading">
        <div class="spinner"></div>
        <p>Generating test intelligence…</p>
        <div class="loading-steps">
          <div class="loading-step active" id="tstep1">Analysing story requirements</div>
          <div class="loading-step"        id="tstep2">Mapping commit diffs to acceptance criteria</div>
          <div class="loading-step"        id="tstep3">Generating test cases with PASS/FAIL predictions</div>
        </div>
      </div>
    `;
  },

  testingStep(step) {
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`tstep${i}`);
      if (!el) continue;
      el.className = i < step ? "loading-step done" : i === step ? "loading-step active" : "loading-step";
    }
  },

  testing(data) {
    const container  = document.getElementById("testing");
    const tests      = data.testCases || [];
    const coverage   = data.coverageScore || 0;
    const breakdown  = data.coverageBreakdown || {};
    const risks      = data.riskZones || [];

    const passCount  = tests.filter((t) => t.predictedOutcome === "PASS").length;
    const failCount  = tests.filter((t) => t.predictedOutcome === "FAIL").length;

    container.innerHTML = `
      <!-- Coverage Panel -->
      <div class="coverage-panel">
        <div class="coverage-card">
          <div class="coverage-number ${coverage >= 70 ? "high" : coverage >= 40 ? "medium" : "low"}">${coverage}%</div>
          <div class="coverage-label">Story Coverage</div>
        </div>
        <div class="coverage-card">
          <div class="coverage-number high">${passCount}</div>
          <div class="coverage-label">Expected Pass</div>
        </div>
        <div class="coverage-card">
          <div class="coverage-number ${failCount > 0 ? "low" : "high"}">${failCount}</div>
          <div class="coverage-label">Expected Fail</div>
        </div>
      </div>

      <!-- Coverage Bar -->
      <div class="coverage-bar-section">
        <div class="coverage-bar-header">
          <span class="coverage-bar-title">Requirement Coverage Index</span>
          <span class="coverage-pct">${coverage}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: 0%" data-target="${coverage}"></div>
        </div>
        ${Render._coverageBreakdown(breakdown)}
      </div>

      <!-- Summary -->
      ${data.summary ? `
        <div class="description-block" style="margin-bottom:16px">
          <h3>Implementation Summary</h3>
          <p>${Utils.escapeHtml(data.summary)}</p>
        </div>
      ` : ""}

      <!-- Toolbar + Test Cases -->
      <div class="testing-toolbar">
        <div class="filter-group">
          <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-right:4px">Filter:</span>
          <button class="filter-btn active" data-filter="all">All (${tests.length})</button>
          ${Render._typeFilterBtns(tests)}
        </div>
        <button class="testing-export-btn" id="exportTestsBtn">
          ↓ Export JSON
        </button>
      </div>

      <div class="test-cases-list" id="testCasesList">
        ${tests.map(Render._testCard).join("")}
      </div>

      <!-- Risk Zones -->
      ${risks.length ? `
        <div class="risk-section">
          <h4>⚠ Risk Zones</h4>
          <ul class="risk-list">
            ${risks.map((r) => `<li>${Utils.escapeHtml(r)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
    `;

    // Animate coverage bar
    setTimeout(() => {
      const bar = container.querySelector(".bar-fill");
      if (bar) bar.style.width = `${coverage}%`;
    }, 100);

    // Bind test card toggles
    container.querySelectorAll(".test-case-header").forEach((hdr) => {
      hdr.onclick = () => hdr.closest(".test-case-card").classList.toggle("open");
    });

    // Filter buttons
    container.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.onclick = () => filterTests(btn, tests);
    });

    // Export
    document.getElementById("exportTestsBtn").onclick = () => {
      Utils.exportJSON(data, `testing-suite-${State.get("selectedStory")?.id || "report"}.json`);
    };
  },

  _typeFilterBtns(tests) {
    const types = ["functional", "edge", "negative", "regression", "integration"];
    return types.map((type) => {
      const count = tests.filter((t) => t.type?.toLowerCase() === type).length;
      return count > 0
        ? `<button class="filter-btn type-${type}" data-filter="${type}">${type} (${count})</button>`
        : "";
    }).join("");
  },

  _testCard(t) {
    const typeClass     = `type-${(t.type || "functional").toLowerCase()}`;
    const priorityClass = `priority-${(t.priority || "medium").toLowerCase()}`;
    const outcomeClass  = t.predictedOutcome === "PASS" ? "outcome-pass"
                        : t.predictedOutcome === "FAIL" ? "outcome-fail"
                        : "outcome-unknown";

    const steps = (t.steps || []).map((s, i) =>
      `<li><span class="step-num">${String(i + 1).padStart(2, "0")}</span> ${Utils.escapeHtml(s)}</li>`
    ).join("");

    const preconditions = (t.preconditions || []).map((p) =>
      `<li>${Utils.escapeHtml(p)}</li>`
    ).join("");

    return `
      <div class="test-case-card" data-type="${(t.type || "").toLowerCase()}">
        <div class="test-case-header">
          <div class="test-case-left">
            <span class="test-id">${Utils.escapeHtml(t.id || "—")}</span>
            <span class="test-name">${Utils.escapeHtml(t.name || "Unnamed Test")}</span>
          </div>
          <div class="test-badges">
            <span class="type-badge ${typeClass}">${Utils.escapeHtml(t.type || "—")}</span>
            <span class="priority-badge ${priorityClass}">${Utils.escapeHtml(t.priority || "—")}</span>
            <span class="outcome-badge ${outcomeClass}">${t.predictedOutcome || "?"}</span>
          </div>
          <span class="test-chevron">▶</span>
        </div>

        <div class="test-case-body">
          <div class="test-case-detail">

            <div class="detail-group">
              <div class="detail-label">Description</div>
              <div class="detail-content">${Utils.escapeHtml(t.description || "—")}</div>
            </div>

            <div class="detail-group">
              <div class="detail-label">Expected Result</div>
              <div class="detail-content">${Utils.escapeHtml(t.expectedResult || "—")}</div>
            </div>

            ${preconditions ? `
              <div class="detail-group">
                <div class="detail-label">Preconditions</div>
                <ul class="steps-list">${preconditions}</ul>
              </div>
            ` : ""}

            <div class="detail-group">
              <div class="detail-label">Execution Steps</div>
              <ul class="steps-list">${steps}</ul>
            </div>

            ${t.justification ? `
              <div class="detail-group full">
                <div class="detail-label">Outcome Justification</div>
                <div class="justification-block">${Utils.escapeHtml(t.justification)}</div>
              </div>
            ` : ""}

          </div>
        </div>
      </div>
    `;
  },

  _coverageBreakdown(breakdown) {
    if (!breakdown || !Object.keys(breakdown).length) return "";

    const renderList = (items, cls) =>
      (items || []).map((i) => `<div class="breakdown-item-text">${Utils.escapeHtml(i)}</div>`).join("");

    return `
      <div class="coverage-breakdown">
        <div class="breakdown-item breakdown-implemented">
          <div class="breakdown-label">✓ Implemented</div>
          <div class="breakdown-items">${renderList(breakdown.fullyImplemented) || "<div class='breakdown-item-text' style='color:var(--text-muted)'>—</div>"}</div>
        </div>
        <div class="breakdown-item breakdown-partial">
          <div class="breakdown-label">⚡ Partial</div>
          <div class="breakdown-items">${renderList(breakdown.partiallyImplemented) || "<div class='breakdown-item-text' style='color:var(--text-muted)'>—</div>"}</div>
        </div>
        <div class="breakdown-item breakdown-missing">
          <div class="breakdown-label">✗ Missing</div>
          <div class="breakdown-items">${renderList(breakdown.missing) || "<div class='breakdown-item-text' style='color:var(--text-muted)'>—</div>"}</div>
        </div>
      </div>
    `;
  },

  error(containerId, message) {
    document.getElementById(containerId).innerHTML = `
      <div class="error-block">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${Utils.escapeHtml(message)}
      </div>
    `;
  },
};

/* ══════════════════════════════════════════════
   ═══  FLOWS — Orchestration logic            ══
   ══════════════════════════════════════════════ */

async function runAnalysisFlow() {
  Render.analysisLoading();

  Render.analysisStep(1);
  const diffData = await API.generateCombinedDiff(State.get("commits"));
  console.log("[Flow] runAnalysisFlow diffData", diffData);
  if (!diffData?.combinedDiff) {
    console.error("[Flow] runAnalysisFlow missing combinedDiff", diffData);
    throw new Error("No diff returned from server");
  }

  Render.analysisStep(2);
  const prompt = Prompts.analysis(diffData.combinedDiff, State.get("selectedStory")?.description || "");
  console.log("[Flow] runAnalysisFlow prompt size", { promptLength: prompt.length });

  const llmRaw = await API.callLLM(prompt);
  console.log("[Flow] runAnalysisFlow raw LLM output", { llmRaw });

  Render.analysisStep(3);
  return { raw: llmRaw, diff: diffData.combinedDiff };
}

async function runTestingFlow() {
  Render.testingLoading();

  Render.testingStep(1);
  const diffData = await API.generateCombinedDiff(State.get("commits"));
  if (!diffData?.combinedDiff) throw new Error("No diff returned from server");

  Render.testingStep(2);
  const llmRaw = await API.callLLM(
    Prompts.testing(diffData.combinedDiff, State.get("selectedStory")?.description || "")
  );
  console.log("Raw LLM output for testing suite:", llmRaw);

  Render.testingStep(3);
  const parsed = Parsers.testing(llmRaw);
  console.log("[Flow] runTestingFlow parsed result", parsed);
  if (!parsed) {
    console.error("[Flow] runTestingFlow parsed is null/undefined", { llmRaw });
    throw new Error("LLM returned malformed JSON for testing suite");
  }

  return parsed;
}

/* ══════════════════════════════════════════════
   ═══  EVENTS — Interactive handlers          ══
   ══════════════════════════════════════════════ */

function setGlobalStatus(state, text) {
  const el   = document.getElementById("globalStatus");
  el.className      = `status-indicator ${state}`;
  el.querySelector(".status-text").textContent = text;
}

function selectStory(story) {
  State.set("selectedStory", story);
  State.reset();

  // Sidebar active state
  document.querySelectorAll(".story-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === story.id);
  });

  // Show details
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("details").classList.remove("hidden");

  document.getElementById("storyIdTag").textContent   = story.id;
  document.getElementById("storyTitle").textContent   = story.title;
  document.getElementById("storyStatus").textContent  = story.status || "In Progress";

  // Reset to overview tab
  switchTab("overview");
  Render.overview();
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === tabName);
  });
}

function toggleCommitRow(row) {
  const sha        = row.dataset.sha;
  const detailRow  = document.querySelector(`.pr-details-row[data-sha="${sha}"]`);
  const isOpen     = detailRow.classList.contains("open");

  detailRow.classList.toggle("open", !isOpen);
  row.classList.toggle("open", !isOpen);

  if (!isOpen && detailRow.dataset.loaded !== "true") {
    detailRow.dataset.loaded = "true";
    // Optionally load file details via API here
    const detail = document.getElementById(`detail-${sha}`);
    if (detail) {
      detail.innerHTML = `
        <div class="pr-files-header">Commit SHA</div>
        <div class="pr-file">${sha}</div>
      `;
    }
  }
}

function filterTests(btn, tests) {
  const filter = btn.dataset.filter;

  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  const cards = document.querySelectorAll(".test-case-card");
  cards.forEach((card) => {
    const show = filter === "all" || card.dataset.type === filter;
    card.style.display = show ? "" : "none";
  });
}

/* Sidebar search filter */
document.getElementById("storySearch").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll(".story-item").forEach((el) => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? "" : "none";
  });
});

/* Export button */
document.getElementById("exportBtn").addEventListener("click", () => {
  const story    = State.get("selectedStory");
  const analysis = State.get("analysisResult");
  const testing  = State.get("testingResult");
  Utils.exportJSON({ story, analysis, testing }, `pr-report-${story?.id || "export"}.json`);
});

/* Tab click handling */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    const tabName = tab.dataset.tab;
    switchTab(tabName);

    const container = document.getElementById(tabName);
    if (container.dataset.loaded === "true") return;

    if (tabName === "commits") {
      if (!State.get("commits").length) {
        Render.error("commits", "No commits found");
        return;
      }
      Render.commits();
      container.dataset.loaded = "true";
    }

    if (tabName === "analysis") {
      if (!State.get("commits").length) {
        Render.error("analysis", "No commits available to analyse");
        return;
      }

      try {
        if (!State._data._analysisPromise) {
          State._data._analysisPromise = runAnalysisFlow();
        }
        const result = await State._data._analysisPromise;
        console.log("Final parsed analysis result:", result);
        console.log("Storing analysis result in state:", JSON.stringify(result));
        console.log("Raw analysis result stored in state:", State.get("analysisResult"));
        State.set("analysisResult", result);
        Render.analysis(result.raw, result.diff);
        container.dataset.loaded = "true";
      } catch (e) {
        console.error("Analysis failed:", e);
        Render.error("analysis", `Analysis failed: ${e.message}`);
      }
    }

    if (tabName === "testing") {
      if (!State.get("commits").length) {
        Render.error("testing", "No commits available for test generation");
        return;
      }

      try {
        if (!State._data._testingPromise) {
          State._data._testingPromise = runTestingFlow();
        }
        const result = await State._data._testingPromise;
        State.set("testingResult", result);
        Render.testing(result);
        container.dataset.loaded = "true";
      } catch (e) {
        console.error("Testing suite failed:", e);
        Render.error("testing", `Test generation failed: ${e.message}`);
      }
    }
  });
});

/* ══════════════════════════════════════════════
   ═══  INIT — Bootstrap                       ══
   ══════════════════════════════════════════════ */
async function init() {
  setGlobalStatus("loading", "Loading stories…");

  try {
    // Load stories and commits in parallel
    const [stories, rawCommits] = await Promise.all([
      API.fetchStories(),
      API.fetchCommits({
        owner:  "Vijaykrishnan2000",
        repo:   "CHAT-API-Website",
        branch: "main",
        since:  "2026-03-01T00:00:00Z",
      }),
    ]);

    const commits = Utils.formatCommits(rawCommits);

    State.set("stories", stories);
    State.set("commits", commits);

    Render.stories();
    document.getElementById("commitsBadge").textContent = commits.length;

    setGlobalStatus("active", "Ready");

    // Auto-select first story
    if (stories.length > 0) {
      selectStory(stories[0]);
    }

  } catch (e) {
    console.error("Init failed:", e);
    setGlobalStatus("error", "Load failed");
    document.getElementById("storyCountBadge").textContent = "Error loading data";
  }
}

init();
