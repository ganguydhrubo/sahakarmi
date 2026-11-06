export class AgentInitializationGate {
  readonly #initialize: () => Promise<void>;
  #pending: Promise<void> | null = null;
  #succeeded = false;
  readonly #onReady: Array<() => void> = [];

  constructor(initialize: () => Promise<void>) {
    this.#initialize = initialize;
  }

  /**
   * Runs `callback` once, after the first successful initialization, whichever start() call
   * (the launch one or a later retry from the window) gets there. Background work such as
   * schedules, routines and Telegram hangs off this, so a failed first try no longer leaves
   * them off until the app restarts.
   */
  onReady(callback: () => void): void {
    if (this.#succeeded) {
      callback();
      return;
    }
    this.#onReady.push(callback);
  }

  start(): Promise<void> {
    if (!this.#pending) {
      this.#pending = this.#initialize().then(
        () => {
          if (this.#succeeded) return;
          this.#succeeded = true;
          for (const callback of this.#onReady.splice(0)) callback();
        },
        (error) => {
          this.#pending = null;
          throw error;
        },
      );
    }
    return this.#pending;
  }
}
