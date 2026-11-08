/**
 * Sahkarmi Download Notify — mails the owner when someone clicks a Download button on
 * sahkarmi.site.
 *
 * The website sends one small JSON beacon per click (website/assets/download-notify.js). It
 * carries no IP address, cookie or visitor ID, only what the browser itself reports: the
 * installer file and version, operating system and browser estimated from the user agent,
 * languages, time zone, screen size, referrer, UTM tags and which button was clicked. Country is
 * estimated from the time zone below; city is never collected. A click is not a finished
 * download, because browsers do not report that.
 *
 * Set-up (all in the Google account that should send the mail, e.g. the Sahkarmi sender account):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script properties:
 *        MAIL_TO     recipient address (the owner)
 *        DAILY_LIMIT optional, instant mails per day before switching to the digest (default 60)
 *   3. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → copy the
 *      /exec URL.
 *   4. Run installDigestTrigger() once from the editor (it adds the daily 23:30 digest).
 *   5. Store the /exec URL as the repository variable DOWNLOAD_NOTIFY_URL; the next website
 *      deploy turns the beacon on. Without the variable the website sends nothing.
 *
 * The /exec URL is public by design (it is in the page). The relay therefore mails only MAIL_TO,
 * accepts only the expected fields, drops repeated clicks and caps instant mails per day; clicks
 * over the cap are counted and reported in the digest instead.
 *
 * Daily active users (Sahkarmi 0.26.0 and later): the app itself sends one "app_active" note a
 * day to this same URL (src/backend/usage-ping.ts): a random ID made for that copy, version, how
 * it was installed, whether it is new and the time zone. Each copy is counted once per day (only
 * a short hash of its ID is kept, and only until that day is reported) and one "Daily active
 * users" mail each morning reports yesterday: active, new, returning, versions, install
 * channels, countries and a 14-day trend. Updating an existing relay:
 *   a. Paste this file over the old one and save.
 *   b. Deploy → Manage deployments → edit the existing web app → Version: New version → Deploy.
 *      (Editing keeps the same /exec URL; a brand-new deployment would change it.)
 *   c. Run installDigestTrigger() once again; it adds the 07:00 daily-active report.
 */

var MAX_FIELD = 300;

