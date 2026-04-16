// reaction-test.js – now uses Supabase Auth for user identity

const box               = document.getElementById("gameBox");
const text              = document.getElementById("text");
const leaderboardList   = document.getElementById("leaderboardList");
const personalBestText  = document.getElementById("personalBest");

const rankedBtn         = document.getElementById("rankedBtn");
const rankedStatus      = document.getElementById("rankedStatus");
const roundNumberText   = document.getElementById("roundNumber");
const youLivesText      = document.getElementById("youLives");
const opponentLivesText = document.getElementById("opponentLives");
const opponentNameText  = document.getElementById("opponentName");
const usernameChip      = document.getElementById("usernameChip");
const logoutBtn         = document.getElementById("logoutBtn");
const authOverlay       = document.getElementById("authLoadingOverlay");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Auth state ───────────────────────────────────────────────────────────────
// currentUserNickname replaces the old getSavedNickname() / localStorage system.

let currentUserNickname = null;

function getSavedNickname() {
  return currentUserNickname;
}

function getBestKey() {
  return `reactionPersonalBest_${currentUserNickname || "guest"}`;
}

async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    // Not logged in → send to auth page
    window.location.href = "../auth/index.html";
    return false;
  }

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("username")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile) {
    // Profile not yet created (edge case) → back to auth
    window.location.href = "../auth/index.html";
    return false;
  }

  currentUserNickname = profile.username;
  usernameChip.textContent = `👤 ${currentUserNickname}`;

  // Hide loading overlay
  authOverlay.style.opacity = "0";
  setTimeout(() => authOverlay.remove(), 320);

  return true;
}

// ─── Game state ───────────────────────────────────────────────────────────────

let soloState  = "idle";
let soloStartTime = 0;
let soloTimeoutId = null;

let mode = "solo";
let currentMatch        = null;
let currentChannel      = null;
let queueChannel        = null;
let rankedClickLocked   = false;
let greenFlipTimer      = null;
let matchPoll           = null;
let isAttachingToMatch  = false;
let nextRoundTimer      = null;

let heartbeatInterval      = null;
let disconnectCheckInterval = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

(async () => {
  const ok = await initAuth();
  if (!ok) return;

  loadPersonalBest();
  loadLeaderboard();
  bindEvents();
})();

function bindEvents() {
  box.addEventListener("click", async () => {
    if (mode === "solo") {
      handleSoloClick();
    } else if (mode === "ranked") {
      await handleRankedClick();
    }
  });

  rankedBtn.addEventListener("click", async () => {
    if (currentMatch) return;
    await joinRankedQueue();
  });

  logoutBtn.addEventListener("click", async () => {
    await forfeitCurrentMatchOnExit();
    cleanupRankedState();
    await supabaseClient.auth.signOut();
    window.location.href = "../auth/index.html";
  });
}

// ─── Solo ─────────────────────────────────────────────────────────────────────

function handleSoloClick() {
  if (soloState === "idle") {
    startSoloRound();
  } else if (soloState === "waiting") {
    failSoloEarly();
  } else if (soloState === "ready") {
    finishSoloRound();
  }
}

function startSoloRound() {
  mode = "solo";
  soloState = "waiting";
  text.textContent = "Wait for green...";
  box.className = "blue";

  const delay = Math.random() * 3000 + 1000;

  soloTimeoutId = setTimeout(() => {
    soloState = "ready";
    soloStartTime = Date.now();
    text.textContent = "CLICK!";
    box.className = "green";
  }, delay);
}

function failSoloEarly() {
  clearTimeout(soloTimeoutId);
  soloTimeoutId = null;
  soloState = "idle";
  text.textContent = "Too early 😭 Click to try again";
  box.className = "red";
}

async function finishSoloRound() {
  const reaction = Date.now() - soloStartTime;
  soloState = "idle";
  text.textContent = `⚡ ${reaction} ms — click to play again`;
  box.className = "blue";

  const isNewBest = savePersonalBest(reaction);

  if (isNewBest) {
    await saveSoloScoreIfBest(reaction);
    await loadLeaderboard();
  }
}

function savePersonalBest(score) {
  const bestKey = getBestKey();
  const oldBest = Number(localStorage.getItem(bestKey));

  if (!oldBest || score < oldBest) {
    localStorage.setItem(bestKey, String(score));
    personalBestText.textContent = `🏅 Personal Best: ${score} ms`;
    return true;
  }

  return false;
}

