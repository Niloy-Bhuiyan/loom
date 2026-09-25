import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel, SpeechToText, TextToSpeech } from '../pipeline/types';
import { Conversation, type AgentState, type AudioSource, type ConversationEvents, type TurnMetrics } from './conversation';

const speech = () => new Float32Array(16_000).fill(0.2);

function setup(opts: { transcript?: string; tokens?: string[]; audio?: Float32Array } = {}) {
  const spoken: string[] = [];
  const states: AgentState[] = [];
  const log: string[] = [];

  let releaseGeneration: () => void = () => {};
  const stt: SpeechToText = {
    load: async () => {},
    dispose: () => {},
    transcribe: vi.fn(async () => opts.transcript ?? 'hello'),
  };
  const llm: LanguageModel = {
    load: async () => {},
    dispose: () => {},
    interrupt: vi.fn(() => releaseGeneration()),
    generate: vi.fn(async (_messages, onToken) => {
      const tokens = opts.tokens ?? ['Hi there. ', 'How can I help?'];
      for (const t of tokens) onToken(t);
      return tokens.join('').trim();
    }),
  };
  const tts: TextToSpeech = {
    load: async () => {},
    dispose: () => {},
    speak: (text) => spoken.push(text),
    stop: vi.fn(),
    drain: async () => {},
  };
  const mic: AudioSource = { start: async () => {}, stop: async () => opts.audio ?? speech() };
  const events: ConversationEvents = {
    onState: (s) => states.push(s),
    onUserMessage: (t) => log.push(`user:${t}`),
    onAssistantStart: () => log.push('assistant:start'),
    onAssistantToken: () => {},
    onAssistantEnd: (t, interrupted) => log.push(`assistant:${t}${interrupted ? ' (interrupted)' : ''}`),
    onNotice: (t) => log.push(`notice:${t}`),
    onError: (e) => log.push(`error:${e.kind}`),
    onRetract: () => log.push('retract'),
  };

  const convo = new Conversation({ stt, llm, tts }, mic, events);
  return { convo, spoken, states, log, llm, tts, stt, setRelease: (fn: () => void) => (releaseGeneration = fn) };
}

