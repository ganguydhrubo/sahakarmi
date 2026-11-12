import type { RoutineCadence, RoutineConditionNo, RoutineOutput, RoutineStepKind } from "./ipc";

/**
 * Ready-made routines for small Indian businesses. A template is only a starting draft: the
 * owner sees it in the editor, can change anything, and nothing runs until they press Save.
 * Coworkers are matched by role, so each owner's own team is used.
 */
export interface RoutineTemplateStep {
  /** Local id, so a yes/no check can name the step a "no" jumps to. */
  id: string;
  kind?: Exclude<RoutineStepKind, "agent">;
  /** The coworker role that should do it (agent and condition steps). */
  role?: string;
  instruction: string;
  onNo?: RoutineConditionNo;
  /** File outputs leave the folder empty: the owner picks one before saving. */
  output?: RoutineOutput;
}

export interface RoutineTemplate {
  id: string;
  /** Message keys for the name and one-line description shown in the gallery. */
  nameKey: string;
  descriptionKey: string;
  cadence: RoutineCadence | null;
  steps: RoutineTemplateStep[];
}

const FILE: RoutineOutput = { kind: "file", folder: "" };
const TELEGRAM: RoutineOutput = { kind: "telegram" };

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: "weekly-gst-check",
    nameKey: "tplGstName",
    descriptionKey: "tplGstDesc",
    cadence: { kind: "weekly", day: 1, time: "10:00" },
    steps: [
      {
        id: "t1",
        role: "Accounts",
        instruction:
          "List last week's sales and purchase invoices from the shared files. Total the GST collected and paid (CGST, SGST, IGST) and show the net amount.",
      },
      {
        id: "t2",
        kind: "condition",
        role: "Accounts",
        instruction:
          "Does any invoice have a missing GSTIN, a wrong tax rate or a missing HSN/SAC code?",
        onNo: { action: "jump", stepId: "t4" },
      },
      {
        id: "t3",
        role: "Accounts",
        instruction:
          "Add a short list of the invoices with problems, what is wrong with each and how to fix it, below the GST summary.",
      },
      { id: "t4", kind: "output", instruction: "", output: FILE },
    ],
  },
  {
    id: "payment-reminders",
    nameKey: "tplRemindName",
    descriptionKey: "tplRemindDesc",
    cadence: { kind: "weekdays", time: "11:00" },
    steps: [
      {
        id: "t1",
        role: "Accounts",
        instruction:
          "Find customer invoices that are unpaid more than 15 days after the due date. List customer, invoice number, amount and days overdue.",
      },
      {
        id: "t2",
        kind: "condition",
        role: "Accounts",
        instruction: "Is at least one invoice overdue?",
        onNo: { action: "stop" },
      },
      {
        id: "t3",
        role: "Sales",
        instruction:
          "Draft a short, polite payment reminder for each overdue customer, in simple English with a one-line Hindi version. Do not send anything.",
      },
      { id: "t4", kind: "approval", instruction: "Send these payment reminders?" },
      {
        id: "t5",
        role: "Sales",
        instruction:
          "Send the approved reminders with the connected email or WhatsApp app, then list who got one.",
      },
      { id: "t6", kind: "output", instruction: "", output: TELEGRAM },
    ],
  },
  {
    id: "lead-follow-up",
    nameKey: "tplLeadsName",
    descriptionKey: "tplLeadsDesc",
    cadence: { kind: "weekdays", time: "09:30" },
    steps: [
      {
        id: "t1",
        role: "Sales",
        instruction:
          "Collect yesterday's new enquiries and leads (email, website form, shared files). For each, note who, what they want and how warm they look.",
      },
      {
        id: "t2",
        kind: "condition",
        role: "Sales",
        instruction: "Is there at least one new lead?",
        onNo: { action: "stop" },
      },
      {
        id: "t3",
        role: "Sales",
        instruction: "Draft a personal follow-up message for each lead. Do not send anything.",
      },
      { id: "t4", kind: "approval", instruction: "Send these follow-ups?" },
      {
        id: "t5",
        role: "Sales",
        instruction: "Send the approved follow-ups and list who got one.",
      },
    ],
  },
  {
    id: "monday-sales-report",
    nameKey: "tplSalesName",
    descriptionKey: "tplSalesDesc",
    cadence: { kind: "weekly", day: 1, time: "09:00" },
    steps: [
      {
        id: "t1",
        role: "Sales",
        instruction:
          "Summarise last week's sales from the shared files: total, top products, top customers, and the change from the week before.",
      },
      {
        id: "t2",
        role: "Content",
        instruction:
          "Turn this into a clear one-page report with a three-line summary at the top. Keep every number exactly as given.",
      },
      { id: "t3", kind: "output", instruction: "", output: FILE },
      { id: "t4", kind: "output", instruction: "", output: TELEGRAM },
    ],
  },
  {
    id: "competitor-watch",
    nameKey: "tplCompetitorName",
    descriptionKey: "tplCompetitorDesc",
    cadence: { kind: "weekly", day: 4, time: "16:00" },
    steps: [
      {
        id: "t1",
        role: "Research",
        instruction:
          "Check our main competitors' websites and marketplace listings for new products, price changes and offers this week. Give sources.",
      },
      {
        id: "t2",
        kind: "condition",
        role: "Research",
        instruction: "Did anything change that we should act on?",
        onNo: { action: "stop" },
      },
      { id: "t3", kind: "output", instruction: "", output: TELEGRAM },
    ],
  },
  {
    id: "social-week-plan",
    nameKey: "tplSocialName",
    descriptionKey: "tplSocialDesc",
    cadence: { kind: "weekly", day: 5, time: "15:00" },
    steps: [
      {
        id: "t1",
        role: "Content",
        instruction:
          "Plan next week's 5 social media posts for our business: topic, format (photo, reel, carousel), and best day to post.",
      },
      { id: "t2", kind: "approval", instruction: "Use this post plan?" },
      {
        id: "t3",
        role: "Content",
        instruction:
          "Write the final caption and hashtags for each planned post. Do not post anything.",
      },
      { id: "t4", kind: "output", instruction: "", output: FILE },
    ],
  },
  {
    id: "review-replies",
    nameKey: "tplReviewsName",
    descriptionKey: "tplReviewsDesc",
    cadence: { kind: "daily", time: "18:00" },
    steps: [
      {
        id: "t1",
        role: "Support",
        instruction:
          "Collect today's new customer reviews and complaints (Google reviews, email, marketplace messages) that have no reply yet.",
      },
      {
        id: "t2",
        kind: "condition",
        role: "Support",
        instruction: "Is there at least one review or complaint without a reply?",
        onNo: { action: "stop" },
      },
      {
        id: "t3",
        role: "Support",
        instruction:
          "Draft a polite, specific reply for each one. Offer a fix for complaints. Do not post anything.",
      },
      { id: "t4", kind: "approval", instruction: "Post these replies?" },
      {
        id: "t5",
        role: "Support",
        instruction: "Post the approved replies and list which ones were posted.",
      },
    ],
  },
  {
    id: "supplier-quotes",
    nameKey: "tplSupplierName",
    descriptionKey: "tplSupplierDesc",
    cadence: null,
    steps: [
      {
        id: "t1",
        role: "Research",
        instruction:
          "Find 3 to 5 suppliers in India for the item in our latest purchase request, with price, minimum order and delivery time. Give sources.",
      },
      {
        id: "t2",
        role: "Accounts",
        instruction:
          "Compare them on total landed cost (price, GST, delivery) and pick the best two.",
      },
      { id: "t3", kind: "approval", instruction: "Ask these two suppliers for a quote?" },
      {
        id: "t4",
        role: "Sales",
        instruction: "Draft a short quote request email to each of the two suppliers.",
      },
      { id: "t5", kind: "output", instruction: "", output: FILE },
    ],
  },
  {
    id: "morning-cash",
    nameKey: "tplCashName",
    descriptionKey: "tplCashDesc",
    cadence: { kind: "weekdays", time: "08:30" },
    steps: [
      {
        id: "t1",
        role: "Accounts",
        instruction:
          "From the latest bank statements and invoices in the shared files, give this morning's cash position: balance, money due in this week, payments due out this week.",
      },
      { id: "t2", kind: "output", instruction: "", output: TELEGRAM },
    ],
  },
  {
    id: "month-end-checklist",
    nameKey: "tplMonthEndName",
    descriptionKey: "tplMonthEndDesc",
    cadence: null,
    steps: [
      {
        id: "t1",
        role: "Accounts",
        instruction:
          "Make this month's closing checklist: bank reconciliation, pending invoices, TDS and GST due dates, salary and vendor payments, with what is done and what is left.",
      },
      {
        id: "t2",
        role: "Ops",
        instruction: "Add an owner and a due date to each open item, and order them by date.",
      },
      { id: "t3", kind: "output", instruction: "", output: FILE },
    ],
  },
];

/** The coworker for a role: same role first, then the orchestrator, then the first coworker. */
export function coworkerForRole(
  role: string | undefined,
  bots: Array<{ id: string; role: string }>,
): string {
  const wanted = role?.toLowerCase();
  const match =
    (wanted && bots.find((bot) => bot.role.toLowerCase() === wanted)) ||
    (wanted && bots.find((bot) => bot.role.toLowerCase().includes(wanted))) ||
    bots.find((bot) => bot.role.toLowerCase() === "orchestrator") ||
    bots[0];
  return match?.id ?? "";
}
