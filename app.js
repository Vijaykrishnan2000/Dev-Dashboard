const API_URL = "/.netlify/functions/getStories";

let state = {
  stories: [],
  selected: null,
  commits: [],
  analysis: null,
  analysisPromise: null
};

init();

async function init() {
  setStatus("Loading data...");

  try {
    const [storiesRes, commits] = await Promise.all([
      fetch(API_URL),
      fetchCommits()
    ]);

    if (!storiesRes.ok) {
      throw new Error(`API error: ${storiesRes.statusText}`);
    }

    const data = await storiesRes.json();

    state.stories = data.stories;
    state.commits = commits;

    renderStories();

    if (state.stories.length > 0) {
      selectStory(state.stories[0]);
    }

    setStatus("");

  } catch (e) {
    setStatus("Failed to load data");
  }
}

function setStatus(msg) {
  document.getElementById("statusBar").innerText = msg;
}

function renderStories() {
  const el = document.getElementById("storyList");
  el.innerHTML = "";

  state.stories.forEach(s => {
    const div = document.createElement("div");
    div.className = "story-item";
    div.innerHTML = `<strong>${s.id}</strong><br>${s.title}`;
    div.onclick = () => selectStory(s);
    el.appendChild(div);
  });
}

function selectStory(story) {
  state.selected = story;

  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("details").classList.remove("hidden");

  document.getElementById("storyTitle").innerText =
    story.id + " - " + story.title;

  document.getElementById("storyStatus").innerText = story.status;

  renderOverview();
}

function renderOverview() {
  const s = state.selected;

  document.getElementById("overview").innerHTML = `
    <h3>Description</h3>
    <p>${s.description}</p>
  `;
}

/* -------------------- COMMITS -------------------- */

async function fetchCommits() {
  const owner = 'Vijaykrishnan2000';
  const repo = 'CHAT-API-Website';
  const branch = 'main';
  const since = '2026-03-01T00:00:00Z';

  try {
    const response = await fetch('/.netlify/functions/getCommits', {
      method: 'POST',
      body: JSON.stringify({ owner, repo, branch, since })
    });

    const data = await response.json();

    console.log("Raw Commits:", data);

    // Filter by story ID
    /*const filtered = data.filter(c =>
      c.commit.message && c.commit.message.includes(storyId)
    );*/

    return formatCommits(data);

  } catch (err) {
    console.error("Error fetching commits:", err);
    return [];
  }
}

// Format commits
function formatCommits(commits) {
  return commits.map((c, index) => ({
    sno: index + 1,
    message: c.commit.message,
    url: c.html_url,
    author: c.commit.author.name,
    date: new Date(c.commit.author.date).toLocaleString(),
    isVerified: c.commit.verification?.verified,
    avatar: c.author?.avatar_url,
    sha: c.sha
  }));
}

/* -------------------- PR RENDER -------------------- */

