export function renderBlastInfo(view, ctx) {
  if (view.name === "guidelines") {
    return ctx.page("Community guidelines", `<article class="blast-card blast-policy" style="padding:4px 12px">
      <section><h2>Respect &amp; Safety</h2><ul><li>Do not send messages that harass, threaten, bully, or sexually exploit anyone.</li><li>Do not spam, manipulate, or pressure other users.</li><li>Hate speech, discrimination, or content that promotes violence is not allowed in messages or posts.</li></ul></section>
      <section><h2>Messages &amp; Posts</h2><ul><li>Messages must follow the same rules as comments and posts.</li><li>Do not harass others or evade blocks.</li><li>Impersonation is prohibited.</li></ul></section>
      <section><h2>Consequences</h2><p>Violations may result in content removal or account restrictions.</p></section>
    </article>`);
  }
  return ctx.page("Privacy summary", `<section class="blast-card" style="padding:17px">
    <div class="blast-eyebrow">Privacy</div><h2 style="margin:10px 0;font:var(--fw-heading) var(--fs-page)/var(--lh-heading) var(--font-heading)">Your Community data</h2>
    <div class="blast-policy">
        <section><h2>Visibility</h2><p>Choose friends, a group conversation, or Only me when you write. Only me posts stay private. Group posts are limited to group members, and community posts are available to joined members.</p></section>
       <section><h2>Notes &amp; chats</h2><p>Notes and saved messages remain private. Video notes follow the audience or recipient you choose when saving.</p></section>
    </div>
  </section>`);
}
