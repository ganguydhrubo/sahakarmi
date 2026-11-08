// The 3D crew stage: five rigged robots (Blender -> glTF) on glowing pedestals. Loaded only when
// the stage is shown; renders only while visible and stops completely on dispose.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CrewAvatar } from "../../shared/ipc";
import mailerUrl from "./assets/crew/sahkarmi-mailer.glb?url";
import outreachUrl from "./assets/crew/sahkarmi-outreach.glb?url";
import publisherUrl from "./assets/crew/sahkarmi-publisher.glb?url";
import startupUrl from "./assets/crew/sahkarmi-startup.glb?url";
import whatsappUrl from "./assets/crew/sahkarmi-whatsapp.glb?url";

const MODELS: Array<[CrewAvatar, string]> = [
  ["startup", startupUrl],
  ["publisher", publisherUrl],
  ["outreach", outreachUrl],
  ["mailer", mailerUrl],
  ["whatsapp", whatsappUrl],
];

interface Robot {
  id: CrewAvatar;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  moving?: THREE.AnimationAction;
  wave?: THREE.AnimationAction;
}

export interface CrewScene {
  wave(id: CrewAvatar): void;
  setWalking(on: boolean): void;
  dispose(): void;
}

export async function mountCrewScene(
  host: HTMLElement,
  options: { reducedMotion: boolean; onPick: (id: CrewAvatar) => void },
): Promise<CrewScene> {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(-4, 6, 5);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.4);
  rim.position.set(2, 5, -6);
  scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.6));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  const loader = new GLTFLoader();
  const robots: Robot[] = await Promise.all(
    MODELS.map(async ([id, url]) => {
      const gltf = await loader.loadAsync(url);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const clip = (name: string) => {
        const found = gltf.animations.find((candidate) => candidate.name === name);
        return found ? mixer.clipAction(found) : undefined;
      };
      const robot: Robot = {
        id,
        root: gltf.scene,
        mixer,
        idle: clip("Idle"),
        moving: clip("Walk") ?? clip("Hover"),
        wave: clip("Wave"),
      };
      robot.idle?.play();
      robot.wave?.setLoop(THREE.LoopOnce, 1);
      scene.add(gltf.scene);
      return robot;
    }),
  );
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);

  let walking = false;
  function layout(): void {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    for (const [index, robot] of robots.entries())
      robot.root.position.set((index - 2) * 1.05, 0, 0);
    const aspect = width / height;
    const halfHeight = Math.max(5.5 / 2 / aspect, 0.62);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.position.set(0, 2.4, 9);
    camera.lookAt(0, 0.4, 0);
    camera.updateProjectionMatrix();
  }

  function wave(robot: Robot): void {
    const action = robot.wave;
    if (!action) return;
    const base = walking ? robot.moving : robot.idle;
    action.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    base?.fadeOut(0.15);
    const done = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return;
      robot.mixer.removeEventListener("finished", done);
      action.fadeOut(0.2);
      base?.reset().fadeIn(0.2).play();
    };
    robot.mixer.addEventListener("finished", done);
    kick();
  }

  const ray = new THREE.Raycaster();
  const onClick = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray.intersectObjects(
      robots.map((robot) => robot.root),
      true,
    )[0];
    if (!hit) return;
    const robot = robots.find((candidate) => {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (node === candidate.root) return true;
        node = node.parent;
      }
      return false;
    });
    if (!robot) return;
    wave(robot);
    options.onPick(robot.id);
  };
  canvas.addEventListener("click", onClick);

  // Renders only while on screen; in reduced motion only for a moment after an action.
  const clock = new THREE.Clock();
  let visible = true;
  let running = false;
  let frameId = 0;
  let calmUntil = 0;
  let disposed = false;
  function frame(): void {
    if (disposed || !visible || (options.reducedMotion && performance.now() > calmUntil)) {
      running = false;
      return;
    }
    const delta = Math.min(clock.getDelta(), 0.05);
    for (const robot of robots) robot.mixer.update(delta);
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(frame);
  }
  function kick(): void {
    if (options.reducedMotion) calmUntil = performance.now() + 2_600;
    if (running || disposed) return;
    running = true;
    clock.getDelta();
    frameId = requestAnimationFrame(frame);
  }
  const visibility = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting) && document.visibilityState === "visible";
    if (visible) kick();
  });
  visibility.observe(host);
  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    if (visible) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const resize = new ResizeObserver(() => {
    layout();
    renderer.render(scene, camera);
  });
  resize.observe(host);
  layout();
  for (const robot of robots) robot.mixer.update(0.5);
  renderer.render(scene, camera);
  kick();

  return {
    wave(id) {
      const robot = robots.find((candidate) => candidate.id === id);
      if (robot) wave(robot);
    },
    setWalking(on) {
      walking = on;
      for (const robot of robots) {
        const [from, to] = on ? [robot.idle, robot.moving] : [robot.moving, robot.idle];
        if (!to || from === to) continue;
        to.reset().play();
        from?.crossFadeTo(to, 0.3, false);
      }
      kick();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
      visibility.disconnect();
      resize.disconnect();
      for (const robot of robots) {
        robot.mixer.stopAllAction();
        robot.root.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.geometry.dispose();
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) material.dispose();
          }
        });
      }
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
