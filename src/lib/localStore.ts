import { Script, Folder, ReadingProfile } from '../types';

const SCRIPTS_KEY = 'vocalprompt:scripts';
const FOLDERS_KEY = 'vocalprompt:folders';
const PROFILES_KEY = 'vocalprompt:profiles';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLocalScripts(): Script[] {
  return read<Script[]>(SCRIPTS_KEY, []);
}

export function saveLocalScripts(scripts: Script[]) {
  write(SCRIPTS_KEY, scripts);
}

export function getLocalFolders(): Folder[] {
  return read<Folder[]>(FOLDERS_KEY, []);
}

export function saveLocalFolders(folders: Folder[]) {
  write(FOLDERS_KEY, folders);
}

export function getLocalProfiles(): ReadingProfile[] {
  return read<ReadingProfile[]>(PROFILES_KEY, []);
}

export function saveLocalProfiles(profiles: ReadingProfile[]) {
  write(PROFILES_KEY, profiles);
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SAMPLE_SCRIPT_CONTENT = `<p>Welcome to VocalPrompt.</p>
<p>Speak naturally and watch each word light up as you go. This teleprompter listens with your microphone, matches what you say to the script, and keeps the active line centered for you.</p>
<p>In practice mode you can record yourself, then play the take back and hear how you sounded.</p>
<p>Use voice sync when you want the scroll to follow your speech, or switch to manual scroll when you prefer a steady pace.</p>
<p>When you are ready, create your own script, upload a text file, or flip the display for a mirrored glass teleprompter.</p>`;

export function ensureSampleScript(userId: string): Script[] {
  const existing = getLocalScripts();
  if (existing.length > 0) return existing;

  const sample: Script = {
    id: createId('script'),
    title: 'Welcome to VocalPrompt',
    content: SAMPLE_SCRIPT_CONTENT,
    userId,
    tags: ['sample', 'demo'],
    folderId: null,
    createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
  };
  saveLocalScripts([sample]);
  return [sample];
}
