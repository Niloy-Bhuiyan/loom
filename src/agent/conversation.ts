import { concatChunks, isLikelySilence, WHISPER_SAMPLE_RATE } from '../audio/pcm';
import { toFriendlyError, type FriendlyError } from '../core/errors';
import { SentenceChunker } from '../core/sentences';
import { toSpeakableText } from '../core/speech-text';
import type { ChatMessage, LanguageModel, SpeechToText, TextToSpeech } from '../pipeline/types';
import { buildMessages, SYSTEM_PROMPT } from './prompt';

export type AgentState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

export interface AudioSource {
  start(): Promise<void>;
  /** Resolves with 16 kHz mono PCM. */
  stop(): Promise<Float32Array>;
}

export interface ConversationEvents {
  onState(state: AgentState): void;
  onUserMessage(text: string): void;
  onAssistantStart(): void;
  onAssistantToken(text: string): void;
  onAssistantEnd(text: string, interrupted: boolean): void;
  /** Something the user should know that isn't an error, e.g. "didn't catch that". */
  onNotice(text: string): void;
  onError(error: FriendlyError): void;
  /** Hands-free: the user was only pausing, so their last message (and any reply to it) is withdrawn. */
  onRetract(): void;
  /** How fast the last completed turn was, for the "under the hood" panel. */
  onMetrics?(metrics: TurnMetrics): void;
}

export interface TurnMetrics {
  /** Speech-to-text time; null for typed messages. */
  sttMs: number | null;
  /** Prompt processing until the first token (measured by the model's worker). */
  firstTokenMs: number | null;
  tokens: number | null;
  tokensPerSecond: number | null;
  /** From the user finishing (speech ended / message sent) to Loom's first sentence going to the voice. */
  replyStartMs: number | null;
}

/** The latest hands-free utterance, kept in case the user was only pausing. */
interface HeardUtterance {
  audio: Float32Array;
  turn: number;
  /** Where its user message landed in history, once transcribed. */
  historyIndex: number | null;
}

/** Returns prompt-ready excerpts relevant to the question, or null. */
export type Retriever = (question: string) => Promise<string | null>;

export interface Stages {
  stt: SpeechToText;
  llm: LanguageModel;
  tts: TextToSpeech;
}

/**
 * Orchestrates one spoken turn at a time:
 * mic → STT → LLM (streamed) → sentence chunks → TTS.
 * Starting to talk while Loom is thinking or speaking interrupts it ("barge-in").
 */
export class Conversation {
  readonly history: ChatMessage[] = [];
  private state: AgentState = 'idle';
  /** Incremented on every new turn / interruption; stale async work checks it and bails. */
  private turn = 0;
  /** Text streamed so far for the reply being generated; null when no generation is running. */
  private streamed: string | null = null;
  private lastUtterance: HeardUtterance | null = null;
  /** Audio from before a mid-sentence pause, to be joined with what the user says next. */
  private continuation: Float32Array | null = null;
  private retriever: Retriever | null = null;
  private systemPrompt = SYSTEM_PROMPT;
  /** Cancels the current turn's transcription if it is still queued. */
  private sttAbort: AbortController | null = null;
  /** When the user finished speaking or sent their message, and how long transcription took. */
  private turnStartedAt = 0;
  private sttMs: number | null = null;

  constructor(
    private stages: Stages,
    private mic: AudioSource,
    private events: ConversationEvents,
  ) {}

  get current(): AgentState {
    return this.state;
  }

  /** Swap the voice without reloading the other stages (e.g. after a fallback). */
  setTts(tts: TextToSpeech): void {
    this.stages.tts = tts;
  }

  /** Swap the brain (e.g. after a background upgrade). Only safe while it isn't generating. */
  setLlm(llm: LanguageModel): void {
    this.stages.llm = llm;
  }

  /** Look up document excerpts for each question (null when no documents are loaded). */
  setRetriever(retriever: Retriever | null): void {
    this.retriever = retriever;
  }

