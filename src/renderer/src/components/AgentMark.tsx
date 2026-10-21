import type { BotAvatarColor, BotAvatarShape } from "../../../shared/ipc";

const SILHOUETTES: Record<BotAvatarShape, string> = {
  blob: "M49 4C72 3 92 19 96 43C101 70 82 93 55 97C28 100 5 82 4 56C3 31 23 7 49 4Z",
  pebble: "M50 7C75 7 94 24 94 50S76 94 50 94 6 77 6 51 25 7 50 7Z",
  squircle: "M25 6H75C87 6 94 13 94 25V75C94 87 87 94 75 94H25C13 94 6 87 6 75V25C6 13 13 6 25 6Z",
  tablet: "M31 4H69C84 4 92 13 92 28V72C92 87 84 96 69 96H31C16 96 8 87 8 72V28C8 13 16 4 31 4Z",
  wedge: "M46 9C48 5 52 5 54 9L94 79C97 85 94 91 88 93C66 99 34 99 12 93C6 91 3 85 6 79L46 9Z",
  hex: "M26 5H74L96 27V73L74 95H26L4 73V27L26 5Z",
  cloud:
    "M23 33C29 17 47 10 62 18C77 15 91 26 91 42C101 54 96 72 84 78C79 92 61 97 49 89C34 97 16 89 14 74C1 66 2 47 15 40C16 37 19 35 23 33Z",
  teardrop: "M50 3C58 18 82 35 91 56C101 80 84 96 50 96S-1 80 9 56C18 35 42 18 50 3Z",
};

interface Palette3D {
  light: string;
  mid: string;
  dark: string;
  shadow: string;
  eye: string;
  gem: string;
  visor: string;
}

const PALETTES: Record<BotAvatarColor, Palette3D> = {
  orange: {
    light: "#ffbe76",
    mid: "#f97316",
    dark: "#c2410c",
    shadow: "#7c2d12",
    eye: "#38bdf8",
    gem: "#f59e0b",
    visor: "#0f172a",
  },
  blue: {
    light: "#93c5fd",
    mid: "#2563eb",
    dark: "#1d4ed8",
    shadow: "#1e3a8a",
    eye: "#67e8f9",
    gem: "#3b82f6",
    visor: "#0f172a",
  },
  green: {
    light: "#86efac",
    mid: "#16a34a",
    dark: "#15803d",
    shadow: "#14532d",
    eye: "#2dd4bf",
    gem: "#22c55e",
    visor: "#0f172a",
  },
  yellow: {
    light: "#fef08a",
    mid: "#eab308",
    dark: "#ca8a04",
    shadow: "#713f12",
    eye: "#38bdf8",
    gem: "#fde047",
    visor: "#0f172a",
  },
  cyan: {
    light: "#a5f3fc",
    mid: "#06b6d4",
    dark: "#0e7490",
    shadow: "#164e63",
    eye: "#67e8f9",
    gem: "#0891b2",
    visor: "#0f172a",
  },
  violet: {
    light: "#d8b4fe",
    mid: "#9333ea",
    dark: "#7e22ce",
    shadow: "#581c87",
    eye: "#e879f9",
    gem: "#a855f7",
    visor: "#0f172a",
  },
  magenta: {
    light: "#fbcfe8",
    mid: "#db2777",
    dark: "#be185d",
    shadow: "#700738",
    eye: "#fb7185",
    gem: "#ec4899",
    visor: "#0f172a",
  },
  red: {
    light: "#fca5a5",
    mid: "#dc2626",
    dark: "#b91c1c",
    shadow: "#7f1d1d",
    eye: "#fde047",
    gem: "#ef4444",
    visor: "#0f172a",
  },
  brown: {
    light: "#fde68a",
    mid: "#92400e",
    dark: "#78350f",
    shadow: "#451a03",
    eye: "#38bdf8",
    gem: "#d97706",
    visor: "#0f172a",
  },
  black: {
    light: "#94a3b8",
    mid: "#334155",
    dark: "#1e293b",
    shadow: "#0f172a",
    eye: "#38bdf8",
    gem: "#f97316",
    visor: "#020617",
  },
  gray: {
    light: "#e2e8f0",
    mid: "#64748b",
    dark: "#475569",
    shadow: "#334155",
    eye: "#38bdf8",
    gem: "#94a3b8",
    visor: "#0f172a",
  },
};

