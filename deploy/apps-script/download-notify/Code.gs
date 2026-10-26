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

/** Run once from the editor: schedules sendDailyDigest every day around 23:30. */
function installDigestTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === "sendDailyDigest") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("sendDailyDigest").timeBased().everyDays(1).atHour(23).nearMinute(30).create();
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
