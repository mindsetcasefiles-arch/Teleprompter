import { cleanWord, matchSpokenToScript, tokenizeSpeech } from './speechMatch';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(cleanWord('Hello,') === 'hello', 'cleanWord strips punctuation');
assert(cleanWord("it's") === "it's", 'cleanWord keeps apostrophes');

const words = 'Welcome to VocalPrompt speak naturally'.split(' ');
const spoken = tokenizeSpeech('', 'welcome to vocalprompt');
const matched = matchSpokenToScript(words, spoken, 0);
assert(matched === 2, `expected match index 2, got ${matched}`);

const advanced = matchSpokenToScript(words, tokenizeSpeech('welcome to', 'vocalprompt speak'), 2);
assert(advanced >= 3, `expected cursor to advance past vocalprompt, got ${advanced}`);

console.log('speechMatch tests passed');