export function AgentMark(props: { shape?: BotAvatarShape; color?: BotAvatarColor }) {
  const shape = () => props.shape ?? "blob";
  const color = () => props.color ?? "orange";
  const palette = () => PALETTES[color()] ?? PALETTES.orange;
  const gradId = () => `bot-3d-${shape()}-${color()}`;

  return (
    <svg aria-hidden="true" class="agent-mark agent-mark-3d" viewBox="0 0 100 100">
      <defs>
        <radialGradient id={gradId()} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.8" />
          <stop offset="30%" stop-color={palette().light} />
          <stop offset="70%" stop-color={palette().mid} />
          <stop offset="100%" stop-color={palette().dark} />
        </radialGradient>
      </defs>

      {/* Top Antenna with Glowing Gem */}
      <path
        d="M50 14 L50 4"
        stroke="#94a3b8"
        stroke-width="2.5"
        stroke-linecap="round"
        class="agent-mark__antenna"
      />
      <circle cx="50" cy="4" r="3.2" fill={palette().gem} class="agent-mark__gem" />
      <circle cx="49" cy="3" r="1.1" fill="#ffffff" opacity="0.8" />

      {/* Side Headphones/Ears */}
      <rect x="14" y="44" width="5.5" height="15" rx="2.5" fill="#334155" />
      <circle cx="16.5" cy="51.5" r="1.8" fill={palette().light} />
      <rect x="80.5" y="44" width="5.5" height="15" rx="2.5" fill="#334155" />
      <circle cx="83.5" cy="51.5" r="1.8" fill={palette().light} />

      {/* 3D Main Head Shape */}
      <path
        class="agent-mark__head-3d"
        d={SILHOUETTES[shape()]}
        fill={`url(#${gradId()})`}
        stroke={palette().dark}
        stroke-width="1.2"
      />

      {/* Specular Highlight along Head Curve */}
      <ellipse
        cx="38"
        cy="26"
        rx="13"
        ry="6.5"
        transform="rotate(-20 38 26)"
        fill="#ffffff"
        opacity="0.45"
      />

      {/* High-Tech Visor / Faceplate */}
      <rect
        x="28"
        y="38"
        width="44"
        height="24"
        rx="12"
        fill={palette().visor}
        stroke={palette().eye}
        stroke-width="1.4"
        class="agent-mark__visor"
      />

      {/* Expressive Luminous 3D Eyes with Blinking Animation */}
      <g class="agent-mark__eyes">
        <ellipse cx="40.5" cy="49" rx="4.5" ry="6" fill={palette().eye} />
        <circle cx="38.5" cy="47" r="1.8" fill="#ffffff" />
        <circle cx="42.5" cy="52" r="0.8" fill="#ffffff" opacity="0.8" />

        <ellipse cx="59.5" cy="49" rx="4.5" ry="6" fill={palette().eye} />
        <circle cx="57.5" cy="47" r="1.8" fill="#ffffff" />
        <circle cx="61.5" cy="52" r="0.8" fill="#ffffff" opacity="0.8" />
      </g>

      {/* Rosy Cheeks */}
      <ellipse cx="32" cy="56" rx="3.5" ry="1.8" fill="#f43f5e" opacity="0.45" />
      <ellipse cx="68" cy="56" rx="3.5" ry="1.8" fill="#f43f5e" opacity="0.45" />

      {/* Friendly Expressive Mouth */}
      <path
        d="M46 56 Q50 60 54 56"
        stroke="#ffffff"
        stroke-width="1.6"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  );
}
