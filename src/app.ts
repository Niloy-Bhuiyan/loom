import { Conversation, type AgentState, type TurnMetrics } from './agent/conversation';
import { MicRecorder } from './audio/recorder';
import { findStt, LIGHTEST_LLM, SUPERTONIC_APPROX_MB, SUPERTONIC_MODEL, type LlmPreset } from './config/models';
import { saveSettings, type Settings, type TalkMode } from './config/settings';
import type { Capabilities } from './core/capabilities';
import { toFriendlyError, type FriendlyError } from './core/errors';
import { areModelsCached, clearModelCache, markModelsCached, requestPersistentStorage } from './core/model-cache';
import { formatBytes } from './core/progress';
import { upgradeBrain } from './llm/brain-upgrade';
import { planBrain, type BrainPlan } from './llm/fast-start';
import { pickDtype, TransformersLLM } from './llm/transformers-llm';
import type { LanguageModel, LoadableStage, TextToSpeech } from './pipeline/types';
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
import { HandsFree } from './vad/hands-free';
import { DocumentLibrary } from './docs/library';
import { DocumentsUi } from './ui/documents';
import { systemPromptFor } from './agent/prompt';
import { ChatStore, titleFor, type SavedChat } from './chats/store';
import { DEFAULT_MODE, findMode, type Mode } from './config/modes';
import { renderChatList } from './ui/chat-list';
import { LiveFace } from './ui/face';
import { renderChatTitle, renderModePicker, renderSuggestions } from './ui/modes';
import { OfflineManager, type OfflineState } from './offline/manager';
import { canDownloadInBackground, hasBackgroundDownload } from './offline/offline';
import { renderOfflineStatus } from './ui/offline-status';
import { NetMonitor } from './core/net-monitor';
import { ProofPanel } from './ui/proof-panel';
import { openSpeedCard, renderSpeedCard } from './ui/speed-card';

const MAX_DOWNLOAD_RETRIES = 2;

/** What the talk button and waveform show: the agent state, plus `standby` for hands-free waiting. */
type DisplayState = AgentState | 'standby';

// Static strings only (rendered as HTML for the <kbd> hints).
const PUSH_STATUS: Record<AgentState, string> = {
  idle: 'Hold to talk, or tap to start and tap again to send<span class="kbd-hint"> · or hold <kbd>Space</kbd></span>',
  listening: 'Listening… release (or tap) to send',
  transcribing: 'Transcribing on your GPU…',
  thinking: 'Thinking… tap to interrupt',
  speaking: 'Speaking… tap to interrupt<span class="kbd-hint"> · <kbd>Esc</kbd> to stop</span>',
};

const HANDS_FREE_STATUS: Record<DisplayState, string> = {
  idle: 'Tap to start a hands-free conversation<span class="kbd-hint"> · or press <kbd>Space</kbd></span>',
  standby: 'I’m listening — just start talking. Tap to end.',
  listening: 'Listening…',
  transcribing: 'Transcribing on your GPU…',
  thinking: 'Thinking… just talk to interrupt',
  speaking: 'Speaking… just talk to interrupt<span class="kbd-hint"> · <kbd>Esc</kbd> to stop</span>',
};

export class App {
  private layout: Layout;
  private transcript: Transcript;
  private recorder = new MicRecorder();
  private stt: WhisperSTT;
  private llm: LanguageModel;
  /** Fast start: which brain loads first, and which (if any) replaces it in the background. */
  private brain: BrainPlan;
  /** An upgraded brain waiting for a quiet moment to be swapped in. */
  private pendingLlm: LanguageModel | null = null;
  /** Name of the brain currently answering (changes after a background upgrade). */
  private brainLabel = '';
  private tts: TextToSpeech;
  private conversation: Conversation;
  private handsFree: HandsFree;
  private waveform: Waveform;
  /** Loom's animated face inside the voice orb; bobs with its voice (a gentle pulse if the engine can't report levels). */
  /** Live proof panel: timings, speed, hardware, and network use since ready. */
  private net = new NetMonitor();
  private proof = new ProofPanel(() => void this.shareSpeed());
  private lastMetrics: TurnMetrics | null = null;
  private face = new LiveFace(() => this.tts.level?.() ?? 0.2 + 0.15 * Math.sin(performance.now() / 110));
  private chats = new ChatStore();
  /** The saved chat being continued; created on the first thing the user says. */
  private currentChat: SavedChat | null = null;
  private mode: Mode = findMode(DEFAULT_MODE);
  private library = new DocumentLibrary();
  private docsUi = new DocumentsUi({
    onFiles: (files) => void this.addDocuments(files),
    onRemove: (id) => this.removeDocument(id),
  });
  private ready = false;
  /** Makes sure this device can run Loom with the wifi off. */
  private offline: OfflineManager;
  /** The start-up panel while it's showing a background download. */
  private bootLoader: LoaderPanel | null = null;

