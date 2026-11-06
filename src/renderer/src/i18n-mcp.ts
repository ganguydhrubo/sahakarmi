/** Settings > MCP servers: checks, tests, smart GitHub import and guided installs. */
export const mcpEn = {
  mcpxRecheck: "Re-check",
  mcpxRecheckHint:
    "Installed something just now? Press Re-check: Sahkarmi reads Windows' PATH again, no restart needed.",
  mcpxProblemPlaceholder:
    'This is a template: replace "{token}" with the real value (for example the folder the server is in), then turn it on.',
  mcpxProblemPlaceholderKey:
    'This is a template: {key} still says "{token}". Edit the server and put in the real value.',
  mcpxProblemMissingCommand:
    "Windows can't find \"{command}\" on this PC, so coworkers won't get this server's tools. Install it, or edit the server and use its full path, then press Re-check.",
  mcpxProblemStoreStub:
    '"{command}" is only the Microsoft Store shortcut, not a real Python. Install Python 3.11, then press Re-check.',
  mcpxProblemMissingFolder:
    'The folder "{path}" does not exist. Edit the server and use the folder where the server really is.',
  mcpxProblemMissingFile:
    'The file "{path}" does not exist. Check the folder, or download the server first.',
  mcpxProblemMissingEnv: "This server needs {name}. Edit the server and add it.",
  mcpxGetIt: "Download page",
  mcpxTest: "Test server",
  mcpxTesting: "Testing… the first run can take up to a minute while it downloads.",
  mcpxTestOk: "Works: {count} tools ({names}).",
  mcpxTestOkNone: "It starts, but it offers no tools.",
  mcpxTestFailed: "Test failed: {reason}",
  mcpxLastChecked: "Checked {time}",
  mcpxNeedsTest: "New server: press Test server. You can turn it on once the test passes.",
  mcpxShowDetails: "What the server printed",
  mcpxTools: "Tools",
  mcpxDiag_commandNotFound:
    "The program could not be started: it is not installed or not on PATH. Install it, then press Re-check.",
  mcpxDiag_storeStub:
    "Windows opened the Microsoft Store instead of Python: no real Python is installed.",
  mcpxDiag_moduleMissing:
    "The server started but its parts are missing (not installed, or started in the wrong folder).",
  mcpxDiag_notMcp:
    "This program is a web app or API, not an MCP server: it opened a web address instead of answering. Use it as a Skill instead.",
  mcpxDiag_noReply:
    "The program started but never answered like an MCP server. It may not be one, or it waits for something.",
  mcpxDiag_stdoutNoise:
    "The server prints normal text where MCP messages should go. Look for a --quiet or stdio option, or tell its author.",
  mcpxDiag_auth:
    "The server says the key or token is missing or wrong. Edit the server and check it.",
  mcpxDiag_portInUse:
    "The server tries to open a network port that is already taken, often because another copy runs. Turn on Shared so only one copy runs.",
  mcpxDiag_firstRunTimeout:
    "It was probably still downloading on its first run. Try again and wait a little longer.",
  mcpxDiag_pathNotFound: "A folder or file in the settings does not exist. Edit the server.",
  mcpxDiag_buildTools:
    "It needs build tools (C++ or Rust compilers) that Sahkarmi will not install. Choose a ready-made package or another server.",
  mcpxDiag_pythonVersion: "It needs a different Python version (3.11 is safest).",
  mcpxDiag_exited: "The server stopped right after starting. What it printed is below.",
  mcpxDiag_unknown: "Something went wrong. What the server printed is below.",
  mcpxFix_edit: "Edit server",
  mcpxFix_recheck: "Re-check",
  mcpxFix_retryLong: "Try again (wait longer)",
  mcpxFix_installUv: "Install uv for me",
  mcpxFix_installNode: "Install Node.js for me",
  mcpxFix_installPython: "Install Python 3.11 for me",
  mcpxFix_reinstall: "Install again",
  mcpxFix_skillRoute: "Use it another way",
  mcpxFix_shared: "Run one copy for everyone",
  mcpxCoworkers: "Coworkers",
  mcpxAllCoworkers: "All coworkers",
  mcpxSomeCoworkers: "{count} coworkers",
  mcpxChooseCoworkers: "Which coworkers get this server",
  mcpxCwd: "Folder to start in (optional)",
  mcpxConflict: "{names} already exists. Replace it with the pasted one?",
  mcpxReplace: "Replace",
  mcpxKeep: "Keep mine",
};

type McpDictionary = Record<keyof typeof mcpEn, string>;

