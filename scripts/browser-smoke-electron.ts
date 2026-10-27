import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, webContents } from "electron";
import { BrowserHost } from "../src/backend/browser-host";

let cachedPageVersion = 1;
let savedDraft = "none";
const pageLoads = new Map<string, number>();

/**
 * A grid that takes input the way Google Sheets does: keys go to a hidden editable frame, a cell
 * starts editing only on a real key press (inserted text alone is thrown away), Tab and Enter
 * save the cell and move, and a paste of tab-separated lines fills rows and columns.
 */
const SHEET_PAGE = `<!doctype html>
  <style>td { border: 1px solid #999; width: 60px; height: 20px }</style>
  <table><tbody id="grid"></tbody></table>
  <iframe id="sink" style="position:absolute; left:-1000px; width:10px; height:10px"
    srcdoc="<body contenteditable='true'></body>"></iframe>
  <svg role="button" aria-label="Menu" width="20" height="20"
    onclick="cells.MENU = 'open'; show()"><rect width="20" height="20"></rect></svg>
  <output id="cells">{}</output>
  <script>
    const cells = {};
    let row = 0, col = 0, startCol = 0, editing = false;
    const frame = document.getElementById('sink');
    const sink = () => frame.contentDocument.body;
    const name = (r, c) => String.fromCharCode(65 + c) + (r + 1);
    const show = () => { document.getElementById('cells').textContent = JSON.stringify(cells); };
    const focusSink = () => { frame.contentWindow.focus(); sink().focus(); };
    const commit = () => {
      if (editing) { cells[name(row, col)] = sink().textContent; editing = false; show(); }
      sink().textContent = '';
    };
    for (let r = 0; r < 6; r += 1) {
      const tr = document.getElementById('grid').insertRow();
      for (let c = 0; c < 4; c += 1) {
        const td = tr.insertCell();
        td.setAttribute('role', 'gridcell');
        td.setAttribute('aria-label', 'Cell ' + name(r, c));
        td.addEventListener('mousedown', (event) => {
          event.preventDefault();
          row = r; col = c; startCol = c; editing = false;
          focusSink();
        });
      }
    }
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      doc.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') { event.preventDefault(); commit(); col += 1; return; }
        if (event.key === 'Enter') { event.preventDefault(); commit(); row += 1; col = startCol; return; }
        if (event.key.length === 1 && !event.ctrlKey && !editing) { editing = true; sink().textContent = ''; }
      });
      doc.addEventListener('input', () => { if (!editing) sink().textContent = ''; });
      doc.addEventListener('paste', (event) => {
        event.preventDefault();
        event.clipboardData.getData('text/plain').split(/\\r?\\n/).forEach((line, i) =>
          line.split('\\t').forEach((value, j) => { cells[name(row + i, col + j)] = value; }));
        show();
      });
      focusSink();
    });
  </script>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/sheet") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(SHEET_PAGE);
    return;
  }
  if (url.pathname === "/cached") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    });
    response.end(`<main>version:${cachedPageVersion}</main>`);
    return;
  }
  if (url.pathname === "/download") {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="sahkarmi-smoke.txt"',
    });
    response.end("local download");
    return;
  }
  if (url.pathname === "/cookie") {
    if (url.searchParams.has("set")) response.setHeader("set-cookie", "sahkarmi=shared; Path=/");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<main>cookie:${request.headers.cookie ?? "none"}</main>`);
    return;
  }
  if (url.pathname === "/headers") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const requestHeaders = JSON.stringify(request.headers).replaceAll("<", "\\u003c");
    response.end(`<main></main><script>
      document.querySelector("main").textContent = JSON.stringify({
        requestHeaders: ${requestHeaders},
        navigatorUserAgent: navigator.userAgent,
        navigatorBrands: navigator.userAgentData?.brands ?? [],
      });
    </script>`);
    return;
  }
  if (url.pathname === "/upload") {
    // Like Facebook's "Photo/video": the button makes a hidden file input and clicks it.
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <button aria-label="Add photo" onclick="
        const input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';
        input.onchange = async () => {
          const file = input.files[0];
          document.querySelector('#picked').textContent = file.name + ':' + (await file.text());
        };
        document.body.append(input);
        input.click();
      ">Add photo</button>
      <input aria-label="Attach file" type="file" multiple onchange="document.querySelector('#direct').textContent = [...this.files].map((f) => f.name).join(',')" />
      <button aria-label="Nothing">Nothing</button>
      <output id="picked">none</output><output id="direct">none</output>`);
    return;
  }
  if (url.pathname === "/draft") {
    // Like a report site: what one tab saves, another tab only shows after a reload.
    if (url.searchParams.has("save")) {
      savedDraft = url.searchParams.get("save") ?? "";
      response.end("saved");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <input aria-label="Draft" />
      <button aria-label="Save draft" onclick="fetch('/draft?save=' + encodeURIComponent(document.querySelector('input').value))">Save draft</button>
      <main>draft:${savedDraft}</main>`);
    return;
  }
  if (url.pathname === "/gone" || url.pathname === "/notes") {
    // Counts loads, so a test can tell whether a tab was reloaded.
    pageLoads.set(url.pathname, (pageLoads.get(url.pathname) ?? 0) + 1);
    response.statusCode = url.pathname === "/gone" ? 404 : 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><input aria-label="Notes" /><main>${url.pathname}</main>`);
    return;
  }
  if (url.pathname === "/abort") {
    response.destroy();
    return;
  }

  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html>
    <input aria-label="Task" oninput="this.dataset.trusted = String(event.isTrusted)" />
    <button aria-label="Save" onclick="document.querySelector('output').textContent = document.querySelector('input').value + '|input:' + document.querySelector('input').dataset.trusted + '|click:' + event.isTrusted">Save</button>
    <a href="/child" target="_blank">Child</a>
    <a href="/download" download>Download</a>
    <output>empty</output>`);
});

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sahkarmi-browser-smoke-"));
  app.setPath("userData", join(temporaryRoot, "user-data"));
  const hardTimeout = setTimeout(() => {
    process.stderr.write("BrowserHost smoke test timed out.\n");
    app.exit(1);
  }, 90_000);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local server did not start.");
    const origin = `http://127.0.0.1:${address.port}`;

    await app.whenReady();
    process.stdout.write("BrowserHost: Electron ready.\n");
    const window = new BrowserWindow({ show: false, opacity: 0 });
    window.show();
    window.focus();
    const downloadsRoot = join(temporaryRoot, "downloads");
    const statePath = join(temporaryRoot, "browser-tabs.json");
    const browser = new BrowserHost(window, downloadsRoot, statePath);

    const controlPhases: string[] = [];
    const controlledTabIds: Array<string | null> = [];
    browser.onControlChanged((state) => {
      const session = state.sessions.find((item) => item.turnId === "browser-smoke-turn");
      if (session) {
        controlPhases.push(`${session.action}:${session.phase}`);
        controlledTabIds.push(session.tabId);
      } else if (controlPhases.length > 0) controlPhases.push("ended");
    });

    const tab = await browser.open(origin, "smoke-thread", "smoke-bot");
    process.stdout.write("BrowserHost: local tab opened.\n");
    const first = await browser.snapshot(tab.id);
    const input = first.elements.find((element) => element.name === "Task");
    const save = first.elements.find((element) => element.name === "Save");
    if (!input || !save) throw new Error("Snapshot did not expose local controls.");

    const typed = await browser.act(tab.id, first.revision, {
      type: "type",
      ref: input.ref,
      text: "runs locally",
    });
    const currentSave = typed.elements.find((element) => element.name === "Save");
    if (!currentSave) throw new Error("Save control disappeared after typing.");
    await browser.act(tab.id, typed.revision, { type: "click", ref: currentSave.ref });
    const result = await browser.snapshot(tab.id);
    if (!result.text.includes("runs locally|input:true|click:true")) {
      throw new Error(`Browser input was not native: ${result.text}`);
    }
    process.stdout.write("BrowserHost: snapshot and actions passed.\n");

    const headerTab = await browser.open(`${origin}/headers`, "smoke-thread");
    const headerSnapshot = await browser.snapshot(headerTab.id);
    const identity = JSON.parse(headerSnapshot.text) as {
      requestHeaders: Record<string, string | undefined>;
      navigatorUserAgent: string;
      navigatorBrands: Array<{ brand: string; version: string }>;
    };
    const clientHintBrands = identity.requestHeaders["sec-ch-ua"] ?? "";
    if (
      headerSnapshot.text.includes("Electron/") ||
      headerSnapshot.text.includes("Sahkarmi/") ||
      identity.requestHeaders["user-agent"] !== identity.navigatorUserAgent ||
      (clientHintBrands.length > 0 &&
        identity.navigatorBrands.some(
          ({ brand, version }) => !clientHintBrands.includes(`"${brand}";v="${version}"`),
        ))
    ) {
      throw new Error(`Browser identity headers are invalid: ${headerSnapshot.text}`);
    }
    process.stdout.write("BrowserHost: matching Chromium page and request identity passed.\n");
    await expectFailure(() =>
      browser.act(tab.id, first.revision, { type: "click", ref: save.ref }),
    );

    const child = result.elements.find((element) => element.name === "Child");
    if (!child) throw new Error("Child-tab control is missing.");
    const childClick = await browser.act(tab.id, result.revision, {
      type: "click",
      ref: child.ref,
    });
    await waitForValue(() =>
      browser
        .listTabs()
        .find((candidate) => candidate.id !== tab.id && candidate.url.includes("/child")),
    );
    const childTab = browser
      .listTabs()
      .find((candidate) => candidate.id !== tab.id && candidate.url.includes("/child"));
    if (childTab?.ownerThreadId !== "smoke-thread" || childTab.ownerBotId !== "smoke-bot") {
      throw new Error("A target=_blank tab did not preserve agent ownership.");
    }
    // Naukri job titles open like this: the coworker must be told which tab to read.
    if (!childClick.notice?.includes(childTab.id)) {
      throw new Error(`A click that opened a tab did not say so: ${childClick.notice ?? "none"}`);
    }
    process.stdout.write("BrowserHost: child-tab ownership passed.\n");

    const screenshot = await browser.screenshot(tab.id);
    if (!screenshot.startsWith("data:image/png;base64,")) throw new Error("Screenshot failed.");
    process.stdout.write("BrowserHost: screenshot passed.\n");

    await browser.open(`${origin}/cookie?set=1`, "smoke-thread");
    const cookieTab = await browser.open(`${origin}/cookie`, "other-thread");
    const cookieSnapshot = await browser.snapshot(cookieTab.id);
    if (!cookieSnapshot.text.includes("sahkarmi=shared"))
      throw new Error("Cookies were not shared.");
    process.stdout.write("BrowserHost: shared cookies passed.\n");

    const firstCachedTab = await browser.open(`${origin}/cached`, "smoke-thread");
    const firstCachedSnapshot = await browser.snapshot(firstCachedTab.id);
    if (!firstCachedSnapshot.text.includes("version:1")) {
      throw new Error("Initial cached page did not load.");
    }
    cachedPageVersion = 2;
    const revalidatedTab = await browser.open(`${origin}/cached`, "smoke-thread");
    const revalidatedSnapshot = await browser.snapshot(revalidatedTab.id);
    if (!revalidatedSnapshot.text.includes("version:2")) {
      throw new Error("A new top-level navigation reused stale cached content.");
    }
    process.stdout.write("BrowserHost: top-level cache revalidation passed.\n");

    await expectFailure(() => browser.open("file:///etc/passwd"));
    const tabCountBeforeAbort = browser.listTabs().length;
    await expectFailure(() => browser.open(`${origin}/abort`));
    if (browser.listTabs().length !== tabCountBeforeAbort) {
      throw new Error("A failed navigation leaked a browser tab.");
    }

    const downloadPage = await browser.open(origin, "smoke-thread");
    const downloadSnapshot = await browser.snapshot(downloadPage.id);
    const download = downloadSnapshot.elements.find((element) => element.name === "Download");
    if (!download) throw new Error("Download link is missing.");
    await browser.act(downloadPage.id, downloadSnapshot.revision, {
      type: "click",
      ref: download.ref,
    });
    const downloadPath = join(downloadsRoot, "sahkarmi-smoke.txt");
    await waitFor(async () => (await readFile(downloadPath, "utf8")) === "local download");
    const nextDownloadSnapshot = await browser.snapshot(downloadPage.id);
    const nextDownload = nextDownloadSnapshot.elements.find(
      (element) => element.name === "Download",
    );
    if (!nextDownload) throw new Error("Download link disappeared.");
    await browser.act(downloadPage.id, nextDownloadSnapshot.revision, {
      type: "click",
      ref: nextDownload.ref,
    });
    await waitFor(
      async () =>
        (await readFile(join(downloadsRoot, "sahkarmi-smoke (2).txt"), "utf8")) ===
        "local download",
    );
    process.stdout.write("BrowserHost: download passed.\n");

    const uploadFile = join(temporaryRoot, "smoke-photo.txt");
    const uploadSecond = join(temporaryRoot, "smoke-second.txt");
    await writeFile(uploadFile, "photo bytes");
    await writeFile(uploadSecond, "second");
    const uploadPage = await browser.open(`${origin}/upload`, "smoke-thread");
    const uploadSnapshot = await browser.snapshot(uploadPage.id);
    const addPhoto = uploadSnapshot.elements.find((element) => element.name === "Add photo");
    if (!addPhoto) throw new Error("Add photo button is missing.");
    // A plain click on it must not open the Windows dialog; the coworker is told to upload.
    const afterClick = await browser.act(uploadPage.id, uploadSnapshot.revision, {
      type: "click",
      ref: addPhoto.ref,
    });
    if (!afterClick.notice?.includes('"type":"upload"')) {
      throw new Error("A click that opens the file picker gave no upload notice.");
    }
    const pickerSnapshot = await browser.snapshot(uploadPage.id);
    const addPhotoAgain = pickerSnapshot.elements.find((element) => element.name === "Add photo");
    if (!addPhotoAgain) throw new Error("Add photo button is missing.");
    const afterPicker = await browser.act(uploadPage.id, pickerSnapshot.revision, {
      type: "upload",
      ref: addPhotoAgain.ref,
      paths: [uploadFile],
    });
    await waitForValue(() =>
      afterPicker.text.includes("smoke-photo.txt:photo bytes") ? true : undefined,
    ).catch(async () => {
      const latest = await browser.snapshot(uploadPage.id);
      if (!latest.text.includes("smoke-photo.txt:photo bytes")) {
        throw new Error(`Upload through a file picker failed: ${latest.text}`);
      }
    });
    const attachSnapshot = await browser.snapshot(uploadPage.id);
    const attach = attachSnapshot.elements.find((element) => element.name === "Attach file");
    if (!attach) throw new Error("File input is missing.");
    const afterDirect = await browser.act(uploadPage.id, attachSnapshot.revision, {
      type: "upload",
      ref: attach.ref,
      paths: [uploadFile, uploadSecond],
    });
    if (!afterDirect.text.includes("smoke-photo.txt,smoke-second.txt")) {
      throw new Error(`Upload into a file input failed: ${afterDirect.text}`);
    }
    const nothing = afterDirect.elements.find((element) => element.name === "Nothing");
    if (!nothing) throw new Error("Plain button is missing.");
    await expectFailure(() =>
      browser.act(uploadPage.id, afterDirect.revision, {
        type: "upload",
        ref: nothing.ref,
        paths: [uploadFile],
      }),
    );
    process.stdout.write("BrowserHost: file upload passed.\n");

    // The owner looks at one tab of a site while a coworker saves in another tab of it. Shorter
    // waits than the app's, so the test is quick; the rules are the same.
    BrowserHost.STALE_REFRESH_MS = 1_500;
    BrowserHost.STALE_MIN_GAP_MS = 0;
    const ownerDraft = await browser.open(`${origin}/draft`, null);
    const coworkerDraft = await browser.open(`${origin}/draft`, "smoke-thread");
    await browser.setVisible({ visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    await browser.activate(ownerDraft.id);
    const saveDraft = async (text: string) => {
      const page = await browser.snapshot(coworkerDraft.id);
      const field = page.elements.find((element) => element.name === "Draft");
      if (!field) throw new Error("Draft field is missing.");
      const typedDraft = await browser.act(coworkerDraft.id, page.revision, {
        type: "type",
        ref: field.ref,
        text,
      });
      const button = typedDraft.elements.find((element) => element.name === "Save draft");
      if (!button) throw new Error("Save draft button is missing.");
      await browser.act(coworkerDraft.id, typedDraft.revision, { type: "click", ref: button.ref });
    };
    await saveDraft("first");
    await waitFor(async () => (await browser.snapshot(ownerDraft.id)).text.includes("draft:first"));
    // Once the owner types in their tab, it is never reloaded over their work.
    await saveDraft("second");
    const ownerContents = webContents
      .getAllWebContents()
      .filter((contents) => contents.getURL() === `${origin}/draft`)
      .sort((left, right) => left.id - right.id)[0];
    ownerContents?.sendInputEvent({ type: "keyDown", keyCode: "a" });
    await new Promise((resolve) => setTimeout(resolve, BrowserHost.STALE_REFRESH_MS + 1_000));
    const untouched = await browser.snapshot(ownerDraft.id);
    if (!untouched.text.includes("draft:first")) {
      throw new Error(`The owner's tab was reloaded over their typing: ${untouched.text}`);
    }

    // An error page is never reloaded, however often the coworker changes the site.
    const gone = await browser.open(`${origin}/gone`, null);
    await waitFor(async () => (pageLoads.get("/gone") ?? 0) === 1);
    await browser.activate(gone.id);
    await saveDraft("third");
    await new Promise((resolve) => setTimeout(resolve, BrowserHost.STALE_REFRESH_MS + 1_000));
    if (pageLoads.get("/gone") !== 1) throw new Error("An error page was reloaded.");

    // A tab a coworker typed in is not reloaded over its unsaved work.
    const notes = await browser.open(`${origin}/notes`, "smoke-thread");
    await waitFor(async () => (pageLoads.get("/notes") ?? 0) === 1);
    const notesPage = await browser.snapshot(notes.id);
    const notesField = notesPage.elements.find((element) => element.name === "Notes");
    if (!notesField) throw new Error("Notes field is missing.");
    await browser.act(notes.id, notesPage.revision, {
      type: "type",
      ref: notesField.ref,
      text: "half done",
    });
    await browser.activate(notes.id);
    await saveDraft("fourth");
    await new Promise((resolve) => setTimeout(resolve, BrowserHost.STALE_REFRESH_MS + 1_000));
    if (pageLoads.get("/notes") !== 1) throw new Error("A coworker's typing was reloaded away.");

    BrowserHost.STALE_REFRESH_MS = 5_000;
    BrowserHost.STALE_MIN_GAP_MS = 30_000;
    await browser.setVisible({ visible: false });
    for (const tab of [ownerDraft, coworkerDraft, gone, notes]) await browser.close(tab.id);
    process.stdout.write("BrowserHost: same-site tab refresh passed.\n");

    // A spreadsheet on a hidden panel, as when a coworker fills Google Sheets, while the owner
    // types in the app's own chat box: the coworker's page must never take the keyboard.
    const sheet = await browser.open(`${origin}/sheet`, "smoke-thread");
    const sheetCells = async (): Promise<Record<string, string>> => {
      const page = await browser.snapshot(sheet.id);
      return JSON.parse(/\{.*\}/.exec(page.text)?.[0] ?? "{}") as Record<string, string>;
    };
    const clickCell = async (cell: string): Promise<number> => {
      const page = await browser.snapshot(sheet.id);
      const target = page.elements.find((element) => element.name === `Cell ${cell}`);
      if (!target) throw new Error(`Sheet cell ${cell} was not in the snapshot.`);
      return (await browser.act(sheet.id, page.revision, { type: "click", ref: target.ref }))
        .revision;
    };
    await browser.act(sheet.id, await clickCell("A1"), {
      type: "type",
      text: "17-Oct\tFri\n19-Oct\tSun",
      // Like a person in Google Sheets: Enter saves the last cell.
      submit: true,
    });
    const typedCells = await sheetCells();
    if (
      typedCells.A1 !== "17-Oct" ||
      typedCells.B1 !== "Fri" ||
      typedCells.A2 !== "19-Oct" ||
      typedCells.B2 !== "Sun"
    ) {
      throw new Error(
        `Typing into the sheet did not fill its cells: ${JSON.stringify(typedCells)}`,
      );
    }
    const ownerClipboard = `owner clipboard ${Date.now()}`;
    clipboard.writeText(ownerClipboard);
    await browser.act(sheet.id, await clickCell("A3"), {
      type: "paste",
      text: "23-Oct\tThu\tपूरा\n24-Oct\tFri\tdone",
    });
    const pastedCells = await sheetCells();
    if (pastedCells.A3 !== "23-Oct" || pastedCells.C3 !== "पूरा" || pastedCells.C4 !== "done") {
      throw new Error(
        `Pasting into the sheet did not fill its cells: ${JSON.stringify(pastedCells)}`,
      );
    }
    if (clipboard.readText() !== ownerClipboard) {
      throw new Error("Pasting did not give the owner's clipboard back.");
    }
    await browser.act(sheet.id, await clickCell("D1"), { type: "type", text: "x" });
    await browser.act(sheet.id, (await browser.snapshot(sheet.id)).revision, {
      type: "key",
      key: "Shift+Tab",
    });
    if ((await sheetCells()).D1 !== "x") throw new Error("A key combo did not reach the sheet.");
    if (
      webContents
        .getAllWebContents()
        .some((page) => page.getURL().includes("/sheet") && page.isFocused())
    ) {
      throw new Error("A coworker's browser action took keyboard focus from the owner's chat box.");
    }
    // An icon button drawn as SVG (Instagram's menu, X's Post) is clickable.
    const menuPage = await browser.snapshot(sheet.id);
    const menu = menuPage.elements.find((element) => element.name === "Menu");
    if (!menu) throw new Error("The SVG menu button was not in the snapshot.");
    await browser.act(sheet.id, menuPage.revision, { type: "click", ref: menu.ref });
    if ((await sheetCells()).MENU !== "open")
      throw new Error("An SVG icon button could not be clicked.");
    const hiddenShot = await browser.screenshot(sheet.id);
    if (!hiddenShot.startsWith("data:image/png;base64,") || hiddenShot.length < 1_000) {
      throw new Error("A hidden tab could not be captured.");
    }
    await browser.close(sheet.id);
    process.stdout.write("BrowserHost: spreadsheet typing, paste and hidden screenshot passed.\n");

    const toolResult = await browser.handleDynamicTool({
      threadId: "smoke-thread",
      turnId: "browser-smoke-turn",
      callId: "browser-smoke-call",
      namespace: "sahkarmi_browser",
      tool: "open",
      arguments: { url: `${origin}/cookie` },
    });
    if (!toolResult.success) throw new Error("Dynamic browser tool failed.");
    if (!controlPhases.includes("open:acting") || !controlPhases.includes("open:waiting")) {
      throw new Error(`Browser control lifecycle was not reported: ${controlPhases.join(", ")}`);
    }
    if (!controlledTabIds.some(Boolean)) {
      throw new Error("Opening a page did not bind browser control to the new tab.");
    }
    await new Promise((resolve) => setTimeout(resolve, BrowserHost.CONTROL_IDLE_GRACE_MS + 100));
    if (browser.getControlState().sessions.length !== 0 || !controlPhases.includes("ended")) {
      throw new Error("Browser control indicator did not clear after the idle grace period.");
    }
    process.stdout.write("BrowserHost: agent control lifecycle passed.\n");

    const persistedTab = await browser.open(
      `${origin}/cookie`,
      "persisted-thread",
      "persisted-bot",
    );
    for (const path of ["/notes", "/draft", "/headers"]) {
      await browser.open(`${origin}${path}`, "other-thread");
    }
    const sleeper = await browser.open(`${origin}/cookie?later=1`, "sleep-thread");
    await browser.activate(persistedTab.id);
    const savedTabCount = browser.listTabs().length;
    await browser.destroy();
    const restoredWindow = new BrowserWindow({ show: false });
    window.destroy();
    BrowserHost.IDLE_SLEEP_MS = 2_000;
    BrowserHost.SLEEP_CHECK_MS = 250;
    const restoredBrowser = new BrowserHost(restoredWindow, downloadsRoot, statePath);
    await restoredBrowser.restore();
    const restoredActiveTabId = restoredBrowser.activeTabId;
    const liveTabs = (): number => restoredBrowser.liveTabCount;

    // Lazy restore: every saved tab is listed, but none loads until it is used.
    if (restoredBrowser.listTabs().length !== savedTabCount || liveTabs() !== 0) {
      throw new Error(`Restore loaded ${liveTabs()} of ${savedTabCount} tabs at start-up.`);
    }
    // A sleeping tab wakes for a coworker, still signed in (the shared cookie is sent).
    const woken = await restoredBrowser.snapshot(sleeper.id);
    if (!woken.text.includes("cookie:sahkarmi=shared") || liveTabs() !== 1) {
      throw new Error(`A restored tab did not wake signed in: ${woken.text.slice(0, 120)}`);
    }
    // Opening the same page again gives the coworker its tab back, not a duplicate.
    const again = await restoredBrowser.open(`${origin}/cookie?later=1`, "sleep-thread");
    if (again.id !== sleeper.id || restoredBrowser.listTabs().length !== savedTabCount) {
      throw new Error("Opening an open page made a duplicate tab.");
    }
    // An idle hidden tab sleeps: its page is freed, the tab and its address stay.
    await waitFor(async () => liveTabs() === 0);
    const asleep = restoredBrowser.listTabs().find((candidate) => candidate.id === sleeper.id);
    if (!asleep?.url.includes("/cookie?later=1") || asleep.loading) {
      throw new Error("A sleeping tab lost its address.");
    }
    const rewoken = await restoredBrowser.snapshot(sleeper.id);
    if (!rewoken.text.includes("cookie:sahkarmi=shared")) {
      throw new Error("A tab woken from sleep was signed out.");
    }
    process.stdout.write("BrowserHost: lazy restore, tab reuse and idle sleep passed.\n");
    const restoredTabs = restoredBrowser.listTabs();
    const restoredTab = restoredTabs.find((candidate) => candidate.id === persistedTab.id);
    if (
      restoredTab?.ownerThreadId !== "persisted-thread" ||
      restoredTab?.ownerBotId !== "persisted-bot" ||
      restoredActiveTabId !== persistedTab.id
    ) {
      throw new Error("Browser tabs did not survive a BrowserHost restart.");
    }
    process.stdout.write("BrowserHost: persisted tabs passed.\n");
    await restoredBrowser.destroy();
    const persistedState = JSON.parse(await readFile(statePath, "utf8")) as {
      tabs?: Array<{ id?: string; url?: string }>;
    };
    if (
      persistedState.tabs?.find((candidate) => candidate.id === persistedTab.id)?.url !==
      `${origin}/cookie`
    ) {
      throw new Error("An immediate shutdown lost a restored tab URL.");
    }
    restoredWindow.destroy();
    process.stdout.write("BrowserHost smoke test passed.\n");
  } finally {
    clearTimeout(hardTimeout);
    server.close();
    try {
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Windows file handle release delay
    }
    app.quit();
  }
}

async function expectFailure(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("Expected operation to fail.");
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // The download may not exist yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for a browser download.");
}

async function waitForValue<T>(check: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for a browser state change.");
}