  constructor(
    private host: HTMLElement,
    private caps: Capabilities,
    private settings: Settings,
  ) {
    this.layout = buildLayout();
    this.transcript = new Transcript(this.layout.empty);
    this.layout.stage.append(this.transcript.el);

    this.stt = new WhisperSTT(findStt(settings.stt));
    this.brain = planBrain(settings.llm, (model) => areModelsCached([model]));
    this.llm = this.createLlm(this.brain.initial);
    this.brainLabel = this.brain.initial.label;
    this.tts = createTts(settings);
    this.offline = new OfflineManager(settings, caps.shaderF16, (state) => this.renderOffline(state));

    this.conversation = new Conversation({ stt: this.stt, llm: this.llm, tts: this.tts }, this.recorder, {
      onState: (s) => this.renderState(s),
      onUserMessage: (t) => {
        this.transcript.addUser(t);
        this.persistChat();
      },
      onAssistantStart: () => this.transcript.startAssistant(),
      onAssistantToken: (t) => this.transcript.appendAssistant(t),
      onAssistantEnd: (_t, interrupted) => {
        this.transcript.endAssistant(interrupted);
        this.persistChat();
      },
      onNotice: (t) => this.transcript.addNotice(t),
      onError: (e) => this.showRuntimeError(e),
      onMetrics: (m) => {
        this.lastMetrics = m;
        this.proof.setMetrics(m);
      },
      onRetract: () => {
        this.transcript.retractLastUser();
        this.persistChat();
      },
    });

    this.handsFree = new HandsFree(this.recorder, {
      onSpeechStart: () => this.conversation.userStartedSpeaking(),
      onSpeechEnd: (audio) => void this.conversation.submitUtterance(audio),
      onError: (err) => {
        this.showRuntimeError(toFriendlyError(err));
        void this.stopHandsFree();
      },
    });

    this.waveform = new Waveform(this.layout.wave, this.layout.talk, {
      mic: () => this.recorder.analyser,
      output: () => this.tts.level?.() ?? null,
    });
  }

  mount(): void {
    this.host.replaceChildren(this.layout.root);
    this.layout.upgrade.el.after(this.docsUi.strip);
    this.layout.typeForm.prepend(this.docsUi.attachButton);
    this.docsUi.mount(this.layout.root);
    this.layout.talk.prepend(this.face.el);
    this.face.start();
    this.layout.root.append(this.proof.el);
    this.net.onChange(() => this.proof.setNetwork(this.net.sinceReady, this.net.ready));
    this.net.start();
    this.proof.setNetwork([], false);
    this.renderSystemInfo();
    this.bindControls();
    this.renderModeSwitch();
    this.renderModes();
    void this.refreshChats();
    const refresh = () => renderConnectivity(this.layout, navigator.onLine, this.ready);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    refresh();
    this.waveform.start();
    void this.boot();
  }

  // ───────────────────────── Model loading ─────────────────────────

  private createLlm(preset: LlmPreset): TransformersLLM {
    // Read settings at load time: the light brain's self-test may already have ruled out f16.
    return new TransformersLLM(preset, this.caps.shaderF16 && this.settings.f16, () => {
      if (!this.settings.f16) return;
      this.settings = { ...this.settings, f16: false };
      saveSettings(this.settings);
      this.transcript.addNotice('Your GPU’s 16-bit math gave wrong results, so Loom switched to 32-bit weights. This is remembered for next time.');
    });
  }

