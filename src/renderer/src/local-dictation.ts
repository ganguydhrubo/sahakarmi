export const DICTATION_SAMPLE_RATE = 16_000;

export interface SegmenterOptions {
  /** Silence this long after speech ends a phrase. */
  pauseMs?: number;
  /** A phrase is cut here even without a pause, so text keeps appearing. */
  maxMs?: number;
  /** Phrases shorter than this are treated as a cough or click and dropped. */
  minSpeechMs?: number;
  /** Audio kept from before speech starts, so the first syllable is not clipped. */
  leadMs?: number;
}

/**
 * Splits microphone audio into spoken phrases using loudness. The quiet level adapts to the room,
 * so a fan or a busy street does not count as speech.
 */
export class SpeechSegmenter {
  readonly #pause: number;
  readonly #max: number;
  readonly #minSpeech: number;
  readonly #lead: number;
  #chunks: Float32Array[] = [];
  #length = 0;
  #speech = 0;
  #silence = 0;
  #inPhrase = false;
  #noise = 0.004;

  constructor(options: SegmenterOptions = {}) {
    const ms = (value: number) => Math.round((value / 1_000) * DICTATION_SAMPLE_RATE);
    this.#pause = ms(options.pauseMs ?? 700);
    this.#max = ms(options.maxMs ?? 20_000);
    this.#minSpeech = ms(options.minSpeechMs ?? 250);
    this.#lead = ms(options.leadMs ?? 300);
  }

  /** Feed 16 kHz samples; returns the phrases that just finished. */
  push(samples: Float32Array): Float32Array[] {
    const phrases: Float32Array[] = [];
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.sqrt(sum / Math.max(1, samples.length));
    const loud = level > Math.max(0.012, this.#noise * 3);
    if (!loud) this.#noise = this.#noise * 0.95 + level * 0.05;

    this.#chunks.push(samples);
    this.#length += samples.length;

    if (loud) {
      this.#inPhrase = true;
      this.#speech += samples.length;
      this.#silence = 0;
    } else if (this.#inPhrase) {
      this.#silence += samples.length;
    } else {
      this.#trimLead();
    }

    if (this.#inPhrase && (this.#silence >= this.#pause || this.#length >= this.#max)) {
      const phrase = this.#take();
      if (phrase) phrases.push(phrase);
    }
    return phrases;
  }

  /** Ends the recording; returns the last phrase if one was being spoken. */
  flush(): Float32Array | null {
    return this.#inPhrase ? this.#take() : null;
  }

  #trimLead(): void {
    while (this.#chunks.length > 1 && this.#length - (this.#chunks[0]?.length ?? 0) >= this.#lead) {
      this.#length -= this.#chunks.shift()?.length ?? 0;
    }
  }

  #take(): Float32Array | null {
    const enough = this.#speech >= this.#minSpeech;
    const phrase = new Float32Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      phrase.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [];
    this.#length = 0;
    this.#speech = 0;
    this.#silence = 0;
    this.#inPhrase = false;
    return enough ? phrase : null;
  }
}

export interface LocalDictationCallbacks {
  onText: (text: string) => void;
  onError: (message: string) => void;
  /** True while a phrase is being turned into text. */
  onBusy?: (busy: boolean) => void;
}

/**
 * Live dictation on this PC: the microphone is read at 16 kHz, cut into phrases at each pause,
 * and every phrase is turned into text by the downloaded model, in order.
 */
export class LocalDictation {
  #context: AudioContext | null = null;
  #processor: ScriptProcessorNode | null = null;
  #ownStream: MediaStream | null = null;
  #segmenter = new SpeechSegmenter();
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  #paused = false;
  #callbacks: LocalDictationCallbacks;

  constructor(callbacks: LocalDictationCallbacks) {
    this.#callbacks = callbacks;
  }

  /** Uses the given microphone stream, or asks for one. */
  async start(stream?: MediaStream | null): Promise<void> {
    if (!stream) {
      this.#ownStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    }
    const input = stream ?? this.#ownStream;
    if (!input) throw new Error("No microphone.");
    // Chromium resamples the microphone to the context's rate.
    const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
    const source = context.createMediaStreamSource(input);
    const processor = context.createScriptProcessor(4_096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (this.#paused) return;
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      for (const phrase of this.#segmenter.push(samples)) this.#transcribe(phrase);
    };
    source.connect(processor);
    // A ScriptProcessor only runs while connected to the output; it writes silence.
    processor.connect(context.destination);
    this.#context = context;
    this.#processor = processor;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
  }

  /** Stops listening; resolves once the last phrase has become text. */
  async stop(): Promise<void> {
    const last = this.#segmenter.flush();
    if (last) this.#transcribe(last);
    this.#release();
    await this.#queue;
  }

  /** Stops at once and drops anything not yet turned into text. */
  cancel(): void {
    this.#release();
    this.#callbacks = { onText: () => undefined, onError: () => undefined };
  }

  #release(): void {
    if (this.#processor) this.#processor.onaudioprocess = null;
    this.#processor?.disconnect();
    void this.#context?.close().catch(() => undefined);
    for (const track of this.#ownStream?.getTracks() ?? []) track.stop();
    this.#processor = null;
    this.#context = null;
    this.#ownStream = null;
    this.#segmenter = new SpeechSegmenter();
  }

  #transcribe(phrase: Float32Array): void {
    this.#pending += 1;
    this.#callbacks.onBusy?.(true);
    this.#queue = this.#queue.then(async () => {
      try {
        const result = await window.sahkarmi.voice.transcribe(phrase);
        if (result.text) this.#callbacks.onText(result.text);
      } catch (error) {
        this.#callbacks.onError(error instanceof Error ? error.message : String(error));
      } finally {
        this.#pending -= 1;
        if (this.#pending === 0) this.#callbacks.onBusy?.(false);
      }
    });
  }
}
