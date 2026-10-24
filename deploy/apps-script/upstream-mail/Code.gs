/**
 * Sahkarmi Upstream Radar — mail relay.
 *
 * Deployed as a Google Apps Script web app in the sender's Google account
 * (Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone).
 * The GitHub Actions workflow POSTs JSON {token, subject, text, html}; this script sends the
 * mail from the account that owns the script to RECIPIENT. The token must match the GitHub
 * secret UPSTREAM_MAIL_TOKEN; set it under Project Settings → Script properties as MAIL_TOKEN,
 * and the recipient as MAIL_TO.
 */

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty("MAIL_TOKEN");
  var recipient = props.getProperty("MAIL_TO");
  var out = function (body, code) {
    return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
      ContentService.MimeType.JSON,
    );
  };
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return out({ ok: false, error: "bad json" });
  }
  if (!expected || !recipient) return out({ ok: false, error: "relay not configured" });
  if (!payload.token || payload.token !== expected) return out({ ok: false, error: "forbidden" });
  var subject = String(payload.subject || "").slice(0, 200);
  if (!subject) return out({ ok: false, error: "subject required" });
  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: String(payload.text || ""),
      htmlBody: payload.html ? String(payload.html) : undefined,
      name: "Sahkarmi Upstream Radar",
    });
    return out({ ok: true, remainingDailyQuota: MailApp.getRemainingDailyQuota() });
  } catch (error) {
    return out({ ok: false, error: String(error) });
  }
}

/** GET shows that the relay is alive without sending anything. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "sahkarmi-upstream-mail", method: "POST only" }),
  ).setMimeType(ContentService.MimeType.JSON);
}