  /** Change who Loom is (conversation mode). Applies from the next reply. */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** Replace the whole conversation, e.g. when opening a saved chat or starting a new one. */
  load(messages: readonly ChatMessage[]): void {
    this.reset();
    this.history.length = 0;
    this.history.push(...messages);
  }

  /** Say something scripted (a mode's greeting) without asking the model. */
  async greet(text: string): Promise<void> {
    this.interrupt();
    const turn = this.nextTurn();
    this.history.push({ role: 'assistant', content: text });
    this.events.onAssistantStart();
    this.events.onAssistantToken(text);
    this.events.onAssistantEnd(text, false);
    this.stages.tts.speak(toSpeakableText(text));
    this.setState('speaking');
    await this.stages.tts.drain();
    this.finish(turn);
  }

  /** True while the language model may be in use. */
  get busy(): boolean {
    return this.state === 'thinking' || this.state === 'speaking' || this.state === 'transcribing';
  }

  async startListening(): Promise<void> {
    if (this.state === 'listening') return;
    this.interrupt();
    try {
      await this.mic.start();
      this.setState('listening');
    } catch (err) {
      this.setState('idle');
      this.events.onError(toFriendlyError(err));
    }
  }

  /** Stop recording and run the full turn. */
  async stopListening(): Promise<void> {
    if (this.state !== 'listening') return;
    const turn = this.nextTurn();
    this.setState('transcribing');

    try {
      const audio = await this.mic.stop();
      if (isLikelySilence(audio, WHISPER_SAMPLE_RATE)) {
        this.events.onNotice('I didn’t hear anything — hold the button and speak.');
        return this.finish(turn);
      }
      await this.transcribeAndReply(turn, audio, false);
    } catch (err) {
      this.fail(turn, err);
    }
  }

  /** Hands-free: voice detection heard the user start talking. Cuts Loom off if it was busy. */
  userStartedSpeaking(): void {
    const last = this.lastUtterance;
    const stillWorking = this.state === 'transcribing' || this.state === 'thinking';
    if (last && last.turn === this.turn && stillWorking) {
      // Loom hadn't started answering yet, so the user was only pausing mid-thought:
      // withdraw that message and hear it again together with what comes next.
      this.nextTurn();
      this.stages.llm.interrupt();
      this.stages.tts.stop();
      this.streamed = null;
      if (last.historyIndex !== null) {
        this.history.length = last.historyIndex;
        this.events.onRetract();
      }
      this.continuation = last.audio;
      this.lastUtterance = null;
      this.setState('listening');
      return;
    }
    this.interrupt();
    if (this.state === 'idle') this.setState('listening');
  }

  /** Hands-free: a complete utterance detected by voice activity detection. */
  async submitUtterance(audio: Float32Array): Promise<void> {
    this.interrupt();
    if (this.continuation) {
      audio = concatChunks([this.continuation, audio]);
      this.continuation = null;
    }
    const turn = this.nextTurn();
    this.lastUtterance = { audio, turn, historyIndex: null };
    this.setState('transcribing');
    try {
      await this.transcribeAndReply(turn, audio, true);
    } catch (err) {
      this.fail(turn, err);
    }
  }

  /** Transcribe, then answer. `quiet` skips the "didn't catch that" notice (background noise in hands-free). */
  private async transcribeAndReply(turn: number, audio: Float32Array, quiet: boolean): Promise<void> {
    this.sttAbort = new AbortController();
    this.turnStartedAt = performance.now();
    const text = await this.stages.stt.transcribe(audio, this.sttAbort.signal);
    this.sttMs = performance.now() - this.turnStartedAt;
    if (turn !== this.turn) return;
    if (!text) {
      if (!quiet) this.events.onNotice('Sorry, I didn’t catch that. Try again?');
      return this.finish(turn);
    }
    if (this.lastUtterance?.turn === turn) this.lastUtterance.historyIndex = this.history.length;
    await this.reply(turn, text);
  }

