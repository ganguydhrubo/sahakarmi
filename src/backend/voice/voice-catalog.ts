// Local voice models. Every file is pinned to a fixed revision and checked against its SHA-256
// before use. Sources:
// - Engine: sherpa-onnx 2.0.0 (Apache-2.0), https://github.com/k2-fsa/sherpa-onnx
// - Speech-to-text: https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx
//   (Apache-2.0 packaging; AI4Bharat IndicConformer MIT, Oriserve Whisper Hindi2Hinglish
//   Apache-2.0, OpenAI Whisper large-v3-turbo MIT, NVIDIA NeMo fast-conformer English CC-BY-4.0)
// - Spoken replies: AI4Bharat VITS Rasa-13 (CC-BY-4.0) via
//   https://huggingface.co/MatiasLin/sherpa-onnx-vits-rasa-13, and Kokoro-82M (Apache-2.0).

export const SHERPA_VERSION = "2.0.0";

export interface VoiceFile {
  /** Path inside the model folder. */
  path: string;
  url: string;
  sha256: string;
  size: number;
}

export interface VoiceArchive {
  url: string;
  sha256: string;
  size: number;
  /** Top folder inside the archive that becomes the model folder. */
  folder: string;
}

export type DictationKind = "nemo-ctc" | "whisper";
export type SpeechKind = "vits" | "kokoro";

export interface VoiceSpeaker {
  id: number;
  name: string;
  /** Language codes this speaker reads best. */
  languages: string[];
}

interface ModelBase {
  id: string;
  name: string;
  /** Shown under the name in Settings. */
  summary: string;
  licence: string;
  /** Language codes; "auto" means the model finds the language itself. */
  languages: string[];
  files?: VoiceFile[];
  archive?: VoiceArchive;
}

export interface DictationModel extends ModelBase {
  type: "dictation";
  kind: DictationKind;
  group: "indic" | "hinglish" | "world";
  /** Language code passed to Whisper; empty lets it detect the language. */
  whisperLanguage?: string;
  /** Whether the text comes out with punctuation. */
  punctuates: boolean;
}

export interface SpeechModel extends ModelBase {
  type: "speech";
  kind: SpeechKind;
  speakers: VoiceSpeaker[];
}

export type VoiceModel = DictationModel | SpeechModel;

const INDIC_REV = "9721eb71eea141fae0982cfcdb9dd2e3d4953c4a";
const INDIC = `https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/${INDIC_REV}`;
const RASA_REV = "b5afd4e991e3bdd6195528de650e2ed219d47506";
const RASA = `https://huggingface.co/MatiasLin/sherpa-onnx-vits-rasa-13/resolve/${RASA_REV}`;
const RASA_LANGUAGES = [
  "hi",
  "bn",
  "mr",
  "ta",
  "te",
  "gu",
  "kn",
  "ml",
  "pa",
  "or",
  "as",
  "brx",
  "mni",
];
const SHERPA_RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

/** The engine: native libraries plus the .NET binding the voice host loads. */
export const VOICE_ENGINE = {
  native: {
    url: `${SHERPA_RELEASES}/v${SHERPA_VERSION}/sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MT-Release.tar.bz2`,
    sha256: "a66a89c6f3401f3f26a6f53d39ea632900884cbd6a116155e2a85f434b6a7bda",
    size: 26_570_586,
    folder: `sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MT-Release`,
  },
  binding: {
    url: `https://api.nuget.org/v3-flatcontainer/org.k2fsa.sherpa.onnx/${SHERPA_VERSION}/org.k2fsa.sherpa.onnx.${SHERPA_VERSION}.nupkg`,
    sha256: "915331057ee9e09def0c17cba7295bf1d810f8bbd1d65c7b8f9c7dbfa617e13b",
    size: 210_453,
    /** The .NET Framework build, which Windows PowerShell 5.1 can load. */
    entry: "lib/net45/sherpa-onnx.dll",
  },
} as const;

export const INDIC_TOKENS: VoiceFile = {
  path: "tokens.txt",
  url: `${INDIC}/tokens.txt`,
  sha256: "ee60967630213f31951817ac8b402b92ec18cce80718a24a49b388e56672dfb2",
  size: 67_605,
};

const WHISPER_TOKENS_SHA = "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126";

