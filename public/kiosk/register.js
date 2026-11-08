// Included only by the production shell document. The development server
// does not add this script, so it does not register a worker during npm run dev.
if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
}