  /** Send a typed message (skips speech recognition; the reply is still spoken). */
  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state === 'listening') return;
    this.interrupt();
    const turn = this.nextTurn();
    this.turnStartedAt = performance.now();
    this.sttMs = null;
    try {
      await this.reply(turn, trimmed);
    } catch (err) {
      this.fail(turn, err);
    }
  }

  /** Hands-free ended: drop anything in progress, including a half-heard utterance. */
  reset(): void {
    this.interrupt();
    this.nextTurn();
    this.lastUtterance = null;
    this.continuation = null;
    this.setState('idle');
  }

  /** Stop thinking/speaking immediately. */
  interrupt(): void {
    if (this.state === 'idle' || this.state === 'listening') return;
    this.nextTurn();
    this.stages.llm.interrupt();
    this.stages.tts.stop();
    // Close out a half-written reply now, so it can't land after the next turn has started.
    if (this.streamed !== null) {
      const partial = this.streamed.trim();
      if (partial) this.history.push({ role: 'assistant', content: partial });
      this.events.onAssistantEnd(partial, true);
      this.streamed = null;
    }
    this.setState('idle');
  }

  private async reply(turn: number, userText: string): Promise<void> {
    this.history.push({ role: 'user', content: userText });
    this.events.onUserMessage(userText);
    this.setState('thinking');
    this.events.onAssistantStart();

    const chunker = new SentenceChunker();
    let replyStartMs: number | null = null;
    const say = (sentences: string[]) => {
      if (turn !== this.turn) return;
      for (const sentence of sentences) {
        const speakable = toSpeakableText(sentence);
        if (!speakable) continue;
        replyStartMs ??= performance.now() - this.turnStartedAt;
        this.stages.tts.speak(speakable);
        this.setState('speaking');
      }
    };

    // Set before any await, so an interruption during retrieval still closes the reply bubble.
    this.streamed = '';
    const context = this.retriever ? await this.retriever(userText).catch(() => null) : null;
    if (turn !== this.turn) return;

    const messages = buildMessages(this.history, { system: this.systemPrompt, context });
    const reply = await this.stages.llm.generate(messages, (token) => {
      if (turn !== this.turn) return;
      this.streamed += token;
      this.events.onAssistantToken(token);
      say(chunker.push(token));
    });
    // If interrupted, interrupt() already recorded the partial reply.
    if (turn !== this.turn) return;

    this.streamed = null;
    if (reply) this.history.push({ role: 'assistant', content: reply });
    this.events.onAssistantEnd(reply, false);

    say(chunker.flush());
    this.reportMetrics(replyStartMs);
    await this.stages.tts.drain();
    this.finish(turn);
  }

  private reportMetrics(replyStartMs: number | null): void {
    if (!this.events.onMetrics) return;
    const stats = this.stages.llm.lastStats?.() ?? null;
    const decodeMs = stats ? stats.totalMs - stats.firstTokenMs : 0;
    this.events.onMetrics({
      sttMs: this.sttMs,
      firstTokenMs: stats?.firstTokenMs ?? null,
      tokens: stats?.tokens ?? null,
      // Tokens after the first, over the time spent producing them.
      tokensPerSecond: stats && stats.tokens > 1 && decodeMs > 0 ? (stats.tokens - 1) / (decodeMs / 1000) : null,
      replyStartMs,
    });
  }

  /**
   * Start a new turn: everything from the previous one is now stale. A queued
   * transcription for it is cancelled, so a newer utterance isn't stuck behind it.
   */
  private nextTurn(): number {
    this.sttAbort?.abort();
    this.sttAbort = null;
    return ++this.turn;
  }

  private fail(turn: number, err: unknown): void {
    if (turn !== this.turn) return;
    this.events.onError(toFriendlyError(err));
    this.finish(turn);
  }

  private finish(turn: number): void {
    if (turn === this.turn) this.setState('idle');
  }

  private setState(state: AgentState): void {
    if (state === this.state) return;
    this.state = state;
    this.events.onState(state);
  }
}
