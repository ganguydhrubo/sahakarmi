// Sahkarmi video library: filters on the library page and a full-screen, swipeable player
// (like Reels) on every video page. Without JavaScript the cards simply open each watch page.
(() => {
  "use strict";
  const dataNode = document.getElementById("video-data");
  if (!dataNode) return;
  const films = JSON.parse(dataNode.textContent || "[]");
  if (!films.length) return;
  const byId = new Map(films.map((film, index) => [film.id, index]));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- filters (library page)
  const chips = [...document.querySelectorAll(".vchip")];
  const cards = [...document.querySelectorAll("#vgrid .vcard")];
  const empty = document.getElementById("vempty");
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter || "";
      for (const other of chips) other.setAttribute("aria-pressed", String(other === chip));
      let shown = 0;
      for (const card of cards) {
        const match = !filter || card.dataset.category === filter;
        card.hidden = !match;
        if (match) shown += 1;
      }
      if (empty) empty.hidden = shown > 0;
    });
  }

  // ---------------------------------------------------------------- the full-screen player
  const icon = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  };
  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html; // Only the fixed icons above, never film data.
    return node;
  };
  const button = (className, label, svg) => {
    const node = el("button", className, svg);
    node.type = "button";
    node.setAttribute("aria-label", label);
    node.title = label;
    return node;
  };

  let feed = null;
  let slides = [];
  let active = -1;
  let muted = false;
  let openedFrom = null;
  let pushed = false;
  let observer = null;
  const canFullscreen = Boolean(document.documentElement.requestFullscreen);

  function build() {
    feed = el("div", "vfeed");
    feed.setAttribute("role", "dialog");
    feed.setAttribute("aria-modal", "true");
    feed.setAttribute("aria-label", "Video player");
    const track = el("div", "vfeed-track");
    slides = films.map((film, index) => {
      const slide = el("section", "vslide");
      slide.dataset.index = String(index);
      slide.setAttribute("aria-label", film.title);
      const video = document.createElement("video");
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.preload = "none";
      video.poster = film.poster;
      video.dataset.src = film.src;
      video.disablePictureInPicture = true;
      const tap = el("div", "vtap");
      const big = el("span", "vbig", icon.play);
      tap.append(big);
      const info = el("div", "vinfo");
      const cat = el("span", "vinfo-cat");
      cat.textContent = `${film.category} · ${film.length}`;
      const title = el("a", "vinfo-title");
      title.textContent = film.title;
      title.href = film.page;
      const cta = el("a", "vinfo-cta");
      cta.textContent = "Get Sahkarmi free";
      cta.href = "/download.html";
      info.append(cat, title, cta);
      const bar = el("div", "vbar");
      const fill = el("span", "vbar-fill");
      bar.append(fill);
      bar.setAttribute("role", "slider");
      bar.setAttribute("aria-label", "Position in the film");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.tabIndex = 0;
      slide.append(video, tap, info, bar);
      track.append(slide);

      video.addEventListener("timeupdate", () => {
        const share = video.duration ? video.currentTime / video.duration : 0;
        fill.style.transform = `scaleX(${share})`;
        bar.setAttribute("aria-valuenow", String(Math.round(share * 100)));
      });
      video.addEventListener("play", () => slide.classList.remove("paused"));
      video.addEventListener("pause", () => slide.classList.add("paused"));
      video.addEventListener("waiting", () => slide.classList.add("loading"));
      video.addEventListener("playing", () => slide.classList.remove("loading"));
      video.addEventListener("ended", () => {
        if (index === active && index < slides.length - 1) go(index + 1);
      });
      tap.addEventListener("click", () => toggle(video));
      // Drag or tap on the bar to move through the film.
      const seek = (event) => {
        const box = bar.getBoundingClientRect();
        const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        if (video.duration) video.currentTime = share * video.duration;
      };
      bar.addEventListener("pointerdown", (event) => {
        bar.setPointerCapture(event.pointerId);
        seek(event);
        const move = (next) => seek(next);
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", () => bar.removeEventListener("pointermove", move), {
          once: true,
        });
      });
      bar.addEventListener("keydown", (event) => {
        if (!video.duration) return;
        if (event.key === "ArrowRight") video.currentTime = Math.min(video.duration, video.currentTime + 5);
        else if (event.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 5);
        else return;
        event.preventDefault();
        event.stopPropagation();
      });
      return { slide, video };
    });

    const tools = el("div", "vtools");
    const close = button("vtool vclose", "Close (Esc)", icon.close);
    const sound = button("vtool vsound", "Sound on or off (M)", icon.sound);
    const share = button("vtool vshare", "Share this film", icon.share);
    tools.append(close, sound, share);
    if (canFullscreen || HTMLVideoElement.prototype.webkitEnterFullscreen) {
      const full = button("vtool vfullscreen", "Full screen (F)", icon.full);
      full.addEventListener("click", fullscreen);
      tools.append(full);
    }
    const nav = el("div", "vnav");
    const prev = button("vtool", "Previous film", icon.up);
    const next = button("vtool", "Next film", icon.down);
    nav.append(prev, next);
    const hint = el("p", "vhint");
    hint.textContent = matchMedia("(hover: none)").matches
      ? "Swipe up for the next film"
      : "Scroll or press ↓ for the next film";
    feed.append(track, tools, nav, hint);
    document.body.append(feed);

    close.addEventListener("click", () => closePlayer());
    sound.addEventListener("click", () => setMuted(!muted));
    share.addEventListener("click", () => shareFilm());
    prev.addEventListener("click", () => go(active - 1));
    next.addEventListener("click", () => go(active + 1));
    feed.addEventListener("keydown", onKey);

    // The slide most on screen is the one that plays.
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            activate(Number(entry.target.dataset.index));
          }
        }
      },
      { root: track, threshold: [0.6] },
    );
    for (const { slide } of slides) observer.observe(slide);
  }

  function load(index, preload) {
    const item = slides[index];
    if (!item) return;
    const video = item.video;
    if (!video.getAttribute("src")) {
      video.preload = preload;
      video.src = video.dataset.src;
    } else if (preload === "auto") video.preload = "auto";
  }

  /** Far-away films give their memory back (phones keep only a few decoders). */
  function unload(index) {
    const video = slides[index]?.video;
    if (!video || !video.getAttribute("src")) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function activate(index) {
    if (index === active || !slides[index]) return;
    const before = slides[active];
    if (before) before.video.pause();
    active = index;
    load(index, "auto");
    load(index + 1, "metadata");
    for (let other = 0; other < slides.length; other += 1) {
      if (Math.abs(other - index) > 2) unload(other);
    }
    const { video } = slides[index];
    video.muted = muted;
    play(video);
    const film = films[index];
    if (pushed) history.replaceState({ vfeed: true }, "", `${location.pathname}?v=${film.id}`);
    feed.querySelector(".vhint")?.classList.toggle("gone", index > 0);
  }

  function play(video) {
    const started = video.play();
    if (started?.catch) {
      started.catch(() => {
        // The browser wants sound to start from a tap: play silently, and offer sound.
        if (!video.muted) {
          video.muted = true;
          setMuted(true);
          video.play().catch(() => slides[active]?.slide.classList.add("paused"));
        } else slides[active]?.slide.classList.add("paused");
      });
    }
  }

  function toggle(video) {
    if (video.paused) {
      if (muted && video.muted) setMuted(false);
      play(video);
    } else video.pause();
  }

  function setMuted(value) {
    muted = value;
    for (const { video } of slides) video.muted = value;
    const sound = feed?.querySelector(".vsound");
    if (sound) {
      sound.innerHTML = value ? icon.muted : icon.sound;
      sound.setAttribute("aria-pressed", String(value));
    }
  }

  function go(index) {
    const target = slides[Math.max(0, Math.min(slides.length - 1, index))];
    if (!target) return;
    target.slide.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function fullscreen() {
    const video = slides[active]?.video;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else if (canFullscreen) {
      feed.requestFullscreen().catch(() => undefined);
    } else if (video?.webkitEnterFullscreen) {
      // iPhone: only the video itself can go full screen.
      video.webkitEnterFullscreen();
    }
  }

  async function shareFilm() {
    const film = films[active];
    if (!film) return;
    const url = new URL(film.page, location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: film.title, url });
      else {
        await navigator.clipboard.writeText(url);
        const share = feed.querySelector(".vshare");
        share.classList.add("done");
        setTimeout(() => share.classList.remove("done"), 1600);
      }
    } catch (_) {
      /* Share sheet closed. */
    }
  }

  function onKey(event) {
    if (event.key === "Escape") return closePlayer();
    if (event.target instanceof HTMLElement && event.target.closest(".vbar")) return;
    const video = slides[active]?.video;
    if (event.key === "ArrowDown" || event.key === "j" || event.key === "PageDown") go(active + 1);
    else if (event.key === "ArrowUp" || event.key === "k" || event.key === "PageUp") go(active - 1);
    else if (event.key === " " || event.key === "Enter") {
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
      if (video) toggle(video);
    } else if (event.key === "m") setMuted(!muted);
    else if (event.key === "f") fullscreen();
    else return;
    event.preventDefault();
  }

  function openPlayer(index, fromHistory) {
    if (!feed) build();
    openedFrom = document.activeElement;
    // Pause the inline film on a watch page; the feed takes over.
    document.getElementById("vmain")?.pause();
    document.documentElement.classList.add("vfeed-open");
    feed.classList.add("open");
    active = -1;
    const target = slides[index] ?? slides[0];
    target.slide.scrollIntoView({ block: "start" });
    if (!fromHistory) {
      history.pushState({ vfeed: true }, "", `${location.pathname}?v=${films[index]?.id ?? films[0].id}`);
      pushed = true;
    }
    activate(index);
    feed.querySelector(".vclose").focus({ preventScroll: true });
  }

  function closePlayer(fromHistory) {
    if (!feed?.classList.contains("open")) return;
    if (!fromHistory && pushed) {
      // Leave through history so the phone's Back button and this button agree.
      history.back();
      return;
    }
    pushed = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    for (let index = 0; index < slides.length; index += 1) unload(index);
    active = -1;
    feed.classList.remove("open");
    document.documentElement.classList.remove("vfeed-open");
    if (location.search.includes("v=")) history.replaceState(null, "", location.pathname);
    if (openedFrom instanceof HTMLElement) openedFrom.focus({ preventScroll: true });
  }

  addEventListener("popstate", () => {
    const open = feed?.classList.contains("open");
    const wanted = new URLSearchParams(location.search).get("v");
    if (open && !wanted) closePlayer(true);
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const trigger = event.target instanceof Element ? event.target.closest("[data-video]") : null;
    if (!trigger) return;
    const index = byId.get(trigger.getAttribute("data-video"));
    if (index === undefined) return;
    event.preventDefault();
    openPlayer(index, false);
  });

  // A shared link such as /videos/?v=hr opens that film straight away.
  const wanted = new URLSearchParams(location.search).get("v");
  if (wanted && byId.has(wanted)) {
    history.replaceState(null, "", location.pathname);
    history.pushState({ vfeed: true }, "", `${location.pathname}?v=${wanted}`);
    pushed = true;
    openPlayer(byId.get(wanted), true);
  }
})();