/** [code, English name, native name, sha256, size] for AI4Bharat IndicConformer. */
export const INDIC_LANGUAGES: [string, string, string, string, number][] = [
  [
    "hi",
    "Hindi",
    "हिन्दी",
    "915c71e04dd7e5378a4057fdebb252b3a587188e4e99db6d7ce0909ad5ad05fa",
    197_595_593,
  ],
  [
    "bn",
    "Bengali",
    "বাংলা",
    "e9120a534f69df065314be468bf15579f1b92a4cd8c07ad119b80b69244718a8",
    197_595_578,
  ],
  [
    "mr",
    "Marathi",
    "मराठी",
    "1ea81e55c4b9b12624c9d02a5b9c1b6f7c871c78a55ff52d333f81cb5136eaf2",
    197_595_593,
  ],
  [
    "te",
    "Telugu",
    "తెలుగు",
    "710f176e33080f1be84b4f38bb5f33be3f522dcf4f191bf4d5cc89f7a85924f3",
    197_595_693,
  ],
  [
    "ta",
    "Tamil",
    "தமிழ்",
    "abb7b59d706b8d27ba3fb5e5e3db7671c9e1a09bf7bc6122de507c60030e65fb",
    197_595_513,
  ],
  [
    "gu",
    "Gujarati",
    "ગુજરાતી",
    "822ed7f0b809bbd479275bf91c913d05564b88c0d082bbcba2f37999b88cb598",
    197_595_461,
  ],
  [
    "kn",
    "Kannada",
    "ಕನ್ನಡ",
    "b226ce7e4ea35b0dd66991964bd00e011b6b14b0fcdf4f7d1cccd777781c94dc",
    197_595_728,
  ],
  [
    "ml",
    "Malayalam",
    "മലയാളം",
    "dcbdfa9f773db910508b40b703cb76c5974e8d4c6f123ea81265b40853c3f0c2",
    197_595_555,
  ],
  [
    "pa",
    "Punjabi",
    "ਪੰਜਾਬੀ",
    "ccd02e5ae7e71b6719de517c2819ce570247c1d9e79b3348e76cfd5eb3e5dbbc",
    197_595_548,
  ],
  [
    "or",
    "Odia",
    "ଓଡ଼ିଆ",
    "31730e06bd186bca5c3214003c2a0b5eeb3234d079b5b81aa72547adbe1c9be7",
    197_584_928,
  ],
  [
    "ur",
    "Urdu",
    "اردو",
    "0239f1c371a38f7623f29a8d7bae79f91f16f58aba45ea67103630dbb425cb07",
    197_585_089,
  ],
  [
    "as",
    "Assamese",
    "অসমীয়া",
    "b8c027e8ab6c9f64417a879b85c61254aefc3557b1875bf793fb5a33abb20426",
    197_595_509,
  ],
  [
    "mai",
    "Maithili",
    "मैथिली",
    "27a6cee11bf20679821aa079e49694c5989ae16c9b7a58ea6f2052f80acff2bd",
    197_585_045,
  ],
  [
    "ne",
    "Nepali",
    "नेपाली",
    "fbbc564e369046fd788d4150192a7e47c4e675346ec3f1b78002937fb3ccfb56",
    197_585_135,
  ],
  [
    "kok",
    "Konkani",
    "कोंकणी",
    "34c952a5817bef09bc118999598fa035b96c5c1900881a2bc438026bf480db07",
    197_585_030,
  ],
  [
    "sa",
    "Sanskrit",
    "संस्कृतम्",
    "08a878cdc31ef93c2a05545dbd0c44c5a95b3884d0754104beed984262a5b981",
    197_585_030,
  ],
  [
    "sd",
    "Sindhi",
    "سنڌي",
    "6529b3ffac5a159696b3fd34dddb6e3bda4f3cb7521307f817e201cdc37d20b3",
    197_584_945,
  ],
  [
    "ks",
    "Kashmiri",
    "कॉशुर",
    "d800d7bc4fd4adda9e1ec5ba3fcceb0539347cbe1b6fdf91deda90cc0bae2a6b",
    197_584_968,
  ],
  [
    "doi",
    "Dogri",
    "डोगरी",
    "cf2031118dcdd3eacb0738e7dd45a749770d276a6217f4e6f56e7175a44f2bbd",
    197_584_880,
  ],
  [
    "brx",
    "Bodo",
    "बड़ो",
    "05e4681819eccb06a39d0481828d52b90619171313ef6d7677db6842d205b177",
    197_584_960,
  ],
  [
    "mni",
    "Manipuri",
    "মৈতৈলোন্",
    "885adb2d6d48ce413e54e37fa88b41bd5eb86c78020f898fd55a554fc04df7ec",
    197_585_042,
  ],
  [
    "sat",
    "Santali",
    "ᱥᱟᱱᱛᱟᱲᱤ",
    "fc22b03c18bf911ce18ca1f7dafe8e5ccf2521f1a8c72596da22117cb8acf147",
    197_584_818,
  ],
];

