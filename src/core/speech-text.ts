/**
 * Small models sometimes answer with Markdown or emoji even when asked not to.
 * Strip what would sound silly when read aloud; the transcript keeps the original.
 */
export function toSpeakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links / images -> label
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '') // list markers
    .replace(/(^|[^\w*])(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\2(?![\w*])/gm, '$1$3') // emphasis
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
