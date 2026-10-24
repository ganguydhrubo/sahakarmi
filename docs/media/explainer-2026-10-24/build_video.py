"""Assembles the explainer videos (en, hi) from the raw app recording, the website recording,
title/outro cards, the narration clips and the synthesised music bed.

Per scene: the footage segment is cut from raw-app.mp4 using markers.json, then trimmed or
held on its last frame to match the narration length (+0.6 s of air). Captions are burnt in
with drawtext (Mukta, SIL OFL) and SRT subtitles are written separately. The music bed sits
under the narration with sidechain ducking. Nothing is sped up: the long free-model wait in the
"message" scene is cut with an on-screen note that says so."""
import json, os, subprocess, sys, shutil
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
V = r"C:\Users\Dhrubo\AppData\Local\Temp\claude\C--Users-Dhrubo\fd793a78-1168-4dff-855b-c0e6a3799894\scratchpad\video"
FONT_REG = os.path.join(V, "fonts", "Mukta-Bold.ttf").replace("\\", "/").replace(":", "\:")
scenes = json.load(open(os.path.join(V, "scripts.json"), encoding="utf-8"))["scenes"]
durations = json.load(open(os.path.join(V, "audio", "durations.json")))
markers = {m["scene"]: m["t"] for m in json.load(open(os.path.join(V, "markers.json")))}
RAW = os.path.join(V, "raw-app.mp4")
WEB = os.path.join(V, "raw-web.mp4")
AIR = 0.7

def run(args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:]); raise SystemExit("ffmpeg failed: " + " ".join(args[:6]))

# The app footage is assembled from CDP frame captures (frames.txt lists each frame with its
# real duration), normalised to 1920x1080 at 30 fps.
if not os.path.exists(RAW) or os.path.getmtime(RAW) < os.path.getmtime(os.path.join(V, "frames.txt")):
    run(["-f", "concat", "-safe", "0", "-i", os.path.join(V, "frames.txt"), "-vf",
         "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p",
         "-c:v", "libx264", "-preset", "medium", "-crf", "17", RAW])
    print("raw app footage built from frames")

def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).decode().strip())

def footage_window(fid):
    """(source, start, end) for a scene's footage from the markers."""
    if fid == "setup": return RAW, markers["setup"], markers["whatsnew"]
    if fid == "team": return RAW, markers["team"], markers["message"]
    if fid == "message":
        # typing + send, then a visible cut to the reply (the free-model wait is cut, and said so)
        return RAW, markers["message"], markers["message-sent"] + 2.5
    if fid == "search": return RAW, markers["search"], markers["browser"]
    if fid == "browser": return RAW, markers["browser"], markers["approvals"]
    if fid == "approvals": return RAW, markers["approvals"], markers["providers"]
    if fid == "providers": return RAW, markers["providers"], markers["end"]
    if fid == "website": return WEB, 0, dur(WEB)
    raise KeyError(fid)

def escape(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")

def caption_filter(text):
    t = escape(text)
    return (f"drawtext=fontfile='{FONT_REG}':text='{t}':fontsize=40:fontcolor=white:"
            f"box=1:boxcolor=0x0F1220@0.72:boxborderw=18:x=(w-text_w)/2:y=h-120")

def build(lang):
    out_dir = os.path.join(V, "out"); os.makedirs(out_dir, exist_ok=True)
    parts, srt, t_cursor = [], [], 0.0
    for idx, sc in enumerate(scenes):
        sid, fid = sc["id"], sc["footage"]
        narration = os.path.join(V, "audio", f"{sid}-{lang}.wav")
        target = durations[f"{sid}-{lang}"] + AIR
        seg = os.path.join(V, "scenes", f"{sid}-{lang}.mp4")
        cap = caption_filter(sc[f"caption_{lang}"])
        if fid in ("title", "outro"):
            card = os.path.join(V, f"card-{'intro' if fid == 'title' else 'outro'}-{lang}.png")
            run(["-loop", "1", "-framerate", "30", "-t", f"{target:.2f}", "-i", card, "-i", narration,
                 "-vf", f"scale=1920:1080,fade=t=in:d=0.6,fade=t=out:st={target-0.6:.2f}:d=0.6,format=yuv420p",
                 "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-shortest", seg])
        else:
            src, start, end = footage_window(fid)
            avail = end - start
            if fid == "message":
                # part A: typing and send; part B: the reply, cut from after the rotation note
                a_len = min(avail, max(target - 6.0, 4.0))
                b_start = markers["message-replied"] - 1.0
                b_len = target - a_len
                note = escape("Cut: the first free model was at its limit; Sahkarmi moved to the next one by itself" if lang == "en" else "कट: पहला मुफ़्त मॉडल सीमा पर था; सहकर्मी ख़ुद अगले मॉडल पर चला गया")
                pa = seg + ".a.mp4"; pb = seg + ".b.mp4"
                run(["-ss", f"{start:.2f}", "-t", f"{a_len:.2f}", "-i", src, "-vf", f"{cap},format=yuv420p", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", pa])
                run(["-ss", f"{b_start:.2f}", "-t", f"{b_len:.2f}", "-i", src, "-vf",
                     f"{cap},drawtext=fontfile='{FONT_REG}':text='{note}':fontsize=30:fontcolor=white:box=1:boxcolor=0xC0392B@0.8:boxborderw=14:x=(w-text_w)/2:y=40:enable='lt(t,4)',format=yuv420p",
                     "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", pb])
                lst = seg + ".txt"
                open(lst, "w").write(f"file '{pa}'\nfile '{pb}'\n")
                vid = seg + ".v.mp4"
                run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", vid])
            else:
                vid = seg + ".v.mp4"
                if avail >= target:
                    run(["-ss", f"{start:.2f}", "-t", f"{target:.2f}", "-i", src, "-vf", f"{cap},format=yuv420p", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", vid])
                else:
                    hold = target - avail
                    run(["-ss", f"{start:.2f}", "-t", f"{avail:.2f}", "-i", src, "-vf", f"tpad=stop_mode=clone:stop_duration={hold:.2f},{cap},format=yuv420p", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", vid])
            run(["-i", vid, "-i", narration, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", seg])
        d = dur(seg)
        srt.append((t_cursor, t_cursor + durations[f"{sid}-{lang}"], sc[lang]))
        t_cursor += d
        parts.append(seg)
    lst = os.path.join(V, "scenes", f"all-{lang}.txt")
    open(lst, "w", encoding="utf-8").write("".join(f"file '{p}'\n" for p in parts))
    joined = os.path.join(V, "scenes", f"joined-{lang}.mp4")
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined])
    total = dur(joined)
    final = os.path.join(out_dir, f"sahkarmi-explainer-{lang}.mp4")
    music = os.path.join(V, "audio", "music-bed.wav")
    run(["-i", joined, "-i", music, "-filter_complex",
         f"[1:a]atrim=0:{total:.2f},afade=t=out:st={max(total-5,0):.2f}:d=5,volume=0.22[m];"
         f"[m][0:a]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=600[duck];"
         f"[0:a][duck]amix=inputs=2:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final])
    def ts(s):
        h = int(s // 3600); m = int(s % 3600 // 60); sec = s % 60
        return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
    with open(os.path.join(out_dir, f"sahkarmi-explainer-{lang}.srt"), "w", encoding="utf-8") as f:
        for i, (a, b, text) in enumerate(srt, 1):
            f.write(f"{i}\n{ts(a)} --> {ts(b)}\n{text}\n\n")
    print(lang, "final", final, round(total, 1), "s")

for lang in sys.argv[1:] or ["en", "hi"]:
    build(lang)
