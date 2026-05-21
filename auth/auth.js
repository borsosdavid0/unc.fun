// auth.js – handles login, register, and email-verification callback

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Init ────────────────────────────────────────────────────────────────────
// If the user is returning from an email verification link, the URL will have
// an #access_token=... fragment that Supabase processes automatically.
// We check for that to avoid redirecting away before the callback fires.

(async () => {
  const isCallback = window.location.hash.includes("access_token") ||
                     window.location.hash.includes("error_description");

  if (!isCallback) {
    // Normal load – if already logged in, go straight home.
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      window.location.href = "../index.html";
    }
  }
})();

// ─── Auth state listener (catches email-verification callbacks) ───────────────
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_IN" && session) {
    await ensureProfileExists(session);

    const { data: profile } = await sb
      .from("profiles")
      .select("is_admin")
      .eq("id", session.user.id)
      .single();

    if (profile?.is_admin) {
      window.location.href = "../admin/index.html";
    } else {
      window.location.href = "../index.html";
    }
  }
});

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(tab) {
  const loginTab     = document.getElementById("loginTab");
  const registerTab  = document.getElementById("registerTab");
  const loginPanel   = document.getElementById("loginPanel");
  const registerPanel = document.getElementById("registerPanel");

  if (tab === "login") {
    loginTab.classList.add("active");
    registerTab.classList.remove("active");
    loginPanel.classList.add("active");
    registerPanel.classList.remove("active");
  } else {
    loginTab.classList.remove("active");
    registerTab.classList.add("active");
    loginPanel.classList.remove("active");
    registerPanel.classList.add("active");
  }
}

function showMainForms() {
  document.getElementById("tabRow").style.display = "";
  document.getElementById("loginPanel").style.display = "";
  document.getElementById("registerPanel").style.display = "";
  document.getElementById("verifyScreen").classList.remove("active");
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `msg ${type}`;
}

function clearMsg(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.className = "msg";
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  clearMsg("loginMsg");

  if (!email || !password) {
    showMsg("loginMsg", "Please fill in all fields.", "error");
    return;
  }

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.textContent = "Signing in…";

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg("loginMsg", error.message, "error");
    btn.disabled = false;
    btn.textContent = "Sign In";
    return;
  }

  await ensureProfileExists(data.session);

  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", data.session.user.id)
    .single();

  if (profile?.is_admin) {
    window.location.href = "../admin/index.html";
  } else {
    window.location.href = "../index.html";
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

async function handleRegister() {
  const username = document.getElementById("regUsername").value.trim();
  const email    = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirm  = document.getElementById("regConfirm").value;

  clearMsg("registerMsg");

  // ── Validation ──
  if (!username || !email || !password || !confirm) {
    showMsg("registerMsg", "Please fill in all fields.", "error");
    return;
  }

  if (!/^[a-zA-Z0-9_]{1,16}$/.test(username)) {
    showMsg("registerMsg", "Username may only contain letters, numbers and underscores (max 16).", "error");
    return;
  }

  if (password.length < 8) {
    showMsg("registerMsg", "Password must be at least 8 characters.", "error");
    return;
  }

  if (password !== confirm) {
    showMsg("registerMsg", "Passwords do not match.", "error");
    return;
  }

  const btn = document.getElementById("registerBtn");
  btn.disabled = true;
  btn.textContent = "Checking username…";

  // ── Username uniqueness check ──
  const { data: existing, error: checkErr } = await sb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (checkErr) {
    showMsg("registerMsg", "Could not verify username – please try again.", "error");
    btn.disabled = false;
    btn.textContent = "Create Account";
    return;
  }

  if (existing) {
    showMsg("registerMsg", "That username is already taken. Please choose another.", "error");
    btn.disabled = false;
    btn.textContent = "Create Account";
    return;
  }

  btn.textContent = "Creating account…";

  // ── Sign up (Supabase sends verification email via your configured SMTP) ──
  //
  // NOTE: To use your Google Cloud / Gmail account for sending verification emails:
  //   1. Go to Supabase Dashboard → Settings → Authentication → SMTP Settings
  //   2. Enable Custom SMTP
  //   3. Host: smtp.gmail.com  |  Port: 587
  //   4. Username: your Gmail address
  //   5. Password: a Google App Password (generated at myaccount.google.com/apppasswords)
  //   6. Set "Sender email" to your Gmail address
  //   7. Set "Site URL" to your deployed domain (e.g. https://unc.fun)
  //   8. In "Redirect URLs" add: https://unc.fun/auth/index.html
  //
  // The username is stored in user metadata so it survives the verification flow.

  const { data, error: signUpErr } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { username },                              // persisted in user_metadata
      emailRedirectTo: "https://unc.fun/auth/index.html"
    }
  });

  if (signUpErr) {
    showMsg("registerMsg", signUpErr.message, "error");
    btn.disabled = false;
    btn.textContent = "Create Account";
    return;
  }

  // If email confirmation is disabled in Supabase (dev mode) a session is
  // returned immediately – create the profile right away.
  if (data.session) {
    await createProfile(data.session.user.id, username);
    // onAuthStateChange SIGNED_IN will redirect us to home.
    return;
  }

  // Otherwise show the "check your email" screen.
  document.getElementById("tabRow").style.display        = "none";
  document.getElementById("loginPanel").style.display    = "none";
  document.getElementById("registerPanel").style.display = "none";
  document.getElementById("verifyScreen").classList.add("active");
  document.getElementById("verifyEmailText").textContent = email;
}

// ─── Profile helpers ──────────────────────────────────────────────────────────

async function createProfile(userId, username) {
  const { error } = await sb
    .from("profiles")
    .insert([{ id: userId, username }]);

  if (error) console.error("Profile creation error:", error);
}

async function ensureProfileExists(session) {
  // Check if profile row already exists
  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile) {
    const username = session.user.user_metadata?.username;
    if (username) {
      await createProfile(session.user.id, username);
    }
  }
}