function renderPRs(commits) {
  const container = document.getElementById("prs");

  if (!commits.length) {
    container.innerHTML = "<p>No commits found</p>";
    return;
  }

  console.log('commits:', JSON.stringify(commits, null, 2));

  let html = `
  <table class="pr-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Commit</th>
        <th>Author</th>
        <th>Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
`;

  commits.forEach((c, index) => {
    const message = c.message.split('\n')[0];
  const authorName = c.author;
  const date = new Date(c.date).toLocaleDateString();
    const avatar = c.avatar || 'https://i.pravatar.cc/40';
  const url = c.url;

  // derive status from verification
  const isVerified = c.isVerified;
  const statusClass = isVerified ? 'pr-merged' : 'pr-closed';
  const statusLabel = isVerified ? 'verified' : 'unverified';

    html += `
    <tr class="pr-expand" data-sha="${c.sha}">
        <td>${index + 1}</td>
      <td>
        <span class="pr-toggle">▶</span>
        <a href="${url}" target="_blank">${message}</a>
      </td>
        <td>
          <div class="pr-author">
            <img class="pr-avatar" src="${avatar}" />
          <span>${authorName}</span>
          </div>
        </td>
      <td>${date}</td>
        <td><span class="pr-badge ${statusClass}">${statusLabel}</span></td>
      </tr>

    <tr class="pr-details-row">
      <td colspan="5">
        <div class="pr-details" id="details-${c.sha}">
          Loading changes...
        </div>
      </td>
    </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

/* -------------------- ANALYSIS FLOW -------------------- */

document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = async () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(tab.dataset.tab).classList.add("active");

    // 🔥 ADDITION: PR TAB CLICK LOGIC
    if (tab.dataset.tab === "prs") {
      const container = document.getElementById("prs");

      if (container.dataset.loaded === "true") return;

        if (!state.commits.length) {
            container.innerHTML = "<p>No commits found</p>";
            return;
        }

      renderPRs(state.commits);
      container.dataset.loaded = "true";
    }

    // Analyze tab click logic
    if (tab.dataset.tab === "analysis") {
      const container = document.getElementById("analysis");

        // prevent re-run
      if (container.dataset.loaded === "true") return;

        // ensure commits are available
        if (!state.commits.length) {
            container.innerHTML = "<p>No commits available</p>";
            return;
        }

      container.innerHTML = "<p>Generating analysis...</p>";

      try {
        if (!state.analysisPromise) {
          state.analysisPromise = runFullAnalysisFlow();
        }

        const result = await state.analysisPromise;

        renderGeminiResponse(result);

        container.dataset.loaded = "true";

      } catch (e) {
        console.error(e);
        container.innerHTML = "<p>Analysis failed</p>";
      }
    }
  };
});

/* -------------------- STEP 1: GET DIFF -------------------- */

async function generateCombinedDiff() {
  const commits = state.commits.map(c => ({
    sha: c.sha,
    url: c.url
  }));
  console.log("Generating combined diff for commits:", JSON.stringify(commits, null, 2));

  const res = await fetch('/.netlify/functions/combine-commits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commits })
  });

  return await res.json();
}

/* -------------------- STEP 2: GEMINI CALL -------------------- */

async function callGemini(diff) {

  const prompt = `
**Role:** Staff Software Engineer (Production Gatekeeper).
**Constraint:** Extreme brevity. No conversational filler. No intro/outro. Use strictly professional/technical vocabulary.

**Evaluation Criteria:**
1. **Score:** Rate 0 to 100 based on Architecture, Security, and Production-Readiness.
2. **Blockers:** Functional bugs or security vulnerabilities requiring immediate rejection.
3. **Refactorings:** Technical debt or efficiency improvements. Use code blocks to highlight exact fixes.

**Output Format (Strict):**

# [Score: X/100]

### 🚨 BLOCKERS
* **[Issue]**
  * Source: [File/Line Number]
  * Problem: [Impact]
  * Fix: [Code Block]

### 🛠️ REFACTORINGS
* **[Subject]**
  * Observation: [Short Description]
  * Code: [Diff-style fix or one-liner]

### 🔒 SECURITY & BEST PRACTICES
* [Point-form observations regarding data leakages, sanitization, or naming]

**Input Diff:**
${diff}
`;

  const res = await fetch('/.netlify/functions/gemini-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  });

  const data = await res.json();

  return data.response || data;
}

/* -------------------- ORCHESTRATION -------------------- */

async function runFullAnalysisFlow() {

  // Step 1: GitHub Diff
  const diffData = await generateCombinedDiff();

  if (!diffData || !diffData.combinedDiff) {
    throw new Error("No diff generated");
  }
  console.log("Combined Diff:", JSON.stringify(diffData.combinedDiff,null,2));

  // Step 2: Gemini
  const geminiResponse = await callGemini(diffData.combinedDiff);
  console.log("Gemini Response:", JSON.stringify(geminiResponse, null, 2));

  return {
    diff: diffData.combinedDiff,
    llm: geminiResponse
  };
}

/* -------------------- RENDER GEMINI -------------------- */

function renderGeminiResponse(data) {
  const container = document.getElementById("analysis");

  const raw = data?.llm || data?.reply || "";

  const parsed = parseLLMResponse(raw);

  container.innerHTML = `
    <div class="analysis-container">

      <div class="score-card">
        <span>Score</span>
        <h2>${parsed.score}</h2>
      </div>

      ${renderSection("🚨 BLOCKERS", parsed.blockers, "blocker")}
      ${renderSection("🛠️ REFACTORINGS", parsed.refactorings, "refactor")}
      ${renderSection("🔒 SECURITY & BEST PRACTICES", parsed.security, "security")}

      <h3>Combined Diff</h3>
      <pre class="analysis-diff">${escapeHtml(data.diff)}</pre>

    </div>
  `;
}

function parseLLMResponse(text) {
  const safeText = typeof text === "string" ? text : JSON.stringify(text);

  const scoreMatch = safeText.match(/Score:\s*(\d+)/);
  const score = scoreMatch ? scoreMatch[1] + "/100" : "N/A";

  const extractSection = (title) => {
    const regex = new RegExp(`###\\s+${title}([\\s\\S]*?)(?=###|$)`);
    const match = safeText.match(regex);
    return match ? match[1].trim() : "";
  };

  return {
    score,
    blockers: extractSection("🚨 BLOCKERS"),
    refactorings: extractSection("🛠️ REFACTORINGS"),
    security: extractSection("🔒 SECURITY & BEST PRACTICES")
  };
}

function renderSection(title, content, type) {
  if (!content) return "";

  return `
    <div class="section ${type}">
      <h3>${title}</h3>
      <div class="analysis-list">
        ${formatContent(content, type)}
      </div>
    </div>
  `;
}

function formatContent(text, type) {
  if (!text) return "";

  let cleaned = text
    .replace(/\\n/g, "\n")
    .replace(/```javascript/g, "```")
    .replace(/javascript\n/g, "")
    .trim();

  // 👉 SECURITY: simple bullet rendering
  if (type === "security") {
    const items = cleaned
      .split(/\n\* /)
      .map(i => i.replace(/^\* /, "").trim())
      .filter(Boolean);

    return `
      <ul class="analysis-simple-list">
        ${items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>
    `;
  }

  // 👉 STRUCTURED (Blockers / Refactorings)
  const items = cleaned.split(/\n\* /).filter(Boolean);

  return items.map(item => {
    const titleMatch = item.match(/\*\*(.*?)\*\*/);
    const title = titleMatch ? titleMatch[1] : item.split("\n")[0];

    const sourceMatch = item.match(/Source:\s*(.*)/);
    const source = sourceMatch ? sourceMatch[1] : "";

    const problemMatch = item.match(/Problem:\s*([\s\S]*?)(?=\n|Fix:|$)/);
    const problem = problemMatch ? problemMatch[1].trim() : "";

    const fixMatch = item.match(/```([\s\S]*?)```/);
    const fix = fixMatch ? fixMatch[1].trim() : "";

    return `
      <div class="analysis-card">
        <div class="analysis-card-header">${title}</div>

        ${source ? `<div class="analysis-meta"><span>Source:</span> ${escapeHtml(source)}</div>` : ""}
        ${problem ? `<div class="analysis-text">${escapeHtml(problem)}</div>` : ""}

        ${fix ? `<pre class="code-block">${escapeHtml(fix)}</pre>` : ""}
      </div>
    `;
  }).join("");
}

/* -------------------- UTIL -------------------- */

function escapeHtml(input) {
  if (!input) return "";
  const str = typeof input === "string" ? input : JSON.stringify(input, null, 2);

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
