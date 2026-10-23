// Only schedules verified recovery. No content or success marker is persisted
// in this browser; each task checks its cloud copy before retiring a source.
export function createMigrationRunner({
  currentOwner,
  run,
  schedule = (task, delay) => setTimeout(task, delay),
  cancel = timer => clearTimeout(timer),
  retryDelays = [15_000, 60_000, 180_000],
  onError = error => console.warn("Oldtime cloud recovery will retry.", error?.message || error),
}) {
  const accounts = new Map();
  function request(owner, { retry = false } = {}) {
    if (!owner || currentOwner() !== owner) return;
    const previous = accounts.get(owner);
    if (previous?.running || previous?.timer !== undefined || previous?.done) return;
    if (previous?.exhausted && !retry) return;
    const state = previous || { attempts: 0, done: false, running: false };
    if (retry) state.attempts = 0;
    state.exhausted = false;
    accounts.set(owner, state);
    state.timer = schedule(async () => {
      state.timer = undefined;
      if (currentOwner() !== owner) { accounts.delete(owner); return; }
      state.running = true;
      let success = false;
      try {
        const results = await run(owner);
        success = Array.isArray(results) && results.every(row => !row.warning);
      } catch (error) { onError(error); }
      finally { state.running = false; }
      if (currentOwner() !== owner) { accounts.delete(owner); return; }
      if (success) { state.done = true; return; }
      const delay = retryDelays[state.attempts++];
      if (delay === undefined) { state.exhausted = true; return; }
      state.timer = schedule(() => {
        state.timer = undefined;
        request(owner);
      }, delay);
    }, 0);
  }
  function reset() {
    for (const state of accounts.values()) if (state.timer !== undefined) cancel(state.timer);
    accounts.clear();
  }
  return { request, reset };
}