function doPost(e) {
  var out = function (body) {
    return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
      ContentService.MimeType.JSON,
    );
  };
  var props = PropertiesService.getScriptProperties();
  var recipient = props.getProperty("MAIL_TO");
  if (!recipient) return out({ ok: false, error: "relay not configured" });

  var data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return out({ ok: false, error: "bad json" });
  }
  if (data && data.event === "app_active" && data.v === 1) return out(recordActive(props, data));
  if (!data || data.event !== "download_click" || data.v !== 1) {
    return out({ ok: false, error: "unexpected payload" });
  }
  var file = clean(data.file, 120);
  if (!/^Sahkarmi-[0-9][0-9A-Za-z.\-]*\.(exe|dmg|AppImage|zip)$/.test(file)) {
    return out({ ok: false, error: "unexpected file" });
  }

  var click = {
    time: new Date(),
    file: file,
    version: clean(data.version, 40),
    os: clean(data.os, 80),
    browser: clean(data.browser, 80),
    device: clean(data.device, 40),
    pageLanguage: clean(data.pageLang, 20),
    browserLanguages: clean(data.languages, 120),
    timeZone: clean(data.timeZone, 60),
    country: countryFromTimeZone(clean(data.timeZone, 60)),
    screen: clean(data.screen, 40),
    referrer: clean(data.referrer, MAX_FIELD),
    utm: clean(data.utm, MAX_FIELD),
    page: clean(data.page, 120),
    button: clean(data.button, 60),
    userAgent: clean(data.userAgent, MAX_FIELD),
  };

  // The same browser clicking twice within two minutes is one download attempt.
  var cache = CacheService.getScriptCache();
  var fingerprint = Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      [click.userAgent, click.timeZone, click.browserLanguages, click.screen, click.file].join("|"),
    ),
  );
  if (cache.get("seen:" + fingerprint)) return out({ ok: true, duplicate: true });
  cache.put("seen:" + fingerprint, "1", 120);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var day = dayKey(click.time);
    var total = Number(props.getProperty("total:" + day) || 0) + 1;
    props.setProperty("total:" + day, String(total));
    var limit = Number(props.getProperty("DAILY_LIMIT") || 60);
    var quota = MailApp.getRemainingDailyQuota();
    if (total > limit || quota < 5) {
      var held = Number(props.getProperty("held:" + day) || 0) + 1;
      props.setProperty("held:" + day, String(held));
      appendDigestLine(props, day, click);
      return out({ ok: true, digest: true });
    }
    appendDigestLine(props, day, click);
    MailApp.sendEmail({
      to: recipient,
      subject:
        "Sahkarmi download: " +
        (click.version || click.file) +
        " · " +
        (click.os || "unknown OS") +
        " · " +
        (click.country || click.timeZone || "unknown place"),
      body: renderText(click, total),
      htmlBody: renderHtml(click, total),
      name: "Sahkarmi Downloads",
    });
    return out({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/** GET shows that the relay is alive without sending anything. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "sahkarmi-download-notify", method: "POST only" }),
  ).setMimeType(ContentService.MimeType.JSON);
}

/** Daily summary: total clicks, clicks that were over the instant-mail cap, and a short table. */
function sendDailyDigest() {
  var props = PropertiesService.getScriptProperties();
  var recipient = props.getProperty("MAIL_TO");
  if (!recipient) return;
  var day = dayKey(new Date());
  var total = Number(props.getProperty("total:" + day) || 0);
  var held = Number(props.getProperty("held:" + day) || 0);
  var lines = props.getProperty("lines:" + day) || "";
  if (total > 0) {
    MailApp.sendEmail({
      to: recipient,
      subject: "Sahkarmi downloads today: " + total + " click" + (total === 1 ? "" : "s"),
      body:
        "Download button clicks on sahkarmi.site on " +
        day +
        ": " +
        total +
        (held ? " (" + held + " over the instant-mail limit, listed only here)" : "") +
        "\n\nTime | Version | OS | Browser | Country | Source\n" +
        lines +
        "\nA click starts the download; browsers do not report whether it finished. " +
        "GitHub's per-file download counts on the Releases page are the reference total.",
      name: "Sahkarmi Downloads",
    });
  }
  // Drop keys older than today so the property store stays small.
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i += 1) {
    var match = /^(total|held|lines):(\d{4}-\d{2}-\d{2})$/.exec(keys[i]);
    if (match && match[2] <= day) props.deleteProperty(keys[i]);
  }
}

/**
 * Run once from the editor: schedules sendDailyDigest every day around 23:30 and
 * sendDailyActiveReport (yesterday's active users) every morning around 07:00.
 */
function installDigestTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i += 1) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === "sendDailyDigest" || handler === "sendDailyActiveReport") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("sendDailyDigest").timeBased().everyDays(1).atHour(23).nearMinute(30).create();
  ScriptApp.newTrigger("sendDailyActiveReport").timeBased().everyDays(1).atHour(7).nearMinute(0).create();
}

// ---- Daily active users -------------------------------------------------------------------

var ACTIVE_CHANNELS = { installer: 1, store: 1, scoop: 1, other: 1 };

/** Counts one copy of the app once per day (the relay's day). Sends no mail. */
function recordActive(props, data) {
  var install = clean(data.install, 40).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(install)) {
    return { ok: false, error: "unexpected install" };
  }
  var version = clean(data.version, 40);
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) return { ok: false, error: "unexpected version" };
  var channel = ACTIVE_CHANNELS[data.channel] ? data.channel : "other";
  var zone = clean(data.timeZone, 60);
  // Only a short hash is kept, never the ID itself; 12 characters keep collisions negligible.
  var hash = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, install),
  ).slice(0, 12);
  var day = dayKey(new Date());
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (activeSeen(props, day, hash)) return { ok: true, duplicate: true };
    activeRemember(props, day, hash);
    var tally = JSON.parse(props.getProperty("dauTally:" + day) || "{}");
    tally.active = (tally.active || 0) + 1;
    if (data.newInstall === true) tally.fresh = (tally.fresh || 0) + 1;
    bump(tally, "versions", version);
    bump(tally, "channels", channel);
    bump(tally, "countries", countryFromTimeZone(zone) || zone || "unknown");
    props.setProperty("dauTally:" + day, JSON.stringify(tally));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function bump(tally, field, key) {
  tally[field] = tally[field] || {};
  tally[field][key] = (tally[field][key] || 0) + 1;
}

// The day's hashes live in chunks of up to 8 KB (a script property holds 9 KB).
function activeSeen(props, day, hash) {
  var chunks = Number(props.getProperty("dauChunks:" + day) || 0);
  for (var i = 0; i < chunks; i += 1) {
    if ((props.getProperty("dauIds:" + day + ":" + i) || "").indexOf(hash + ",") !== -1) return true;
  }
  return false;
}

