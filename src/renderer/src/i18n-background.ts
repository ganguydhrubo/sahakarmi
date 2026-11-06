/** Routines: event triggers ("When a file is added to a folder"). */
export const backgroundEn = {
  routineOnFolder: "When a file is added",
  routineFolderLabel: "Folder to watch",
  routineFolderChoose: "Choose folder…",
  routineFolderNone: "No folder chosen yet",
  routineFolderHelp:
    "Runs when a new file appears in this folder or a subfolder, once it has finished copying. Temporary and partly downloaded files are ignored. Works while Sahkarmi is open (or in the tray).",
  routineFolderRequired: "Choose a folder to watch.",
  routineFolderStarts: "When a file is added to {folder}",
  routineTriggerFolder: "New file",
};

type BackgroundDictionary = Record<keyof typeof backgroundEn, string>;

export const backgroundHi: BackgroundDictionary = {
  routineOnFolder: "जब कोई फ़ाइल जुड़े",
  routineFolderLabel: "किस फ़ोल्डर पर नज़र रखें",
  routineFolderChoose: "फ़ोल्डर चुनें…",
  routineFolderNone: "अभी कोई फ़ोल्डर नहीं चुना",
  routineFolderHelp:
    "जब इस फ़ोल्डर या इसके किसी सब-फ़ोल्डर में नई फ़ाइल आती है और उसकी कॉपी पूरी हो जाती है, तब यह चलता है। अस्थायी और अधूरी डाउनलोड फ़ाइलें छोड़ दी जाती हैं। यह तब तक काम करता है जब तक सहकर्मी खुला है (या ट्रे में चल रहा है)।",
  routineFolderRequired: "नज़र रखने के लिए एक फ़ोल्डर चुनें।",
  routineFolderStarts: "जब {folder} में कोई फ़ाइल जुड़े",
  routineTriggerFolder: "नई फ़ाइल",
};

export const backgroundBn: BackgroundDictionary = {
  routineOnFolder: "যখন কোনো ফাইল যোগ হয়",
  routineFolderLabel: "কোন ফোল্ডারে নজর রাখবে",
  routineFolderChoose: "ফোল্ডার বাছুন…",
  routineFolderNone: "এখনও কোনো ফোল্ডার বাছা হয়নি",
  routineFolderHelp:
    "এই ফোল্ডারে বা এর কোনো সাব-ফোল্ডারে নতুন ফাইল এলে এবং তার কপি শেষ হলে এটি চলে। অস্থায়ী ও আধা-ডাউনলোড হওয়া ফাইল বাদ দেওয়া হয়। সহকর্মী খোলা থাকলে (বা ট্রে-তে চললে) কাজ করে।",
  routineFolderRequired: "নজর রাখার জন্য একটি ফোল্ডার বাছুন।",
  routineFolderStarts: "যখন {folder}-এ কোনো ফাইল যোগ হয়",
  routineTriggerFolder: "নতুন ফাইল",
};
