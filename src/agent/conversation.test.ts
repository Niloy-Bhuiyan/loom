import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel, SpeechToText, TextToSpeech } from '../pipeline/types';
import { Conversation, type AgentState, type AudioSource, type ConversationEvents } from './conversation';

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

    it('lets the user cut Loom off by speaking', async () => {
      const ctx = setup();
      let finish: (reply: string) => void = () => {};
      vi.mocked(ctx.llm.generate).mockImplementationOnce(async (_m, onToken) => {
        onToken('Long answer');
        return new Promise<string>((resolve) => (finish = resolve));
      });
      const turn = ctx.convo.submitUtterance(speech());
      await vi.waitFor(() => expect(ctx.convo.current).toBe('thinking'));

      ctx.convo.userStartedSpeaking();
      finish('Long answer');
      await turn;

      expect(ctx.convo.current).toBe('listening');
      expect(ctx.tts.stop).toHaveBeenCalled();
      expect(ctx.log.at(-1)).toBe('assistant:Long answer (interrupted)');
    });
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
