import type { ActivityCategory, ActivityPhase } from "./activity-hinglish";

/**
 * Plain English agent activity, used when the app is in English (or the owner picks it in
 * Settings). Same shape as activity-hinglish.ts and the same honesty rules: each line names a
 * real event and long waits never claim the work is nearly done.
 */

export const PRIMARY: Record<ActivityPhase, string> = {
  idle: "",
  sending: "Sending your message…",
  queued: "Waiting in the queue…",
  paused: "The queue is paused",
  initializing: "Request received…",
  thinking: "Working on your request…",
  generating: "Writing the reply…",
  researching: "Searching the web…",
  executing_tool: "Running a step…",
  processing_result: "Reading the result…",
  waiting_approval: "Waiting for your approval",
  waiting_user: "Waiting for your answer",
  retrying: "Trying again…",
  finalizing: "Preparing the final reply…",
  completed: "Done!",
  cancelled: "The task was cancelled.",
  failed: "The task could not be completed. Please try again.",
};

export const TOOL_PRIMARY: Record<ActivityCategory, string> = {
  research: "Searching the web…",
  browser: "Working in the browser…",
  code: "Working on code…",
  tests: "Checking tests and the build…",
  command: "Running a command…",
  files_read: "Reading files…",
  files_write: "Saving changes to files…",
  coworker: "Handing work to another coworker…",
  approval: "Asking for your approval…",
  generic: "Running a step…",
};

export const SECONDARY: Record<ActivityPhase, string[]> = {
  idle: [],
  sending: ["One moment, sending…"],
  queued: ["Starts as soon as the current task finishes…"],
  paused: ["Work starts again when you resume the queue."],
  initializing: ["Getting ready…", "Connecting to the AI provider…"],
  thinking: ["Understanding the request…", "Planning the next step…", "Comparing options…"],
  generating: ["Writing it clearly…", "Adding the important points…"],
  researching: ["Exploring sources…", "Cross-checking facts…"],
  executing_tool: ["Waiting for the step to finish…", "The workflow is moving ahead…"],
  processing_result: ["Checking the result…", "Preparing the next step…"],
  waiting_approval: [
    "Approve or reject the request shown below.",
    "This task is paused until you decide.",
  ],
  waiting_user: ["Answer the question above and the work will continue."],
  retrying: ["The last attempt hit a problem…", "Retrying after a short pause…"],
  finalizing: ["Organising the results…", "Structuring the reply…"],
  completed: [],
  cancelled: [],
  failed: [],
};

export const TOOL_SECONDARY: Record<ActivityCategory, string[]> = {
  research: ["Reading sources carefully…", "Cross-checking facts…"],
  browser: ["Reading the page…", "Waiting for the page to load…"],
  code: ["Inspecting the code…", "Making the changes…"],
  tests: ["Waiting for test results…", "Verifying the build…"],
  command: ["Waiting for the command to finish…"],
  files_read: ["Analysing the file…", "Pulling out the relevant data…"],
  files_write: ["Saving changes…"],
  coworker: ["Coordinating with the team…"],
  approval: ["This step waits for your decision."],
  generic: ["Waiting for the step to finish…"],
};

/** English has no playful variant: thinking lines stay plain. */
export const MASTI_THINKING: string[] = SECONDARY.thinking;
export const MASTI_LONG: string[] = ["This is taking a while; the work is still going…"];

export const LONG_RUNNING: string[] = [
  "This is taking a while; the work is still going…",
  "The task is bigger than expected; still working…",
  "Checking the details carefully…",
];

export const TOOL_FAILED_PRIMARY = "A step returned an error; looking into it…";
export const TOOL_FAILED_SECONDARY = ["Working out what went wrong…", "Deciding the next step…"];

export const LABELS = {
  statusIdle: "Available",
  statusWorking: "Working",
  statusWaiting: "Needs you",
  statusError: "Needs attention",
  toolRunning: "Running",
  toolDone: "Done",
  toolFailed: "Failed",
  queueQueued: "queued",
  queueRunning: "running",
  queueDone: "done",
  queuePaused: "Paused",
  thinking: "Thinking",
  thinkingSteps: "{count} steps",
  elapsed: "{time}",
  retryAttempt: "Attempt {attempt}/{max}",
} as const;

export const ERROR_TITLES: Record<string, string> = {
  error: "Something went wrong",
  load: "Couldn't load the conversation",
  create: "Couldn't create the coworker",
  settings: "Couldn't save settings",
  delete: "Couldn't delete",
  send: "Couldn't send the message",
  answer: "Couldn't send the answer",
  cancel: "Couldn't cancel",
  pause: "Couldn't pause the queue",
  resume: "Couldn't resume the queue",
  schedule: "Couldn't set the schedule",
  stop: "Couldn't stop the work",
};
