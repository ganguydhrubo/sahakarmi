"""Captures the app's own rendered frames over CDP (works while the window is covered; never
sees anything outside the app) while driving a scripted first-run flow. A synthetic cursor is
drawn at the driver's pointer position. Frames + timestamps are assembled with ffmpeg."""
import io, json, os, sys, threading, time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
V = r"C:\Users\Dhrubo\AppData\Local\Temp\claude\C--Users-Dhrubo\fd793a78-1168-4dff-855b-c0e6a3799894\scratchpad\video"
FR = os.path.join(V, "frames"); os.makedirs(FR, exist_ok=True)
for f in os.listdir(FR): os.remove(os.path.join(FR, f))
PORT = "9477"
state = {"ptr": (760.0, 430.0), "run": True, "scale": 1.25, "frames": [], "t0": time.time(), "markers": []}

def mark(name):
    state["markers"].append({"scene": name, "t": round(time.time() - state["t0"], 2)}); print(f"[{state['markers'][-1]['t']:6.1f}] {name}", flush=True)

def draw_cursor(img, x, y):
    d = ImageDraw.Draw(img)
    pts = [(x, y), (x, y + 24), (x + 6, y + 19), (x + 10, y + 28), (x + 14, y + 26), (x + 10, y + 17), (x + 17, y + 17)]
    d.polygon(pts, fill=(15, 18, 32), outline=(255, 255, 255))
    return img

def capture_loop(_unused):
    # Own Playwright instance and CDP connection: the sync API is bound to one thread.
    i = 0
    with sync_playwright() as p2:
        b2 = p2.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
        page = [pg for pg in b2.contexts[0].pages if pg.url.startswith("sahkarmi-app")][0]
        while state["run"]:
            try:
                png = page.screenshot(type="jpeg", quality=88)
            except Exception:
                time.sleep(0.05); continue
            t = time.time() - state["t0"]
            img = Image.open(io.BytesIO(png)).convert("RGB")
            px, py = state["ptr"]; s = state["scale"]
            draw_cursor(img, int(px * s), int(py * s))
            path = os.path.join(FR, f"f{i:06d}.jpg"); img.save(path, quality=90)
            state["frames"].append((t, path)); i += 1
        b2.close()

def _old_capture_loop(page):
    i = 0
    while state["run"]:
        try:
            png = page.screenshot(type="jpeg", quality=88)
        except Exception:
            time.sleep(0.05); continue
        t = time.time() - state["t0"]
        img = Image.open(io.BytesIO(png)).convert("RGB")
        px, py = state["ptr"]; s = state["scale"]
        draw_cursor(img, int(px * s), int(py * s))
        path = os.path.join(FR, f"f{i:06d}.jpg"); img.save(path, quality=90)
        state["frames"].append((t, path)); i += 1

def glide(page, loc, hold=0.5, steps=16):
    box = loc.bounding_box()
    if not box: return
    tx, ty = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    sx, sy = state["ptr"]
    for k in range(1, steps + 1):
        e = k / steps; e = e * e * (3 - 2 * e)
        state["ptr"] = (sx + (tx - sx) * e, sy + (ty - sy) * e); time.sleep(0.03)
    time.sleep(hold)

def click(page, name, hold=0.5):
    loc = page.get_by_role("button", name=name).first
    glide(page, loc, hold); loc.click(); time.sleep(0.4)

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
    page = [pg for pg in b.contexts[0].pages if pg.url.startswith("sahkarmi-app")][0]
    w, h = page.evaluate("() => [window.innerWidth, window.innerHeight]")
    dpr = page.evaluate("() => window.devicePixelRatio"); state["scale"] = dpr
    print("viewport", w, h, "dpr", dpr, flush=True)
    th = threading.Thread(target=capture_loop, args=(page,), daemon=True); th.start()
    try:
        time.sleep(1.0); mark("setup")
        page.get_by_text("OpenCode (free, built in)").wait_for(timeout=60000); time.sleep(3.0)
        glide(page, page.get_by_text("OpenCode (free, built in)").first, 0.8)
        click(page, "Continue with OpenCode (free)"); time.sleep(3.5)
        mark("whatsnew"); time.sleep(2.5)
        if page.get_by_role("button", name="Got it").count() > 0: click(page, "Got it")
        time.sleep(0.8); mark("team")
        for name in ["Asha, Accounts, Free hai", "Meera, Support, Free hai", "Arjun, Research, Free hai", "Kabir, Security, Free hai"]:
            glide(page, page.get_by_role("button", name=name).first, 0.9)
        click(page, "Asha, Accounts, Free hai"); time.sleep(1.5)
        mark("message")
        click(page, "Vikram, Sales, Free hai"); time.sleep(0.8)
        editor = page.locator("[contenteditable], textarea").first
        glide(page, editor, 0.3); editor.click()
        page.keyboard.type("Vikram, draft a short, polite WhatsApp follow-up in English for a wholesale buyer who asked for our winter catalogue price list last week and has not replied. Keep it under 60 words.", delay=45)
        time.sleep(0.6); click(page, "Send message"); mark("message-sent")
        page.evaluate("""() => new Promise(r => { const t0 = Date.now(); const i = setInterval(() => { const t = document.body.innerText; const seg = t.slice(t.indexOf('Browser')).split('Message Vikram')[0]; const after = seg.split('under 60 words.').slice(-1)[0] || ''; const done = after.length > 150 && !/chal raha|Request par|Soch-vichaar\\s*$/i.test(after.slice(-120)) && /Vikram|regards|follow/i.test(after); if (done || Date.now()-t0 > 240000) { clearInterval(i); r(true); } }, 1000); })""")
        mark("message-replied"); time.sleep(5)
        mark("search"); page.keyboard.press("Control+k"); time.sleep(1.0)
        page.keyboard.type("catalogue", delay=90); time.sleep(2.5); page.keyboard.press("Escape"); time.sleep(0.6)
        mark("browser"); click(page, "Show browser"); time.sleep(5.0)
        glide(page, page.get_by_role("button", name="Take over").first, 1.5)
        click(page, "Hide browser"); time.sleep(0.6)
        mark("approvals"); click(page, "Approvals"); time.sleep(4)
        click(page, "Settings"); time.sleep(0.8)
        loc = page.get_by_text("Permissions", exact=True).first; glide(page, loc, 0.4); loc.click(); time.sleep(4)
        mark("providers")
        loc = page.get_by_text("AI and models", exact=True).first; glide(page, loc, 0.4); loc.click(); time.sleep(5.5)
        mark("end"); time.sleep(1.2)
    finally:
        state["run"] = False; th.join(timeout=5)
        b.close()
# write ffmpeg concat list with real frame durations
frames = state["frames"]
with open(os.path.join(V, "frames.txt"), "w", encoding="utf-8") as f:
    for idx, (t, path) in enumerate(frames):
        nxt = frames[idx + 1][0] if idx + 1 < len(frames) else t + 0.1
        f.write(f"file '{path}'\nduration {max(nxt - t, 0.01):.4f}\n")
    f.write(f"file '{frames[-1][1]}'\n")
json.dump(state["markers"], open(os.path.join(V, "markers.json"), "w"), indent=1)
print("frames", len(frames), "over", round(frames[-1][0], 1), "s; avg fps", round(len(frames) / frames[-1][0], 1))
