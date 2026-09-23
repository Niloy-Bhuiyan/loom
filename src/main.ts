import './styles.css';
import { App } from './app';
import { loadSettings } from './config/settings';
import { detectCapabilities } from './core/capabilities';
import { unsupportedScreen } from './ui/dialogs';

async function main(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const caps = await detectCapabilities();

  if (!caps.webgpu) {
    root.replaceChildren(unsupportedScreen(caps));
    return;
  }

  new App(root, caps, loadSettings()).mount();
}

void main();
