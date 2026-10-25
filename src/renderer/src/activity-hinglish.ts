/**
 * Every user-facing agent activity message, in natural Roman-script Hinglish.
 *
 * Voice: neutral ("ho raha hai", "chal raha hai") so it reads right for every coworker,
 * whatever their name. Machine identifiers (phases, categories) stay in English.
 */

export type ActivityPhase =
  | "idle"
  | "sending"
  | "queued"
  | "paused"
  | "initializing"
  | "thinking"
  | "generating"
  | "researching"
  | "executing_tool"
  | "processing_result"
  | "waiting_approval"
  | "waiting_user"
  | "retrying"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "failed";

/** What kind of real tool call is running; decides which vocabulary is truthful. */
export type ActivityCategory =
  | "research"
  | "browser"
  | "code"
  | "tests"
  | "command"
  | "files_read"
  | "files_write"
  | "coworker"
  | "approval"
  | "generic";

/** Primary line: names the real event. Shown immediately when the event happens. */
export const PRIMARY: Record<ActivityPhase, string> = {
  idle: "",
  sending: "Message bheja ja raha hai…",
  queued: "Request line mein hai…",
  paused: "Queue abhi ruki hui hai",
  initializing: "Request receive ho gayi…",
  thinking: "Request par kaam chal raha hai…",
  generating: "Jawab likha ja raha hai…",
  researching: "Web par information dhoondhi ja rahi hai…",
  executing_tool: "Tool execute ho raha hai…",
  processing_result: "Tool se mila result process ho raha hai…",
  waiting_approval: "Aapki manzoori ka intezaar hai",
  waiting_user: "Aapke jawab ka intezaar hai",
  retrying: "Ek baar phir try ho raha hai…",
  finalizing: "Final jawab taiyar ho raha hai…",
  completed: "Kaam poora ho gaya!",
  cancelled: "Task cancel kar diya gaya hai.",
  failed: "Task complete nahi ho paya. Dobara try karein.",
};

/** Primary line for a running tool, by category (more specific than PRIMARY.executing_tool). */
export const TOOL_PRIMARY: Record<ActivityCategory, string> = {
  research: "Web par information dhoondhi ja rahi hai…",
  browser: "Browser mein page khola ja raha hai…",
  code: "Code par kaam chal raha hai…",
  tests: "Tests aur build check ho rahe hain…",
  command: "Command chal rahi hai…",
  files_read: "Files padhi ja rahi hain…",
  files_write: "Files mein changes ho rahe hain…",
  coworker: "Dusre coworker ko kaam bheja ja raha hai…",
  approval: "Aapse manzoori maangi ja rahi hai…",
  generic: "Tool execute ho raha hai…",
};

/** Secondary lines rotate under the primary line. Each pool only says what that event implies. */
export const SECONDARY: Record<ActivityPhase, string[]> = {
  idle: [],
  sending: ["Ek second, request ja rahi hai…"],
  queued: [
    "Pehle wala kaam khatam hote hi shuru hoga…",
    "Request safe hai, line mein intezaar ho raha hai…",
  ],
  paused: ["Queue resume karte hi kaam shuru hoga."],
  initializing: [
    "Kaam ki taiyari ho rahi hai…",
    "AI provider se connection ban raha hai…",
    "Request bheji ja rahi hai…",
  ],
  thinking: [
    "Request ko samjha ja raha hai…",
    "Best approach dhoondha ja raha hai…",
    "Agla step plan ho raha hai…",
    "Saari zaroori baatein jodi ja rahi hain…",
    "Options compare ho rahe hain…",
    "Sahi direction figure out ho rahi hai…",
  ],
  generating: [
    "Jawab par kaam chal raha hai…",
    "Baatein clearly likhi ja rahi hain…",
    "Important points jode ja rahe hain…",
  ],
  researching: [
    "Kaam ke sources explore ho rahe hain…",
    "Relevant details nikaali ja rahi hain…",
    "Facts cross-check ho rahe hain…",
    "Alag-alag information compare ho rahi hai…",
  ],
  executing_tool: [
    "Tool ke response ka intezaar ho raha hai…",
    "Workflow aage badh raha hai…",
    "Ek aur step complete ho raha hai…",
  ],
  processing_result: [
    "Result verify ho raha hai…",
    "Agle step ki taiyari ho rahi hai…",
    "Intermediate results check ho rahe hain…",
  ],
  waiting_approval: [
    "Neeche di gayi request ko manzoor ya reject karein.",
    "Aapke faisle tak yeh kaam ruka hua hai.",
  ],
  waiting_user: ["Upar diye sawaal ka jawab dein, phir kaam aage badhega."],
  retrying: ["Pichhli koshish mein dikkat aayi thi…", "Thoda ruk kar dobara koshish ho rahi hai…"],
  finalizing: [
    "Results organize ho rahe hain…",
    "Important points summarize ho rahe hain…",
    "Jawab ko clearly structure kiya ja raha hai…",
  ],
  completed: [],
  cancelled: [],
  failed: [],
};

