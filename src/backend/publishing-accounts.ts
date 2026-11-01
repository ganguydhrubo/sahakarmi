import type { SocialPlatform } from "../shared/ipc";

const PLATFORM_HOSTS: Array<{ platform: SocialPlatform; hosts: string[] }> = [
  { platform: "facebook", hosts: ["facebook.com", "fb.com"] },
  { platform: "instagram", hosts: ["instagram.com"] },
  { platform: "linkedin", hosts: ["linkedin.com"] },
];

/** The social platform a page belongs to, or null for any other site. */
export function socialPlatformForUrl(url: string): SocialPlatform | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const { platform, hosts } of PLATFORM_HOSTS) {
    if (hosts.some((item) => host === item || host.endsWith(`.${item}`))) return platform;
  }
  return null;
}

/** The social platform a Composio tool posts to, from its slug ("LINKEDIN_CREATE_POST"). */
export function socialPlatformForTool(slug: string): SocialPlatform | null {
  const match = slug.toUpperCase().match(/^(FACEBOOK|INSTAGRAM|LINKEDIN)_/);
  return match ? (match[1]?.toLowerCase() as SocialPlatform) : null;
}

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

/** Where the owner can open an account id to see whose it is. */
export function accountLink(platform: SocialPlatform, accountId: string): string | null {
  if (platform === "facebook") return `https://www.facebook.com/profile.php?id=${accountId}`;
  if (platform === "linkedin") return `https://www.linkedin.com/in/${accountId}/`;
  return null;
}

/** The cookie that names the signed-in account, on platforms that have one. */
export const ACCOUNT_COOKIES: Partial<Record<SocialPlatform, { url: string; name: string }>> = {
  facebook: { url: "https://www.facebook.com", name: "c_user" },
  instagram: { url: "https://www.instagram.com", name: "ds_user_id" },
};

/** LinkedIn sends /in/me/ to the signed-in member's own address. */
export function linkedinAccountFromRedirect(location: string | null): string | null {
  if (!location) return null;
  const match = location.match(/\/in\/([^/?#]+)/i);
  const slug = match?.[1];
  return slug && slug.toLowerCase() !== "me" ? decodeURIComponent(slug) : null;
}

/**
 * The website a sign-in belongs to. Close enough to the registrable domain for matching cookies;
 * the two-letter-country forms common in India and elsewhere keep three labels (example.co.in).
 */
export function siteOfHost(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  const keep = last.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function siteOfUrl(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? siteOfHost(hostname) : null;
  } catch {
    return null;
  }
}
