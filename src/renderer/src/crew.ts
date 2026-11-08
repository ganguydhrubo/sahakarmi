import type { CrewAvatar } from "../../shared/ipc";
import mailerIdle from "./assets/crew/mailer-idle.webp";
import mailerStill from "./assets/crew/mailer-still.webp";
import mailerWave from "./assets/crew/mailer-wave.webp";
import outreachIdle from "./assets/crew/outreach-idle.webp";
import outreachStill from "./assets/crew/outreach-still.webp";
import outreachWave from "./assets/crew/outreach-wave.webp";
import publisherIdle from "./assets/crew/publisher-idle.webp";
import publisherStill from "./assets/crew/publisher-still.webp";
import publisherWave from "./assets/crew/publisher-wave.webp";
import startupIdle from "./assets/crew/startup-idle.webp";
import startupStill from "./assets/crew/startup-still.webp";
import startupWave from "./assets/crew/startup-wave.webp";
import whatsappIdle from "./assets/crew/whatsapp-idle.webp";
import whatsappStill from "./assets/crew/whatsapp-still.webp";
import whatsappWave from "./assets/crew/whatsapp-wave.webp";

/** The five 3D crew robots: rendered from the same Blender rig as the 3D stage models. */
export interface CrewMember {
  id: CrewAvatar;
  name: string;
  /** Status halo colour, the same as on the robot's pedestal. */
  halo: string;
  /** Animated idle loop, animated wave loop and a still frame for reduced motion. */
  idle: string;
  wave: string;
  still: string;
}

export const CREW: readonly CrewMember[] = [
  {
    id: "startup",
    name: "Startup",
    halo: "#3cc8ff",
    idle: startupIdle,
    wave: startupWave,
    still: startupStill,
  },
  {
    id: "publisher",
    name: "Publisher",
    halo: "#ff6fb1",
    idle: publisherIdle,
    wave: publisherWave,
    still: publisherStill,
  },
  {
    id: "outreach",
    name: "Outreach",
    halo: "#a86bff",
    idle: outreachIdle,
    wave: outreachWave,
    still: outreachStill,
  },
  {
    id: "mailer",
    name: "Mailer",
    halo: "#ffb02e",
    idle: mailerIdle,
    wave: mailerWave,
    still: mailerStill,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    halo: "#36e27a",
    idle: whatsappIdle,
    wave: whatsappWave,
    still: whatsappStill,
  },
];

export function crewMember(id: CrewAvatar | null | undefined): CrewMember | undefined {
  return id ? CREW.find((member) => member.id === id) : undefined;
}