function activeRemember(props, day, hash) {
  var chunks = Number(props.getProperty("dauChunks:" + day) || 0);
  var last = chunks > 0 ? props.getProperty("dauIds:" + day + ":" + (chunks - 1)) || "" : "";
  if (chunks === 0 || last.length > 8000) {
    props.setProperty("dauIds:" + day + ":" + chunks, hash + ",");
    props.setProperty("dauChunks:" + day, String(chunks + 1));
  } else {
    props.setProperty("dauIds:" + day + ":" + (chunks - 1), last + hash + ",");
  }
}

/** Mails yesterday's daily active users with a 14-day trend, then forgets yesterday's hashes. */
function sendDailyActiveReport() {
  var props = PropertiesService.getScriptProperties();
  var recipient = props.getProperty("MAIL_TO");
  if (!recipient) return;
  var yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  var tally = JSON.parse(props.getProperty("dauTally:" + yesterday) || "{}");
  var active = tally.active || 0;
  var fresh = tally.fresh || 0;
  var history = JSON.parse(props.getProperty("dauHistory") || "[]").filter(function (row) {
    return row.day !== yesterday;
  });
  history.push({ day: yesterday, active: active, fresh: fresh });
  history.sort(function (a, b) {
    return a.day < b.day ? -1 : 1;
  });
  history = history.slice(-60);
  props.setProperty("dauHistory", JSON.stringify(history));

  var recent = history.slice(-14);
  var before = history.length > 1 ? history[history.length - 2] : null;
  var week = history.slice(-7);
  var weekAverage = week.reduce(function (sum, row) { return sum + row.active; }, 0) / week.length;
  var change = before ? active - before.active : null;
  var lines = [
    "Sahkarmi daily active users for " + yesterday,
    "",
    "Active installations: " + active,
    "New installations: " + fresh,
    "Returning installations: " + (active - fresh),
    "Change from the day before: " +
      (change === null ? "no earlier day yet" : (change >= 0 ? "+" : "") + change),
    "7-day average: " + weekAverage.toFixed(1),
    "",
    "Versions: " + describeCounts(tally.versions),
    "How installed: " + describeCounts(tally.channels),
    "Countries (estimate from time zone): " + describeCounts(tally.countries),
    "",
    "Trend (day | active | new | returning):",
  ];
  for (var i = 0; i < recent.length; i += 1) {
    lines.push(
      recent[i].day + " | " + recent[i].active + " | " + recent[i].fresh + " | " +
        (recent[i].active - recent[i].fresh),
    );
  }
  lines.push(
    "",
    "Each copy of Sahkarmi that was opened that day counts once, wherever it was downloaded " +
      "(website, GitHub, winget, Scoop, Microsoft Store). Copies whose owner switched the count off " +
      "in Settings > About, and versions before 0.26.0, are not included. No name, IP address, " +
      "chat or file is collected; only a short hash of a random per-copy ID is kept, for one day.",
  );
  MailApp.sendEmail({
    to: recipient,
    subject:
      "Sahkarmi daily active users " + yesterday + ": " + active + " (" + fresh + " new, " +
      (active - fresh) + " returning)",
    body: lines.join("\n"),
    htmlBody: renderActiveHtml(yesterday, active, fresh, change, weekAverage, tally, recent),
    name: "Sahkarmi Downloads",
  });

  // Forget the reported day and anything older.
  var keys = props.getKeys();
  for (var k = 0; k < keys.length; k += 1) {
    var match = /^dau(?:Ids|Chunks|Tally):(\d{4}-\d{2}-\d{2})/.exec(keys[k]);
    if (match && match[1] <= yesterday) props.deleteProperty(keys[k]);
  }
}

function describeCounts(counts) {
  if (!counts) return "none";
  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .map(function (key) { return key + " " + counts[key]; })
    .join(", ");
}

