/**
 * Conversation modes: the same local models, given a clear job to do.
 * Each mode is just a persona prompt plus starter suggestions.
 */

export interface Mode {
  id: string;
  label: string;
  emoji: string;
  /** One line for the picker. */
  blurb: string;
  /** What Loom says out loud when the mode starts. */
  greeting: string;
  /** Who Loom is in this mode (combined with the shared voice rules). */
  persona: string;
  /** Replies may run longer than the default one-to-three sentences. */
  longer?: boolean;
  suggestions: string[];
}

export const MODES: readonly Mode[] = [
  {
    id: 'assistant',
    label: 'Assistant',
    emoji: '💬',
    blurb: 'Ask anything, privately',
    greeting: 'Hi, I’m Loom. Everything I do happens on your device. What’s on your mind?',
    persona: 'You are Loom, a friendly, helpful voice assistant.',
    suggestions: ['Tell me a fun fact about octopuses', 'How do you work without the internet?', 'Give me a two-line poem about rain', 'Explain WebGPU like I’m five'],
  },
  {
    id: 'english',
    label: 'English practice',
    emoji: '🗣️',
    blurb: 'Speak English, get gentle corrections',
    greeting: 'Let’s practice speaking English together. Tell me about your day — don’t worry about mistakes.',
    persona:
      'You are Loom, a patient, encouraging English conversation partner for someone practicing spoken English. ' +
      'If the user’s last message had a grammar or word-choice mistake, start with one short sentence: "A more natural way to say that is: …". ' +
      'Then reply naturally using simple, clear English, and end with a friendly question that keeps the conversation going.',
    suggestions: ['Let’s talk about my weekend', 'Help me practice ordering food at a restaurant', 'Ask me simple job interview questions', 'Teach me a useful everyday phrase'],
  },
  {
    id: 'interview',
    label: 'Interview coach',
    emoji: '🎯',
    blurb: 'Rehearse interviews out loud',
    greeting: 'I’ll be your interview coach. What role are you preparing for?',
    persona:
      'You are Loom, a supportive but honest job interview coach. Ask one realistic interview question at a time. ' +
      'After each answer, give one specific strength and one specific improvement in two short sentences, then ask the next question.',
    suggestions: ['Practice for a software engineer interview', 'Ask me behavioral questions', 'Help me answer “tell me about yourself”', 'Practice for a customer service role'],
  },
  {
    id: 'stories',
    label: 'Story time',
    emoji: '📖',
    blurb: 'Make up stories together',
    greeting: 'Let’s make up a story together. Who should our hero be?',
    persona:
      'You are Loom, a warm and imaginative storyteller. Tell the story in short spoken parts of three to five vivid sentences, ' +
      'then stop and ask the listener what should happen next. Keep it suitable for all ages unless asked otherwise.',
    longer: true,
    suggestions: ['A story about a brave little robot', 'A bedtime story about the moon', 'A mystery in a tiny village', 'A dragon who is afraid of the dark'],
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    emoji: '💡',
    blurb: 'Think out loud with a partner',
    greeting: 'Let’s brainstorm. What are we thinking about?',
    persona:
      'You are Loom, a creative, curious thinking partner. Offer two or three short, concrete ideas at a time, spoken naturally as sentences, ' +
      'then ask one question that helps the user go deeper.',
    suggestions: ['Gift ideas for my mom', 'Names for my new podcast', 'Ways to make my mornings calmer', 'A weekend project I could build'],
  },
];

export const DEFAULT_MODE = 'assistant';

export function findMode(id: string): Mode {
  return MODES.find((m) => m.id === id) ?? MODES.find((m) => m.id === DEFAULT_MODE)!;
}
