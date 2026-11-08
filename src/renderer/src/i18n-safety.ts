/** Approval provenance and work limits (Phase 1 safety). */
export const safetyEn = {
  provenanceLabel: "Where this request came from:",
  provenanceOwner: "You asked",
  provenanceRemote: "You asked, from your phone",
  provenanceRoutine: "A routine",
  provenanceSchedule: "A schedule",
  provenanceTeamRun: "A team run",
  provenanceCoworker: "Another coworker",
  provenanceCoworkerNamed: "Another coworker ({name})",
  provenanceSystem: "Sahkarmi itself",
  provenanceWeb: "A web page it read ({name})",
  provenanceApp: "A reply from a connected app or tool ({name})",
  provenanceFile: "A file from outside its folders ({name})",
  budgetTitle: "Work limits",
  budgetIntro:
    "Stop a coworker after a number of replies a day, or a team run after a number of steps. Empty means no limit. The coworker pauses before its next reply, never in the middle of one.",
  budgetCoworkerLabel: "Replies a day",
  budgetTeamRunLabel: "Steps per team run",
  budgetUsedToday: "{used} today",
  budgetNoLimit: "No limit",
  budgetOff: "Work limits are switched off in Features, so these limits are not applied.",
  budgetSaved: "Saved",
};

export type SafetyDictionary = typeof safetyEn;

export const safetyHi: SafetyDictionary = {
  provenanceLabel: "यह अनुरोध कहाँ से आया:",
  provenanceOwner: "आपने कहा",
  provenanceRemote: "आपने अपने फ़ोन से कहा",
  provenanceRoutine: "एक रूटीन",
  provenanceSchedule: "एक शेड्यूल",
  provenanceTeamRun: "एक टीम रन",
  provenanceCoworker: "दूसरा सहकर्मी",
  provenanceCoworkerNamed: "दूसरा सहकर्मी ({name})",
  provenanceSystem: "खुद सहकर्मी ऐप",
  provenanceWeb: "उसने जो वेब पेज पढ़ा ({name})",
  provenanceApp: "जुड़े हुए ऐप या टूल का जवाब ({name})",
  provenanceFile: "उसके फ़ोल्डरों के बाहर की फ़ाइल ({name})",
  budgetTitle: "काम की सीमा",
  budgetIntro:
    "किसी सहकर्मी को दिन में तय जवाबों के बाद, या टीम रन को तय चरणों के बाद रोकें। खाली का मतलब कोई सीमा नहीं। सहकर्मी अगले जवाब से पहले रुकता है, बीच में कभी नहीं।",
  budgetCoworkerLabel: "दिन में जवाब",
  budgetTeamRunLabel: "हर टीम रन में चरण",
  budgetUsedToday: "आज {used}",
  budgetNoLimit: "कोई सीमा नहीं",
  budgetOff: "Features में काम की सीमा बंद है, इसलिए ये सीमाएँ लागू नहीं होतीं।",
  budgetSaved: "सहेजा गया",
};

export const safetyBn: SafetyDictionary = {
  provenanceLabel: "এই অনুরোধ কোথা থেকে এসেছে:",
  provenanceOwner: "আপনি বলেছেন",
  provenanceRemote: "আপনি ফোন থেকে বলেছেন",
  provenanceRoutine: "একটি রুটিন",
  provenanceSchedule: "একটি সময়সূচি",
  provenanceTeamRun: "একটি টিম রান",
  provenanceCoworker: "অন্য একজন সহকর্মী",
  provenanceCoworkerNamed: "অন্য একজন সহকর্মী ({name})",
  provenanceSystem: "সহকর্মী অ্যাপ নিজে",
  provenanceWeb: "সে যে ওয়েব পেজ পড়েছে ({name})",
  provenanceApp: "যুক্ত অ্যাপ বা টুলের উত্তর ({name})",
  provenanceFile: "তার ফোল্ডারের বাইরের একটি ফাইল ({name})",
  budgetTitle: "কাজের সীমা",
  budgetIntro:
    "দিনে নির্দিষ্ট সংখ্যক উত্তরের পরে কোনো সহকর্মীকে, বা নির্দিষ্ট ধাপের পরে টিম রানকে থামান। খালি মানে কোনো সীমা নেই। সহকর্মী পরের উত্তরের আগে থামে, মাঝখানে কখনো নয়।",
  budgetCoworkerLabel: "দিনে উত্তর",
  budgetTeamRunLabel: "প্রতি টিম রানে ধাপ",
  budgetUsedToday: "আজ {used}",
  budgetNoLimit: "কোনো সীমা নেই",
  budgetOff: "Features-এ কাজের সীমা বন্ধ আছে, তাই এই সীমাগুলো প্রযোজ্য নয়।",
  budgetSaved: "সংরক্ষিত",
};
