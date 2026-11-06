/** Team memory (the Memory view): workspace scope, search, editing and paging. */
export const memoryEn = {
  memoryScopeNote:
    "Only this workspace's coworkers see these notes. Up to three that match your message are added to it automatically (Settings > Features).",
  memoryEdit: "Edit",
  memoryEditTitle: "Edit memory",
  memoryLoadMore: "Show more",
  memoryShowing: "Showing {shown} of {total}",
  memoryNoMatch: "No memory matches that search.",
  memoryByCoworker: "Saved by {name}",
  memorySaveFailed: "Could not save: {error}",
  memoryDeleteFailed: "Could not delete: {error}",
};

type MemoryDictionary = Record<keyof typeof memoryEn, string>;

export const memoryHi: MemoryDictionary = {
  memoryScopeNote:
    "ये बातें सिर्फ़ इसी वर्कस्पेस के सहकर्मी देखते हैं। आपके संदेश से मेल खाने वाली अधिकतम तीन बातें उसमें अपने-आप जुड़ जाती हैं (सेटिंग्स > फ़ीचर)।",
  memoryEdit: "बदलें",
  memoryEditTitle: "याद बदलें",
  memoryLoadMore: "और दिखाएँ",
  memoryShowing: "{total} में से {shown} दिख रही हैं",
  memoryNoMatch: "इस खोज से कोई याद नहीं मिली।",
  memoryByCoworker: "{name} ने सहेजी",
  memorySaveFailed: "सहेजा नहीं जा सका: {error}",
  memoryDeleteFailed: "हटाया नहीं जा सका: {error}",
};

export const memoryBn: MemoryDictionary = {
  memoryScopeNote:
    "এই কথাগুলো শুধু এই ওয়ার্কস্পেসের সহকর্মীরাই দেখে। আপনার বার্তার সঙ্গে মেলে এমন সর্বোচ্চ তিনটি কথা নিজে থেকেই তাতে যোগ হয় (সেটিংস > ফিচার)।",
  memoryEdit: "বদলান",
  memoryEditTitle: "স্মৃতি বদলান",
  memoryLoadMore: "আরও দেখান",
  memoryShowing: "{total}টির মধ্যে {shown}টি দেখানো হচ্ছে",
  memoryNoMatch: "এই খোঁজে কোনো স্মৃতি মেলেনি।",
  memoryByCoworker: "{name} সংরক্ষণ করেছে",
  memorySaveFailed: "সংরক্ষণ করা যায়নি: {error}",
  memoryDeleteFailed: "মোছা যায়নি: {error}",
};
