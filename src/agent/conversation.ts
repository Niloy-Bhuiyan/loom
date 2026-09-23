import { isLikelySilence, WHISPER_SAMPLE_RATE } from '../audio/pcm';
import { toFriendlyError, type FriendlyError } from '../core/errors';
import { SentenceChunker } from '../core/sentences';
import { toSpeakableText } from '../core/speech-text';
import type { ChatMessage, LanguageModel, SpeechToText, TextToSpeech } from '../pipeline/types';
import { buildMessages } from './prompt';

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
}

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
    const turn = ++this.turn;
    this.setState('transcribing');

    try {
      const audio = await this.mic.stop();
      if (isLikelySilence(audio, WHISPER_SAMPLE_RATE)) {
        this.events.onNotice('I didn’t hear anything — hold the button and speak.');
        return this.finish(turn);
      }

      const text = await this.stages.stt.transcribe(audio);
      if (turn !== this.turn) return;
      if (!text) {
        this.events.onNotice('Sorry, I didn’t catch that. Try again?');
        return this.finish(turn);
      }

      await this.reply(turn, text);
    } catch (err) {
      this.fail(turn, err);
    }
  }

  /** Send a typed message (skips speech recognition; the reply is still spoken). */
  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state === 'listening') return;
    this.interrupt();
    const turn = ++this.turn;
    try {
      await this.reply(turn, trimmed);
    } catch (err) {
      this.fail(turn, err);
    }
  }

  /** Stop thinking/speaking immediately. */
  interrupt(): void {
    if (this.state === 'idle' || this.state === 'listening') return;
    this.turn++;
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
    const say = (sentences: string[]) => {
      if (turn !== this.turn) return;
      for (const sentence of sentences) {
        const speakable = toSpeakableText(sentence);
        if (!speakable) continue;
        this.stages.tts.speak(speakable);
        this.setState('speaking');
      }
    };

    this.streamed = '';
    const reply = await this.stages.llm.generate(buildMessages(this.history), (token) => {
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
    await this.stages.tts.drain();
    this.finish(turn);
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
