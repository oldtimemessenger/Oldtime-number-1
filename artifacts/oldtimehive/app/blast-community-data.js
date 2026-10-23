export const BLAST_COMMUNITIES = Object.freeze([
  { id: "everyday-life", name: "Everyday life", category: "Life", description: "Small wins, questions, and the things happening around you.", icon: "comment" },
  { id: "outdoors", name: "Outdoors", category: "Outdoors", description: "Routes, hikes, fresh air, and places worth sharing.", icon: "location" },
  { id: "music-scenes", name: "Music scenes", category: "Music", description: "Find new sounds and talk about the music you love.", icon: "volume" },
  { id: "creative-corner", name: "Creative corner", category: "Art", description: "Share work in progress, ideas, and inspiration.", icon: "image" },
  { id: "writers-room", name: "Writers room", category: "Writing", description: "Prompts, drafts, recommendations, and good lines.", icon: "edit" },
  { id: "game-day", name: "Game day", category: "Sport", description: "Training, teams, match days, and the moments around sport.", icon: "timeCircle" }
]);

export const BLAST_COMMUNITY_CATEGORIES = Object.freeze(["All", ...new Set(BLAST_COMMUNITIES.map(item => item.category))]);

export function getBlastCommunity(id) {
  return BLAST_COMMUNITIES.find(item => item.id === String(id || "")) || null;
}
