/**
 * Every open-source project whose content Sahkarmi can download, recommend or learned from.
 * Settings > About > Open-source credits renders this list as it is, and it is the ONLY place
 * the app names upstream skill-pack projects, their URLs, copyright lines and licences.
 * Append new entries; never remove one while something still uses it.
 */

/** Permissive open-source licences accepted for anything Sahkarmi downloads (SPDX ids). */
export const ALLOWED_LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"] as const;

export type AllowedLicence = (typeof ALLOWED_LICENCES)[number];

export interface OpenSourceCredit {
  /** Project name as its authors publish it. */
  name: string;
  url: string;
  /** SPDX licence id. */
  licence: string;
  /** Copyright line as written in the project's licence (or its owner when it has none). */
  copyright: string;
  /** NOTICE text, for Apache-2.0 projects that publish one (checked at the pinned commit). */
  notice?: string;
}

export const OPEN_SOURCE_CREDITS: OpenSourceCredit[] = [
  {
    name: "anthropics/knowledge-work-plugins",
    url: "https://github.com/anthropics/knowledge-work-plugins",
    licence: "Apache-2.0",
    copyright:
      "Copyright Anthropic, PBC (the project's LICENSE keeps the unfilled Apache-2.0 template line)",
  },
  {
    name: "anthropics/skills",
    url: "https://github.com/anthropics/skills",
    licence: "Apache-2.0",
    copyright: "Copyright 2026 Anthropic, PBC.",
  },
  {
    name: "coreyhaines31/marketingskills",
    url: "https://github.com/coreyhaines31/marketingskills",
    licence: "MIT",
    copyright: "Copyright (c) 2025 Corey Haines",
  },
  {
    name: "mohitagw15856/pm-claude-skills",
    url: "https://github.com/mohitagw15856/pm-claude-skills",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Mohit Aggarwal",
  },
  {
    name: "nextlevelbuilder/ui-ux-pro-max-skill",
    url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    licence: "MIT",
    copyright: "Copyright (c) 2024 Next Level Builder",
  },
  {
    name: "evolsb/claude-legal-skill",
    url: "https://github.com/evolsb/claude-legal-skill",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Christopher Sheehan",
  },
  {
    name: "mukul975/Privacy-Data-Protection-Skills",
    url: "https://github.com/mukul975/Privacy-Data-Protection-Skills",
    licence: "Apache-2.0",
    copyright: "Copyright 2025 Mahipal",
  },
  {
    name: "tuanductran/hr-skills",
    url: "https://github.com/tuanductran/hr-skills",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Tuan Duc Tran",
  },
];

/** The credit for a GitHub repo ("owner/repo"), matched by URL. */
export function creditForRepo(repo: string): OpenSourceCredit | undefined {
  const url = `https://github.com/${repo}`.toLowerCase();
  return OPEN_SOURCE_CREDITS.find((credit) => credit.url.toLowerCase() === url);
}
