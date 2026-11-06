/** Team runs, engine limits, interrupted tasks and the Performance view. */
export const engineEn = {
  engineInterruptedTitle: "This task was interrupted before it finished",
  engineInterruptedBody: "Sahkarmi closed (or the AI stopped) while {name} was working on it.",
  engineRunAgain: "Run again",
  engineDismiss: "Dismiss",
  engineVerdictPassed: "Checked",
  engineVerdictFailed: "Check failed",
  engineVerdictUnverified: "Not verified",
  engineUnverifiedHint:
    "Nothing outside the coworker's own word could be checked: its reply named no files and this run has no check command.",
  engineCheckLabel: "Check command (optional)",
  engineCheckPlaceholder: "For example: npm test",
  engineCheckHint:
    "Runs in the Shared folder after each task, only as your permission rules allow. Leave empty to skip.",
  enginePlannedByCeo: "Planned by {name}",
  enginePlannedByTemplate: "Standard plan",
  engineReplanned: "Plan revised {count} time(s) after a failure",
  engineReviewTitle: "Second opinion",
  engineSettingsTitle: "How hard coworkers may work this PC",
  engineMaxTurnsLabel: "Coworkers working at the same time",
  engineMaxTurnsHint:
    "Others wait their turn and start as soon as one finishes. Lower it on a slow or 8 GB laptop.",
  engineWatchdogLabel: "Stop a turn with no progress after (minutes)",
  engineWatchdogHint:
    "A turn that shows no text and uses no tool for this long is stopped. Turns waiting for your approval are never stopped.",
  engineSaved: "Saved",
  performanceTitle: "Performance",
  performanceIntro:
    "How coworker turns went on this PC: time taken, tools used and outcome. Stored only on this computer; nothing is sent anywhere.",
  performanceEmpty: "No finished turns recorded yet.",
  performanceByCoworker: "By coworker",
  performanceByModel: "By model",
  performanceRecent: "Recent turns",
  performanceTurns: "Turns",
  performanceDone: "Done",
  performanceFailed: "Failed",
  performanceMedian: "Typical time",
  performanceTools: "Tools per turn",
  performanceRefresh: "Refresh",
  performanceShow: "Show performance",
  performanceHide: "Hide performance",
};

export type EngineDictionary = typeof engineEn;

export const engineHi: EngineDictionary = {
  engineInterruptedTitle: "यह काम पूरा होने से पहले रुक गया",
  engineInterruptedBody: "{name} इस पर काम कर रहा था तभी सहकर्मी बंद हो गया (या AI रुक गया)।",
  engineRunAgain: "फिर से चलाएँ",
  engineDismiss: "हटाएँ",
  engineVerdictPassed: "जाँचा गया",
  engineVerdictFailed: "जाँच विफल",
  engineVerdictUnverified: "जाँचा नहीं गया",
  engineUnverifiedHint:
    "सहकर्मी की अपनी बात के अलावा कुछ जाँचा नहीं जा सका: उसके जवाब में कोई फ़ाइल नहीं थी और इस रन में कोई जाँच कमांड नहीं है।",
  engineCheckLabel: "जाँच कमांड (वैकल्पिक)",
  engineCheckPlaceholder: "उदाहरण: npm test",
  engineCheckHint:
    "हर काम के बाद Shared फ़ोल्डर में चलती है, सिर्फ़ उतनी जितनी आपके अनुमति नियम दें। छोड़ना हो तो खाली रखें।",
  enginePlannedByCeo: "{name} ने योजना बनाई",
  enginePlannedByTemplate: "सामान्य योजना",
  engineReplanned: "विफलता के बाद योजना {count} बार बदली गई",
  engineReviewTitle: "दूसरी राय",
  engineSettingsTitle: "सहकर्मी इस PC पर कितना काम करें",
  engineMaxTurnsLabel: "एक साथ काम करने वाले सहकर्मी",
  engineMaxTurnsHint:
    "बाकी अपनी बारी का इंतज़ार करते हैं और किसी के ख़त्म होते ही शुरू हो जाते हैं। धीमे या 8 GB लैपटॉप पर इसे कम रखें।",
  engineWatchdogLabel: "बिना प्रगति वाले टर्न को इतने मिनट बाद रोकें",
  engineWatchdogHint:
    "जो टर्न इतनी देर तक न कुछ लिखे, न कोई टूल चलाए, उसे रोक दिया जाता है। आपकी मंज़ूरी का इंतज़ार कर रहे टर्न कभी नहीं रोके जाते।",
  engineSaved: "सहेजा गया",
  performanceTitle: "प्रदर्शन",
  performanceIntro:
    "इस PC पर सहकर्मियों के टर्न कैसे रहे: लगा समय, इस्तेमाल हुए टूल और नतीजा। सिर्फ़ इसी कंप्यूटर पर रखा जाता है; कहीं नहीं भेजा जाता।",
  performanceEmpty: "अभी तक कोई पूरा टर्न दर्ज नहीं हुआ।",
  performanceByCoworker: "सहकर्मी के अनुसार",
  performanceByModel: "मॉडल के अनुसार",
  performanceRecent: "हाल के टर्न",
  performanceTurns: "टर्न",
  performanceDone: "पूरे",
  performanceFailed: "विफल",
  performanceMedian: "आम तौर पर लगा समय",
  performanceTools: "प्रति टर्न टूल",
  performanceRefresh: "ताज़ा करें",
  performanceShow: "प्रदर्शन दिखाएँ",
  performanceHide: "प्रदर्शन छिपाएँ",
};

