// Cloud records replace their imported source, never the other way around.
export function mergeFeedPosts(localPosts, cloudPosts) {
  const cloudIds = new Set(cloudPosts.map(post => String(post.id)));
  const sources = new Set(cloudPosts.map(post => post.sourceId).filter(Boolean).map(String));
  return [...localPosts.filter(post => !cloudIds.has(String(post.id)) && !sources.has(String(post.id))), ...cloudPosts];
}

export function followingPosts(posts, me) {
  if (!me) return posts;
  const following = new Set(me.following || []);
  return posts.filter(post => post.author === me.id || following.has(post.author));
}
