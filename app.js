const API_URL = "/.netlify/functions/getStories";

let state = {
  stories: [],
  selected: null,
  commits: [],
  analysis: null,          
  analysisPromise: null    
};

init();

/*async function init() {
  setStatus("Loading stories...");

  try {
    const res = await fetch(API_URL);
    console.log("API Response Status:", res.status);
    console.log('API URL:', API_URL);
    if (!res.ok) {
      throw new Error(`API error: ${res.statusText}`);
    }
    const data = await res.json();

    state.stories = data.stories;

    renderStories();

    if (state.stories.length > 0) {
      selectStory(state.stories[0]);
    }

    setStatus("");

  } catch (e) {
    setStatus("Failed to load stories");
  }
}*/

async function init() {
  setStatus("Loading data...");

  try {
    const [storiesRes, commits] = await Promise.all([
      fetch(API_URL),
      fetchCommits() // 👈 fetch early
    ]);

    if (!storiesRes.ok) {
      throw new Error(`API error: ${storiesRes.statusText}`);
    }

    const data = await storiesRes.json();

    state.stories = data.stories;
    state.commits = commits; // 👈 store commits

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


/////////////////////// 🔥 NEW LOGIC STARTS HERE ///////////////////////

// 🔥 Fetch commits from GitHub (via Netlify)
async function fetchCommits() {
  const owner = 'Vijaykrishnan2000';
  const repo = 'CHAT-API-Website';
  const branch = 'main';
  const since = '2026-03-01T00:00:00Z';

  try {
    const response = await fetch('/.netlify/functions/getCommits', {
      method: 'POST',
      body: JSON.stringify({
        owner,
        repo,
        branch,
        since
      })
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

// Render into PR tab
function renderPRs(commits) {
  const container = document.getElementById("prs");

  if (!commits.length) {
    container.innerHTML = "<p>No commits found</p>";
    return;
  }

  console.log('commits:', JSON.stringify(commits, null, 2));

  /*let html = `
    <table class="pr-table">
      <thead>
        <tr>
          <th>S.No</th>
          <th>Commit Message</th>
          <th>Author</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
  `;

  commits.forEach(c => {
    html += `
      <tr>
        <td>${c.sno}</td>
        <td><a href="${c.url}" target="_blank">${c.message}</a></td>
        <td>${c.author}</td>
        <td>${c.date}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;

  container.innerHTML = html;*/

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

/////////////////////// 🔥 NEW LOGIC ENDS HERE ///////////////////////

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = async () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(tab.dataset.tab).classList.add("active");

    // 🔥 ADDITION: PR TAB CLICK LOGIC
    if (tab.dataset.tab === "prs") {

       const container = document.getElementById("prs");

        // render only once
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
            // cache promise to avoid duplicate calls
            if (!state.analysisPromise) {
            state.analysisPromise = generateCombinedDiff();
            }

            const data = await state.analysisPromise;

            state.analysis = data;

            renderAnalysis(data);

            container.dataset.loaded = "true";

        } catch (e) {
            console.error(e);
            container.innerHTML = "<p>Failed to generate analysis</p>";
        }
    }

  };
});

async function generateCombinedDiff() {
  const owner = 'Vijaykrishnan2000';
  const repo = 'CHAT-API-Website';
  const branch = 'main';

  const commits = state.commits.map(c => ({
    sha: c.sha,
    url: c.url
  }));
  console.log("Generating combined diff for commits:", JSON.stringify(commits, null, 2));

  const res = await fetch('/.netlify/functions/combine-commits', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ commits })
  });

  const data = await res.json();

  console.log("Combined Diff:", data.combinedDiff);

  return data;
}

function renderAnalysis(data) {
  const container = document.getElementById("analysis");

  if (!data || !data.combinedDiff) {
    container.innerHTML = "<p>No analysis available</p>";
    return;
  }

  container.innerHTML = `
    <div class="analysis-container">
      <h3>Combined Diff</h3>
      <pre class="analysis-diff">${escapeHtml(data.combinedDiff)}</pre>
    </div>
  `;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

