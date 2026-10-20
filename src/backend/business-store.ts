import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  BusinessIntegration,
  BusinessTarget,
  SaveBusinessTargetInput,
  TargetPeriod,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

/**
 * Only platforms coworkers can actually help with today; unsupported ones are not listed.
 * What each platform officially allows. Statuses come from the platforms' published developer
 * programmes; nothing here scrapes an account, solves a CAPTCHA or automates a prohibited action.
 */
export const BUSINESS_INTEGRATIONS: BusinessIntegration[] = [
  {
    id: "gst-portal",
    name: "GST portal",
    support: "browser-assisted",
    summary:
      "Coworkers can prepare figures and open the portal in the built-in browser. You log in, enter the OTP and press submit yourself.",
    accessNeeded: "A GST Suvidha Provider (GSP) licence for direct API filing.",
    workaround:
      "Use Take over for login and OTP. Submitting a return always needs your approval (Official forms permission).",
  },
  {
    id: "tally",
    name: "Tally / spreadsheets",
    support: "manual-import",
    summary:
      "Exported Tally reports, Excel and CSV files in Shared files can be read and reconciled.",
    accessNeeded: "None for exported files.",
    workaround: "Export from Tally to Excel/CSV and drop the file in Shared files.",
  },
  {
    id: "email",
    name: "Email (Gmail, Outlook)",
    support: "browser-assisted",
    summary:
      "A coworker can draft in the webmail you are logged in to in the built-in browser. Sending needs your approval.",
    accessNeeded: "None beyond your own login.",
    workaround: "Drafts are prepared; the External messages permission controls sending.",
  },
];

const PERIODS: TargetPeriod[] = ["weekly", "monthly", "quarterly", "yearly"];

interface BusinessFileState {
  version: 1;
  targets: BusinessTarget[];
}

export class BusinessStore {
  readonly #file: JsonFile<BusinessFileState>;
  #state: BusinessFileState = { version: 1, targets: [] };

  constructor(userDataPath: string) {
    this.#file = new JsonFile(join(userDataPath, "business-targets.json"));
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(() => ({ version: 1, targets: [] }), isBusinessState);
  }

  integrations(): BusinessIntegration[] {
    return BUSINESS_INTEGRATIONS.map((integration) => ({ ...integration }));
  }

  listTargets(): BusinessTarget[] {
    return this.#state.targets.map((target) => ({ ...target }));
  }

  async saveTarget(input: SaveBusinessTargetInput): Promise<BusinessTarget[]> {
    const title = input.title.trim().slice(0, 120);
    if (!title) throw new Error("A target needs a name.");
    if (!Number.isFinite(input.targetValue) || input.targetValue < 0) {
      throw new Error("The target value must be a positive number.");
    }
    if (
      input.currentValue !== null &&
      (!Number.isFinite(input.currentValue) || input.currentValue < 0)
    ) {
      throw new Error("Progress must be a positive number or empty.");
    }
    if (!PERIODS.includes(input.period)) throw new Error("Unknown period.");
    if (input.dueDate !== null && Number.isNaN(Date.parse(input.dueDate))) {
      throw new Error("Invalid due date.");
    }
    const target: BusinessTarget = {
      id: input.id ?? randomUUID(),
      title,
      metric: input.metric.trim().slice(0, 80),
      unit: input.unit.trim().slice(0, 20),
      targetValue: input.targetValue,
      currentValue: input.currentValue,
      period: input.period,
      dueDate: input.dueDate,
      botId: input.botId,
      notes: input.notes.trim().slice(0, 1_000),
      updatedAt: new Date().toISOString(),
    };
    const index = this.#state.targets.findIndex((candidate) => candidate.id === target.id);
    if (input.id && index === -1) throw new Error("This target no longer exists.");
    if (index === -1) this.#state.targets.push(target);
    else this.#state.targets[index] = target;
    await this.#file.write(this.#state);
    return this.listTargets();
  }

  async deleteTarget(targetId: string): Promise<BusinessTarget[]> {
    this.#state.targets = this.#state.targets.filter((target) => target.id !== targetId);
    await this.#file.write(this.#state);
    return this.listTargets();
  }
}

function isBusinessState(value: unknown): value is BusinessFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.targets) &&
    value.targets.every(
      (target) =>
        isRecord(target) &&
        typeof target.id === "string" &&
        typeof target.title === "string" &&
        typeof target.targetValue === "number",
    )
  );
}