describe('Conversation', () => {
  it('runs a full turn: listen → transcribe → think → speak → idle', async () => {
    const { convo, spoken, states, log } = setup();
    await convo.startListening();
    await convo.stopListening();

    expect(states).toEqual(['listening', 'transcribing', 'thinking', 'speaking', 'idle']);
    expect(spoken).toEqual(['Hi there.', 'How can I help?']);
    expect(log).toEqual(['user:hello', 'assistant:start', 'assistant:Hi there. How can I help?']);
    expect(convo.history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there. How can I help?' },
    ]);
  });

  it('skips silent recordings without calling the models', async () => {
    const { convo, stt, log, states } = setup({ audio: new Float32Array(16_000) });
    await convo.startListening();
    await convo.stopListening();
    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(log[0]).toMatch(/^notice:/);
    expect(states.at(-1)).toBe('idle');
  });

  it('tells the user when nothing was transcribed', async () => {
    const { convo, llm, log } = setup({ transcript: '' });
    await convo.startListening();
    await convo.stopListening();
    expect(llm.generate).not.toHaveBeenCalled();
    expect(log[0]).toMatch(/didn’t catch/);
  });

  it('speaks markdown-free text', async () => {
    const { convo, spoken } = setup({ tokens: ['**Sure!** ', 'Here you go.'] });
    await convo.startListening();
    await convo.stopListening();
    expect(spoken).toEqual(['Sure!', 'Here you go.']);
  });

  it('barges in: talking while it is thinking interrupts the reply', async () => {
    const ctx = setup();
    let finish: (reply: string) => void = () => {};
    vi.mocked(ctx.llm.generate).mockImplementation(async (_m, onToken) => {
      onToken('Partial');
      return new Promise<string>((resolve) => (finish = resolve));
    });
    ctx.setRelease(() => finish('Partial'));

    await ctx.convo.startListening();
    const turn = ctx.convo.stopListening();
    await vi.waitFor(() => expect(ctx.convo.current).toBe('thinking'));

    await ctx.convo.startListening();
    await turn;

    expect(ctx.llm.interrupt).toHaveBeenCalled();
    expect(ctx.tts.stop).toHaveBeenCalled();
    expect(ctx.convo.current).toBe('listening');
    expect(ctx.log.at(-1)).toBe('assistant:Partial (interrupted)');
  });

  it('closes an interrupted reply before the next turn starts', async () => {
    const ctx = setup();
    let finishFirst: (reply: string) => void = () => {};
    vi.mocked(ctx.llm.generate)
      .mockImplementationOnce(async (_m, onToken) => {
        onToken('Half an ans');
        return new Promise<string>((resolve) => (finishFirst = resolve));
      })
      .mockImplementationOnce(async (_m, onToken) => {
        onToken('Second.');
        return 'Second.';
      });

    const first = ctx.convo.sendText('one');
    await vi.waitFor(() => expect(ctx.convo.current).toBe('thinking'));
    const second = ctx.convo.sendText('two');
    finishFirst('Half an answer'); // the stale generation resolves late
    await Promise.all([first, second]);

    expect(ctx.log).toEqual([
      'user:one',
      'assistant:start',
      'assistant:Half an ans (interrupted)',
      'user:two',
      'assistant:start',
      'assistant:Second.',
    ]);
    expect(ctx.convo.history.map((m) => m.content)).toEqual(['one', 'Half an ans', 'two', 'Second.']);
  });

  describe('hands-free', () => {
    it('runs a turn from a detected utterance', async () => {
      const { convo, states, spoken } = setup();
      convo.userStartedSpeaking();
      await convo.submitUtterance(speech());
      expect(states).toEqual(['listening', 'transcribing', 'thinking', 'speaking', 'idle']);
      expect(spoken).toEqual(['Hi there.', 'How can I help?']);
    });

    it('stays quiet when background noise transcribes to nothing', async () => {
      const { convo, log, states } = setup({ transcript: '' });
      await convo.submitUtterance(speech());
      expect(log).toEqual([]);
      expect(states.at(-1)).toBe('idle');
    });

    it('treats talking again before Loom answers as a pause, and re-hears both parts together', async () => {
      const ctx = setup();
      const heard: number[] = [];
      vi.mocked(ctx.stt.transcribe).mockImplementation(async (audio) => {
        heard.push(audio.length);
        return heard.length === 1 ? 'Hello Loom' : 'Hello Loom, what is the capital of France?';
      });
      let finishFirst: (reply: string) => void = () => {};
      vi.mocked(ctx.llm.generate).mockImplementationOnce(async () => new Promise<string>((r) => (finishFirst = r)));

      const first = ctx.convo.submitUtterance(new Float32Array(16_000).fill(0.2));
      await vi.waitFor(() => expect(ctx.convo.current).toBe('thinking'));

      ctx.convo.userStartedSpeaking(); // the user carries on talking
      finishFirst('Hi!');
      await first;
      await ctx.convo.submitUtterance(new Float32Array(8_000).fill(0.2));

      expect(heard).toEqual([16_000, 24_000]); // second pass hears both parts
      expect(ctx.log).toEqual([
        'user:Hello Loom',
        'assistant:start',
        'retract',
        'user:Hello Loom, what is the capital of France?',
        'assistant:start',
        'assistant:Hi there. How can I help?',
      ]);
      expect(ctx.convo.history.map((m) => m.content)).toEqual(['Hello Loom, what is the capital of France?', 'Hi there. How can I help?']);
    });

    it('cancels the stale transcription when the user carries on talking', async () => {
      const ctx = setup();
      const signals: AbortSignal[] = [];
      vi.mocked(ctx.stt.transcribe).mockImplementation(
        (_audio, signal) =>
          new Promise((resolve, reject) => {
            signals.push(signal!);
            signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            if (signals.length > 1) resolve('the whole sentence');
          }),
      );

      const first = ctx.convo.submitUtterance(speech());
      ctx.convo.userStartedSpeaking(); // still transcribing the first part
      await first;
      await ctx.convo.submitUtterance(speech());

      expect(signals[0]!.aborted).toBe(true);
      expect(ctx.log).toContain('user:the whole sentence');
      expect(ctx.log.filter((l) => l.startsWith('error'))).toEqual([]);
    });

    it('treats talking while Loom is speaking as a real interruption', async () => {
      const ctx = setup();
      let finish: (reply: string) => void = () => {};
      vi.mocked(ctx.llm.generate).mockImplementationOnce(async (_m, onToken) => {
        onToken('First sentence. ');
        onToken('Second');
        return new Promise<string>((r) => (finish = r));
      });
      const turn = ctx.convo.submitUtterance(speech());
      await vi.waitFor(() => expect(ctx.convo.current).toBe('speaking'));
      ctx.convo.userStartedSpeaking();
      finish('First sentence. Second');
      await turn;
      expect(ctx.convo.current).toBe('listening');
      expect(ctx.tts.stop).toHaveBeenCalled();
      expect(ctx.log).not.toContain('retract');
      expect(ctx.log.at(-1)).toBe('assistant:First sentence. Second (interrupted)');
    });

    it('drops a half-heard utterance when hands-free is switched off', async () => {
      const { convo, states } = setup();
      convo.userStartedSpeaking();
      convo.reset();
      expect(states).toEqual(['listening', 'idle']);
    });

  });

  it('reports how fast each turn was', async () => {
    const ctx = setup();
    ctx.llm.lastStats = () => ({ tokens: 21, firstTokenMs: 500, totalMs: 1500 });
    const metrics: TurnMetrics[] = [];
    (ctx.convo as unknown as { events: ConversationEvents }).events.onMetrics = (m) => metrics.push(m);

    await ctx.convo.startListening();
    await ctx.convo.stopListening();

    expect(metrics).toHaveLength(1);
    const [m] = metrics;
    expect(m).toMatchObject({ firstTokenMs: 500, tokens: 21, tokensPerSecond: 20 });
    expect(m!.sttMs).toBeGreaterThanOrEqual(0);
    expect(m!.replyStartMs).toBeGreaterThanOrEqual(0);
  });

  it('has no speech-to-text time for typed messages', async () => {
    const ctx = setup();
    const metrics: TurnMetrics[] = [];
    (ctx.convo as unknown as { events: ConversationEvents }).events.onMetrics = (m) => metrics.push(m);
    await ctx.convo.sendText('hi');
    expect(metrics[0]).toMatchObject({ sttMs: null, tokensPerSecond: null });
  });

  it('speaks a greeting without calling the model', async () => {
    const ctx = setup();
    await ctx.convo.greet('Let’s practice English!');
    expect(ctx.llm.generate).not.toHaveBeenCalled();
    expect(ctx.spoken).toEqual(['Let’s practice English!']);
    expect(ctx.convo.history).toEqual([{ role: 'assistant', content: 'Let’s practice English!' }]);
    expect(ctx.convo.current).toBe('idle');
  });

  it('uses the current mode’s system prompt', async () => {
    const ctx = setup();
    ctx.convo.setSystemPrompt('You are a pirate.');
    await ctx.convo.sendText('Ahoy');
    const [messages] = vi.mocked(ctx.llm.generate).mock.calls[0]!;
    expect(messages[0]).toEqual({ role: 'system', content: 'You are a pirate.' });
  });

  it('loads a saved conversation and continues from it', async () => {
    const ctx = setup();
    ctx.convo.load([
      { role: 'user', content: 'My name is Sam.' },
      { role: 'assistant', content: 'Nice to meet you, Sam!' },
    ]);
    await ctx.convo.sendText('What is my name?');
    const [messages] = vi.mocked(ctx.llm.generate).mock.calls[0]!;
    expect(messages.map((m) => m.content).slice(1)).toEqual(['My name is Sam.', 'Nice to meet you, Sam!', 'What is my name?']);
  });

  it('adds document excerpts to the prompt but not to the history', async () => {
    const ctx = setup();
    const retriever = vi.fn(async () => '[From “menu.pdf”]\nSoup is $4.');
    ctx.convo.setRetriever(retriever);
    await ctx.convo.sendText('How much is soup?');

    expect(retriever).toHaveBeenCalledWith('How much is soup?');
    const [messages] = vi.mocked(ctx.llm.generate).mock.calls[0]!;
    expect(messages.at(-1)?.content).toContain('Soup is $4.');
    expect(ctx.convo.history[0]).toEqual({ role: 'user', content: 'How much is soup?' });
  });

  it('still answers if document lookup fails', async () => {
    const ctx = setup();
    ctx.convo.setRetriever(async () => {
      throw new Error('embedder crashed');
    });
    await ctx.convo.sendText('Hello?');
    expect(ctx.spoken).toEqual(['Hi there.', 'How can I help?']);
  });

  it('answers typed messages without speech recognition', async () => {
    const { convo, stt, spoken, log } = setup();
    await convo.sendText('  typed question ');
    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(log[0]).toBe('user:typed question');
    expect(spoken).toEqual(['Hi there.', 'How can I help?']);
    expect(convo.current).toBe('idle');
  });

  it('ignores empty typed messages', async () => {
    const { convo, log } = setup();
    await convo.sendText('   ');
    expect(log).toEqual([]);
  });

  it('reports errors from a stage and returns to idle', async () => {
    const ctx = setup();
    vi.mocked(ctx.stt.transcribe).mockRejectedValue(new Error('Failed to fetch'));
    await ctx.convo.startListening();
    await ctx.convo.stopListening();
    expect(ctx.log).toEqual(['error:network']);
    expect(ctx.convo.current).toBe('idle');
  });
});
