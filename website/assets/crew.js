// "Meet the crew": five rigged 3D coworkers (Blender -> glTF) on glowing pedestals.
// Loads only when the section comes near, pauses off-screen, and falls back to the poster
// image when WebGL or modules are unavailable.
import * as THREE from "three";
import { RoomEnvironment } from "./3d/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "./3d/addons/loaders/GLTFLoader.js";

const stage = document.getElementById("crew-stage");
const chips = [...document.querySelectorAll("[data-crew]")];
const walkButton = document.getElementById("crew-walk");
const CREW = ["startup", "publisher", "outreach", "mailer", "whatsapp"];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(-4, 6, 5);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.4);
  rim.position.set(2, 5, -6);
  scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.6));

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const loader = new GLTFLoader();
  const crew = await Promise.all(
    CREW.map(async (name) => {
      const gltf = await loader.loadAsync(`/assets/3d/models/sahkarmi-${name}.glb`);
      const root = gltf.scene;
      const mixer = new THREE.AnimationMixer(root);
      const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
      const moving = clips.Walk ?? clips.Hover;
      clips.Idle?.play();
      if (clips.Wave) {
        clips.Wave.setLoop(THREE.LoopOnce, 1);
        clips.Wave.clampWhenFinished = false;
      }
      scene.add(root);
      return { name, root, mixer, clips, moving };
    }),
  );
  stage.classList.add("is-live");
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  function layout() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    // The brand faces stand in one straight row, seen from the front.
    crew.forEach((c, i) => c.root.position.set((i - 2) * 1.05, 0, 0));
    const aspect = w / h;
    const halfH = Math.max(5.5 / 2 / aspect, 0.62);
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.position.set(0, 2.4, 9);
    camera.lookAt(0, 0.4, 0);
    camera.updateProjectionMatrix();
  }

  function wave(c) {
    const action = c.clips.Wave;
    if (!action) return;
    action.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    const idle = walking ? c.moving : c.clips.Idle;
    idle?.fadeOut(0.15);
    const done = (event) => {
      if (event.action !== action) return;
      c.mixer.removeEventListener("finished", done);
      action.fadeOut(0.2);
      idle?.reset().fadeIn(0.2).play();
    };
    c.mixer.addEventListener("finished", done);
  }

  let walking = false;
  function setWalking(on) {
    walking = on;
    walkButton?.setAttribute("aria-pressed", String(on));
    for (const c of crew) {
      const [from, to] = on ? [c.clips.Idle, c.moving] : [c.moving, c.clips.Idle];
      if (!to || from === to) continue;
      to.reset().play();
      from?.crossFadeTo(to, 0.3, false);
    }
    kick();
  }

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      const c = crew.find((x) => x.name === chip.dataset.crew);
      if (c) wave(c);
      kick();
    }),
  );
  walkButton?.addEventListener("click", () => setWalking(!walking));

  const ray = new THREE.Raycaster();
  renderer.domElement.addEventListener("click", (event) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1),
      camera,
    );
    const hit = ray.intersectObjects(crew.map((c) => c.root), true)[0];
    if (!hit) return;
    const c = crew.find((x) => {
      let o = hit.object;
      while (o) {
        if (o === x.root) return true;
        o = o.parent;
      }
      return false;
    });
    if (c) wave(c);
    kick();
  });

  // Render loop that sleeps off-screen and in reduced motion (one still frame, waves on request).
  const clock = new THREE.Clock();
  let visible = true;
  let running = false;
  let calmUntil = 0;
  let nextWave = performance.now() + 2500;
  function frame() {
    if (!visible || (reduceMotion && performance.now() > calmUntil)) {
      running = false;
      return;
    }
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const c of crew) c.mixer.update(dt);
    if (!reduceMotion && performance.now() > nextWave) {
      wave(crew[Math.floor(Math.random() * crew.length)]);
      nextWave = performance.now() + 4500 + Math.random() * 3500;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  function kick() {
    if (reduceMotion) calmUntil = performance.now() + 2600;
    if (running) return;
    running = true;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  }).observe(stage);
  new ResizeObserver(() => {
    layout();
    renderer.render(scene, camera);
  }).observe(stage);
  layout();
  for (const c of crew) c.mixer.update(0.5);
  renderer.render(scene, camera);
  kick();
}

if (stage && webglOk()) {
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      start().catch(() => stage.classList.remove("is-live"));
    },
    { rootMargin: "300px" },
  );
  near.observe(stage);
}
