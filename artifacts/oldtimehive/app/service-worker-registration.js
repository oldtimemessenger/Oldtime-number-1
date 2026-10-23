if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const scriptUrl = new URL("./service-worker.js", document.baseURI).href;
    if (import.meta.env.DEV) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const appRegistrations = registrations.filter(registration =>
          [registration.active, registration.waiting, registration.installing]
            .some(worker => worker?.scriptURL === scriptUrl)
        );
        const appCaches = "caches" in window
          ? (await caches.keys()).filter(name => name.startsWith("old-time-shell-"))
          : [];
        const needsReload = appRegistrations.length > 0 || appCaches.length > 0;
        await Promise.all([
          ...appRegistrations.map(registration => registration.unregister()),
          ...appCaches.map(name => caches.delete(name))
        ]);
        if (needsReload) location.reload();
      } catch {}
      return;
    }
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