export const engineBn: EngineDictionary = {
  engineInterruptedTitle: "এই কাজটি শেষ হওয়ার আগেই থেমে গেছে",
  engineInterruptedBody: "{name} এটি নিয়ে কাজ করার সময় সহকর্মী বন্ধ হয়ে গিয়েছিল (বা AI থেমে গিয়েছিল)।",
  engineRunAgain: "আবার চালান",
  engineDismiss: "সরিয়ে দিন",
  engineVerdictPassed: "যাচাই হয়েছে",
  engineVerdictFailed: "যাচাই ব্যর্থ",
  engineVerdictUnverified: "যাচাই হয়নি",
  engineUnverifiedHint:
    "সহকর্মীর নিজের কথার বাইরে কিছু যাচাই করা যায়নি: তার উত্তরে কোনো ফাইলের নাম ছিল না এবং এই রানে কোনো যাচাই কমান্ড নেই।",
  engineCheckLabel: "যাচাই কমান্ড (ঐচ্ছিক)",
  engineCheckPlaceholder: "যেমন: npm test",
  engineCheckHint:
    "প্রতিটি কাজের পরে Shared ফোল্ডারে চলে, শুধু আপনার অনুমতির নিয়ম যতটা দেয়। বাদ দিতে চাইলে খালি রাখুন।",
  enginePlannedByCeo: "{name} পরিকল্পনা করেছে",
  enginePlannedByTemplate: "সাধারণ পরিকল্পনা",
  engineReplanned: "ব্যর্থতার পরে পরিকল্পনা {count} বার বদলানো হয়েছে",
  engineReviewTitle: "দ্বিতীয় মতামত",
  engineSettingsTitle: "সহকর্মীরা এই PC-তে কতটা কাজ করবে",
  engineMaxTurnsLabel: "একসাথে কাজ করা সহকর্মী",
  engineMaxTurnsHint:
    "বাকিরা নিজের পালার অপেক্ষা করে এবং কেউ শেষ করলেই শুরু করে। ধীর বা 8 GB ল্যাপটপে এটি কম রাখুন।",
  engineWatchdogLabel: "অগ্রগতি না থাকলে এত মিনিট পরে টার্ন থামান",
  engineWatchdogHint:
    "যে টার্ন এতক্ষণ কিছু লেখে না বা কোনো টুল চালায় না, সেটি থামানো হয়। আপনার অনুমোদনের অপেক্ষায় থাকা টার্ন কখনো থামানো হয় না।",
  engineSaved: "সংরক্ষিত",
  performanceTitle: "পারফরম্যান্স",
  performanceIntro:
    "এই PC-তে সহকর্মীদের টার্ন কেমন গেছে: সময়, ব্যবহৃত টুল ও ফলাফল। শুধু এই কম্পিউটারেই রাখা হয়; কোথাও পাঠানো হয় না।",
  performanceEmpty: "এখনো কোনো শেষ হওয়া টার্ন রেকর্ড হয়নি।",
  performanceByCoworker: "সহকর্মী অনুযায়ী",
  performanceByModel: "মডেল অনুযায়ী",
  performanceRecent: "সাম্প্রতিক টার্ন",
  performanceTurns: "টার্ন",
  performanceDone: "সম্পন্ন",
  performanceFailed: "ব্যর্থ",
  performanceMedian: "সাধারণ সময়",
  performanceTools: "প্রতি টার্নে টুল",
  performanceRefresh: "রিফ্রেশ",
  performanceShow: "পারফরম্যান্স দেখান",
  performanceHide: "পারফরম্যান্স লুকান",
};
