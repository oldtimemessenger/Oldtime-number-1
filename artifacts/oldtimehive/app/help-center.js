import "./help-center.css";
import { artImg, illustration, escHtml as esc } from "./old-time-art.js";

const fmt = v => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const KINDS = ["Something is not working", "Account or sign-in", "Privacy or safety concern", "A post, story or message", "Other"];
const chev = '<span aria-hidden="true" class="hc-chev">&rsaquo;</span>';
const $ = s => document.querySelector(s);

export const GUIDE_TOPICS = [
  { id:"walkthroughs", q:"Where can I explore feature walkthroughs?", keys:"walkthrough guides features tips reminders learn tutorial", a:"Open the illustrated guide library whenever you want. Tip preferences sync with your Oldtime account and can be paused.", link:"help-guides", label:"Explore feature guides" },
  { id:"blast", q:"What can I do in Community?", keys:"community friends invite add username video notes groups messages chat", a:"Community brings video notes, friends, groups and chats together. Share your username with people you know, then explore Friends. Requests are confirmed only after the server accepts them.", link:"help-blast", label:"Explore friends" },
  { id:"saved", q:"How do saved messages work?", keys:"saved messages bookmark saved inbox search", a:"Use a message's bookmark action to save it. Open Saved in that inbox to find it again. Bookmarks are separate from reactions and sync with your account.", link:"help-messages", label:"Open Messages" },
  { id: "private", q: "How do I make my account private?", keys: "private public account audience followers visible who sees posts", a: "Open Account privacy and choose public or private. Private accounts limit posts to approved followers.", link: "privacy", label: "Open account privacy" },
  { id: "close", q: "How do Close Friends work?", keys: "close friends stories audience list green ring", a: "Close Friends is a separate audience for stories. You and the other person must both be friends, and blocking removes them.", link: "close-friends", label: "Manage Close Friends" },
  { id: "block", q: "How do I block or unblock someone?", keys: "block unblock harass stop contact remove person", a: "Blocked accounts are listed in settings, where you can unblock them. Blocking hides content between you in both directions.", link: "blocked", label: "Review blocked accounts" },
  { id: "chat", q: "Can I hide read receipts or last seen?", keys: "read receipts last seen messages chat seen typing", a: "Chat privacy lets you choose read receipts and who sees your last seen.", link: "chat", label: "Open chat privacy" },
  { id: "notif", q: "How do I stop notifications?", keys: "notifications alerts mute updates turn off", a: "Notifications can be switched on or off in settings.", link: "notifications", label: "Open notifications" },
  { id: "profile", q: "How do I change my profile details?", keys: "profile name bio city birthday cover avatar photo interests edit", a: "Edit your profile to update details, cover and interests, and choose whether city and interests show.", link: "edit-profile", label: "Edit your profile" },
  { id: "password", q: "How do I change my password?", keys: "password sign in login security account change forgot", a: "Password changes are available for online accounts in settings.", link: "password", label: "Change password" },
  { id: "report", q: "How do I report a problem?", keys: "report problem bug issue feedback wrong broken", a: "Submit a description and it will be stored in your online report history. A submitted report is not the same as a completed review.", link: "help-report", label: "Report a problem" },
  { id: "status", q: "What does Account Status show?", keys: "account status guidelines restrictions removed moderation standing", a: "It lists facts Oldtime can verify. Moderation results are not available here, so it does not say whether your account passed a review.", link: "help-account-status", label: "Open Account Status" },
  { id: "badge", q: "How do I get a Blue Badge?", keys: "blue badge membership verified price trial subscribe buy", a: "Blue Badge purchases are only in the Oldtime mobile app. The web app cannot sell or restore memberships.", link: "blue-badge", label: "See Blue Badge" },
  { id: "data", q: "Where is my information?", keys: "data information privacy center download delete export", a: "The Privacy Center collects your privacy controls and topics.", link: "privacy-center", label: "Open Privacy Center" }
];

export function scoreTopic(topic, query) {
  const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (!words.length) return 0;
  const hay = `${topic.q} ${topic.keys}`.toLowerCase();
  return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}

