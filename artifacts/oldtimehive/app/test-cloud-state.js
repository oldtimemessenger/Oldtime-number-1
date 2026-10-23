import { api } from "./store.js";

const originalMethods = {
  me: api.me,
  cloudAccountId: api.cloudAccountId,
  cloudAccountStateLoaded: api.cloudAccountStateLoaded,
  cloudAccountState: api.cloudAccountState,
  updateCloudAccountState: api.updateCloudAccountState,
};

export function mockCloudAccountState(initialAccount = "a") {
  const states = new Map([[initialAccount, {}]]);
  let activeAccount = initialAccount;
  let loaded = true;
  let updateError = null;

  api.me = () => activeAccount ? { id: activeAccount } : null;
  api.cloudAccountId = () => activeAccount;
  api.cloudAccountStateLoaded = () => loaded && !!activeAccount;
  api.cloudAccountState = () => structuredClone(states.get(activeAccount) || {});
  api.updateCloudAccountState = async patch => {
    if (updateError) throw updateError;
    const next = { ...(states.get(activeAccount) || {}), ...structuredClone(patch) };
    states.set(activeAccount, next);
    return structuredClone(next);
  };

  return {
    switchAccount(id) {
      activeAccount = id;
      if (!states.has(id)) states.set(id, {});
    },
    setLoaded(value) { loaded = value; },
    setState(id, value) { states.set(id, structuredClone(value)); },
    failUpdates(error) { updateError = error; },
    restore() { Object.assign(api, originalMethods); },
  };
}