function loadPersonalBest() {
  const best = localStorage.getItem(getBestKey());
  personalBestText.textContent = best
    ? `🏅 Personal Best: ${best} ms`
    : "🏅 Personal Best: --";
}

async function saveSoloScoreIfBest(score) {
  const nickname = getSavedNickname();
  if (!nickname) return;

  const { data: existingRow, error: fetchError } = await supabaseClient
    .from("reaction_scores")
    .select("id, score_ms")
    .eq("nickname", nickname)
    .maybeSingle();

  if (fetchError) {
    console.error(fetchError);
    return;
  }

  if (!existingRow) {
    const { error } = await supabaseClient
      .from("reaction_scores")
      .insert([{ nickname, score_ms: score }]);

    if (error) console.error(error);
    return;
  }

  if (score < existingRow.score_ms) {
    const { error } = await supabaseClient
      .from("reaction_scores")
      .update({ score_ms: score })
      .eq("id", existingRow.id);

    if (error) console.error(error);
  }
}

async function loadLeaderboard() {
  leaderboardList.innerHTML = `<div class="entry"><span>Loading...</span><span>...</span></div>`;

  const { data, error } = await supabaseClient
    .from("reaction_scores")
    .select("nickname, score_ms")
    .order("score_ms", { ascending: true })
    .limit(5);

  if (error) {
    leaderboardList.innerHTML = `<div class="entry"><span>Error loading</span><span>--</span></div>`;
    console.error(error);
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

// ─── Ranked queue ─────────────────────────────────────────────────────────────

async function joinRankedQueue() {
  mode = "ranked";
  rankedBtn.disabled = true;
  rankedBtn.textContent = "Searching...";
  rankedStatus.textContent = "Searching for player...";
  text.textContent = "Searching for ranked match...";
  box.className = "blue";

  cleanupTimersOnly();
  isAttachingToMatch = false;

  const nickname = getSavedNickname();

  await supabaseClient.from("ranked_queue").delete().eq("nickname", nickname);

  const { data: myQueueRow, error: insertQueueError } = await supabaseClient
    .from("ranked_queue")
    .insert([{ nickname }])
    .select()
    .single();

  if (insertQueueError || !myQueueRow) {
    console.error(insertQueueError);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Could not join queue";
    mode = "solo";
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const { data: queueRows, error: queueError } = await supabaseClient
    .from("ranked_queue")
    .select("*")
    .neq("nickname", nickname)
    .lt("id", myQueueRow.id)
    .order("id", { ascending: true })
    .limit(1);

  if (queueError) {
    console.error(queueError);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Queue error";
    mode = "solo";
    return;
  }

  const opponent = queueRows?.[0];

  if (!opponent) {
    watchForMatch();
    rankedBtn.textContent = "Queued";
    rankedStatus.textContent = "Waiting in queue...";
    text.textContent = "Waiting for someone to join...";
    return;
  }

  await supabaseClient.from("ranked_queue").delete().eq("id", myQueueRow.id);
  await supabaseClient.from("ranked_queue").delete().eq("id", opponent.id);

  const nowIso = new Date().toISOString();

  const { data: insertedMatch, error: matchError } = await supabaseClient
    .from("ranked_matches")
    .insert([{
      player1: opponent.nickname,
      player2: nickname,
      player1_lives: 3,
      player2_lives: 3,
      round_number: 1,
      status: "starting",
      player1_last_seen: nowIso,
      player2_last_seen: nowIso
    }])
    .select()
    .single();

  if (matchError || !insertedMatch) {
    console.error(matchError);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Could not create match";
    mode = "solo";
    return;
  }

  await attachToMatch(insertedMatch.id);
}

async function findActiveMatchForNickname(nickname) {
  const [{ data: asP1 }, { data: asP2 }] = await Promise.all([
    supabaseClient
      .from("ranked_matches")
      .select("id, player1, player2, status")
      .eq("player1", nickname)
      .neq("status", "finished")
      .order("id", { ascending: false })
      .limit(1),
    supabaseClient
      .from("ranked_matches")
      .select("id, player1, player2, status")
      .eq("player2", nickname)
      .neq("status", "finished")
      .order("id", { ascending: false })
      .limit(1)
  ]);

  const candidates = [...(asP1 || []), ...(asP2 || [])];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.id - a.id);
  return candidates[0];
}

function watchForMatch() {
  const nickname = getSavedNickname();

  if (matchPoll) {
    clearInterval(matchPoll);
    matchPoll = null;
  }

  matchPoll = setInterval(async () => {
    if (isAttachingToMatch) return;

    const match = await findActiveMatchForNickname(nickname);

    if (match) {
      isAttachingToMatch = true;

      clearInterval(matchPoll);
      matchPoll = null;

      await supabaseClient
        .from("ranked_queue")
        .delete()
        .eq("nickname", nickname);

      await attachToMatch(match.id);
    }
  }, 500);
}

// ─── Match attachment ──────────────────────────────────────────────────────────

async function attachToMatch(matchId) {
  const { data, error } = await supabaseClient
    .from("ranked_matches")
    .select("*")
    .eq("id", matchId)
    .single();

  if (error || !data) {
    console.error("attachToMatch load error:", error);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Match load failed";
    mode = "solo";
    isAttachingToMatch = false;
    return;
  }

  currentMatch = data;
  mode = "ranked";
  rankedBtn.disabled = true;
  rankedBtn.textContent = "In Ranked Match";
  rankedClickLocked = false;
  startHeartbeat();
  startDisconnectWatcher();

  if (currentChannel) {
    clearInterval(currentChannel);
    currentChannel = null;
  }

  currentChannel = setInterval(async () => {
    await refreshCurrentMatch();
    await maybeResolveRound();
    await maybeStartRound();
  }, 250);

  await refreshCurrentMatch();
  await maybeResolveRound();
  await maybeStartRound();
}

async function refreshCurrentMatch() {
  if (!currentMatch) return;

  const { data, error } = await supabaseClient
    .from("ranked_matches")
    .select("*")
    .eq("id", currentMatch.id)
    .single();

  if (error || !data) {
    console.error(error);
    return;
  }

  currentMatch = data;
  renderRankedState();
}

// ─── UI rendering ──────────────────────────────────────────────────────────────

function getYouAndOpponent() {
  const me = getSavedNickname();

  if (!currentMatch) {
    return { me, opponent: "--", myLives: 3, oppLives: 3, amPlayer1: false };
  }

  const amPlayer1 = currentMatch.player1 === me;

  return {
    me,
    opponent: amPlayer1 ? currentMatch.player2 : currentMatch.player1,
    myLives:  amPlayer1 ? currentMatch.player1_lives : currentMatch.player2_lives,
    oppLives: amPlayer1 ? currentMatch.player2_lives : currentMatch.player1_lives,
    amPlayer1
  };
}

function renderLives(num) {
  return "❤️".repeat(Math.max(0, num)) + "🖤".repeat(Math.max(0, 3 - num));
}

function renderRankedState() {
  if (!currentMatch) return;

  const info = getYouAndOpponent();

  opponentNameText.textContent  = info.opponent || "--";
  youLivesText.textContent      = renderLives(info.myLives);
  opponentLivesText.textContent = renderLives(info.oppLives);
  roundNumberText.textContent   = currentMatch.round_number;

  if (currentMatch.status === "starting") {
    if (greenFlipTimer) { clearTimeout(greenFlipTimer); greenFlipTimer = null; }
    rankedStatus.textContent = "Match found";
    text.textContent = `Match found vs ${info.opponent}`;
    box.className = "blue";
    rankedClickLocked = false;
    rankedBtn.textContent = "In Ranked Match";
  }

  if (currentMatch.status === "waiting_clicks") {
    const greenAt = new Date(currentMatch.green_at).getTime();
    const isLive  = Date.now() >= greenAt;
    rankedStatus.textContent = isLive ? "Round live" : "Get ready...";
    text.textContent         = isLive ? "CLICK!"     : "Wait for green...";
    box.className            = isLive ? "green"      : "blue";
    rankedBtn.textContent    = "In Ranked Match";
  }

  if (currentMatch.status === "round_result") {
    if (greenFlipTimer) { clearTimeout(greenFlipTimer); greenFlipTimer = null; }
    rankedStatus.textContent = currentMatch.round_winner
      ? `${currentMatch.round_winner} won round`
      : "Round result";

    const me = getSavedNickname();

    if (currentMatch.round_winner === me) {
      text.textContent = "🏆 You won the round!";
      box.className = "green";
    } else if (currentMatch.round_winner) {
      text.textContent = "💥 You lost the round!";
      box.className = "red";
    } else {
      text.textContent = "Tie round";
      box.className = "blue";
    }

    rankedClickLocked = true;
    rankedBtn.textContent = "In Ranked Match";
  }

  if (currentMatch.status === "finished") {
    if (greenFlipTimer) { clearTimeout(greenFlipTimer); greenFlipTimer = null; }

    const won = currentMatch.winner === info.me;

    rankedStatus.textContent = won ? "You won the match" : "You lost the match";
    text.textContent = won
      ? "🏆 You won ranked! Click Play Ranked for another."
      : "💀 You lost ranked. Click Play Ranked to retry.";
    box.className = won ? "green" : "red";

    rankedBtn.disabled    = false;
    rankedBtn.textContent = "⚔️ Play Ranked";

    supabaseClient.from("ranked_queue").delete().eq("nickname", getSavedNickname());

    if (currentChannel) { clearInterval(currentChannel); currentChannel = null; }
    if (matchPoll)       { clearInterval(matchPoll);      matchPoll = null;       }
    if (greenFlipTimer)  { clearTimeout(greenFlipTimer);  greenFlipTimer = null;  }
    if (nextRoundTimer)  { clearTimeout(nextRoundTimer);  nextRoundTimer = null;  }

    stopHeartbeat();
    stopDisconnectWatcher();

    currentMatch       = null;
    mode               = "solo";
    rankedClickLocked  = false;
    isAttachingToMatch = false;
  }
}

// ─── Round logic ───────────────────────────────────────────────────────────────

async function maybeStartRound() {
  if (!currentMatch) return;
  if (currentMatch.status !== "starting") return;

  await new Promise((r) => setTimeout(r, 250));
  await refreshCurrentMatch();

  if (!currentMatch || currentMatch.status !== "starting") return;

  const greenAt = new Date(Date.now() + (Math.random() * 2500 + 1500));

  const { data, error } = await supabaseClient
    .from("ranked_matches")
    .update({
      status: "waiting_clicks",
      green_at: greenAt.toISOString(),
      player1_reaction: null,
      player2_reaction: null,
      round_winner: null
    })
    .eq("id", currentMatch.id)
    .eq("status", "starting")
    .select()
    .single();

  if (error) { console.error("maybeStartRound error:", error); return; }
  if (data)  { currentMatch = data; }

  await refreshCurrentMatch();
}

async function handleRankedClick() {
  if (!currentMatch) return;
  if (currentMatch.status !== "waiting_clicks") return;
  if (rankedClickLocked) return;

  const info = getYouAndOpponent();
  const myReactionColumn = info.amPlayer1 ? "player1_reaction" : "player2_reaction";

  if (currentMatch[myReactionColumn] != null) return;

  const greenAt = new Date(currentMatch.green_at).getTime();
  const now     = Date.now();

  if (now < greenAt) {
    text.textContent = "Too early 😭";
    box.className = "red";
    return;
  }

  const reaction = now - greenAt;
  rankedClickLocked = true;

  text.textContent = `⚡ ${reaction} ms`;
  box.className = "green";

  const updateData = info.amPlayer1
    ? { player1_reaction: reaction }
    : { player2_reaction: reaction };

  const { error } = await supabaseClient
    .from("ranked_matches")
    .update(updateData)
    .eq("id", currentMatch.id)
    .eq("status", "waiting_clicks")
    .is(myReactionColumn, null);

  if (error) {
    console.error("handleRankedClick error:", error);
    rankedClickLocked = false;
    return;
  }

  setTimeout(async () => {
    await refreshCurrentMatch();
    await maybeResolveRound();
  }, 200);
}

async function maybeResolveRound() {
  if (!currentMatch) return;

  const info = getYouAndOpponent();

  if (!info.amPlayer1) return;
  if (currentMatch.status !== "waiting_clicks") return;
  if (currentMatch.player1_reaction == null || currentMatch.player2_reaction == null) return;

  let p1Lives    = currentMatch.player1_lives;
  let p2Lives    = currentMatch.player2_lives;
  let roundWinner = null;

  if (currentMatch.player1_reaction < currentMatch.player2_reaction) {
    p2Lives -= 1;
    roundWinner = currentMatch.player1;
  } else if (currentMatch.player2_reaction < currentMatch.player1_reaction) {
    p1Lives -= 1;
    roundWinner = currentMatch.player2;
  }

  const finished = p1Lives <= 0 || p2Lives <= 0;
  const winner   = finished
    ? (p1Lives > p2Lives ? currentMatch.player1 : currentMatch.player2)
    : null;

  const currentRound = currentMatch.round_number;

  const { error } = await supabaseClient
    .from("ranked_matches")
    .update({
      player1_lives: p1Lives,
      player2_lives: p2Lives,
      round_winner: roundWinner,
      winner,
      status: finished ? "finished" : "round_result"
    })
    .eq("id", currentMatch.id)
    .eq("status", "waiting_clicks");

  if (error) { console.error("maybeResolveRound error:", error); return; }

  await refreshCurrentMatch();

  if (!finished) {
    if (nextRoundTimer) { clearTimeout(nextRoundTimer); nextRoundTimer = null; }

    nextRoundTimer = setTimeout(async () => {
      const { error: nextError } = await supabaseClient
        .from("ranked_matches")
        .update({
          round_number: currentRound + 1,
          status: "starting",
          player1_reaction: null,
          player2_reaction: null,
          green_at: null,
          round_winner: null
        })
        .eq("id", currentMatch.id)
        .eq("status", "round_result");

      if (nextError) { console.error("next round error:", nextError); return; }

      await refreshCurrentMatch();
      await maybeStartRound();
    }, 1800);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function cleanupTimersOnly() {
  if (greenFlipTimer) { clearTimeout(greenFlipTimer); greenFlipTimer = null; }
  if (nextRoundTimer) { clearTimeout(nextRoundTimer); nextRoundTimer = null; }
}

function cleanupRankedState() {
  cleanupTimersOnly();
  if (currentChannel) { clearInterval(currentChannel); currentChannel = null; }
  if (matchPoll)       { clearInterval(matchPoll);      matchPoll = null;       }
  stopHeartbeat();
  stopDisconnectWatcher();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ─── Heartbeat & disconnect watcher ───────────────────────────────────────────

function getHeartbeatColumn() {
  const info = getYouAndOpponent();
  return info.amPlayer1 ? "player1_last_seen" : "player2_last_seen";
}

function getOpponentHeartbeatColumn() {
  const info = getYouAndOpponent();
  return info.amPlayer1 ? "player2_last_seen" : "player1_last_seen";
}

function startHeartbeat() {
  stopHeartbeat();

  heartbeatInterval = setInterval(async () => {
    if (!currentMatch) return;
    const column = getHeartbeatColumn();
    const { error } = await supabaseClient
      .from("ranked_matches")
      .update({ [column]: new Date().toISOString() })
      .eq("id", currentMatch.id)
      .neq("status", "finished");
    if (error) console.error("heartbeat error:", error);
  }, 2000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function startDisconnectWatcher() {
  stopDisconnectWatcher();

  disconnectCheckInterval = setInterval(async () => {
    if (!currentMatch) return;
    if (currentMatch.status === "finished") return;

    const opponentColumn  = getOpponentHeartbeatColumn();
    const opponentLastSeen = currentMatch[opponentColumn];

    if (!opponentLastSeen) return;

    const diffMs = Date.now() - new Date(opponentLastSeen).getTime();

    if (diffMs > 6000) {
      const me = getSavedNickname();
      const { error } = await supabaseClient
        .from("ranked_matches")
        .update({ status: "finished", winner: me, round_winner: me })
        .eq("id", currentMatch.id)
        .neq("status", "finished");

      if (error) { console.error("disconnect win error:", error); return; }
      await refreshCurrentMatch();
    }
  }, 2000);
}

function stopDisconnectWatcher() {
  if (disconnectCheckInterval) { clearInterval(disconnectCheckInterval); disconnectCheckInterval = null; }
}

// ─── Exit / forfeit ────────────────────────────────────────────────────────────

async function forfeitCurrentMatchOnExit() {
  const nickname = getSavedNickname();

  if (nickname) {
    try {
      await supabaseClient.from("ranked_queue").delete().eq("nickname", nickname);
    } catch (err) {
      console.error("exit queue cleanup error:", err);
    }
  }

  if (!currentMatch) return;

  const info     = getYouAndOpponent();
  const opponent = info.opponent;

  if (!opponent) return;

  try {
    await supabaseClient
      .from("ranked_matches")
      .update({ status: "finished", winner: opponent, round_winner: opponent })
      .eq("id", currentMatch.id)
      .neq("status", "finished");
  } catch (err) {
    console.error("exit forfeit error:", err);
  }
}

window.addEventListener("pagehide",      () => { forfeitCurrentMatchOnExit(); });
window.addEventListener("beforeunload",  () => { forfeitCurrentMatchOnExit(); });