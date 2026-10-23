let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open("oldtime-sports", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("workouts", { keyPath: "key" });
      store.createIndex("owner", "owner");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(new Error("Workout storage is unavailable. Enable browser storage before recording.")); };
  });
  return opening;
}
export async function records(owner) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction("workouts").objectStore("workouts").index("owner").getAll(owner);
    req.onsuccess = () => resolve(req.result.map(r => r.workout));
    req.onerror = () => reject(new Error("Your saved workouts could not be read."));
  });
}
export async function erase(owner, id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workouts", "readwrite"); tx.objectStore("workouts").delete(`${owner}:${id}`);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error("Workout could not be deleted."));
  });
}