export const mcpHi: McpDictionary = {
  mcpxRecheck: "फिर से जाँचें",
  mcpxRecheckHint:
    "अभी कुछ इंस्टॉल किया? फिर से जाँचें दबाएँ: Sahkarmi Windows का PATH दोबारा पढ़ता है, रीस्टार्ट की ज़रूरत नहीं।",
  mcpxProblemPlaceholder:
    'यह एक टेम्पलेट है: "{token}" की जगह असली मान डालें (जैसे वह फ़ोल्डर जिसमें सर्वर है), फिर इसे चालू करें।',
  mcpxProblemPlaceholderKey:
    'यह एक टेम्पलेट है: {key} में अभी भी "{token}" लिखा है। सर्वर बदलें और असली मान डालें।',
  mcpxProblemMissingCommand:
    'Windows को इस PC पर "{command}" नहीं मिल रहा, इसलिए सहकर्मियों को इस सर्वर के टूल नहीं मिलेंगे। इसे इंस्टॉल करें, या सर्वर बदलकर पूरा पाथ डालें, फिर फिर से जाँचें दबाएँ।',
  mcpxProblemStoreStub:
    '"{command}" सिर्फ़ Microsoft Store का शॉर्टकट है, असली Python नहीं। Python 3.11 इंस्टॉल करें, फिर फिर से जाँचें दबाएँ।',
  mcpxProblemMissingFolder: 'फ़ोल्डर "{path}" मौजूद नहीं है। सर्वर बदलें और वह फ़ोल्डर डालें जहाँ सर्वर सच में है।',
  mcpxProblemMissingFile: 'फ़ाइल "{path}" मौजूद नहीं है। फ़ोल्डर जाँचें, या पहले सर्वर डाउनलोड करें।',
  mcpxProblemMissingEnv: "इस सर्वर को {name} चाहिए। सर्वर बदलें और इसे जोड़ें।",
  mcpxGetIt: "डाउनलोड पेज",
  mcpxTest: "सर्वर जाँचें",
  mcpxTesting: "जाँच हो रही है… पहली बार डाउनलोड के कारण एक मिनट तक लग सकता है।",
  mcpxTestOk: "चल रहा है: {count} टूल ({names})।",
  mcpxTestOkNone: "यह शुरू होता है, पर कोई टूल नहीं देता।",
  mcpxTestFailed: "जाँच विफल: {reason}",
  mcpxLastChecked: "{time} को जाँचा",
  mcpxNeedsTest: "नया सर्वर: सर्वर जाँचें दबाएँ। जाँच पास होने के बाद इसे चालू कर सकते हैं।",
  mcpxShowDetails: "सर्वर ने क्या लिखा",
  mcpxTools: "टूल",
  mcpxDiag_commandNotFound:
    "प्रोग्राम शुरू नहीं हो सका: यह इंस्टॉल नहीं है या PATH पर नहीं है। इसे इंस्टॉल करें, फिर फिर से जाँचें दबाएँ।",
  mcpxDiag_storeStub:
    "Windows ने Python की जगह Microsoft Store खोल दिया: कोई असली Python इंस्टॉल नहीं है।",
  mcpxDiag_moduleMissing: "सर्वर शुरू हुआ पर उसके हिस्से नहीं मिले (इंस्टॉल नहीं हैं, या गलत फ़ोल्डर में शुरू हुआ)।",
  mcpxDiag_notMcp:
    "यह प्रोग्राम एक वेब ऐप या API है, MCP सर्वर नहीं: इसने जवाब देने की जगह एक वेब पता खोला। इसे स्किल की तरह इस्तेमाल करें।",
  mcpxDiag_noReply:
    "प्रोग्राम शुरू हुआ पर उसने कभी MCP सर्वर की तरह जवाब नहीं दिया। शायद यह MCP सर्वर नहीं है, या किसी चीज़ का इंतज़ार कर रहा है।",
  mcpxDiag_stdoutNoise:
    "सर्वर MCP संदेशों की जगह सामान्य टेक्स्ट लिखता है। --quiet या stdio विकल्प देखें, या इसके लेखक को बताएँ।",
  mcpxDiag_auth: "सर्वर कहता है कि की या टोकन नहीं है या गलत है। सर्वर बदलें और इसे जाँचें।",
  mcpxDiag_portInUse:
    "सर्वर ऐसा नेटवर्क पोर्ट खोलना चाहता है जो पहले से इस्तेमाल में है, अक्सर क्योंकि दूसरी कॉपी चल रही है। साझा चालू करें ताकि एक ही कॉपी चले।",
  mcpxDiag_firstRunTimeout:
    "पहली बार यह शायद अभी डाउनलोड हो रहा था। फिर से कोशिश करें और थोड़ा ज़्यादा इंतज़ार करें।",
  mcpxDiag_pathNotFound: "सेटिंग में दिया कोई फ़ोल्डर या फ़ाइल मौजूद नहीं है। सर्वर बदलें।",
  mcpxDiag_buildTools:
    "इसे बिल्ड टूल (C++ या Rust कंपाइलर) चाहिए जो Sahkarmi इंस्टॉल नहीं करेगा। तैयार पैकेज या दूसरा सर्वर चुनें।",
  mcpxDiag_pythonVersion: "इसे Python का दूसरा वर्ज़न चाहिए (3.11 सबसे सुरक्षित है)।",
  mcpxDiag_exited: "सर्वर शुरू होते ही बंद हो गया। उसने जो लिखा वह नीचे है।",
  mcpxDiag_unknown: "कुछ गड़बड़ हुई। सर्वर ने जो लिखा वह नीचे है।",
  mcpxFix_edit: "सर्वर बदलें",
  mcpxFix_recheck: "फिर से जाँचें",
  mcpxFix_retryLong: "फिर कोशिश करें (ज़्यादा इंतज़ार)",
  mcpxFix_installUv: "मेरे लिए uv इंस्टॉल करें",
  mcpxFix_installNode: "मेरे लिए Node.js इंस्टॉल करें",
  mcpxFix_installPython: "मेरे लिए Python 3.11 इंस्टॉल करें",
  mcpxFix_reinstall: "फिर से इंस्टॉल करें",
  mcpxFix_skillRoute: "इसे दूसरे तरीके से इस्तेमाल करें",
  mcpxFix_shared: "सबके लिए एक कॉपी चलाएँ",
  mcpxCoworkers: "सहकर्मी",
  mcpxAllCoworkers: "सभी सहकर्मी",
  mcpxSomeCoworkers: "{count} सहकर्मी",
  mcpxChooseCoworkers: "किन सहकर्मियों को यह सर्वर मिले",
  mcpxCwd: "शुरू करने का फ़ोल्डर (वैकल्पिक)",
  mcpxConflict: "{names} पहले से मौजूद है। क्या इसे चिपकाए गए सर्वर से बदल दें?",
  mcpxReplace: "बदलें",
  mcpxKeep: "मेरा वाला रखें",
};

