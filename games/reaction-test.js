const box = document.getElementById("gameBox");
const text = document.getElementById("text");
const leaderboardList = document.getElementById("leaderboardList");
const personalBestText = document.getElementById("personalBest");

const nameModal = document.getElementById("nameModal");
const nicknameInput = document.getElementById("nicknameInput");
const saveScoreBtn = document.getElementById("saveScoreBtn");
const cancelScoreBtn = document.getElementById("cancelScoreBtn");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = "idle";
let startTime = 0;
let timeoutId = null;
let pendingScore = null;

const LOCAL_BEST_KEY = "reactionPersonalBest";
const LOCAL_NAME_KEY = "reactionNickname";

loadPersonalBest();
loadLeaderboard();

box.addEventListener("click", () => {
  if (state === "idle") {
    startRound();
  } else if (state === "waiting") {
    failEarly();
  } else if (state === "ready") {
    finishRound();
  }
});

saveScoreBtn.addEventListener("click", async () => {
  const nickname = nicknameInput.value.trim().slice(0, 16);

  if (!nickname || pendingScore === null) return;

  saveScoreBtn.disabled = true;

  const { error } = await supabaseClient
    .from("reaction_scores")
    .insert([{ nickname, score_ms: pendingScore }]);

  saveScoreBtn.disabled = false;

  if (error) {
    alert("Could not save score.");
    return;
  }

  localStorage.setItem(LOCAL_NAME_KEY, nickname);
  hideModal();
  await loadLeaderboard();
});

cancelScoreBtn.addEventListener("click", () => {
  hideModal();
});

function startRound() {
  state = "waiting";
  text.textContent = "Wait for green...";
  box.className = "blue";

  const delay = Math.random() * 3000 + 1000;

  timeoutId = setTimeout(() => {
    state = "ready";
    startTime = Date.now();
    text.textContent = "CLICK!";
    box.className = "green";
  }, delay);
}

function failEarly() {
  clearTimeout(timeoutId);
  timeoutId = null;
  state = "idle";
  text.textContent = "Too early 😭 Click to try again";
  box.className = "red";
}

function finishRound() {
  const reaction = Date.now() - startTime;
  state = "idle";
  text.textContent = `⚡ ${reaction} ms — click to play again`;
  box.className = "blue";

  savePersonalBest(reaction);
  pendingScore = reaction;

  const savedName = localStorage.getItem(LOCAL_NAME_KEY) || "";
  nicknameInput.value = savedName;
  nameModal.style.display = "flex";
  nicknameInput.focus();
}

function savePersonalBest(score) {
  const oldBest = Number(localStorage.getItem(LOCAL_BEST_KEY));

  if (!oldBest || score < oldBest) {
    localStorage.setItem(LOCAL_BEST_KEY, String(score));
    personalBestText.textContent = `🏅 Personal Best: ${score} ms`;
  }
}

function loadPersonalBest() {
  const best = localStorage.getItem(LOCAL_BEST_KEY);
  personalBestText.textContent = best
    ? `🏅 Personal Best: ${best} ms`
    : "🏅 Personal Best: --";
}

async function loadLeaderboard() {
  leaderboardList.innerHTML = `<div class="entry"><span>Loading...</span><span>...</span></div>`;

  const { data, error } = await supabaseClient
    .from("reaction_scores")
    .select("nickname, score_ms")
    .order("score_ms", { ascending: true })
    .limit(10);

  if (error) {
    leaderboardList.innerHTML = `<div class="entry"><span>Error loading</span><span>--</span></div>`;
    return;
  }

  if (!data || data.length === 0) {
    leaderboardList.innerHTML = `<div class="entry"><span>No scores yet</span><span>--</span></div>`;
    return;
  }

  leaderboardList.innerHTML = "";

  data.forEach((row, index) => {
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `
      <span>#${index + 1} ${escapeHtml(row.nickname)}</span>
      <span>${row.score_ms} ms</span>
    `;
    leaderboardList.appendChild(div);
  });
}

function hideModal() {
  nameModal.style.display = "none";
  pendingScore = null;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}