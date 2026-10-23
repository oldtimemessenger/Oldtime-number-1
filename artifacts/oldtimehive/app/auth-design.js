import "./auth-brand.css";

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const art = url => `<div class="ot-art"><img src="${esc(url)}" alt="Oldtime quill and ring emblem" /></div>`;

export function loginMarkup(brandArtUrl) {
  return `<div class="stage"><div class="phone"><div class="auth ot-auth">
    ${art(brandArtUrl)}
    <p class="ot-eyebrow">Welcome back</p>
    <h1>Sign in to Oldtime</h1>
    <hr class="ot-rule" />
    <div id="cognito-sign-in" style="display:contents"></div>
    <form class="auth-form" id="login-form">
      <label class="ot-label" for="email">Email or username
        <input class="field" id="email" name="username" type="text" autocomplete="username" placeholder="you@example.com" required />
      </label>
      <label class="ot-label" for="pass">Password
        <input class="field" id="pass" name="password" type="password" autocomplete="current-password" placeholder="Password" required />
      </label>
      <p class="sub" id="err" role="alert"></p>
      <button class="btn primary" id="login" type="submit">Log in</button>
    </form>
    <div class="ot-switch"><span>New to Oldtime?</span>
      <button class="btn ghost" id="signup" type="button">Create account</button>
    </div>
  </div></div></div>`;
}

export function signupMarkup(brandArtUrl) {
  return `<div class="stage"><div class="phone"><div class="auth ot-auth">
    ${art(brandArtUrl)}
    <p class="ot-eyebrow">Join Oldtime</p>
    <h1>Create your account</h1>
    <p class="ot-lede">Three details to get started. You can personalize your profile later.</p>
    <hr class="ot-rule" />
    <div id="cognito-sign-in" style="display:contents"></div>
    <form class="auth-form" id="signup-form">
      <label class="ot-label" for="su-email">Email address
        <input class="field" id="su-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="ot-label" for="su-user">Username <small>3–24 letters, numbers, or underscores</small>
        <input class="field" id="su-user" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" placeholder="Choose a username" required />
      </label>
      <label class="ot-label" for="su-pass">Password <small>8+ characters</small>
        <input class="field" id="su-pass" name="new-password" type="password" autocomplete="new-password" placeholder="Password (8+ characters)" minlength="8" required />
      </label>
      <p class="sub" id="err" role="alert"></p>
      <button class="btn primary" id="go" type="submit">Create account</button>
      <button class="btn auth-link" id="back" type="button">Already have an account? <strong>Log in</strong></button>
    </form>
  </div></div></div>`;
}