export const mcpBn: McpDictionary = {
  mcpxRecheck: "আবার দেখুন",
  mcpxRecheckHint:
    "এইমাত্র কিছু ইনস্টল করেছেন? আবার দেখুন চাপুন: Sahkarmi Windows-এর PATH আবার পড়ে, রিস্টার্ট লাগে না।",
  mcpxProblemPlaceholder:
    'এটি একটি টেমপ্লেট: "{token}"-এর জায়গায় আসল মান দিন (যেমন যে ফোল্ডারে সার্ভারটি আছে), তারপর চালু করুন।',
  mcpxProblemPlaceholderKey:
    'এটি একটি টেমপ্লেট: {key}-এ এখনও "{token}" লেখা। সার্ভারটি বদলে আসল মান দিন।',
  mcpxProblemMissingCommand:
    'Windows এই পিসিতে "{command}" খুঁজে পাচ্ছে না, তাই সহকর্মীরা এই সার্ভারের টুল পাবে না। এটি ইনস্টল করুন, বা সার্ভার বদলে পুরো পাথ দিন, তারপর আবার দেখুন চাপুন।',
  mcpxProblemStoreStub:
    '"{command}" শুধু Microsoft Store-এর শর্টকাট, আসল Python নয়। Python 3.11 ইনস্টল করুন, তারপর আবার দেখুন চাপুন।',
  mcpxProblemMissingFolder: 'ফোল্ডার "{path}" নেই। সার্ভার বদলে সেই ফোল্ডার দিন যেখানে সার্ভারটি সত্যিই আছে।',
  mcpxProblemMissingFile: 'ফাইল "{path}" নেই। ফোল্ডারটি দেখুন, বা আগে সার্ভারটি ডাউনলোড করুন।',
  mcpxProblemMissingEnv: "এই সার্ভারের {name} দরকার। সার্ভার বদলে এটি যোগ করুন।",
  mcpxGetIt: "ডাউনলোড পেজ",
  mcpxTest: "সার্ভার পরীক্ষা",
  mcpxTesting: "পরীক্ষা চলছে… প্রথমবার ডাউনলোডের জন্য এক মিনিট পর্যন্ত লাগতে পারে।",
  mcpxTestOk: "চলছে: {count}টি টুল ({names})।",
  mcpxTestOkNone: "এটি চালু হয়, কিন্তু কোনো টুল দেয় না।",
  mcpxTestFailed: "পরীক্ষা ব্যর্থ: {reason}",
  mcpxLastChecked: "{time}-এ দেখা হয়েছে",
  mcpxNeedsTest: "নতুন সার্ভার: সার্ভার পরীক্ষা চাপুন। পরীক্ষা পাস হলে চালু করতে পারবেন।",
  mcpxShowDetails: "সার্ভার যা লিখেছে",
  mcpxTools: "টুল",
  mcpxDiag_commandNotFound:
    "প্রোগ্রামটি চালু করা গেল না: এটি ইনস্টল নেই বা PATH-এ নেই। ইনস্টল করে আবার দেখুন চাপুন।",
  mcpxDiag_storeStub: "Windows Python-এর বদলে Microsoft Store খুলেছে: কোনো আসল Python ইনস্টল নেই।",
  mcpxDiag_moduleMissing: "সার্ভার চালু হয়েছে কিন্তু তার অংশগুলো নেই (ইনস্টল হয়নি, বা ভুল ফোল্ডারে চালু হয়েছে)।",
  mcpxDiag_notMcp:
    "এই প্রোগ্রামটি একটি ওয়েব অ্যাপ বা API, MCP সার্ভার নয়: উত্তর দেওয়ার বদলে এটি একটি ওয়েব ঠিকানা খুলেছে। এটিকে স্কিল হিসেবে ব্যবহার করুন।",
  mcpxDiag_noReply:
    "প্রোগ্রাম চালু হয়েছে কিন্তু কখনও MCP সার্ভারের মতো উত্তর দেয়নি। হয়তো এটি MCP সার্ভার নয়, বা কিছুর অপেক্ষায় আছে।",
  mcpxDiag_stdoutNoise:
    "সার্ভার MCP বার্তার জায়গায় সাধারণ লেখা লেখে। --quiet বা stdio বিকল্প খুঁজুন, বা এর লেখককে জানান।",
  mcpxDiag_auth: "সার্ভার বলছে কী বা টোকেন নেই বা ভুল। সার্ভার বদলে এটি দেখুন।",
  mcpxDiag_portInUse:
    "সার্ভার এমন নেটওয়ার্ক পোর্ট খুলতে চায় যা আগে থেকেই ব্যবহৃত, সাধারণত কারণ আরেকটি কপি চলছে। শেয়ার্ড চালু করুন যাতে একটিই কপি চলে।",
  mcpxDiag_firstRunTimeout:
    "প্রথমবার এটি সম্ভবত তখনও ডাউনলোড হচ্ছিল। আবার চেষ্টা করুন এবং একটু বেশি অপেক্ষা করুন।",
  mcpxDiag_pathNotFound: "সেটিংসে থাকা কোনো ফোল্ডার বা ফাইল নেই। সার্ভারটি বদলান।",
  mcpxDiag_buildTools:
    "এর জন্য বিল্ড টুল (C++ বা Rust কম্পাইলার) লাগে যা Sahkarmi ইনস্টল করবে না। তৈরি প্যাকেজ বা অন্য সার্ভার বেছে নিন।",
  mcpxDiag_pythonVersion: "এর জন্য অন্য Python সংস্করণ লাগে (3.11 সবচেয়ে নিরাপদ)।",
  mcpxDiag_exited: "সার্ভার চালু হয়েই বন্ধ হয়ে গেছে। এটি যা লিখেছে তা নিচে আছে।",
  mcpxDiag_unknown: "কিছু ভুল হয়েছে। সার্ভার যা লিখেছে তা নিচে আছে।",
  mcpxFix_edit: "সার্ভার বদলান",
  mcpxFix_recheck: "আবার দেখুন",
  mcpxFix_retryLong: "আবার চেষ্টা (বেশি অপেক্ষা)",
  mcpxFix_installUv: "আমার জন্য uv ইনস্টল করুন",
  mcpxFix_installNode: "আমার জন্য Node.js ইনস্টল করুন",
  mcpxFix_installPython: "আমার জন্য Python 3.11 ইনস্টল করুন",
  mcpxFix_reinstall: "আবার ইনস্টল করুন",
  mcpxFix_skillRoute: "অন্যভাবে ব্যবহার করুন",
  mcpxFix_shared: "সবার জন্য একটি কপি চালান",
  mcpxCoworkers: "সহকর্মী",
  mcpxAllCoworkers: "সব সহকর্মী",
  mcpxSomeCoworkers: "{count} জন সহকর্মী",
  mcpxChooseCoworkers: "কোন সহকর্মীরা এই সার্ভার পাবে",
  mcpxCwd: "যে ফোল্ডারে চালু হবে (ঐচ্ছিক)",
  mcpxConflict: "{names} আগে থেকেই আছে। পেস্ট করা সার্ভার দিয়ে বদলে দেবেন?",
  mcpxReplace: "বদলান",
  mcpxKeep: "আমারটা রাখুন",
};
