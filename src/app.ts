import { Conversation, type AgentState } from './agent/conversation';
import { MicRecorder } from './audio/recorder';
import { findLlm, findStt, LIGHTEST_LLM, SUPERTONIC_APPROX_MB, SUPERTONIC_MODEL } from './config/models';
import { saveSettings, type Settings } from './config/settings';
import type { Capabilities } from './core/capabilities';
import { toFriendlyError, type FriendlyError } from './core/errors';
import { areModelsCached, clearModelCache, markModelsCached, requestPersistentStorage } from './core/model-cache';
import { TransformersLLM } from './llm/transformers-llm';
import type { LoadableStage, TextToSpeech } from './pipeline/types';
import { WhisperSTT } from './stt/whisper';
import { createTts, describeTts, SilentTTS, SupertonicTTS, WebSpeechTTS } from './tts';
import { errorDialog, type DialogAction } from './ui/dialogs';
import { icon } from './ui/icons';
import { buildLayout, renderConnectivity, type Layout } from './ui/layout';
import { LoaderPanel, type StageInfo } from './ui/loader';
import { openSettings } from './ui/settings-panel';
import { bindTalkControls } from './ui/talk-controls';
import { Transcript } from './ui/transcript';
import { Waveform } from './ui/waveform';

const STATUS: Record<AgentState, string> = {
  idle: 'Hold to talk, or tap to start and tap again to send · <kbd>Space</kbd>',
  listening: 'Listening… release (or tap) to send',
  transcribing: 'Transcribing on your GPU…',
  thinking: 'Thinking… tap to interrupt',
  speaking: 'Speaking… tap to interrupt · <kbd>Esc</kbd> to stop',
};

export class App {
  private layout: Layout;
  private transcript: Transcript;
  private recorder = new MicRecorder();
  private stt: WhisperSTT;
  private llm: TransformersLLM;
  private tts: TextToSpeech;
  private conversation: Conversation;
  private waveform: Waveform;
  private ready = false;

  constructor(
    private host: HTMLElement,
    private caps: Capabilities,
    private settings: Settings,
  ) {
    this.layout = buildLayout();
    this.transcript = new Transcript(this.layout.empty);
    this.layout.stage.append(this.transcript.el);

    this.stt = new WhisperSTT(findStt(settings.stt));
    this.llm = new TransformersLLM(findLlm(settings.llm), caps.shaderF16);
    this.tts = createTts(settings);

    this.conversation = new Conversation({ stt: this.stt, llm: this.llm, tts: this.tts }, this.recorder, {
      onState: (s) => this.renderState(s),
      onUserMessage: (t) => this.transcript.addUser(t),
      onAssistantStart: () => this.transcript.startAssistant(),
      onAssistantToken: (t) => this.transcript.appendAssistant(t),
      onAssistantEnd: (_t, interrupted) => this.transcript.endAssistant(interrupted),
      onNotice: (t) => this.transcript.addNotice(t),
      onError: (e) => this.showRuntimeError(e),
    });

    this.waveform = new Waveform(this.layout.wave, this.layout.talk, {
      mic: () => this.recorder.analyser,
      output: () => this.tts.level?.() ?? null,
    });
  }

  mount(): void {
    this.host.replaceChildren(this.layout.root);
    this.bindControls();
    const refresh = () => renderConnectivity(this.layout, navigator.onLine, this.ready);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    refresh();
    this.waveform.start();
    this.boot();
  }

  // ───────────────────────── Model loading ─────────────────────────

  private stageInfo(): StageInfo[] {
    const stt = findStt(this.settings.stt);
    const llm = findLlm(this.settings.llm);
    const supertonic = this.settings.tts === 'supertonic';
    return [
      { key: 'stt', title: 'Ears', model: stt.label, approxMB: stt.approxMB, icon: 'ear' },
      { key: 'llm', title: 'Brain', model: llm.label, approxMB: llm.approxMB, icon: 'brain' },
      {
        key: 'tts',
        title: 'Voice',
        model: supertonic ? 'Supertonic TTS' : 'Built-in browser voice',
        approxMB: supertonic ? SUPERTONIC_APPROX_MB : 0,
        icon: 'speaker',
      },
    ];
  }

  private modelIds(): string[] {
    const ids = [findStt(this.settings.stt).model, findLlm(this.settings.llm).model];
    if (this.settings.tts === 'supertonic') ids.push(SUPERTONIC_MODEL);
    return ids;
  }

  private boot(): void {
    const stages = this.stageInfo();
    const gpu = this.caps.adapterName ? `GPU: ${this.caps.adapterName}` : 'GPU: WebGPU';
    const loader = new LoaderPanel(stages, `${gpu} · ${this.caps.shaderF16 ? '16-bit shaders ✓' : '32-bit shaders'} · models from huggingface.co`);
    this.host.append(loader.el);

    const start = (fromCache: boolean) => {
      loader.showLoading(fromCache);
      void this.loadModels(loader);
    };

    if (areModelsCached(this.modelIds())) {
      start(true);
    } else {
      const total = stages.reduce((n, s) => n + s.approxMB, 0);
      loader.askToDownload(total, () => start(false), () => this.openSettings());
    }
  }