  private stageInfo(): StageInfo[] {
    const stt = findStt(this.settings.stt);
    const llm = this.brain.initial;
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
    const ids = [findStt(this.settings.stt).model, this.brain.initial.model];
    if (this.settings.tts === 'supertonic') ids.push(SUPERTONIC_MODEL);
    return ids;
  }

  private async boot(): Promise<void> {
    const stages = this.stageInfo();
    const gpu = this.caps.adapterName ? `GPU: ${this.caps.adapterName}` : 'GPU: WebGPU';
    const loader = new LoaderPanel(stages, `${gpu} · ${this.caps.shaderF16 ? '16-bit shaders ✓' : '32-bit shaders'} · models from huggingface.co`);
    this.host.append(loader.el);

    const start = (fromCache: boolean) => {
      this.bootLoader = null;
      loader.showLoading(fromCache);
      void this.loadModels(loader);
    };

    if (areModelsCached(this.modelIds())) return start(true);
    // Came back while a background download is still going: show it instead of asking again.
    if (await hasBackgroundDownload().catch(() => false)) return this.followBackgroundDownload(loader, false);

    const total = stages.reduce((n, s) => n + s.approxMB, 0);
    const later = this.brain.upgradeTo;
    const note = later
      ? `To get you talking sooner, Loom starts with a light brain and quietly upgrades to ${later.label} (~${formatBytes(later.approxMB * 1024 * 1024)}) in the background.`
      : undefined;
    const background = await canDownloadInBackground().catch(() => false);
    loader.askToDownload(total, () => start(false), () => this.openSettings(), note, background ? () => void this.followBackgroundDownload(loader, true) : undefined);
  }

  /**
   * Download everything (chosen brain included) via Background Fetch while
   * showing progress in the loader. When it's all on disk, reload so the
   * chosen models load directly from cache.
   */
  private async followBackgroundDownload(loader: LoaderPanel, begin: boolean): Promise<void> {
    this.bootLoader = loader;
    loader.showBackground('Starting…', null);
    if (begin) await this.offline.download();
    else await this.offline.refresh();
    const state = this.offline.current;
    if (state.kind === 'ready') location.reload();
    else if (state.kind !== 'failed') {
      // Never leave the start-up screen hanging without a way forward.
      loader.showBackground('Not everything was saved yet. Reload the page to resume — files that arrived are kept.', 0, false);
    }
  }

  private renderOffline(state: OfflineState): void {
    renderOfflineStatus(this.layout.offlineStatus, state, () => void this.offline.download());
    if (!this.bootLoader) return;
    if (state.kind === 'downloading' && state.storing) {
      this.bootLoader.showBackground('Download complete — saving it to this device…', null, state.background);
    } else if (state.kind === 'downloading') {
      const { downloadedBytes: done, totalBytes: total } = state;
      const fraction = done && total ? Math.min(1, done / total) : null;
      const detail = done ? `${formatBytes(done)}${total ? ` of ${formatBytes(total)}` : ''} saved` : 'Starting…';
      this.bootLoader.showBackground(detail, fraction, state.background);
    } else if (state.kind === 'failed') {
      this.bootLoader.showBackground(`${state.message} Reload the page to resume — files that arrived are kept.`, 0);
    }
  }