const shell = (title, inner, cls = "") => ({ title, content: `<div class="hc ${cls}">${inner}</div>`, bind: () => {} });
const topicHtml = t => `<article class="hc-topic"><b>${esc(t.q)}</b><p>${esc(t.a)}</p>${t.link ? `<button type="button" class="btn exp-primary hc-btn exp-nav" data-exp-nav="${esc(t.link)}">${esc(t.label)}</button>` : ""}</article>`;

export function helpScreen(view, env) {
  const { me, db, api, navigate, toast } = env;
  if(view.startsWith("help-article-")){
    const topic=GUIDE_TOPICS.find(item=>item.id===view.slice("help-article-".length));
    if(topic){
      const title={blast:"About Community",saved:"Saved messages",walkthroughs:"Feature walkthroughs"}[topic.id]||topic.q;
      return shell(title,topicHtml(topic));
    }
  }
  if (view === "help-account-status") {
    const blocks = (db.blocks || []).filter(b => b.by === me.id).length;
    const online = api.authMode?.() === "cloud";
    const vis = me.profileVisibility || {};
    const facts = [
      ["Account", `@${me.username}${me.name ? `, ${me.name}` : ""}`],
      ["Sign-in", online ? "Online account" : "Unavailable"],
      ["Audience", me.private ? "Private account" : "Public account"],
      ["City on profile", vis.city === false ? "Hidden" : "Shown"],
      ["Interests on profile", vis.interests === false ? "Hidden" : "Shown"],
      ["Accounts you blocked", String(blocks)],
      ["Report history", online ? "Stored online" : "Unavailable"]
    ];
    const unavailable = ["Feature restrictions", "Content and message removals", "Recommendation eligibility", "Availability by age", "Monetization status"];
    const r = shell("Account Status", `<div class="hc-status-head">${illustration("help", "hc-hero")}<img class="hc-avatar" src="${esc(me.avatar)}" alt="Your profile photo"><h2>Here is what Oldtime can show</h2>
  <p>These are facts from your account. Moderation results are not available here, so this page does not say your account passed any review. <button type="button" class="hc-inline exp-nav" data-exp-nav="help-article-status">Learn more</button></p></div>
      <section class="hc-list"><h3>From your account</h3>${facts.map(([k, v]) => `<div class="hc-fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</section>
      <section class="hc-list"><h3>Checks not available</h3>${unavailable.map(k => `<div class="hc-fact"><span>${esc(k)}</span><b class="hc-pill">Unavailable</b></div>`).join("")}</section>
      <div class="hc-float"><button type="button" class="btn exp-primary hc-btn exp-nav" data-exp-nav="help-guide">Get support</button></div>`);
    return r;
  }
  if (view === "help-report") {
    const r = shell("Report a problem", `<div class="hc-head">${illustration("help")}<h2>Tell us what went wrong</h2></div>
      <p class="hc-note">Reports are submitted to Oldtime and appear in your online history. A received report is not confirmation that it has been reviewed.</p>
      <form id="hc-form" class="hc-form"><label>What kind of problem?<select class="field" id="hc-kind">${KINDS.map(k => `<option>${esc(k)}</option>`).join("")}</select></label>
      <label>Describe it<textarea class="field" id="hc-text" maxlength="1000" required placeholder="What happened, and where in the app?"></textarea></label>
      <small class="hc-count" id="hc-count" aria-live="polite">0 / 1000</small>
      <div class="hc-error" id="hc-err" role="alert"></div>
      <button class="btn exp-primary hc-btn" type="submit">Submit report</button></form>
      <button type="button" class="listbtn exp-nav" data-exp-nav="help-reports"><span><b>Your report history</b></span>${chev}</button>`);
    r.bind = () => {
      const t = $("#hc-text");
      t.oninput = () => { $("#hc-count").textContent = `${t.value.length} / 1000`; $("#hc-err").textContent = ""; };
      $("#hc-form").onsubmit = async e => {
        e.preventDefault();
        const text = t.value.trim();
        if (text.length < 10) { $("#hc-err").textContent = "Enter at least 10 characters."; t.focus(); return; }
        const button = $("#hc-form button[type=submit]");
        button.disabled = true;
        try {
          await api.submitCloudReport({ kind: "problem", category: $("#hc-kind").value, reason: text });
          toast("Report received by Oldtime. Review status is not available yet.");
          navigate("help-reports");
        } catch (err) {
          $("#hc-err").textContent = err.message || "The report could not be submitted online.";
          button.disabled = false;
        }
      };
    };
    return r;
  }
  if (view === "help-reports") {
    const r = shell("Report history", `<p class="hc-note">Reports are stored online under your account. Status “received” means the server accepted the report; it does not confirm a review.</p><div id="hc-reports" aria-live="polite">Loading your online reports…</div>`);
    r.bind = () => {
      const target = $("#hc-reports");
      void api.listCloudReports().then(list => {
        if (!target?.isConnected) return;
        target.innerHTML = list.length
          ? list.map(item => `<details class="hc-report"><summary><span><b>${esc(item.category || item.kind)}</b><small>${esc(fmt(item.createdAt))}</small></span>${chev}</summary><p>${esc(item.reason)}</p><small>Status: ${esc(item.status)}</small></details>`).join("")
          : `<div class="exp-empty hc-empty">${artImg("neighbors", "hc-art", true)}<b>No reports submitted</b><p>Reports you submit will appear here.</p><button type="button" class="btn exp-primary hc-btn exp-nav" data-exp-nav="help-report">Report a problem</button></div>`;
        target.querySelectorAll("[data-exp-nav]").forEach(button => button.onclick = () => navigate(button.dataset.expNav));
      }).catch(error => {
        if (target?.isConnected) target.textContent = error.message || "Online report history could not be loaded.";
      });
    };
    return r;
  }
  if (view === "help-guide") {
    const r = shell("Support guide", `<div class="hc-head">${illustration("help")}<h2>Find an answer</h2></div>
      <p class="hc-note">Answers come from built-in guides. If you submit a report, it is sent to Oldtime and added to your online report history.</p>
      <label class="exp-search"><input id="hc-q" type="search" placeholder="Ask in your own words" aria-label="Ask a question"></label>
      <div class="hc-chips" id="hc-chips" role="group" aria-label="Topics">${GUIDE_TOPICS.map(t => `<button type="button" class="hc-chip" data-hc-topic="${t.id}">${esc(t.q.replace(/\?$/, ""))}</button>`).join("")}</div>
      <div id="hc-out" aria-live="polite"></div>
      <button type="button" class="listbtn exp-nav" data-exp-nav="help-report"><span><b>Still stuck? Report a problem</b><small>Submit it to your online report history.</small></span>${chev}</button>`);
    r.bind = () => {
      const out = $("#hc-out");
      const show = (list, head) => {
        out.innerHTML = list.length ? `<h3>${esc(head)}</h3>${list.map(topicHtml).join("")}` : `<div class="exp-empty"><b>No guide matches that</b><p>Try different words or pick a topic above. You can also save a problem report.</p></div>`;
        out.querySelectorAll("[data-exp-nav]").forEach(b => b.onclick = () => navigate(b.dataset.expNav));
      };
      $("#hc-q").oninput = e => {
        const q = e.currentTarget.value.trim();
        document.querySelectorAll(".hc-chip").forEach(c => c.setAttribute("aria-pressed", "false"));
        if (!q) { out.innerHTML = ""; return; }
        show(GUIDE_TOPICS.map(t => [t, scoreTopic(t, q)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]), "Best matches");
      };
      document.querySelectorAll("[data-hc-topic]").forEach(c => c.onclick = () => {
        document.querySelectorAll(".hc-chip").forEach(x => x.setAttribute("aria-pressed", String(x === c)));
        $("#hc-q").value = "";
        show(GUIDE_TOPICS.filter(t => t.id === c.dataset.hcTopic), "Answer");
      });
    };
    return r;
  }
  return null;
}
