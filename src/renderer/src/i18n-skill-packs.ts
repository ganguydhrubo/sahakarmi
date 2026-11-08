/** Settings > Skills > Skill packs, suggested connections, and Settings > About > credits. */
export const skillPacksEn = {
  packsHeading: "Skill packs",
  packsIntro:
    "Free, ready-made skills grouped by job. Each pack installs from one fixed, checked version: text only, no scripts, with the same safety check as any skill.",
  packsSkills: "{count} skills",
  packsInstalledCount: "{installed} of {count} installed",
  packsInstall: "Install pack",
  packsInstallRest: "Install the rest",
  packsShowSkills: "Show skills",
  packsHideSkills: "Hide skills",
  packsInstallSkill: "Install",
  packsInstalling: "Installing… this can take a minute.",
  packsNotLegalAdvice: "Not legal advice — check with a lawyer",
  packsFrom: "From the {pack}",
  packsCreditsNote: "Where these come from: Settings > About > Open-source credits.",
  mcpRecsHeading: "Suggested connections",
  mcpRecsIntro:
    "Skills you installed work best with these services. Nothing is connected: press Connect to add one to MCP servers, then test it there.",
  mcpRecsConnect: "Connect…",
  mcpRecsConfirm:
    "Add “{name}” to Settings > MCP servers? It is saved switched off until you test it, and any key it needs you add there yourself.",
  mcpRecsAdd: "Add to MCP servers",
  mcpRecsCancel: "Cancel",
  mcpRecsAdded: "Added “{name}”. Open Settings > MCP servers to test it and switch it on.",
  mcpRecsNeeds: "Needs: {names}",
  skillsLinkedFiles: "{count} linked files brought along",
  skillsUnresolved: "Mentions files that were not copied: {paths}",
  skillsPlugin: "Plugin: {name}",
  creditsHeading: "Open-source credits",
  creditsIntro:
    "Skill packs and presets in Sahkarmi come from these open-source projects. Thank you to their authors.",
  creditsLicence: "Licence",
  creditsNotice: "NOTICE",
  creditsNoNotice: "This project publishes no NOTICE file.",
  creditsOpen: "Open project page",
  "pack.small-business.title": "Small business pack",
  "pack.small-business.summary":
    "Run the shop: cash flow, invoices to chase, payroll prep, hiring, leads, reviews, social posts and a Monday brief. You approve anything that touches money or customers.",
  "pack.sales.title": "Sales pack",
  "pack.sales.summary":
    "Account research, call prep and summaries, pipeline and forecast reviews, outreach drafts, objection handling and weekly wraps.",
  "pack.customer-support.title": "Customer support pack",
  "pack.customer-support.summary":
    "Triage tickets, draft replies, write help-centre articles, research a customer and escalate well.",
  "pack.hr.title": "HR pack",
  "pack.hr.summary":
    "Offers, onboarding, interview prep, performance reviews, pay analysis, org planning and policy look-ups.",
  "pack.legal.title": "Legal pack (not legal advice)",
  "pack.legal.summary":
    "First-pass contract and NDA reviews, compliance checks, risk notes and meeting briefs, for you to take to a lawyer.",
  "pack.finance.title": "Finance & accounting pack",
  "pack.finance.summary":
    "Month-end close, journal entries, reconciliations, financial statements, variance analysis and audit support.",
  "pack.product-management.title": "Product management pack",
  "pack.product-management.summary":
    "Write specs, plan sprints, update the roadmap, review metrics, brainstorm and summarise research.",
  "pack.operations.title": "Operations pack",
  "pack.operations.summary":
    "Process docs, runbooks, change requests, capacity plans, vendor reviews, risk and status reports.",
  "pack.marketing.title": "Marketing pack",
  "pack.marketing.summary":
    "Campaign plans, content drafts, email sequences, brand reviews, SEO audits and performance reports.",
  "pack.data.title": "Data & analysis pack",
  "pack.data.summary":
    "Explore and validate data, write SQL, run statistics, build charts and dashboards.",
  "pack.productivity.title": "Productivity pack",
  "pack.productivity.summary":
    "Task lists, a daily start and update routine, and a tidy working memory.",
  "pack.documents.title": "Documents & writing pack",
  "pack.documents.summary":
    "Internal updates and newsletters, colour and font themes for documents, polished web page design, and follow-up questions that check a draft before you act on it.",
  "pack.growth-marketing.title": "Growth marketing pack",
  "pack.growth-marketing.summary":
    "Copywriting, SEO, ads, landing-page conversion, pricing, launches, referrals, email and social: 51 marketing playbooks.",
  "pack.product-playbooks.title": "Product playbooks pack",
  "pack.product-playbooks.summary":
    "PRDs, user stories, OKRs, RICE scoring, launch checklists, positioning, journey maps, churn and cohort analysis.",
  "pack.design-ux.title": "Design & UX pack",
  "pack.design-ux.summary": "Banners for social, ads and print, and HTML slide decks with charts.",
  "pack.contract-review.title": "Contract review pack (not legal advice)",
  "pack.contract-review.summary":
    "Read a contract, NDA, employment or SaaS agreement, flag one-sided terms and suggest edits to discuss with a lawyer.",
  "pack.privacy-dpdp.title": "Privacy & DPDP pack (not legal advice)",
  "pack.privacy-dpdp.summary":
    "India's DPDP Act 2023 and GDPR: consent, records of processing, DPIAs, processor contracts, gap analysis and remediation plans.",
  "pack.hr-handbook.title": "HR handbook pack",
  "pack.hr-handbook.summary":
    "Hiring, job descriptions, interviews, onboarding and exits, payroll, pay and benefits, policies, engagement and wellbeing.",
};