function renderActiveHtml(day, active, fresh, change, weekAverage, tally, recent) {
  var max = recent.reduce(function (top, row) { return Math.max(top, row.active); }, 1);
  var row = function (label, value) {
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666">' +
      escapeHtml(label) + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee">' +
      escapeHtml(String(value)) + "</td></tr>";
  };
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d1d1f">' +
    "<p><b>Sahkarmi daily active users for " + escapeHtml(day) + "</b></p>" +
    '<table cellpadding="0" style="border-collapse:collapse;margin-bottom:12px">' +
    row("Active installations", active) +
    row("New", fresh) +
    row("Returning", active - fresh) +
    row("Change from the day before",
      change === null ? "no earlier day yet" : (change >= 0 ? "+" : "") + change) +
    row("7-day average", weekAverage.toFixed(1)) +
    row("Versions", describeCounts(tally.versions)) +
    row("How installed", describeCounts(tally.channels)) +
    row("Countries (estimate)", describeCounts(tally.countries)) +
    "</table><p><b>Last 14 days</b> (bar = active, darker part = new)</p>" +
    '<table cellpadding="0" style="border-collapse:collapse">';
  for (var i = 0; i < recent.length; i += 1) {
    var day14 = recent[i];
    var width = Math.max(Math.round((day14.active / max) * 220), 1);
    var freshWidth = day14.active ? Math.round((day14.fresh / day14.active) * width) : 0;
    html += '<tr><td style="padding:3px 10px 3px 0;color:#666">' + escapeHtml(day14.day) + "</td>" +
      '<td style="padding:3px 0"><span style="display:inline-block;height:12px;width:' + freshWidth +
      'px;background:#c2561a"></span><span style="display:inline-block;height:12px;width:' +
      (width - freshWidth) + 'px;background:#f0a46b"></span></td>' +
      '<td style="padding:3px 0 3px 8px">' + day14.active + " (" + day14.fresh + " new)</td></tr>";
  }
  return html + "</table>" +
    '<p style="color:#666;font-size:12px">Each copy of Sahkarmi opened that day counts once, ' +
    "wherever it was downloaded. Copies with the count switched off in Settings &gt; About and " +
    "versions before 0.26.0 are not included. No name, IP address, chat or file is collected.</p></div>";
}

function appendDigestLine(props, day, click) {
  var key = "lines:" + day;
  var lines = props.getProperty(key) || "";
  // Script properties hold up to 9 KB per value; keep the newest lines within that.
  var line =
    [
      Utilities.formatDate(click.time, Session.getScriptTimeZone(), "HH:mm"),
      click.version,
      click.os,
      click.browser,
      click.country || click.timeZone,
      shortSource(click),
    ].join(" | ") + "\n";
  lines = (lines + line).slice(-8000);
  props.setProperty(key, lines);
}

