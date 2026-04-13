const box = document.getElementById("gameBox");
const text = document.getElementById("text");
const leaderboardList = document.getElementById("leaderboardList");
const personalBestText = document.getElementById("personalBest");

const rankedBtn = document.getElementById("rankedBtn");
const rankedStatus = document.getElementById("rankedStatus");
const roundNumberText = document.getElementById("roundNumber");
const youLivesText = document.getElementById("youLives");
const opponentLivesText = document.getElementById("opponentLives");
const opponentNameText = document.getElementById("opponentName");
const usernameChip = document.getElementById("usernameChip");
const changeNameBtn = document.getElementById("changeNameBtn");

const nameModal = document.getElementById("nameModal");
const nicknameInput = document.getElementById("nicknameInput");
const saveNameBtn = document.getElementById("saveNameBtn");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LOCAL_NAME_KEY = "reactionNickname";

function getBestKey() {
  const nickname = getSavedNickname() || "guest";
  return `reactionPersonalBest_${nickname}`;
}

let soloState = "idle";
let soloStartTime = 0;
let soloTimeoutId = null;

let mode = "solo";
let currentMatch = null;
let currentChannel = null;
let queueChannel = null;
let rankedClickLocked = false;

loadPersonalBest();
loadLeaderboard();
checkUsernameOnOpen();
updateUsernameChip();

box.addEventListener("click", async () => {
  if (!getSavedNickname()) {
    showNameModal();
    return;
  }

  if (mode === "solo") {
    handleSoloClick();
  } else if (mode === "ranked") {
    await handleRankedClick();
  }
});

rankedBtn.addEventListener("click", async () => {
  if (!getSavedNickname()) {
    showNameModal();
    return;
  }

  if (currentMatch) return;

  await joinRankedQueue();
});

changeNameBtn.addEventListener("click", () => {
  showNameModal();
});

saveNameBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim().slice(0, 16);

  if (!nickname) return;

  localStorage.setItem(LOCAL_NAME_KEY, nickname);
  hideNameModal();
  updateUsernameChip();
  loadPersonalBest();
  loadLeaderboard();
});

function checkUsernameOnOpen() {
  if (!getSavedNickname()) {
    showNameModal();
  }
}

function showNameModal() {
  nicknameInput.value = getSavedNickname();
  nameModal.style.display = "flex";
  nicknameInput.focus();
}

function hideNameModal() {
  nameModal.style.display = "none";
}

function getSavedNickname() {
  return (localStorage.getItem(LOCAL_NAME_KEY) || "").trim();
}

function updateUsernameChip() {
  usernameChip.textContent = `User: ${getSavedNickname() || "--"}`;
}

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
    .limit(10);

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

async function joinRankedQueue() {
  mode = "ranked";
  rankedBtn.disabled = true;
  rankedBtn.textContent = "Searching...";
  rankedStatus.textContent = "Searching for player...";
  text.textContent = "Searching for ranked match...";
  box.className = "blue";

  const nickname = getSavedNickname();

  // clear old queue row for this user
  const { error: deleteOwnError } = await supabaseClient
    .from("ranked_queue")
    .delete()
    .eq("nickname", nickname);

  if (deleteOwnError) {
    console.error(deleteOwnError);
  }

  // insert self into queue first
  const { error: insertQueueError } = await supabaseClient
    .from("ranked_queue")
    .insert([{ nickname }]);

  if (insertQueueError) {
    console.error(insertQueueError);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Could not join queue";
    mode = "solo";
    return;
  }

  // small delay so both players can appear in queue
  await new Promise((resolve) => setTimeout(resolve, 600));

  // check queue again
  const { data: queueRows, error: queueError } = await supabaseClient
    .from("ranked_queue")
    .select("*")
    .neq("nickname", nickname)
    .order("joined_at", { ascending: true });

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

  // try to remove both rows from queue
  await supabaseClient.from("ranked_queue").delete().eq("nickname", nickname);
  await supabaseClient.from("ranked_queue").delete().eq("nickname", opponent.nickname);

  const { data: insertedMatch, error: matchError } = await supabaseClient
    .from("ranked_matches")
    .insert([{
      player1: opponent.nickname,
      player2: nickname,
      player1_lives: 3,
      player2_lives: 3,
      round_number: 1,
      status: "starting"
    }])
    .select()
    .single();

  if (matchError) {
    console.error(matchError);
    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";
    rankedStatus.textContent = "Could not create match";
    mode = "solo";
    return;
  }

  await attachToMatch(insertedMatch.id);
}

