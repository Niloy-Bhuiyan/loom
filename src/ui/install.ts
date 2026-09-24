import { h } from './dom';
import { icon } from './icons';

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * An "Install" button that appears only when the browser says Loom can be
 * installed as an app (Chrome/Edge desktop and Android). Installed, Loom opens
 * in its own window and — with its models cached — works like a native offline app.
 */
export function installButton(): HTMLButtonElement {
  const button = h('button', { class: 'install-btn', hidden: true, title: 'Install Loom as an app' }, icon('download'), h('span', {}, 'Install'));
  let deferred: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.hidden = true;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });
  return button;
}
