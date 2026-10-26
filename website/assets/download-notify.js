// Counts clicks on Download links: one small beacon per click to the owner's mail relay
// (deploy/apps-script/download-notify). It sends no IP-derived data, cookie or visitor ID, never
// delays the download, and does nothing when the relay URL is not configured or the browser
// asks not to be tracked (Global Privacy Control / Do Not Track).
(function () {
  var meta = document.querySelector('meta[name="sahkarmi-download-notify"]');
  var endpoint = meta && meta.getAttribute("content");
  if (!endpoint || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return;
  if (!navigator.sendBeacon) return;

  function estimateOs(ua) {
    var win = /Windows NT (\d+\.\d+)/.exec(ua);
    if (win) {
      var names = { "10.0": "Windows 10/11", "6.3": "Windows 8.1", "6.2": "Windows 8", "6.1": "Windows 7" };
      return names[win[1]] || "Windows NT " + win[1];
    }
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS / iPadOS";
    if (/Mac OS X/i.test(ua)) return "macOS";
    if (/CrOS/i.test(ua)) return "ChromeOS";
    if (/Linux|X11/i.test(ua)) return "Linux";
    return "unknown";
  }

  function estimateBrowser(ua) {
    var checks = [
      ["Edge", /Edg\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Samsung Internet", /SamsungBrowser\/(\d+)/],
      ["Firefox", /Firefox\/(\d+)/], ["Chrome", /Chrome\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/],
    ];
    for (var i = 0; i < checks.length; i += 1) {
      var match = checks[i][1].exec(ua);
      if (match) return checks[i][0] + " " + match[1];
    }
    return "unknown";
  }

  function utmTags() {
    var params = new URLSearchParams(location.search);
    var parts = [];
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"].forEach(function (key) {
      var value = params.get(key);
      if (value) parts.push(key + "=" + value.slice(0, 60));
    });
    return parts.join("&");
  }

  function referrer() {
    if (!document.referrer) return "";
    try {
      var url = new URL(document.referrer);
      if (url.hostname === location.hostname) return "";
      return url.origin + url.pathname;
    } catch (_) {
      return "";
    }
  }

  function buttonName(link) {
    if (link.id) return link.id;
    if (link.classList.contains("header-download")) return "header";
    if (link.hasAttribute("data-platform-tile")) return "platform-card";
    if (link.hasAttribute("data-platform")) return "installer-list";
    if (link.closest(".sticky-cta, [class*='sticky']")) return "sticky-bar";
    if (link.closest("section")) return "section:" + (link.closest("section").id || "unnamed");
    return "link";
  }

  document.addEventListener(
    "click",
    function (event) {
      var link = event.target instanceof Element && event.target.closest('a[href*="/releases/download/"]');
      if (!link) return;
      try {
        var file = decodeURIComponent(link.href.split("/").pop() || "");
        var version = (/-(\d+\.\d+\.\d+[\w.-]*?)-(?:x64|arm64)/.exec(file) || [])[1] || "";
        var ua = navigator.userAgent || "";
        var zone = "";
        try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { /* old browser */ }
        var payload = {
          v: 1,
          event: "download_click",
          file: file,
          version: version,
          os: estimateOs(ua),
          browser: estimateBrowser(ua),
          device: /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile / tablet" : "desktop",
          pageLang: document.documentElement.lang || "",
          languages: (navigator.languages || [navigator.language || ""]).slice(0, 4).join(", "),
          timeZone: zone,
          screen: screen.width + "x" + screen.height,
          referrer: referrer(),
          utm: utmTags(),
          page: location.pathname,
          button: buttonName(link),
          userAgent: ua.slice(0, 300),
        };
        // text/plain keeps this a simple request (no CORS preflight) and Apps Script reads the body.
        navigator.sendBeacon(endpoint, new Blob([JSON.stringify(payload)], { type: "text/plain" }));
      } catch (_) {
        /* counting must never get in the way of the download */
      }
    },
    true,
  );
})();