function shortSource(click) {
  if (click.utm) return click.utm;
  if (!click.referrer) return "direct";
  return click.referrer.replace(/^https?:\/\//, "").split("/")[0];
}

function renderText(click, total) {
  return [
    "Someone clicked Download on sahkarmi.site.",
    "",
    "Time: " + click.time.toISOString() + " (" + Session.getScriptTimeZone() + " " +
      Utilities.formatDate(click.time, Session.getScriptTimeZone(), "dd MMM yyyy HH:mm:ss") + ")",
    "Installer: " + click.file,
    "App version: " + click.version,
    "Operating system (estimate): " + click.os,
    "Browser (estimate): " + click.browser,
    "Device: " + click.device,
    "Country (estimate from time zone): " + (click.country || "unknown"),
    "Time zone: " + click.timeZone,
    "Page language: " + click.pageLanguage,
    "Browser languages: " + click.browserLanguages,
    "Screen: " + click.screen,
    "Came from: " + (click.referrer || "direct / unknown"),
    "Campaign (UTM): " + (click.utm || "none"),
    "Page and button: " + click.page + " · " + click.button,
    "User agent: " + click.userAgent,
    "",
    "Clicks today: " + total,
    "Status: download started from the website. Browsers do not report whether a download " +
      "finished; GitHub's per-file counts on the Releases page are the reference total.",
    "No IP address, cookie or visitor ID is collected.",
  ].join("\n");
}

function renderHtml(click, total) {
  var rows = [
    ["Time", Utilities.formatDate(click.time, Session.getScriptTimeZone(), "dd MMM yyyy HH:mm:ss") +
      " (" + Session.getScriptTimeZone() + ")"],
    ["Installer", click.file],
    ["App version", click.version],
    ["Operating system", click.os + " (estimate)"],
    ["Browser", click.browser + " (estimate)"],
    ["Device", click.device],
    ["Country", (click.country || "unknown") + " (estimate from time zone)"],
    ["Time zone", click.timeZone],
    ["Page language", click.pageLanguage],
    ["Browser languages", click.browserLanguages],
    ["Screen", click.screen],
    ["Came from", click.referrer || "direct / unknown"],
    ["Campaign (UTM)", click.utm || "none"],
    ["Page and button", click.page + " · " + click.button],
    ["User agent", click.userAgent],
    ["Clicks today", String(total)],
  ];
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d1d1f">' +
    "<p><b>Someone clicked Download on sahkarmi.site.</b></p>" +
    '<table cellpadding="6" style="border-collapse:collapse">';
  for (var i = 0; i < rows.length; i += 1) {
    html += '<tr><td style="color:#666;vertical-align:top">' + escapeHtml(rows[i][0]) +
      '</td><td style="word-break:break-word">' + escapeHtml(rows[i][1]) + "</td></tr>";
  }
  return html + "</table>" +
    '<p style="color:#666;font-size:12px">Status: download started from the website. Browsers ' +
    "do not report whether a download finished; GitHub's per-file counts on the Releases page are " +
    "the reference total. No IP address, cookie or visitor ID is collected.</p></div>";
}

function clean(value, max) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dayKey(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/** Country estimate from the browser's IANA time zone. Unknown zones return "". */
function countryFromTimeZone(zone) {
  var map = {
    "Asia/Kolkata": "India", "Asia/Calcutta": "India",
    "Asia/Dhaka": "Bangladesh", "Asia/Kathmandu": "Nepal", "Asia/Katmandu": "Nepal",
    "Asia/Colombo": "Sri Lanka", "Asia/Karachi": "Pakistan", "Asia/Thimphu": "Bhutan",
    "Indian/Maldives": "Maldives", "Asia/Kabul": "Afghanistan", "Asia/Yangon": "Myanmar",
    "Asia/Dubai": "United Arab Emirates", "Asia/Muscat": "Oman", "Asia/Qatar": "Qatar",
    "Asia/Riyadh": "Saudi Arabia", "Asia/Kuwait": "Kuwait", "Asia/Bahrain": "Bahrain",
    "Asia/Tehran": "Iran", "Asia/Baghdad": "Iraq", "Asia/Jerusalem": "Israel",
    "Asia/Singapore": "Singapore", "Asia/Kuala_Lumpur": "Malaysia", "Asia/Bangkok": "Thailand",
    "Asia/Jakarta": "Indonesia", "Asia/Manila": "Philippines", "Asia/Ho_Chi_Minh": "Vietnam",
    "Asia/Saigon": "Vietnam", "Asia/Hong_Kong": "Hong Kong", "Asia/Shanghai": "China",
    "Asia/Taipei": "Taiwan", "Asia/Tokyo": "Japan", "Asia/Seoul": "South Korea",
    "Australia/Sydney": "Australia", "Australia/Melbourne": "Australia",
    "Australia/Brisbane": "Australia", "Australia/Perth": "Australia",
    "Australia/Adelaide": "Australia", "Pacific/Auckland": "New Zealand",
    "Europe/London": "United Kingdom", "Europe/Dublin": "Ireland", "Europe/Paris": "France",
    "Europe/Berlin": "Germany", "Europe/Madrid": "Spain", "Europe/Rome": "Italy",
    "Europe/Amsterdam": "Netherlands", "Europe/Brussels": "Belgium", "Europe/Zurich": "Switzerland",
    "Europe/Vienna": "Austria", "Europe/Stockholm": "Sweden", "Europe/Oslo": "Norway",
    "Europe/Copenhagen": "Denmark", "Europe/Helsinki": "Finland", "Europe/Warsaw": "Poland",
    "Europe/Prague": "Czechia", "Europe/Lisbon": "Portugal", "Europe/Athens": "Greece",
    "Europe/Istanbul": "Turkey", "Europe/Kiev": "Ukraine", "Europe/Kyiv": "Ukraine",
    "Europe/Moscow": "Russia", "Europe/Bucharest": "Romania", "Europe/Budapest": "Hungary",
    "Africa/Cairo": "Egypt", "Africa/Lagos": "Nigeria", "Africa/Nairobi": "Kenya",
    "Africa/Johannesburg": "South Africa", "Africa/Casablanca": "Morocco",
    "America/New_York": "United States", "America/Chicago": "United States",
    "America/Denver": "United States", "America/Phoenix": "United States",
    "America/Los_Angeles": "United States", "America/Anchorage": "United States",
    "Pacific/Honolulu": "United States", "America/Detroit": "United States",
    "America/Toronto": "Canada", "America/Vancouver": "Canada", "America/Edmonton": "Canada",
    "America/Winnipeg": "Canada", "America/Halifax": "Canada", "America/Mexico_City": "Mexico",
    "America/Sao_Paulo": "Brazil", "America/Argentina/Buenos_Aires": "Argentina",
    "America/Bogota": "Colombia", "America/Lima": "Peru", "America/Santiago": "Chile",
  };
  return map[zone] || "";
}
