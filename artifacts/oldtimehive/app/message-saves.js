export function messageIsSaved(message, userId) {
  return Array.isArray(message.savedBy) ? message.savedBy.includes(userId) : !!message.starred;
}
export function toggleMessageSaved(db, conversationId, messageId, userId) {
  const conversation = db.convos.find(item => item.id === conversationId && item.members.includes(userId));
  const message = conversation?.messages.find(item => item.id === messageId);
  if (!message || message.hiddenFor?.includes(userId)) throw new Error("Message unavailable");
  if (message.viewOnce || message.expired || message.expiresAt <= Date.now()) throw new Error("This message cannot be saved");
  const saved = !messageIsSaved(message, userId);
  const owners = new Set(Array.isArray(message.savedBy) ? message.savedBy : message.starred ? [userId] : []);
  saved ? owners.add(userId) : owners.delete(userId);
  message.savedBy = [...owners];
  message.starred = false;
  db.saved = [...new Set((db.saved || []).filter(id => id !== messageId))];
  if (saved) db.saved.push(messageId);
  return saved;
}
