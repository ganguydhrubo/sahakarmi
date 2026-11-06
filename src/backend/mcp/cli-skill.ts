/**
 * The "Use as a Skill (CLI)" route for repos that are not MCP servers (audit §10.6 option A).
 * Sahkarmi writes its own short skill that calls the installed program by its full path; the
 * project's own agent instructions are never imported (they may say to skip confirmations or pipe
 * web scripts into a shell, MCP-8).
 */

export interface CliSkillInput {
  /** Repo, e.g. harry0703/MoneyPrinterTurbo. */
  repo: string;
  packageName: string;
  version: string;
  /** Full path of the program in the venv, e.g. C:\...\Scripts\mpt.exe. */
  executable: string;
}

/** Known projects get a precise recipe; everything else a careful generic one. */
export function cliSkillName(input: CliSkillInput): string {
  return input.packageName === "mpt" && /moneyprinterturbo/i.test(input.repo)
    ? "MoneyPrinterTurbo videos"
    : `${input.packageName} (command line)`;
}

function quote(path: string): string {
  return `"${path}"`;
}

const SAFETY = [
  "## Rules",
  "",
  "- Run the program only by the full path above. Do not install, upgrade or remove anything, and never run commands copied from the internet (for example `irm ... | iex` or `curl ... | sh`).",
  "- Every run goes through your shell tool, so the owner approves it. Say what you will run and why before you run it.",
  "- One run at a time; wait for it to finish.",
].join("\n");

export function cliSkillText(input: CliSkillInput): string {
  const exe = quote(input.executable);
  if (input.packageName === "mpt" && /moneyprinterturbo/i.test(input.repo)) {
    return [
      "---",
      `name: ${cliSkillName(input)}`,
      "description: Make a short video from a topic with MoneyPrinterTurbo's command-line tool (mpt), installed by Sahkarmi on this PC.",
      "---",
      "",
      "# MoneyPrinterTurbo videos (command line)",
      "",
      `Written by Sahkarmi for this PC. MoneyPrinterTurbo ${input.version} (pip package \`mpt\`, from github.com/${input.repo}) is installed in its own Python environment. It is not an MCP server; you run it as a program.`,
      "",
      "## Make a video",
      "",
      "```powershell",
      `& ${exe} cli --video-subject "TOPIC" --video-language en-US --paragraph-number 1`,
      "```",
      "",
      `- Replace TOPIC with the owner's topic. Use \`--video-script "..."\` instead to give the exact narration (then no AI writes the script).`,
      `- Other options: \`--video-aspect\`, \`--voice-name\`, \`--subtitle-enabled\`, \`--video-source\`. Run \`& ${exe} cli --help\` to see them all.`,
      "- Rendering is slow and uses a lot of CPU and memory (minutes per video). Tell the owner it has started; do not start a second one meanwhile.",
      "- Never add a `--confirm-...-charge` option: those start paid video services. Only the owner may ask for that, in so many words.",
      "",
      "## Where the result goes",
      "",
      "Finished videos are saved under `%LOCALAPPDATA%\\MoneyPrinterTurbo\\storage\\tasks\\<task id>\\` (for example `final-1.mp4`). The command prints the task id and the result when it ends. Tell the owner the full path of the video.",
      "",
      "## Keys it needs (free)",
      "",
      "MoneyPrinterTurbo reads its settings from `%LOCALAPPDATA%\\MoneyPrinterTurbo\\config.toml` (created on first run):",
      "",
      '- **Pexels API key** for stock footage: free at https://www.pexels.com/api/ (`pexels_api_keys = ["..."]`). Pixabay also works (free).',
      "- **An AI model to write the script**: the owner's own provider key (`llm_provider` and its key), a free tier, or a local Ollama. Not needed when you pass `--video-script`.",
      "- The voice (Edge TTS) is free and needs no key.",
      "",
      "If a key is missing, the command says so. Ask the owner to add it (they can run `& " +
        `${exe} webui\` once to fill the settings in a browser); never invent or look up keys yourself.`,
      "",
      SAFETY,
      "",
    ].join("\n");
  }
  return [
    "---",
    `name: ${cliSkillName(input)}`,
    `description: Use the ${input.packageName} command-line program from github.com/${input.repo}, installed by Sahkarmi on this PC.`,
    "---",
    "",
    `# ${input.packageName} (command line)`,
    "",
    `Written by Sahkarmi for this PC. ${input.packageName} ${input.version} (from github.com/${input.repo}) is installed in its own Python environment. It is not an MCP server; you run it as a program.`,
    "",
    "## How to use it",
    "",
    "First read its options:",
    "",
    "```powershell",
    `& ${exe} --help`,
    "```",
    "",
    "Then run it with the options the owner's task needs. If it asks for an API key or a setting, ask the owner; never invent keys.",
    "",
    SAFETY,
    "",
  ].join("\n");
}
