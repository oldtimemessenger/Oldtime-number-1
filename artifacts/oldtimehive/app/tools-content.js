// Self-service guidance built from features Oldtime actually has. No metrics or outcomes are promised.
const COMMON = [
  { id: "profile", title: "Finish your profile", art: "lineup", body: "People decide quickly whether to follow. Add a clear photo, a short bio, your city if you want it shown, and interests so your profile says who you are.", link: "edit-profile", label: "Edit your profile" },
  { id: "audience", title: "Pick the right audience first", art: "neighbors", body: "Public accounts are visible to everyone. Private accounts limit posts to approved followers, and Close Friends is a separate audience for stories. Review this before you share something personal.", link: "privacy", label: "Review account privacy" },
  { id: "replies", title: "Keep conversations kind", art: "conversation", body: "Reply to comments and messages in your own voice. You can block accounts and set read receipts and last seen in your settings.", link: "chat", label: "Open chat privacy" }
];
const BY_ROLE = {
  personal: [
    { id: "everyday", title: "Share the small things", art: "celebration", body: "Oldtime is built for everyday posts, stories and conversations. A short update with friends in mind works as well as a polished one.", link: "", label: "" }
  ],
  creator: [
    { id: "rhythm", title: "Learn from your own numbers", art: "celebration", body: "Creator Studio shows what was measured for your account since tracking began. Compare date ranges and open any post for its own insights before deciding what to change.", link: "creator-studio", label: "Open Creator Studio" },
    { id: "membership", title: "Understand Blue Badge", art: "community", body: "Blue Badge is a membership verified by the app store. It is separate from your activity and does not guarantee reach or earnings.", link: "blue-badge", label: "See Blue Badge details" }
  ],
  business: [
    { id: "contact", title: "Decide what customers can see", art: "community", body: "Contact details and category are optional and only appear when you turn them on in Account type. Keep them off if you prefer people to message you.", link: "account-type", label: "Review account type" },
    { id: "insights", title: "Check what people actually viewed", art: "celebration", body: "Your business dashboard lists measured views and profile visits. Open a post to see its own numbers.", link: "business-dashboard", label: "Open business dashboard" }
  ]
};
const IDEAS = {
  all: [
    { id: "story", title: "Post a story from today", art: "celebration", body: "Stories are a light way to share a moment. Choose Close Friends when it is only for your closest people.", link: "close-friends", label: "Manage Close Friends" },
    { id: "blast", title: "Try Community", art: "conversation", body: "Community is for posts, notes and events with people you choose. Visibility follows the audience you select.", link: "", label: "" },
    { id: "campaign", title: "Start or follow a Campaign", art: "community", body: "Campaigns let neighbors share a cause and the support it needs. Donations are not available.", link: "campaigns", label: "Browse Campaigns" },
    { id: "nearby", title: "Browse Nearby by area", art: "neighbors", body: "Nearby uses your location only when you ask. You can also browse by area without allowing location.", link: "", label: "" }
  ]
};
export const bestPractices = role => [...(BY_ROLE[role] || BY_ROLE.personal), ...COMMON];
export const inspiration = () => IDEAS.all;
