/**
 * Every open-source project whose content Sahkarmi can download or recommend: skill packs now,
 * MCP presets later. Settings > About > Open-source credits renders this list as it is, and it
 * is the ONLY place the app names upstream projects, their URLs, copyright lines and licences.
 * Append new entries here; never remove one while something still uses it.
 */

/** Only permissive open-source licences are accepted. */
export const ALLOWED_LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"] as const;

export type AllowedLicence = (typeof ALLOWED_LICENCES)[number];

export interface OpenSourceCredit {
  /** Stable id other lists (skill packs, MCP presets) point at. */
  id: string;
  /** Project name as its authors publish it. */
  project: string;
  url: string;
  licence: AllowedLicence;
  /** Copyright line as written in the project's licence (or the owner when it has none). */
  copyright: string;
  /**
   * The project's NOTICE text, for Apache-2.0 projects that publish one. Null means the
   * project publishes no NOTICE file (checked at the pinned commit).
   */
  notice: string | null;
  /** What Sahkarmi uses it for, in plain English (Sahkarmi's own words). */
  usedFor: string;
}

export const OPEN_SOURCE_CREDITS: OpenSourceCredit[] = [
  {
    id: "business-plugins",
    project: "anthropics/knowledge-work-plugins",
    url: "https://github.com/anthropics/knowledge-work-plugins",
    licence: "Apache-2.0",
    copyright:
      "Copyright Anthropic, PBC (the project's LICENSE keeps the unfilled Apache-2.0 template line)",
    notice: null,
    usedFor:
      "Sales, customer support, HR, legal, finance, product, small business, operations, marketing, data and productivity skill packs",
  },
  {
    id: "document-skills",
    project: "anthropics/skills",
    url: "https://github.com/anthropics/skills",
    licence: "Apache-2.0",
    copyright: "Copyright 2026 Anthropic, PBC.",
    notice: null,
    usedFor: "Documents & writing pack (only skills whose own LICENSE.txt is Apache-2.0)",
  },
  {
    id: "marketing-skills",
    project: "coreyhaines31/marketingskills",
    url: "https://github.com/coreyhaines31/marketingskills",
    licence: "MIT",
    copyright: "Copyright (c) 2025 Corey Haines",
    notice: null,
    usedFor: "Growth marketing pack",
  },
  {
    id: "product-skills",
    project: "mohitagw15856/pm-claude-skills",
    url: "https://github.com/mohitagw15856/pm-claude-skills",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Mohit Aggarwal",
    notice: null,
    usedFor: "Product playbooks pack",
  },
  {
    id: "design-skills",
    project: "nextlevelbuilder/ui-ux-pro-max-skill",
    url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    licence: "MIT",
    copyright: "Copyright (c) 2024 Next Level Builder",
    notice: null,
    usedFor: "Design & UX pack (text-only skills; none of its scripts)",
  },
  {
    id: "contract-skills",
    project: "evolsb/claude-legal-skill",
    url: "https://github.com/evolsb/claude-legal-skill",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Christopher Sheehan",
    notice: null,
    usedFor: "Contract review pack (not legal advice)",
  },
  {
    id: "privacy-skills",
    project: "mukul975/Privacy-Data-Protection-Skills",
    url: "https://github.com/mukul975/Privacy-Data-Protection-Skills",
    licence: "Apache-2.0",
    copyright: "Copyright 2025 Mahipal",
    notice: null,
    usedFor:
      "Privacy & DPDP pack (India DPDP Act and GDPR skills only; scripts are not downloaded)",
  },
  {
    id: "hr-skills",
    project: "tuanductran/hr-skills",
    url: "https://github.com/tuanductran/hr-skills",
    licence: "MIT",
    copyright: "Copyright (c) 2026 Tuan Duc Tran",
    notice: null,
    usedFor: "HR handbook pack",
  },
];

export function creditById(id: string): OpenSourceCredit | undefined {
  return OPEN_SOURCE_CREDITS.find((credit) => credit.id === id);
}
