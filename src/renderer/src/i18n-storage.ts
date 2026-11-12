/** Settings > Storage, and the chat's "Load earlier" button. */
export const storageEn = {
  loadEarlier: "Show {count} earlier messages",
  setStorage: "Storage",
  storageIntro:
    "How much space Sahkarmi uses on this computer, and what can be removed safely. Your chats, coworkers and documents are never removed here.",
  storageRefresh: "Measure again",
  storageMeasuring: "Measuring…",
  storageTotal: "Total: {size}",
  storageAtLeast: "at least {size}",
  storageBrowser: "Coworker browsers",
  storageBrowserHint: "Sign-ins and page data of each coworker's browser.",
  storageRuntimes: "AI tools",
  storageRuntimesHint:
    "Copies of Claude Code, Codex, OpenCode and Google's agent that Sahkarmi downloaded.",
  storageAccounts: "Google accounts",
  storageAccountsHint: "Sign-in folders of the extra Google accounts used for Gemini.",
  storageAttachments: "Files sent in chats",
  storageAttachmentsHint: "Files you and your coworkers attached to messages.",
  storageKnowledge: "Knowledge Bases",
  storageKnowledgeHint:
    "Search indexes of your documents. The documents themselves stay where they are.",
  storageLogs: "Logs",
  storageLogsHint: "The app's own log files, used to find problems.",
  storageMailboxArchive: "Old messages",
  storageMailboxArchiveHint: "Messages older than 30 days, kept so old chats stay readable.",
  storageCleanBrowser: "Remove deleted coworkers' data",
  storageCleanRuntimes: "Remove old versions",
  storageCleanAccounts: "Remove removed accounts' data",
  storageCleanLogs: "Remove old logs",
  storageCleanAttachments: "Remove files older than",
  storageDays: "days",
  storageConfirmBrowser:
    "Remove the browser data of coworkers you deleted? Your current coworkers keep their sign-ins.",
  storageConfirmRuntimes:
    "Remove AI tool versions Sahkarmi no longer uses? The version in use, and the last working one, stay.",
  storageConfirmAccounts:
    "Remove the folders of Google accounts you removed? Accounts still listed keep their sign-in.",
  storageConfirmLogs: "Remove the older log files? The current log stays.",
  storageConfirmAttachments:
    "Remove files sent in chats more than {days} days ago? The messages stay, but those files can no longer be opened. This cannot be undone.",
  storageCleaned: "Freed {size} ({count} items).",
  storageNothing: "Nothing to remove.",
  storageSkipped: "{count} items are still in use and will be removed at the next start.",
};

export type StorageDictionary = Record<keyof typeof storageEn, string>;

export const storageHi: StorageDictionary = {
  loadEarlier: "पिछले {count} संदेश दिखाएँ",
  setStorage: "स्टोरेज",
  storageIntro:
    "सहकर्मी इस कंप्यूटर पर कितनी जगह लेता है, और क्या सुरक्षित रूप से हटाया जा सकता है। आपकी चैट, सहकर्मी और दस्तावेज़ यहाँ से कभी नहीं हटते।",
  storageRefresh: "फिर से मापें",
  storageMeasuring: "माप रहे हैं…",
  storageTotal: "कुल: {size}",
  storageAtLeast: "कम से कम {size}",
  storageBrowser: "सहकर्मियों के ब्राउज़र",
  storageBrowserHint: "हर सहकर्मी के ब्राउज़र के साइन-इन और पेज डेटा।",
  storageRuntimes: "AI टूल",
  storageRuntimesHint:
    "Claude Code, Codex, OpenCode और Google एजेंट की कॉपियाँ जो सहकर्मी ने डाउनलोड कीं।",
  storageAccounts: "Google खाते",
  storageAccountsHint: "Gemini के लिए जोड़े गए अतिरिक्त Google खातों के साइन-इन फ़ोल्डर।",
  storageAttachments: "चैट में भेजी फ़ाइलें",
  storageAttachmentsHint: "आपने और आपके सहकर्मियों ने संदेशों के साथ जो फ़ाइलें जोड़ीं।",
  storageKnowledge: "नॉलेज बेस",
  storageKnowledgeHint: "आपके दस्तावेज़ों के सर्च इंडेक्स। दस्तावेज़ अपनी जगह पर ही रहते हैं।",
  storageLogs: "लॉग",
  storageLogsHint: "ऐप की अपनी लॉग फ़ाइलें, समस्याएँ ढूँढने के लिए।",
  storageMailboxArchive: "पुराने संदेश",
  storageMailboxArchiveHint: "30 दिन से पुराने संदेश, ताकि पुरानी चैट पढ़ी जा सकें।",
  storageCleanBrowser: "हटाए गए सहकर्मियों का डेटा हटाएँ",
  storageCleanRuntimes: "पुराने वर्शन हटाएँ",
  storageCleanAccounts: "हटाए गए खातों का डेटा हटाएँ",
  storageCleanLogs: "पुराने लॉग हटाएँ",
  storageCleanAttachments: "इससे पुरानी फ़ाइलें हटाएँ",
  storageDays: "दिन",
  storageConfirmBrowser:
    "जिन सहकर्मियों को आपने हटाया, उनका ब्राउज़र डेटा हटाएँ? मौजूदा सहकर्मियों के साइन-इन बने रहेंगे।",
  storageConfirmRuntimes:
    "AI टूल के वे वर्शन हटाएँ जो सहकर्मी अब इस्तेमाल नहीं करता? चालू वर्शन और आख़िरी चलने वाला वर्शन बने रहेंगे।",
  storageConfirmAccounts:
    "जिन Google खातों को आपने हटाया, उनके फ़ोल्डर हटाएँ? सूची में मौजूद खातों का साइन-इन बना रहेगा।",
  storageConfirmLogs: "पुरानी लॉग फ़ाइलें हटाएँ? मौजूदा लॉग बना रहेगा।",
  storageConfirmAttachments:
    "{days} दिन से पहले चैट में भेजी गई फ़ाइलें हटाएँ? संदेश बने रहेंगे, पर वे फ़ाइलें खुल नहीं पाएँगी। इसे वापस नहीं किया जा सकता।",
  storageCleaned: "{size} जगह खाली हुई ({count} चीज़ें)।",
  storageNothing: "हटाने को कुछ नहीं है।",
  storageSkipped: "{count} चीज़ें अभी इस्तेमाल में हैं, अगली बार ऐप खुलने पर हटेंगी।",
};

