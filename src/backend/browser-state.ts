import { readFile } from "node:fs/promises";

export function persistentBrowserUrl(value: string): string {
  const url = new URL(value);
  // Never persist inline credentials to the restored-tabs file.
  url.username = "";
  url.password = "";
  return url.toString();
}

/** Which pages each coworker has used, from the permission audit log. Best effort. */
export async function browserPagesFromAudit(
  auditPath: string,
): Promise<Array<{ botId: string; url: string }>> {
  try {
    const parsed = JSON.parse(await readFile(auditPath, "utf8")) as {
      entries?: Array<{ botId?: unknown; action?: unknown }>;
    };
    return (parsed.entries ?? []).flatMap((entry) => {
      const url =
        typeof entry.action === "string" ? entry.action.match(/https?:\/\/\S+/)?.[0] : null;
      return typeof entry.botId === "string" && url ? [{ botId: entry.botId, url }] : [];
    });
  } catch {
    return [];
  }
}