  private async loadModels(loader: LoaderPanel): Promise<void> {
    const load = async (key: string, stage: LoadableStage) => {
      for (let attempt = 1; ; attempt++) {
        try {
          await stage.load((p) => loader.progress(key, p));
          loader.status(key, 'ready', 'Ready');
          return;
        } catch (err) {
          // Multi-hundred-MB downloads sometimes drop midway; files that finished are cached, so retrying is cheap.
          const transient = toFriendlyError(err).kind === 'network' && navigator.onLine;
          if (transient && attempt <= MAX_DOWNLOAD_RETRIES) {
            loader.status(key, 'loading', `Connection dropped — retrying (${attempt}/${MAX_DOWNLOAD_RETRIES})…`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          loader.status(key, 'error', 'Failed to load');
          throw err;
        }
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
    this.renderSystemInfo();
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
    this.renderModes();
    renderConnectivity(this.layout, navigator.onLine, true);
    // From here on, a conversation should cause zero network requests.
    this.net.markReady();
    this.renderSystemInfo();
    this.renderState('idle');
    // Check offline readiness once nothing else is downloading (after an upgrade, see swapBrainIfIdle).
    if (this.brain.upgradeTo) void this.startBrainUpgrade(this.brain.upgradeTo);
    else void this.offline.refresh();
  }

  private async startBrainUpgrade(target: LlmPreset): Promise<void> {
    const { el, text, fill } = this.layout.upgrade;
    el.hidden = false;
    text.textContent = `Getting smarter in the background — downloading ${target.label}…`;
    const dtype = pickDtype(target, this.caps.shaderF16 && this.settings.f16);

    await upgradeBrain(target, dtype, () => this.createLlm(target), {
      onProgress: (p) => {
        const pct = Math.round((p.fraction ?? 0) * 100);
        fill.style.width = `${pct}%`;
        text.textContent =
          p.fraction !== null && p.fraction < 1
            ? `Getting smarter in the background — downloading ${target.label}… ${pct}% (${formatBytes(p.loadedBytes)} of ${formatBytes(p.totalBytes)})`
            : `Getting smarter — loading ${target.label} onto your GPU…`;
      },
      onReady: (llm) => {
        this.pendingLlm = llm;
        markModelsCached([target.model]);
        text.textContent = `${target.label} is ready — switching over after this reply.`;
        this.swapBrainIfIdle();
      },
      onError: (err) => {
        el.hidden = true;
        console.warn('[loom] brain upgrade failed', err);
        void this.offline.refresh();
        const friendly = toFriendlyError(err);
        this.transcript.addNotice(
          friendly.kind === 'out-of-memory'
            ? `${target.label} doesn’t fit in your GPU’s memory, so Loom will keep using the light brain.`
            : `Couldn’t download ${target.label} right now; Loom will keep using the light brain and try again next visit.`,
        );
      },
    });
  }

  /** Swap in an upgraded brain once nothing is being generated. */
  private swapBrainIfIdle(): void {
    if (!this.pendingLlm || this.conversation.busy) return;
    const old = this.llm;
    this.llm = this.pendingLlm;
    this.pendingLlm = null;
    this.conversation.setLlm(this.llm);
    old.dispose();
    this.layout.upgrade.el.hidden = true;
    this.transcript.addNotice(`Brain upgraded — now using ${this.brain.upgradeTo?.label ?? 'the bigger model'}.`);
    this.brainLabel = this.brain.upgradeTo?.label ?? this.brainLabel;
    this.renderSystemInfo();
    void this.offline.refresh();
  }

  private renderSystemInfo(): void {
    this.proof.setSystem({
      gpu: this.caps.adapterName ?? 'WebGPU adapter',
      precision: this.caps.shaderF16 && this.settings.f16 ? '16-bit weights' : '32-bit weights',
      ears: findStt(this.settings.stt).label,
      brain: this.brainLabel,
      voice: describeTts(this.tts),
    });
  }

  private async shareSpeed(): Promise<void> {
    const m = this.lastMetrics;
    if (!m || m.tokensPerSecond === null) return;
    const blob = await renderSpeedCard({
      tokensPerSecond: m.tokensPerSecond,
      replyStartMs: m.replyStartMs,
      gpu: this.caps.adapterName ?? 'WebGPU',
      brain: this.brainLabel,
    });
    openSpeedCard(blob);
  }

  // ───────────────────────── Interaction ─────────────────────────

  private get handsFreeMode(): boolean {
    return this.settings.talkMode === 'hands-free';
  }

  private bindControls(): void {
    // In hands-free mode the button (and Space) simply toggles the "call" on and off.
    bindTalkControls(this.layout.talk, {
      start: () => (this.handsFreeMode ? void this.toggleHandsFree() : void this.conversation.startListening()),
      stop: () => {
        if (!this.handsFreeMode) void this.conversation.stopListening();
      },
      cancel: () => this.conversation.interrupt(),
      isListening: () => !this.handsFreeMode && this.conversation.current === 'listening',
    });

    for (const [mode, button] of Object.entries(this.layout.modeButtons) as [TalkMode, HTMLButtonElement][]) {
      button.addEventListener('click', () => void this.setTalkMode(mode));
    }

    this.layout.typeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.layout.typeInput.value;
      this.layout.typeInput.value = '';
      void this.conversation.sendText(text);
    });

    this.layout.newChatButton.addEventListener('click', () => this.startNewChat());
    this.layout.menuButton.addEventListener('click', () => this.setSidebarOpen(this.layout.root.dataset.sidebar !== 'open'));
    this.layout.scrim.addEventListener('click', () => this.setSidebarOpen(false));
    this.layout.settingsButton.addEventListener('click', () => this.openSettings());
    this.layout.proofButton.addEventListener('click', () => {
      this.proof.toggle();
      this.layout.proofButton.setAttribute('aria-expanded', String(this.proof.isOpen));
    });
  }

  private async setTalkMode(mode: TalkMode): Promise<void> {
    if (mode === this.settings.talkMode) return;
    if (this.handsFree.active) await this.stopHandsFree();
    this.settings = { ...this.settings, talkMode: mode };
    saveSettings(this.settings);
    this.renderState(this.conversation.current);
  }

  private async toggleHandsFree(): Promise<void> {
    if (this.handsFree.active) return this.stopHandsFree();
    this.conversation.interrupt();
    try {
      await this.handsFree.start();
    } catch (err) {
      this.showRuntimeError(toFriendlyError(err));
    }
    this.renderState(this.conversation.current);
  }

  private async stopHandsFree(): Promise<void> {
    await this.handsFree.stop();
    this.conversation.reset();
    this.renderState(this.conversation.current);
  }

  private renderState(state: AgentState): void {
    this.swapBrainIfIdle();
    const { talk, status } = this.layout;
    const handsFree = this.handsFreeMode;
    const live = handsFree && this.handsFree.active;
    const display: DisplayState = live && state === 'idle' ? 'standby' : state;

    talk.dataset.state = display;
    this.face.setMood(display === 'transcribing' ? 'thinking' : display);
    this.layout.talkBadge.replaceChildren(icon(live || (!handsFree && state === 'listening') ? 'stop' : 'mic'));
    talk.setAttribute(
      'aria-label',
      live ? 'End hands-free conversation' : handsFree ? 'Start hands-free conversation' : state === 'listening' ? 'Stop and send' : 'Hold to talk',
    );
    status.innerHTML = live || (handsFree && state === 'idle') ? HANDS_FREE_STATUS[display] : PUSH_STATUS[state];
    this.waveform.setMode(display === 'transcribing' ? 'thinking' : display);
    // Loom's own voice can leak into the mic; demand clearer speech to barge in while it talks.
    if (live) this.handsFree.setStrict(state === 'speaking');
    this.renderModeSwitch();
  }

  private renderModeSwitch(): void {
    for (const [mode, button] of Object.entries(this.layout.modeButtons) as [TalkMode, HTMLButtonElement][]) {
      button.setAttribute('aria-checked', String(mode === this.settings.talkMode));
    }
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

    const onlyVoiceChanged = prev.stt === next.stt && prev.llm === next.llm && prev.tts === next.tts && prev.f16 === next.f16;
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

  // ───────────────────────── Modes & saved chats ─────────────────────────

  private renderModes(): void {
    renderModePicker(this.layout.modePicker, this.mode, (mode) => void this.pickMode(mode));
    renderSuggestions(this.layout.chipsBox, this.mode, this.ready, (text) => void this.conversation.sendText(text));
    renderChatTitle(this.layout.chatTitle, this.mode);
    this.transcript.setAvatarColor(this.mode.color);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.conversation.setSystemPrompt(systemPromptFor(mode));
    this.renderModes();
  }

  /** Chosen from the welcome screen: switch persona and have Loom say hello. */
  private async pickMode(mode: Mode): Promise<void> {
    this.setMode(mode);
    if (this.ready && this.conversation.history.length === 0) await this.conversation.greet(mode.greeting);
  }

  private startNewChat(): void {
    this.currentChat = null;
    this.conversation.load([]);
    this.transcript.clear();
    this.renderModes();
    this.setSidebarOpen(false);
    void this.refreshChats();
  }

  private async openChat(id: string): Promise<void> {
    const chat = await this.chats.get(id).catch(() => undefined);
    if (!chat) return;
    this.currentChat = chat;
    this.setMode(findMode(chat.mode));
    this.conversation.load(chat.messages);
    this.transcript.showHistory(chat.messages);
    this.setSidebarOpen(false);
    void this.refreshChats();
  }

  private async deleteChat(id: string): Promise<void> {
    await this.chats.delete(id).catch(() => {});
    if (this.currentChat?.id === id) this.startNewChat();
    else void this.refreshChats();
  }

  private async refreshChats(): Promise<void> {
    const chats = await this.chats.list().catch(() => []);
    renderChatList(this.layout.chatList, chats, this.currentChat?.id ?? null, {
      onOpen: (id) => void this.openChat(id),
      onDelete: (id) => void this.deleteChat(id),
    });
  }

  /** On small screens the sidebar slides over the conversation. */
  private setSidebarOpen(open: boolean): void {
    this.layout.root.dataset.sidebar = open ? 'open' : 'closed';
    this.layout.menuButton.setAttribute('aria-expanded', String(open));
  }

  /** Save the conversation on this device once the user has said something. */
  private persistChat(): void {
    const messages = [...this.conversation.history];
    if (!messages.some((m) => m.role === 'user')) return;
    const now = Date.now();
    this.currentChat ??= { id: crypto.randomUUID(), title: '', mode: this.mode.id, messages: [], createdAt: now, updatedAt: now };
    Object.assign(this.currentChat, { messages, title: titleFor(messages), mode: this.mode.id, updatedAt: now });
    // IndexedDB can be unavailable (e.g. some private windows); chats then simply aren't kept.
    this.chats
      .save({ ...this.currentChat })
      .then(() => this.refreshChats())
      .catch((err: unknown) => console.warn('[loom] could not save chat', err));
  }

  // ───────────────────────── Documents ─────────────────────────

  private async addDocuments(files: File[]): Promise<void> {
    for (const file of files) {
      const show = (text: string | null) => this.docsUi.showProgress(text, this.library.list);
      try {
        show(`Reading ${file.name}…`);
        const doc = await this.library.add(
          file,
          ({ step, fraction }) => show(`${step === 'reading' ? 'Reading' : 'Understanding'} ${file.name}… ${Math.round(fraction * 100)}%`),
          (p) => show(`Getting the document reader ready… ${Math.round((p.fraction ?? 0) * 100)}%`),
        );
        show(null);
        this.conversation.setRetriever((q) => this.library.retrieve(q));
        this.layout.typeInput.placeholder = `Ask about ${doc.name}…`;
        this.transcript.addNotice(
          `📄 Read “${doc.name}”${doc.pages ? ` (${doc.pages} page${doc.pages === 1 ? '' : 's'})` : ''} on this device. Ask me anything about it — the file never leaves your computer.`,
        );
      } catch (err) {
        show(null);
        const message = err instanceof Error ? err.message : String(err);
        this.transcript.addNotice(`Couldn’t read “${file.name}”: ${message}`, true);
      }
    }
  }

  private removeDocument(id: string): void {
    this.library.remove(id);
    this.docsUi.render(this.library.list);
    if (this.library.isEmpty) {
      this.conversation.setRetriever(null);
      this.layout.typeInput.placeholder = 'or type a message…';
    }
  }

  // ───────────────────────── Errors ─────────────────────────

  private showLoadError(error: FriendlyError, context: string): void {
    const actions: DialogAction[] = [];
    const light = error.suggestSmallerModel && this.brain.initial.id !== LIGHTEST_LLM;
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
