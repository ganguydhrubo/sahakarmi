export function persistentBrowserUrl(value: string): string {
  const url = new URL(value);
  // Never persist inline credentials to the restored-tabs file.
  url.username = "";
  url.password = "";
  return url.toString();
}