  private async loadModels(loader: LoaderPanel): Promise<void> {
    const load = async (key: string, stage: LoadableStage) => {
      try {
        await stage.load((p) => loader.progress(key, p));
        loader.status(key, 'ready', 'Ready');
      } catch (err) {
        loader.status(key, 'error', 'Failed to load');
        throw err;
      }
    };

    const [stt, llm, tts] = await Promise.allSettled([
      load('stt', this.stt),
      load('llm', this.llm),
      load('tts', this.tts).catch((err) => this.fallbackVoice(loader, err)),
    ]);

    const failure = [stt, llm, tts].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) {
      const which = stt.status === 'rejected' ? 'the speech recognition model' : 'the language model';
      this.showLoadError(toFriendlyError(failure.reason), `Loom couldn’t load ${which}.`);
      return;
    }

    markModelsCached(this.modelIds());
    void requestPersistentStorage();
    loader.hide();
    this.setReady();
  }

  /** The neural voice failed (often memory): fall back to an on-device system voice, then to text only. */
  private async fallbackVoice(loader: LoaderPanel, err: unknown): Promise<void> {
    console.warn('[loom] voice failed to load, falling back', err);
    this.tts.dispose();
    let fallback: TextToSpeech = new WebSpeechTTS();
    try {
      await fallback.load(() => {});
    } catch {
      fallback = new SilentTTS();
    }
    this.tts = fallback;
    this.conversation.setTts(fallback);
    loader.status('tts', 'ready', `Using fallback: ${describeTts(fallback)}`);
    this.transcript.addNotice(
      fallback instanceof SilentTTS
        ? 'The neural voice couldn’t load and no on-device system voice is installed, so replies will be text only.'
        : 'The neural voice couldn’t load, so Loom is using your system’s built-in on-device voice.',
    );
  }

  private setReady(): void {
    this.ready = true;
    this.layout.talk.disabled = false;
    this.layout.typeInput.disabled = false;
    for (const chip of this.layout.chips) chip.disabled = false;
    renderConnectivity(this.layout, navigator.onLine, true);
    this.renderState('idle');
  }

  // ───────────────────────── Interaction ─────────────────────────

  private bindControls(): void {
    bindTalkControls(this.layout.talk, {
      start: () => void this.conversation.startListening(),
      stop: () => void this.conversation.stopListening(),
      cancel: () => this.conversation.interrupt(),
      isListening: () => this.conversation.current === 'listening',
    });

    this.layout.typeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.layout.typeInput.value;
      this.layout.typeInput.value = '';
      void this.conversation.sendText(text);
    });

    for (const chip of this.layout.chips) {
      chip.addEventListener('click', () => void this.conversation.sendText(chip.textContent ?? ''));
    }

    this.layout.settingsButton.addEventListener('click', () => this.openSettings());
  }

  private renderState(state: AgentState): void {
    const { talk, status } = this.layout;
    talk.dataset.state = state;
    talk.replaceChildren(icon(state === 'listening' ? 'stop' : 'mic'));
    talk.setAttribute('aria-label', state === 'listening' ? 'Stop and send' : state === 'idle' ? 'Hold to talk' : 'Interrupt and talk');
    status.innerHTML = STATUS[state]; // static strings only
    this.waveform.setMode(state === 'transcribing' ? 'thinking' : state);
  }

  private openSettings(): void {
    openSettings({
      settings: this.settings,
      caps: this.caps,
      activeTts: describeTts(this.tts),
      onApply: (next) => this.applySettings(next),
      onClearCache: () => void clearModelCache().then(() => location.reload()),
    });
  }

  private applySettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    saveSettings(next);

    const onlyVoiceChanged = prev.stt === next.stt && prev.llm === next.llm && prev.tts === next.tts;
    if (onlyVoiceChanged && this.tts instanceof SupertonicTTS) {
      this.tts.voice = next.voice;
      this.transcript.addNotice(`Voice changed to ${next.voice}.`);
      return;
    }
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      // Reloading is the most reliable way to release GPU memory held by the old models.
      location.reload();
    }
  }

  // ───────────────────────── Errors ─────────────────────────

  private showLoadError(error: FriendlyError, context: string): void {
    const actions: DialogAction[] = [];
    const light = error.suggestSmallerModel && this.settings.llm !== LIGHTEST_LLM;
    if (light) {
      actions.push({
        label: 'Use the light model',
        primary: true,
        onClick: () => {
          saveSettings({ ...this.settings, llm: LIGHTEST_LLM, stt: 'whisper-tiny.en' });
          location.reload();
        },
      });
    }
    actions.push({ label: 'Try again', primary: !light, onClick: () => location.reload() });
    actions.push({ label: 'Settings', onClick: () => this.openSettings() });
    document.body.append(errorDialog(error, actions, context));
  }

  private showRuntimeError(error: FriendlyError): void {
    this.transcript.endAssistant(true);
    this.transcript.addNotice(`${error.title}. ${error.detail}`, true);
  }
}
