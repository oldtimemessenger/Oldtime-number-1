import { api, requestCloudApi } from "./store.js";
// requestCloudApi serializes JSON; passing a string here would encode it twice.
const json = (method, body) => ({ method, body });
const path = (id) => encodeURIComponent(id);
export const sportsSocial = {
  viewer: () => api.me(),
  authRevision: () => api.authRevision(),
  summary: () => requestCloudApi(`/api/sports/summary?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`),
  challenges: () => requestCloudApi("/api/sports/challenges"),
  createChallenge: body => requestCloudApi("/api/sports/challenges", json("POST", body)),
  challenge: id => requestCloudApi(`/api/sports/challenges/${path(id)}`),
  joinChallenge: id => requestCloudApi(`/api/sports/challenges/${path(id)}/join`, json("POST", {})),
  inviteChallenge: (id, userIds) => requestCloudApi(`/api/sports/challenges/${path(id)}/invites`, json("POST", { userIds })),
  tagWorkout: (id, body) => requestCloudApi(`/api/sports/workouts/${path(id)}/challenge`, json("PUT", body)),
  workoutTags: id => requestCloudApi(`/api/sports/workouts/${path(id)}/challenge`),
  people: query => requestCloudApi(`/api/users/search?query=${encodeURIComponent(query)}`),
  deleteChallenge: id => requestCloudApi(`/api/sports/challenges/${path(id)}`, { method: "DELETE" }),
  mapConfig: () => requestCloudApi("/api/sports/maps/config"),
};
