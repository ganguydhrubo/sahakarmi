/** Shared by every runtime's copy of the learning tools, so their wording stays identical. */
export const SEARCH_PAST_CHATS_DESCRIPTION =
  "Search earlier conversations to recall what was said, decided or delivered (all words must match). Returns short excerpts with the coworker, author and date, newest first.";
export const LIST_SKILLS_DESCRIPTION =
  "List the team's skills: Marketplace playbooks the owner installed and skills coworkers learned, each with when to use it.";
export const LIST_KNOWLEDGE_BASES_DESCRIPTION =
  "List the Knowledge Bases (the owner's indexed documents) you may search: id, name, file count and the kinds of files in each.";
export const SEARCH_KNOWLEDGE_BASE_DESCRIPTION =
  "Search the owner's Knowledge Bases (PDF, Word, PowerPoint, Excel, CSV, Markdown, text) for a question or key words. Returns the best matching excerpts with file name and page, slide or sheet, numbered [S1], [S2]... Quote these anchors when you use a fact. Words must appear in the document (English, Hindi or Bengali); try other words if nothing is found.";
export const READ_DOCUMENT_SECTION_DESCRIPTION =
  "Read more of one indexed document: a whole page, or the passages around an excerpt (by its chunkIndex), or the beginning. Use after search_knowledge_base when an excerpt is cut short or you need the surrounding context.";
export const SAVE_SKILL_DESCRIPTION =
  "Save what you learned as a reusable playbook after a task that took several steps, a fix, or a correction from the owner. Saving under an existing name improves that skill (its version goes up). Write clear numbered steps; never include passwords, OTPs, keys, card numbers or personal data.";
export const SAVE_MEMORY_DESCRIPTION =
  "Save a fact, decision or owner preference to this workspace's team memory, so you and your teammates can recall it in later chats (other workspaces never see it). Saving again under the same key replaces that memory instead of adding a copy. Related memories are added to the owner's later messages automatically. Never save passwords, OTPs, keys, card numbers or personal data.";
export const SEARCH_MEMORY_DESCRIPTION =
  "Search this workspace's team memory by words (word forms match, e.g. invoice finds invoices; it does not search by meaning). Returns the best matches first, up to limit (default 20).";
export const LIST_MEMORIES_DESCRIPTION =
  "List this workspace's team memory, newest first, one page at a time: limit (default 20, at most 50) and offset for the next page. Use search_memory to find something specific.";
