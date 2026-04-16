// ─── Auth bar on home page ────────────────────────────────────────────────────

let _sbHome = null;

async function initHomeAuth() {
  _sbHome = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await _sbHome.auth.getSession();
  const bar = document.getElementById("authTopbar");

  if (session) {
    // Fetch username from profiles table
    const { data: profile } = await _sbHome
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle();

    const username = profile?.username || session.user.email;

    bar.innerHTML = `
      <div class="auth-chip">👤 ${escapeHtml(username)}</div>
      <button class="small-btn" onclick="homeLogout()">Logout</button>
    `;
  } else {
    bar.innerHTML = `
      <button class="login-btn" onclick="location.href='auth/index.html'">Login / Register</button>
    `;
  }
}

async function homeLogout() {
  if (_sbHome) {
    await _sbHome.auth.signOut();
    location.reload();
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initHomeAuth();

// ─── Game cards & preview ─────────────────────────────────────────────────────

const cards = document.querySelectorAll(".game-card[data-title]");
const previewTitle = document.getElementById("previewTitle");
const previewDesc  = document.getElementById("previewDesc");
const expandBtn    = document.getElementById("expandBtn");
const gameGrid     = document.getElementById("gameGrid");

cards.forEach((card) => {
  card.addEventListener("click", () => {
    previewTitle.textContent = card.dataset.title;
    previewDesc.textContent  = card.dataset.desc;
  });
});

let expanded = false;

expandBtn.addEventListener("click", () => {
  if (expanded) return;
  expanded = true;

  const extraCards = [
    { title: "Night Driver",     desc: "A moody endless road game with neon lights."                  },
    { title: "Timeline Chaos",   desc: "Drag a slider and watch weird alternate history events appear." },
    { title: "Sound Lab",        desc: "Make strange music by clicking animated shapes."               },
    { title: "Pixel Aquarium",   desc: "Tiny fish, bubbles, and relaxing interactions."                }
  ];

  extraCards.forEach((item) => {
    const btn = document.createElement("button");
    btn.className       = "game-card";
    btn.dataset.title   = item.title;
    btn.dataset.desc    = item.desc;
    btn.innerHTML       = `<h2>${item.title}</h2><p>${item.desc}</p>`;

    btn.addEventListener("click", () => {
      previewTitle.textContent = btn.dataset.title;
      previewDesc.textContent  = btn.dataset.desc;
    });

    gameGrid.appendChild(btn);
  });

  expandBtn.querySelector("h2").textContent = "Expanded";
  expandBtn.querySelector("p").textContent  = "You can keep adding more categories later";
});