export type SkillPacksDictionary = Record<keyof typeof skillPacksEn, string>;

export const skillPacksHi: SkillPacksDictionary = {
  packsHeading: "स्किल पैक",
  packsIntro:
    "काम के हिसाब से बने मुफ़्त, तैयार स्किल। हर पैक एक तय, जाँचे हुए वर्ज़न से जुड़ता है: सिर्फ़ टेक्स्ट, कोई स्क्रिप्ट नहीं, और हर स्किल वाली वही सुरक्षा जाँच।",
  packsSkills: "{count} स्किल",
  packsInstalledCount: "{count} में से {installed} जुड़े",
  packsInstall: "पैक जोड़ें",
  packsInstallRest: "बाकी जोड़ें",
  packsShowSkills: "स्किल दिखाएँ",
  packsHideSkills: "स्किल छिपाएँ",
  packsInstallSkill: "जोड़ें",
  packsInstalling: "जोड़ रहे हैं… इसमें एक मिनट लग सकता है।",
  packsNotLegalAdvice: "यह कानूनी सलाह नहीं है — किसी वकील से पूछें",
  packsFrom: "{pack} से",
  packsCreditsNote: "ये कहाँ से आए: सेटिंग्स > परिचय > ओपन-सोर्स श्रेय।",
  mcpRecsHeading: "सुझाए गए कनेक्शन",
  mcpRecsIntro:
    "आपके जोड़े स्किल इन सेवाओं के साथ सबसे अच्छा काम करते हैं। कुछ भी जुड़ा नहीं है: किसी को MCP सर्वर में जोड़ने के लिए कनेक्ट दबाएँ, फिर वहीं उसे टेस्ट करें।",
  mcpRecsConnect: "कनेक्ट…",
  mcpRecsConfirm:
    "“{name}” को सेटिंग्स > MCP सर्वर में जोड़ें? टेस्ट होने तक यह बंद रहेगा, और जो भी चाबी इसे चाहिए वह आप वहीं खुद डालेंगे।",
  mcpRecsAdd: "MCP सर्वर में जोड़ें",
  mcpRecsCancel: "रद्द करें",
  mcpRecsAdded: "“{name}” जुड़ गया। इसे टेस्ट करने और चालू करने के लिए सेटिंग्स > MCP सर्वर खोलें।",
  mcpRecsNeeds: "चाहिए: {names}",
  skillsLinkedFiles: "{count} जुड़ी फ़ाइलें साथ लाई गईं",
  skillsUnresolved: "इसमें ऐसी फ़ाइलों का ज़िक्र है जो कॉपी नहीं हुईं: {paths}",
  skillsPlugin: "प्लगइन: {name}",
  creditsHeading: "ओपन-सोर्स श्रेय",
  creditsIntro: "सहकर्मी के स्किल पैक और प्रीसेट इन ओपन-सोर्स प्रोजेक्ट से आते हैं। इनके लेखकों का धन्यवाद।",
  creditsLicence: "लाइसेंस",
  creditsNotice: "NOTICE",
  creditsNoNotice: "यह प्रोजेक्ट कोई NOTICE फ़ाइल नहीं देता।",
  creditsOpen: "प्रोजेक्ट पेज खोलें",
  "pack.small-business.title": "छोटा व्यापार पैक",
  "pack.small-business.summary":
    "दुकान चलाइए: कैश फ़्लो, बकाया बिलों की याद, पेरोल की तैयारी, भर्ती, लीड, रिव्यू, सोशल पोस्ट और सोमवार की ब्रीफ़। पैसे या ग्राहकों से जुड़ा हर कदम आपकी मंज़ूरी से।",
  "pack.sales.title": "सेल्स पैक",
  "pack.sales.summary":
    "अकाउंट रिसर्च, कॉल की तैयारी और सारांश, पाइपलाइन और फ़ोरकास्ट समीक्षा, आउटरीच ड्राफ़्ट, आपत्तियों के जवाब और साप्ताहिक सार।",
  "pack.customer-support.title": "ग्राहक सहायता पैक",
  "pack.customer-support.summary":
    "टिकट छाँटें, जवाब ड्राफ़्ट करें, हेल्प-सेंटर लेख लिखें, ग्राहक की जानकारी जुटाएँ और सही तरीके से आगे बढ़ाएँ।",
  "pack.hr.title": "HR पैक",
  "pack.hr.summary":
    "ऑफ़र, ऑनबोर्डिंग, इंटरव्यू की तैयारी, परफ़ॉर्मेंस रिव्यू, वेतन विश्लेषण, संगठन योजना और नीति खोज।",
  "pack.legal.title": "कानूनी पैक (कानूनी सलाह नहीं)",
  "pack.legal.summary":
    "कॉन्ट्रैक्ट और NDA की पहली समीक्षा, अनुपालन जाँच, जोखिम नोट और मीटिंग ब्रीफ़, जिन्हें आप वकील के पास ले जाएँ।",
  "pack.finance.title": "वित्त और लेखा पैक",
  "pack.finance.summary":
    "महीने का क्लोज़, जर्नल एंट्री, मिलान, वित्तीय विवरण, अंतर विश्लेषण और ऑडिट सहायता।",
  "pack.product-management.title": "प्रोडक्ट मैनेजमेंट पैक",
  "pack.product-management.summary":
    "स्पेक लिखें, स्प्रिंट की योजना बनाएँ, रोडमैप अपडेट करें, मेट्रिक्स देखें, विचार करें और रिसर्च का सार निकालें।",
  "pack.operations.title": "ऑपरेशंस पैक",
  "pack.operations.summary":
    "प्रक्रिया दस्तावेज़, रनबुक, बदलाव अनुरोध, क्षमता योजना, वेंडर समीक्षा, जोखिम और स्टेटस रिपोर्ट।",
  "pack.marketing.title": "मार्केटिंग पैक",
  "pack.marketing.summary":
    "कैंपेन योजना, कंटेंट ड्राफ़्ट, ईमेल सीक्वेंस, ब्रांड समीक्षा, SEO ऑडिट और परफ़ॉर्मेंस रिपोर्ट।",
  "pack.data.title": "डेटा और विश्लेषण पैक",
  "pack.data.summary": "डेटा देखें और जाँचें, SQL लिखें, सांख्यिकी चलाएँ, चार्ट और डैशबोर्ड बनाएँ।",
  "pack.productivity.title": "प्रोडक्टिविटी पैक",
  "pack.productivity.summary": "काम की सूची, रोज़ की शुरुआत और अपडेट, और साफ़-सुथरी कामकाजी याददाश्त।",
  "pack.documents.title": "दस्तावेज़ और लेखन पैक",
  "pack.documents.summary":
    "अंदरूनी अपडेट और न्यूज़लेटर, दस्तावेज़ों के लिए रंग और फ़ॉन्ट थीम, सुंदर वेब पेज डिज़ाइन, और ऐसे सवाल जो कदम उठाने से पहले ड्राफ़्ट जाँचें।",
  "pack.growth-marketing.title": "ग्रोथ मार्केटिंग पैक",
  "pack.growth-marketing.summary":
    "कॉपीराइटिंग, SEO, विज्ञापन, लैंडिंग-पेज कन्वर्ज़न, कीमत, लॉन्च, रेफ़रल, ईमेल और सोशल: 51 मार्केटिंग तरीके।",
  "pack.product-playbooks.title": "प्रोडक्ट प्लेबुक पैक",
  "pack.product-playbooks.summary":
    "PRD, यूज़र स्टोरी, OKR, RICE स्कोर, लॉन्च चेकलिस्ट, पोज़िशनिंग, जर्नी मैप, चर्न और कोहोर्ट विश्लेषण।",
  "pack.design-ux.title": "डिज़ाइन और UX पैक",
  "pack.design-ux.summary": "सोशल, विज्ञापन और प्रिंट के लिए बैनर, और चार्ट वाले HTML स्लाइड डेक।",
  "pack.contract-review.title": "कॉन्ट्रैक्ट समीक्षा पैक (कानूनी सलाह नहीं)",
  "pack.contract-review.summary":
    "कॉन्ट्रैक्ट, NDA, नौकरी या SaaS समझौता पढ़ें, एकतरफ़ा शर्तें पकड़ें और वकील से बात करने लायक बदलाव सुझाएँ।",
  "pack.privacy-dpdp.title": "प्राइवेसी और DPDP पैक (कानूनी सलाह नहीं)",
  "pack.privacy-dpdp.summary":
    "भारत का DPDP अधिनियम 2023 और GDPR: सहमति, प्रोसेसिंग रिकॉर्ड, DPIA, प्रोसेसर अनुबंध, कमी विश्लेषण और सुधार योजना।",
  "pack.hr-handbook.title": "HR हैंडबुक पैक",
  "pack.hr-handbook.summary":
    "भर्ती, जॉब विवरण, इंटरव्यू, ऑनबोर्डिंग और विदाई, पेरोल, वेतन और लाभ, नीतियाँ, जुड़ाव और सेहत।",
};