/** Secondary lines for a running tool, by category. */
export const TOOL_SECONDARY: Record<ActivityCategory, string[]> = {
  research: [
    "Sources dhyan se padhe ja rahe hain…",
    "Relevant information search ho rahi hai…",
    "Facts cross-check ho rahe hain…",
  ],
  browser: [
    "Page ka content padha ja raha hai…",
    "Page load hone ka intezaar ho raha hai…",
    "Kaam ki details nikaali ja rahi hain…",
  ],
  code: [
    "Codebase inspect ho raha hai…",
    "Changes implement ho rahe hain…",
    "Dependencies check ho rahi hain…",
  ],
  tests: [
    "Tests ke result ka intezaar ho raha hai…",
    "Build verify ho raha hai…",
    "Edge cases check ho rahe hain…",
  ],
  command: ["Command ke output ka intezaar ho raha hai…", "Workflow aage badh raha hai…"],
  files_read: [
    "File ka content analyze ho raha hai…",
    "Relevant data nikaala ja raha hai…",
    "Data ko organize kiya ja raha hai…",
  ],
  files_write: ["Changes save ho rahe hain…", "Information ko structure kiya ja raha hai…"],
  coworker: ["Team ke saath kaam coordinate ho raha hai…"],
  approval: ["Aapke faisle tak yeh step ruka rahega."],
  generic: ["Tool ke response ka intezaar ho raha hai…", "Workflow aage badh raha hai…"],
};

/**
 * "Masti" style: playful Claude Code-like lines in desi flavour. Used ONLY while the model is
 * thinking with no specific action under way, so they decorate without claiming any activity.
 * Tool, research, waiting and outcome lines always stay factual.
 */
export const MASTI_THINKING: string[] = [
  "Request par gehrayi se soch-vichaar ho raha hai…",
  "Saari zaroori baatein jodi ja rahi hain…",
  "Best approach analyze ki ja rahi hai…",
  "Context aur details ko samjha ja raha hai…",
  "Sahi solution figure out kiya ja raha hai…",
  "Logical steps plan kiye ja rahe hain…",
  "Critical points evaluate ho rahe hain…",
  "Data aur options compare kiye ja rahe hain…",
  "Sahi direction tai ki ja rahi hai…",
  "Information ko organize kiya ja raha hai…",
  "Accurate outcome ke liye calculate ho raha hai…",
  "Step-by-step reasoning apply ho rahi hai…",
  "Problem ko breakdown kiya ja raha hai…",
  "Optimal path formulate ho raha hai…",
  "Structure taiyar kiya ja raha hai…",
  "Requirements carefully cross-check ho rahi hain…",
  "Next action points plan ho rahe hain…",
  "Clear aur precise response synthesize ho raha hai…",
  "Solution structure build ho raha hai…",
  "Execution strategy finalize ho rahi hai…",
  "Request ko end-to-end trace kiya ja raha hai…",
  "Quality checks verify ho rahe hain…",
  "Sahi format mein result draft ho raha hai…",
  "Complete response deliver hone ja raha hai…",
];

/** Masti lines for long waits: still honest that the work is ongoing, never "almost done". */
export const MASTI_LONG: string[] = [
  "Thoda waqt lag raha hai, analysis jaari hai…",
  "Complex task hai, dhyan se execute kiya ja raha hai…",
  "Sabhi steps precision ke saath chal rahe hain…",
  "Comprehensive result ke liye process chal raha hai…",
];

/** Long waits: reassuring, and never claims the task is nearly done. */
export const LONG_RUNNING: string[] = [
  "Thoda waqt lag raha hai, kaam jaari hai…",
  "Kaam expected se thoda bada hai, process jaari hai…",
  "Details carefully check ho rahi hain…",
  "Abhi kuch aur steps baaki ho sakte hain…",
  "Kaam ko sahi tareeke se poora kiya ja raha hai…",
];

/** A tool call that just failed: true, without guessing what the agent will do next. */
export const TOOL_FAILED_PRIMARY = "Tool se error aaya, use dekha ja raha hai…";
export const TOOL_FAILED_SECONDARY = [
  "Error ki wajah samjhi ja rahi hai…",
  "Agla kadam tay ho raha hai…",
];

/** Short labels used across the app (status dots, tool cards, task queue, thinking). */
export const LABELS = {
  statusIdle: "Free hai",
  statusWorking: "Kaam chal raha hai",
  statusWaiting: "Aapka intezaar hai",
  statusError: "Dhyan dijiye",
  toolRunning: "Chal raha hai",
  toolDone: "Ho gaya",
  toolFailed: "Nahi ho paya",
  queueQueued: "line mein",
  queueRunning: "chal rahe",
  queueDone: "poore",
  queuePaused: "Ruka hua",
  thinking: "Soch-vichaar",
  thinkingSteps: "{count} kadam",
  elapsed: "{time} se",
  retryAttempt: "Koshish {attempt}/{max}",
} as const;

/** Titles shown on in-conversation error notices. Keys are the app's internal codes. */
export const ERROR_TITLES: Record<string, string> = {
  error: "Kuch gadbad ho gayi",
  load: "Baatcheet load nahi ho payi",
  create: "Naya coworker nahi ban paya",
  settings: "Settings save nahi ho payi",
  delete: "Delete nahi ho paya",
  send: "Message nahi ja paya",
  answer: "Jawab nahi ja paya",
  cancel: "Cancel nahi ho paya",
  pause: "Queue ruk nahi payi",
  resume: "Queue phir se shuru nahi ho payi",
  schedule: "Schedule set nahi ho paya",
  stop: "Kaam rok nahi paye",
};

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

/** "45s", "1m 05s", "1h 02m": compact and language-neutral. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
