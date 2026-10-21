window.LOCALDNS_UI_CONFIG = {
  apiBase: "",
  // Optional UI update endpoint; populated by install_ui_updater.py. No credentials here.
  uiUpdaterBase: "",
  // Same-origin config backend (this single-port Scripting server hosts /api/proxy-config too)
  proxyConfigBase: typeof location !== 'undefined' ? location.origin : "",
  title: "LocalDNS 控制台",
  refreshInterval: 30,
  requestTimeout: 10000,
  demoOnApiFailure: false
};