export const storageBn: StorageDictionary = {
  loadEarlier: "আগের {count}টি বার্তা দেখান",
  setStorage: "স্টোরেজ",
  storageIntro:
    "সহকর্মী এই কম্পিউটারে কতটা জায়গা নেয়, আর কী নিরাপদে মুছে ফেলা যায়। আপনার চ্যাট, সহকর্মী আর নথি এখান থেকে কখনও মোছা হয় না।",
  storageRefresh: "আবার মাপুন",
  storageMeasuring: "মাপা হচ্ছে…",
  storageTotal: "মোট: {size}",
  storageAtLeast: "অন্তত {size}",
  storageBrowser: "সহকর্মীদের ব্রাউজার",
  storageBrowserHint: "প্রত্যেক সহকর্মীর ব্রাউজারের সাইন-ইন আর পেজের ডেটা।",
  storageRuntimes: "AI টুল",
  storageRuntimesHint:
    "Claude Code, Codex, OpenCode আর Google-এর এজেন্টের যে কপিগুলো সহকর্মী ডাউনলোড করেছে।",
  storageAccounts: "Google অ্যাকাউন্ট",
  storageAccountsHint: "Gemini-এর জন্য যোগ করা বাড়তি Google অ্যাকাউন্টের সাইন-ইন ফোল্ডার।",
  storageAttachments: "চ্যাটে পাঠানো ফাইল",
  storageAttachmentsHint: "আপনি আর আপনার সহকর্মীরা বার্তার সঙ্গে যে ফাইল জুড়েছেন।",
  storageKnowledge: "নলেজ বেস",
  storageKnowledgeHint: "আপনার নথির সার্চ ইনডেক্স। নথিগুলো নিজের জায়গাতেই থাকে।",
  storageLogs: "লগ",
  storageLogsHint: "অ্যাপের নিজের লগ ফাইল, সমস্যা খুঁজতে কাজে লাগে।",
  storageMailboxArchive: "পুরোনো বার্তা",
  storageMailboxArchiveHint: "৩০ দিনের পুরোনো বার্তা, যাতে পুরোনো চ্যাট পড়া যায়।",
  storageCleanBrowser: "মুছে ফেলা সহকর্মীদের ডেটা সরান",
  storageCleanRuntimes: "পুরোনো সংস্করণ সরান",
  storageCleanAccounts: "সরানো অ্যাকাউন্টের ডেটা সরান",
  storageCleanLogs: "পুরোনো লগ সরান",
  storageCleanAttachments: "এর চেয়ে পুরোনো ফাইল সরান",
  storageDays: "দিন",
  storageConfirmBrowser:
    "যে সহকর্মীদের মুছেছেন, তাদের ব্রাউজারের ডেটা সরাবেন? এখনকার সহকর্মীদের সাইন-ইন থেকে যাবে।",
  storageConfirmRuntimes:
    "সহকর্মী আর যে AI টুল সংস্করণগুলো ব্যবহার করে না, সেগুলো সরাবেন? চালু সংস্করণ আর শেষ চলা সংস্করণ থেকে যাবে।",
  storageConfirmAccounts:
    "যে Google অ্যাকাউন্টগুলো সরিয়েছেন, তাদের ফোল্ডার সরাবেন? তালিকায় থাকা অ্যাকাউন্টের সাইন-ইন থেকে যাবে।",
  storageConfirmLogs: "পুরোনো লগ ফাইলগুলো সরাবেন? এখনকার লগ থেকে যাবে।",
  storageConfirmAttachments:
    "{days} দিনেরও আগে চ্যাটে পাঠানো ফাইল সরাবেন? বার্তাগুলো থাকবে, কিন্তু সেই ফাইলগুলো আর খোলা যাবে না। এটা ফেরানো যাবে না।",
  storageCleaned: "{size} জায়গা খালি হল ({count}টি জিনিস)।",
  storageNothing: "সরানোর মতো কিছু নেই।",
  storageSkipped: "{count}টি জিনিস এখনও ব্যবহার হচ্ছে, পরের বার অ্যাপ খুললে সরানো হবে।",
};