export const skillPacksBn: SkillPacksDictionary = {
  packsHeading: "স্কিল প্যাক",
  packsIntro:
    "কাজ অনুযায়ী সাজানো বিনামূল্যের, তৈরি স্কিল। প্রতিটি প্যাক একটি নির্দিষ্ট, যাচাই করা সংস্করণ থেকে যোগ হয়: শুধু লেখা, কোনো স্ক্রিপ্ট নয়, আর যেকোনো স্কিলের মতোই নিরাপত্তা যাচাই।",
  packsSkills: "{count}টি স্কিল",
  packsInstalledCount: "{count}টির মধ্যে {installed}টি যোগ হয়েছে",
  packsInstall: "প্যাক যোগ করুন",
  packsInstallRest: "বাকিগুলো যোগ করুন",
  packsShowSkills: "স্কিল দেখান",
  packsHideSkills: "স্কিল লুকান",
  packsInstallSkill: "যোগ করুন",
  packsInstalling: "যোগ হচ্ছে… এক মিনিট লাগতে পারে।",
  packsNotLegalAdvice: "এটি আইনি পরামর্শ নয় — একজন আইনজীবীর সঙ্গে কথা বলুন",
  packsFrom: "{pack} থেকে",
  packsCreditsNote: "এগুলো কোথা থেকে এসেছে: সেটিংস > পরিচিতি > ওপেন-সোর্স কৃতজ্ঞতা।",
  mcpRecsHeading: "প্রস্তাবিত সংযোগ",
  mcpRecsIntro:
    "আপনার যোগ করা স্কিলগুলো এই পরিষেবাগুলোর সঙ্গে সবচেয়ে ভালো কাজ করে। কিছুই সংযুক্ত নয়: MCP সার্ভারে যোগ করতে কানেক্ট চাপুন, তারপর সেখানে পরীক্ষা করুন।",
  mcpRecsConnect: "কানেক্ট…",
  mcpRecsConfirm:
    "“{name}” কে সেটিংস > MCP সার্ভারে যোগ করবেন? পরীক্ষা না হওয়া পর্যন্ত এটি বন্ধ থাকবে, আর যে চাবি লাগবে তা আপনি সেখানে নিজে দেবেন।",
  mcpRecsAdd: "MCP সার্ভারে যোগ করুন",
  mcpRecsCancel: "বাতিল",
  mcpRecsAdded: "“{name}” যোগ হয়েছে। পরীক্ষা করে চালু করতে সেটিংস > MCP সার্ভার খুলুন।",
  mcpRecsNeeds: "লাগবে: {names}",
  skillsLinkedFiles: "{count}টি যুক্ত ফাইল সঙ্গে আনা হয়েছে",
  skillsUnresolved: "এমন ফাইলের উল্লেখ আছে যা কপি হয়নি: {paths}",
  skillsPlugin: "প্লাগইন: {name}",
  creditsHeading: "ওপেন-সোর্স কৃতজ্ঞতা",
  creditsIntro: "সহকর্মীর স্কিল প্যাক ও প্রিসেট এই ওপেন-সোর্স প্রকল্পগুলো থেকে আসে। এদের লেখকদের ধন্যবাদ।",
  creditsLicence: "লাইসেন্স",
  creditsNotice: "NOTICE",
  creditsNoNotice: "এই প্রকল্প কোনো NOTICE ফাইল প্রকাশ করে না।",
  creditsOpen: "প্রকল্পের পাতা খুলুন",
  "pack.small-business.title": "ছোট ব্যবসা প্যাক",
  "pack.small-business.summary":
    "দোকান চালান: নগদ প্রবাহ, বকেয়া বিলের তাগাদা, বেতনের প্রস্তুতি, নিয়োগ, লিড, রিভিউ, সোশ্যাল পোস্ট আর সোমবারের ব্রিফ। টাকা বা গ্রাহক জড়িত প্রতিটি ধাপ আপনার অনুমোদনে।",
  "pack.sales.title": "সেলস প্যাক",
  "pack.sales.summary":
    "অ্যাকাউন্ট গবেষণা, কলের প্রস্তুতি ও সারাংশ, পাইপলাইন ও পূর্বাভাস পর্যালোচনা, আউটরিচ খসড়া, আপত্তির উত্তর আর সাপ্তাহিক সারসংক্ষেপ।",
  "pack.customer-support.title": "গ্রাহক সহায়তা প্যাক",
  "pack.customer-support.summary":
    "টিকিট বাছাই, উত্তরের খসড়া, হেল্প-সেন্টার লেখা, গ্রাহক সম্পর্কে খোঁজ আর ঠিকভাবে এসক্যালেশন।",
  "pack.hr.title": "HR প্যাক",
  "pack.hr.summary":
    "অফার, অনবোর্ডিং, ইন্টারভিউর প্রস্তুতি, পারফরম্যান্স রিভিউ, বেতন বিশ্লেষণ, সংগঠন পরিকল্পনা আর নীতি খোঁজা।",
  "pack.legal.title": "আইনি প্যাক (আইনি পরামর্শ নয়)",
  "pack.legal.summary":
    "চুক্তি ও NDA-র প্রথম পর্যালোচনা, সম্মতি যাচাই, ঝুঁকির নোট আর মিটিং ব্রিফ, যা আপনি আইনজীবীর কাছে নিয়ে যাবেন।",
  "pack.finance.title": "অর্থ ও হিসাব প্যাক",
  "pack.finance.summary":
    "মাস শেষের ক্লোজ, জার্নাল এন্ট্রি, মিলকরণ, আর্থিক বিবরণী, পার্থক্য বিশ্লেষণ আর অডিট সহায়তা।",
  "pack.product-management.title": "প্রোডাক্ট ম্যানেজমেন্ট প্যাক",
  "pack.product-management.summary":
    "স্পেক লিখুন, স্প্রিন্ট পরিকল্পনা করুন, রোডম্যাপ হালনাগাদ করুন, মেট্রিক্স দেখুন, ভাবনা সাজান আর গবেষণার সারাংশ করুন।",
  "pack.operations.title": "অপারেশনস প্যাক",
  "pack.operations.summary":
    "প্রক্রিয়ার নথি, রানবুক, পরিবর্তনের অনুরোধ, সক্ষমতা পরিকল্পনা, ভেন্ডর পর্যালোচনা, ঝুঁকি ও স্ট্যাটাস রিপোর্ট।",
  "pack.marketing.title": "মার্কেটিং প্যাক",
  "pack.marketing.summary":
    "ক্যাম্পেইন পরিকল্পনা, কনটেন্টের খসড়া, ইমেল সিকোয়েন্স, ব্র্যান্ড পর্যালোচনা, SEO অডিট আর পারফরম্যান্স রিপোর্ট।",
  "pack.data.title": "ডেটা ও বিশ্লেষণ প্যাক",
  "pack.data.summary": "ডেটা দেখুন ও যাচাই করুন, SQL লিখুন, পরিসংখ্যান চালান, চার্ট ও ড্যাশবোর্ড বানান।",
  "pack.productivity.title": "প্রোডাক্টিভিটি প্যাক",
  "pack.productivity.summary": "কাজের তালিকা, দিনের শুরু ও আপডেটের রুটিন, আর গোছানো কাজের স্মৃতি।",
  "pack.documents.title": "নথি ও লেখা প্যাক",
  "pack.documents.summary":
    "অভ্যন্তরীণ আপডেট ও নিউজলেটার, নথির জন্য রং ও ফন্ট থিম, সুন্দর ওয়েব পেজ ডিজাইন, আর এমন প্রশ্ন যা কাজে নামার আগে খসড়া যাচাই করে।",
  "pack.growth-marketing.title": "গ্রোথ মার্কেটিং প্যাক",
  "pack.growth-marketing.summary":
    "কপিরাইটিং, SEO, বিজ্ঞাপন, ল্যান্ডিং-পেজ কনভার্সন, দাম, লঞ্চ, রেফারাল, ইমেল ও সোশ্যাল: ৫১টি মার্কেটিং পদ্ধতি।",
  "pack.product-playbooks.title": "প্রোডাক্ট প্লেবুক প্যাক",
  "pack.product-playbooks.summary":
    "PRD, ইউজার স্টোরি, OKR, RICE স্কোর, লঞ্চ চেকলিস্ট, পজিশনিং, জার্নি ম্যাপ, চার্ন ও কোহর্ট বিশ্লেষণ।",
  "pack.design-ux.title": "ডিজাইন ও UX প্যাক",
  "pack.design-ux.summary": "সোশ্যাল, বিজ্ঞাপন ও প্রিন্টের ব্যানার, আর চার্টসহ HTML স্লাইড ডেক।",
  "pack.contract-review.title": "চুক্তি পর্যালোচনা প্যাক (আইনি পরামর্শ নয়)",
  "pack.contract-review.summary":
    "চুক্তি, NDA, চাকরি বা SaaS চুক্তি পড়ুন, একতরফা শর্ত চিহ্নিত করুন আর আইনজীবীর সঙ্গে আলোচনার মতো সংশোধন প্রস্তাব করুন।",
  "pack.privacy-dpdp.title": "প্রাইভেসি ও DPDP প্যাক (আইনি পরামর্শ নয়)",
  "pack.privacy-dpdp.summary":
    "ভারতের DPDP আইন ২০২৩ ও GDPR: সম্মতি, প্রক্রিয়াকরণের রেকর্ড, DPIA, প্রসেসর চুক্তি, ঘাটতি বিশ্লেষণ ও সংশোধন পরিকল্পনা।",
  "pack.hr-handbook.title": "HR হ্যান্ডবুক প্যাক",
  "pack.hr-handbook.summary":
    "নিয়োগ, কাজের বিবরণ, ইন্টারভিউ, অনবোর্ডিং ও বিদায়, বেতন, পারিশ্রমিক ও সুবিধা, নীতি, সম্পৃক্ততা আর সুস্থতা।",
};