let matchPoll = null;

function watchForMatch() {
  const nickname = getSavedNickname();

  if (queueChannel) {
    supabaseClient.removeChannel(queueChannel);
    queueChannel = null;
  }

  if (matchPoll) {
    clearInterval(matchPoll);
    matchPoll = null;
  }

  queueChannel = supabaseClient
    .channel("ranked-match-finder-" + nickname)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "ranked_matches"
      },
      async (payload) => {
        console.log("Realtime payload:", payload);

        const row = payload.new;
        if (row.player1 === nickname || row.player2 === nickname) {
          if (matchPoll) {
            clearInterval(matchPoll);
            matchPoll = null;
          }

          if (queueChannel) {
            supabaseClient.removeChannel(queueChannel);
            queueChannel = null;
          }

          await supabaseClient.from("ranked_queue").delete().eq("nickname", nickname);
          await attachToMatch(row.id);
        }
      }
    )
    .subscribe((status) => {
      console.log("queueChannel status:", status);
    });

    matchPoll = setInterval(async () => {
    const { data, error } = await supabaseClient
      .from("ranked_matches")
      .select("id, player1, player2")
      .or(`player1.eq."${nickname}",player2.eq."${nickname}"`)
      .order("id", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Polling error:", error);
      return;
    }

    const match = data?.[0];
    if (match) {
      clearInterval(matchPoll);
      matchPoll = null;

      if (queueChannel) {
        supabaseClient.removeChannel(queueChannel);
        queueChannel = null;
      }

      await supabaseClient.from("ranked_queue").delete().eq("nickname", nickname);
      await attachToMatch(match.id);
    }
  }, 1000);
}

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
    return;
  }

  currentMatch = data;
  mode = "ranked";
  rankedBtn.disabled = true;
  rankedBtn.textContent = "In Ranked Match";
  rankedClickLocked = false;

  if (currentChannel) {
    supabaseClient.removeChannel(currentChannel);
    currentChannel = null;
  }

  currentChannel = supabaseClient
    .channel("ranked-match-" + matchId)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ranked_matches",
        filter: `id=eq.${matchId}`
      },
      async (payload) => {
        console.log("match realtime payload:", payload);
        await refreshCurrentMatch();
      }
    )
    .subscribe(async (status) => {
      console.log("match channel status:", status);

      if (status === "SUBSCRIBED") {
        await refreshCurrentMatch();
        await maybeStartRound();
      }
    });
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

