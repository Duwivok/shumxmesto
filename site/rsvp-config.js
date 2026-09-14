export const RSVP_CONFIG = Object.freeze({
  endpoint: "/api/rsvp",
  storageKey: "shum:rsvp:2026-09-19:v1",

  // GitHub Pages is a visual preview only. RSVP stays disabled there even
  // after channelUrl is filled for the production Timeweb deployment.
  previewHostnames: Object.freeze(["duwivok.github.io"]),

  // Required before production: paste the exact https://t.me/... channel URL.
  // Keep the URL free of vote IDs, UTM tags, or other tracking parameters.
  channelUrl: "",
});
