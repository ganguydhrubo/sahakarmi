/** Settings › MCP servers › Ready-made connectors (feature "mcp-connector-gallery"). */
export const connectorsEn = {
  mcpcTitle: "Ready-made connectors",
  mcpcIntro:
    "Free, checked connectors. Nothing is downloaded or started until you press Add, and each one is saved switched off: press Test server in the list, then turn it on.",
  mcpcAdd: "Add",
  mcpcAddOff: "Add (switched off)",
  mcpcAddNote:
    "Saved switched off. The first test downloads the pinned version once; after that it starts only when a coworker uses it.",
  mcpcAddedNotice:
    '"{name}" was added switched off. Press Test server below, then turn it on for the coworkers you choose.',
  mcpcAlreadyAdded: 'Added as "{name}".',
  mcpcHosted: "hosted online",
  mcpcVersion: "version {version}",
  mcpcRuntimeNode: "Runs on this PC (Node.js)",
  mcpcRuntimePython: "Runs on this PC (uv)",
  mcpcRuntimeRemote: "Online, nothing to install",
  mcpcRuntimeProgram: "Runs a program you download",
  mcpcNeedsKeys: "You will need: {keys}.",
  mcpcNeedsNode: "Needs Node.js {min} or newer.",
  mcpcNeedsNodeFound: "Needs Node.js {min} or newer; this PC has {found}.",
  mcpcNeedsUv: "Needs uv, the free tool that runs Python connectors.",
  mcpcNeedsGit: "Needs Git for Windows.",
  mcpcNeedsChrome: "Needs Google Chrome.",
  mcpcInstallHint: "Sahkarmi does not install it for you: install it, then press Re-check.",
  mcpcGetIt: "Where to get it",
  mcpcSetup: "Open the setup page",
};

type ConnectorsDictionary = Record<keyof typeof connectorsEn, string>;

export const connectorsHi: ConnectorsDictionary = {
  mcpcTitle: "तैयार कनेक्टर",
  mcpcIntro:
    "मुफ़्त, जाँचे हुए कनेक्टर। जब तक आप जोड़ें नहीं दबाते, कुछ भी डाउनलोड या शुरू नहीं होता, और हर कनेक्टर बंद करके सहेजा जाता है: सूची में सर्वर जाँचें दबाएँ, फिर चालू करें।",
  mcpcAdd: "जोड़ें",
  mcpcAddOff: "जोड़ें (बंद रहेगा)",
  mcpcAddNote:
    "बंद करके सहेजा जाता है। पहली जाँच तय संस्करण एक बार डाउनलोड करती है; उसके बाद यह तभी चलता है जब कोई सहकर्मी इसका उपयोग करे।",
  mcpcAddedNotice: '"{name}" बंद करके जोड़ा गया। नीचे सर्वर जाँचें दबाएँ, फिर अपने चुने सहकर्मियों के लिए चालू करें।',
  mcpcAlreadyAdded: '"{name}" नाम से जोड़ा गया।',
  mcpcHosted: "ऑनलाइन",
  mcpcVersion: "संस्करण {version}",
  mcpcRuntimeNode: "इस पीसी पर चलता है (Node.js)",
  mcpcRuntimePython: "इस पीसी पर चलता है (uv)",
  mcpcRuntimeRemote: "ऑनलाइन, कुछ इंस्टॉल नहीं करना",
  mcpcRuntimeProgram: "आपका डाउनलोड किया प्रोग्राम चलाता है",
  mcpcNeedsKeys: "आपको चाहिए: {keys}।",
  mcpcNeedsNode: "Node.js {min} या नया चाहिए।",
  mcpcNeedsNodeFound: "Node.js {min} या नया चाहिए; इस पीसी पर {found} है।",
  mcpcNeedsUv: "uv चाहिए, मुफ़्त टूल जो Python कनेक्टर चलाता है।",
  mcpcNeedsGit: "Git for Windows चाहिए।",
  mcpcNeedsChrome: "Google Chrome चाहिए।",
  mcpcInstallHint: "सहकर्मी इसे आपके लिए इंस्टॉल नहीं करता: इसे इंस्टॉल करें, फिर फिर से जाँचें दबाएँ।",
  mcpcGetIt: "कहाँ से लें",
  mcpcSetup: "सेटअप पेज खोलें",
};

export const connectorsBn: ConnectorsDictionary = {
  mcpcTitle: "তৈরি কানেক্টর",
  mcpcIntro:
    "বিনামূল্যে, যাচাই করা কানেক্টর। যোগ করুন না চাপা পর্যন্ত কিছুই ডাউনলোড বা চালু হয় না, আর প্রতিটি বন্ধ অবস্থায় সেভ হয়: তালিকায় সার্ভার পরীক্ষা চাপুন, তারপর চালু করুন।",
  mcpcAdd: "যোগ করুন",
  mcpcAddOff: "যোগ করুন (বন্ধ থাকবে)",
  mcpcAddNote:
    "বন্ধ অবস্থায় সেভ হয়। প্রথম পরীক্ষা নির্দিষ্ট সংস্করণটি একবার ডাউনলোড করে; তারপর কোনো সহকর্মী ব্যবহার করলেই শুধু চলে।",
  mcpcAddedNotice:
    '"{name}" বন্ধ অবস্থায় যোগ হয়েছে। নিচে সার্ভার পরীক্ষা চাপুন, তারপর বেছে নেওয়া সহকর্মীদের জন্য চালু করুন।',
  mcpcAlreadyAdded: '"{name}" নামে যোগ করা আছে।',
  mcpcHosted: "অনলাইন",
  mcpcVersion: "সংস্করণ {version}",
  mcpcRuntimeNode: "এই পিসিতে চলে (Node.js)",
  mcpcRuntimePython: "এই পিসিতে চলে (uv)",
  mcpcRuntimeRemote: "অনলাইন, কিছু ইনস্টল করতে হবে না",
  mcpcRuntimeProgram: "আপনার ডাউনলোড করা প্রোগ্রাম চালায়",
  mcpcNeedsKeys: "আপনার লাগবে: {keys}।",
  mcpcNeedsNode: "Node.js {min} বা নতুন লাগবে।",
  mcpcNeedsNodeFound: "Node.js {min} বা নতুন লাগবে; এই পিসিতে আছে {found}।",
  mcpcNeedsUv: "uv লাগবে, Python কানেক্টর চালানোর বিনামূল্যের টুল।",
  mcpcNeedsGit: "Git for Windows লাগবে।",
  mcpcNeedsChrome: "Google Chrome লাগবে।",
  mcpcInstallHint: "সহকর্মী এটি আপনার জন্য ইনস্টল করে না: ইনস্টল করুন, তারপর আবার পরীক্ষা চাপুন।",
  mcpcGetIt: "কোথায় পাবেন",
  mcpcSetup: "সেটআপ পেজ খুলুন",
};