function getYouAndOpponent() {
  const me = getSavedNickname();

  if (!currentMatch) {
    return {
      me,
      opponent: "--",
      myLives: 3,
      oppLives: 3,
      amPlayer1: false
    };
  }

  const amPlayer1 = currentMatch.player1 === me;

  return {
    me,
    opponent: amPlayer1 ? currentMatch.player2 : currentMatch.player1,
    myLives: amPlayer1 ? currentMatch.player1_lives : currentMatch.player2_lives,
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

  opponentNameText.textContent = info.opponent || "--";
  youLivesText.textContent = renderLives(info.myLives);
  opponentLivesText.textContent = renderLives(info.oppLives);
  roundNumberText.textContent = currentMatch.round_number;

  if (currentMatch.status === "starting") {
    rankedStatus.textContent = "Match found";
    text.textContent = `Match found vs ${info.opponent}`;
    box.className = "blue";
    rankedClickLocked = false;
  }

  if (currentMatch.status === "waiting_clicks") {
    const greenAt = new Date(currentMatch.green_at).getTime();

    if (Date.now() < greenAt) {
      rankedStatus.textContent = "Get ready...";
      text.textContent = "Wait for green...";
      box.className = "blue";
    } else {
      rankedStatus.textContent = "Round live";
      text.textContent = "CLICK!";
      box.className = "green";
    }
  }

  if (currentMatch.status === "round_result") {
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
  }

    if (currentMatch.status === "finished") {
    const won = currentMatch.winner === info.me;

    rankedStatus.textContent = won ? "You won the match" : "You lost the match";
    text.textContent = won
      ? "🏆 You won ranked! Click Play Ranked for another."
      : "💀 You lost ranked. Click Play Ranked to retry.";
    box.className = won ? "green" : "red";

    rankedBtn.disabled = false;
    rankedBtn.textContent = "⚔️ Play Ranked";

    // FIX 7: remove stale queue row for this user
    supabaseClient.from("ranked_queue").delete().eq("nickname", getSavedNickname());

    if (currentChannel) {
      supabaseClient.removeChannel(currentChannel);
      currentChannel = null;
    }

    currentMatch = null;
    mode = "solo";
    rankedClickLocked = false;
  }
}

async function maybeStartRound() {
  if (!currentMatch) return;

  const info = getYouAndOpponent();

  if (!info.amPlayer1) return;
  if (currentMatch.status !== "starting") return;

  const greenAt = new Date(Date.now() + (Math.random() * 2500 + 1500));

  const { error } = await supabaseClient
    .from("ranked_matches")
    .update({
      status: "waiting_clicks",
      green_at: greenAt.toISOString(),
      player1_reaction: null,
      player2_reaction: null
    })
    .eq("id", currentMatch.id);

  if (error) console.error(error);
}

async function handleRankedClick() {
  if (!currentMatch) return;
  if (currentMatch.status !== "waiting_clicks") return;
  if (rankedClickLocked) return;

  const info = getYouAndOpponent();
  const greenAt = new Date(currentMatch.green_at).getTime();
  const now = Date.now();

  let reaction;

  if (now < greenAt) {
    reaction = 9999;
    text.textContent = "Too early 😭";
    box.className = "red";
  } else {
    reaction = now - greenAt;
    text.textContent = `⚡ ${reaction} ms`;
    box.className = "green";
  }

  rankedClickLocked = true;

  const updateData = info.amPlayer1
    ? { player1_reaction: reaction }
    : { player2_reaction: reaction };

  const { error } = await supabaseClient
    .from("ranked_matches")
    .update(updateData)
    .eq("id", currentMatch.id);

  if (error) {
    console.error(error);
    rankedClickLocked = false;
    return;
  }

  setTimeout(async () => {
    await refreshCurrentMatch();
    await maybeResolveRound();
  }, 250);
}

async function maybeResolveRound() {
  if (!currentMatch) return;

  const info = getYouAndOpponent();

  if (!info.amPlayer1) return;
  if (currentMatch.status !== "waiting_clicks") return;
  if (currentMatch.player1_reaction == null || currentMatch.player2_reaction == null) return;

  let p1Lives = currentMatch.player1_lives;
  let p2Lives = currentMatch.player2_lives;
  let roundWinner = null;

  if (currentMatch.player1_reaction < currentMatch.player2_reaction) {
    p2Lives -= 1;
    roundWinner = currentMatch.player1;
  } else if (currentMatch.player2_reaction < currentMatch.player1_reaction) {
    p1Lives -= 1;
    roundWinner = currentMatch.player2;
  }

  const finished = p1Lives <= 0 || p2Lives <= 0;
  const winner = finished
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
    .eq("id", currentMatch.id);

  if (error) {
    console.error(error);
    return;
  }

  if (!finished) {
    setTimeout(async () => {
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
        .eq("id", currentMatch.id);

      if (nextError) console.error(nextError);
    }, 1800);
  }
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}