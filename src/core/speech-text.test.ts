import { describe, expect, it } from 'vitest';
import { toSpeakableText } from './speech-text';

describe('toSpeakableText', () => {
  it('leaves plain sentences alone', () => {
    expect(toSpeakableText('Hi, I am Loom.')).toBe('Hi, I am Loom.');
  });

  it('removes markdown emphasis, headings and list markers', () => {
    expect(toSpeakableText('## Tips\n- **Drink** water\n- Sleep _well_')).toBe('Tips Drink water Sleep well');
    expect(toSpeakableText('1. First\n2) Second')).toBe('First Second');
  });

  it('keeps link labels and replaces bare URLs', () => {
    expect(toSpeakableText('See [the docs](https://x.y) or https://example.com')).toBe('See the docs or a link');
  });

  it('drops code blocks and emoji', () => {
    expect(toSpeakableText('Sure! 😀 ```js\nx()\n``` Done `ok`.')).toBe('Sure! Done ok.');
  });

  it('keeps snake_case and arithmetic intact', () => {
    expect(toSpeakableText('use my_var and 2*3*4')).toBe('use my_var and 2*3*4');
  });
});