const indicModels: DictationModel[] = INDIC_LANGUAGES.map(([code, name, native, sha256, size]) => ({
  id: `indic-${code}`,
  type: "dictation",
  kind: "nemo-ctc",
  group: "indic",
  name: `${name} · ${native}`,
  summary: "Fast. Made for Indian speech by AI4Bharat. Works offline.",
  licence: "MIT (AI4Bharat IndicConformer)",
  languages: [code],
  punctuates: false,
  files: [
    { path: "model.int8.onnx", url: `${INDIC}/${code}/model.int8.onnx`, sha256, size },
    INDIC_TOKENS,
  ],
}));

export const VOICE_MODELS: VoiceModel[] = [
  ...indicModels,
  {
    id: "english-fast",
    type: "dictation",
    kind: "nemo-ctc",
    group: "world",
    name: "English (fast)",
    summary: "Very fast English, including Indian English. Writes lowercase with no punctuation.",
    licence: "CC-BY-4.0 (NVIDIA NeMo)",
    languages: ["en"],
    punctuates: false,
    files: [
      {
        path: "model.int8.onnx",
        url: `${INDIC}/en/model.int8.onnx`,
        sha256: "28b9261a53028a7c99ff0799f44fb53f19c78b68cc4cf40637ac9c16cb1fbc6f",
        size: 174_610_057,
      },
      {
        path: "tokens.txt",
        url: `${INDIC}/en/tokens.txt`,
        sha256: "89c165b98df7af718ec0e872177279bfad4ade51331f1be92753c9583a1ef30d",
        size: 11_433,
      },
    ],
  },
  {
    id: "hinglish-swift",
    type: "dictation",
    kind: "whisper",
    group: "hinglish",
    name: "Hinglish (fast)",
    summary: "Hindi and English mixed in one sentence. Writes Roman script with punctuation.",
    licence: "Apache-2.0 (Oriserve Whisper Hindi2Hinglish Swift)",
    languages: ["hi-en"],
    whisperLanguage: "hi",
    punctuates: true,
    files: [
      {
        path: "encoder.int8.onnx",
        url: `${INDIC}/hi-hinglish-swift/encoder.int8.onnx`,
        sha256: "817f10919051ba8c784935a54da22683fceefd45a8c3547e68369204fc36c5ff",
        size: 29_122_029,
      },
      {
        path: "decoder.int8.onnx",
        url: `${INDIC}/hi-hinglish-swift/decoder.int8.onnx`,
        sha256: "19e88530a38a00af1744bc2c9340e72d4687f017e19b37b1b6c69c2b5128fc12",
        size: 130_781_044,
      },
      {
        path: "tokens.txt",
        url: `${INDIC}/hi-hinglish-swift/tokens.txt`,
        sha256: WHISPER_TOKENS_SHA,
        size: 816_730,
      },
    ],
  },
  {
    id: "hinglish-apex",
    type: "dictation",
    kind: "whisper",
    group: "hinglish",
    name: "Hinglish (best)",
    summary: "The most accurate Hinglish. Slower; best on a fast PC.",
    licence: "Apache-2.0 (Oriserve Whisper Hindi2Hinglish Apex)",
    languages: ["hi-en"],
    whisperLanguage: "hi",
    punctuates: true,
    files: [
      {
        path: "encoder.int8.onnx",
        url: `${INDIC}/hi-hinglish-apex/encoder.int8.onnx`,
        sha256: "a4858a32b0b6b9baa142ea3980e40dcf28a92ceed599e7adfb295826b902f2ea",
        size: 674_716_505,
      },
      {
        path: "decoder.int8.onnx",
        url: `${INDIC}/hi-hinglish-apex/decoder.int8.onnx`,
        sha256: "43420ffc365cd95e78cc07b3729a75b9c413a953798faa7066cfcbb9261927bb",
        size: 361_153_351,
      },
      {
        path: "tokens.txt",
        url: `${INDIC}/hi-hinglish-apex/tokens.txt`,
        sha256: WHISPER_TOKENS_SHA,
        size: 816_730,
      },
    ],
  },
  {
    id: "whisper-turbo",
    type: "dictation",
    kind: "whisper",
    group: "world",
    name: "Whisper large-v3 turbo",
    summary: "About 100 languages with punctuation. Finds the language itself, or set one.",
    licence: "MIT (OpenAI Whisper)",
    languages: ["auto"],
    whisperLanguage: "",
    punctuates: true,
    files: [
      {
        path: "encoder.int8.onnx",
        url: `${INDIC}/whisper-multilingual-apex/encoder.int8.onnx`,
        sha256: "c875d7fe866ccc0f54f84937cba94a57a2f10a48fcdd7e99e3e0257c27d796e6",
        size: 674_716_477,
      },
      {
        path: "decoder.int8.onnx",
        url: `${INDIC}/whisper-multilingual-apex/decoder.int8.onnx`,
        sha256: "0f5e075e6d6a4ea709e62b3664ded0b65ed0ce0359b1d83c1eafa3834e73648a",
        size: 361_152_887,
      },
      {
        path: "tokens.txt",
        url: `${INDIC}/whisper-multilingual-apex/tokens.txt`,
        sha256: WHISPER_TOKENS_SHA,
        size: 816_730,
      },
    ],
  },
  {
    id: "rasa-indic",
    type: "speech",
    kind: "vits",
    name: "Indian voices (AI4Bharat Rasa)",
    summary: "Reads replies aloud in Hindi, Bengali, Marathi, Tamil, Telugu and 8 more.",
    licence: "CC-BY-4.0 (AI4Bharat Rasa)",
    languages: RASA_LANGUAGES,
    // Picked by reading test sentences in Hindi and Bengali and checking that dictation heard
    // every word back; "light" and "deep" describe the measured pitch.
    speakers: [
      { id: 2, name: "Light", languages: RASA_LANGUAGES },
      { id: 10, name: "Warm", languages: RASA_LANGUAGES },
      { id: 9, name: "Deep", languages: RASA_LANGUAGES },
      { id: 5, name: "Deep 2", languages: RASA_LANGUAGES },
    ],
    files: [
      {
        path: "model.onnx",
        url: `${RASA}/model.onnx`,
        sha256: "4473f8d0b6f738196c1626bbf337cda99b34749b638bb7234c4cb8e1992bf804",
        size: 123_338_635,
      },
      {
        path: "tokens.txt",
        url: `${RASA}/tokens.txt`,
        sha256: "32ad56b2533484ccd61f8c783cc32b1f90ae06e65469476548c2f832eb6d3a9c",
        size: 9_556,
      },
    ],
  },
  {
    id: "kokoro-english",
    type: "speech",
    kind: "kokoro",
    name: "English voices (Kokoro)",
    summary: "Natural English voices for replies, American and British.",
    licence: "Apache-2.0 (Kokoro-82M)",
    languages: ["en"],
    speakers: [
      { id: 3, name: "Heart", languages: ["en"] },
      { id: 16, name: "Michael", languages: ["en"] },
      { id: 21, name: "Emma (British)", languages: ["en"] },
      { id: 26, name: "George (British)", languages: ["en"] },
    ],
    archive: {
      url: `${SHERPA_RELEASES}/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2`,
      sha256: "4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e",
      size: 132_303_094,
      folder: "kokoro-int8-multi-lang-v1_0",
    },
  },
];

export function voiceModel(id: string): VoiceModel | undefined {
  return VOICE_MODELS.find((model) => model.id === id);
}

export function downloadSize(model: VoiceModel): number {
  if (model.archive) return model.archive.size;
  return (model.files ?? []).reduce((total, file) => total + file.size, 0);
}
