const API_URL = "/.netlify/functions/getStories";

let state = {
  stories: [],
  selected: null
};

init();

async function init() {
  setStatus("Loading stories...");

  try {
    const res = await fetch(API_URL);
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

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(tab.dataset.tab).classList.add("active");
  };
});