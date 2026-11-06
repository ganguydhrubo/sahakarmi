/** Security wording: skills that need the owner's review before coworkers trust them. */
export const securityEn = {
  skillsReviewBadge: "Review needed",
  skillsReviewWhy:
    "Coworkers treat this skill as untrusted until you read it: it asks to do something risky.",
  skillsReviewFlagged: "Flagged:",
  skillsMarkReviewed: "I have read it, trust it",
};

type SecurityDictionary = Record<keyof typeof securityEn, string>;

export const securityHi: SecurityDictionary = {
  skillsReviewBadge: "जाँच ज़रूरी",
  skillsReviewWhy:
    "जब तक आप इसे पढ़ नहीं लेते, सहकर्मी इस स्किल पर भरोसा नहीं करेंगे: यह कुछ जोखिम भरा करने को कहती है।",
  skillsReviewFlagged: "चिह्नित:",
  skillsMarkReviewed: "मैंने पढ़ लिया, इस पर भरोसा है",
};

export const securityBn: SecurityDictionary = {
  skillsReviewBadge: "যাচাই দরকার",
  skillsReviewWhy: "আপনি এটি না পড়া পর্যন্ত সহকর্মীরা এই স্কিলটিকে বিশ্বাস করবে না: এটি ঝুঁকিপূর্ণ কিছু করতে বলে।",
  skillsReviewFlagged: "চিহ্নিত:",
  skillsMarkReviewed: "আমি পড়েছি, এটিকে বিশ্বাস করি",
};
