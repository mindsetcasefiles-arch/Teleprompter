import { useState, useEffect, useRef, useMemo } from 'react';
import {
  SkipBack,
  Settings2,
  X,
  Save,
  Trash2,
  Mic,
  FlipHorizontal2,
  Pause,
  Play,
} from 'lucide-react';
import { Script, ReadingProfile, AppUser } from '../types';
import {
  doc,
  onSnapshot,
  deleteDoc,
  addDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { profilesCollection, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  getLocalProfiles,
  saveLocalProfiles,
  createId,
} from '../lib/localStore';
import { matchSpokenToScript, tokenizeSpeech } from '../lib/speechMatch';

interface Props {
  script: Script;
  user: AppUser;
  onClose: () => void;
}

export default function TeleprompterView({ script, user, onClose }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(isPlaying);

  const [scrollMode, setScrollMode] = useState<'voice' | 'manual'>('voice');
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [mirror, setMirror] = useState(false);

  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const [fontSize, setFontSize] = useState(48);
  const [lineHeight, setLineHeight] = useState(1.5);
  const [contentWidth, setContentWidth] = useState('max-w-4xl');
  const [scrollSpeed, setScrollSpeed] = useState(2);
  const [micSensitivity, setMicSensitivity] = useState(50);

  const [showSettings, setShowSettings] = useState(false);
  const [profiles, setProfiles] = useState<ReadingProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [newProfileName, setNewProfileName] = useState('');

  const [spokenWords, setSpokenWords] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [matchedIndex, setMatchedIndex] = useState(0);
  const [listening, setListening] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const requestRef = useRef<number>();
  const lastMatchedIndexRef = useRef(0);
  const spokenWordsRef = useRef('');
  const transcriptRef = useRef('');

  const [parsedData, setParsedData] = useState<{
    html: string;
    words: string[];
    bookmarks: { id: string; name: string }[];
  }>({ html: '', words: [], bookmarks: [] });

  // Load reading profiles
  useEffect(() => {
    if (user.isGuest) {
      setProfiles(getLocalProfiles().filter((p) => p.userId === user.uid));
      return;
    }

    const qProfiles = query(profilesCollection, where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(qProfiles, (snapshot) => {
      const loaded: ReadingProfile[] = [];
      snapshot.forEach((docSnap) => {
        loaded.push({ id: docSnap.id, ...docSnap.data() } as ReadingProfile);
      });
      setProfiles(loaded);
    });
    return () => unsubscribe();
  }, [user]);

  const saveProfile = async () => {
    if (!newProfileName.trim()) return;
    const payload = {
      userId: user.uid,
      name: newProfileName.trim(),
      fontSize,
      lineHeight,
      contentWidth,
      micSensitivity,
      mirror,
      createdAt: user.isGuest ? Date.now() : serverTimestamp(),
    };

    try {
      if (user.isGuest) {
        const next = [
          ...getLocalProfiles(),
          { id: createId('profile'), ...payload, createdAt: { toMillis: () => Date.now() } },
        ];
        saveLocalProfiles(next);
        setProfiles(next.filter((p) => p.userId === user.uid));
        setSelectedProfileId(next[next.length - 1].id);
      } else {
        const docRef = await addDoc(profilesCollection, payload);
        setSelectedProfileId(docRef.id);
      }
      setNewProfileName('');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'profiles');
    }
  };

  const deleteProfile = async (id: string) => {
    try {
      if (user.isGuest) {
        const next = getLocalProfiles().filter((p) => p.id !== id);
        saveLocalProfiles(next);
        setProfiles(next.filter((p) => p.userId === user.uid));
      } else {
        await deleteDoc(doc(db, 'profiles', id));
      }
      if (selectedProfileId === id) setSelectedProfileId('');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `profiles/${id}`);
    }
  };

  const applyProfile = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    setSelectedProfileId(profile.id);
    setFontSize(profile.fontSize);
    setLineHeight(profile.lineHeight);
    setContentWidth(profile.contentWidth);
    if (profile.micSensitivity !== undefined) setMicSensitivity(profile.micSensitivity);
    if (profile.mirror !== undefined) setMirror(profile.mirror);
  };

  // Parse script into word spans
  useEffect(() => {
    const container = document.createElement('div');
    container.innerHTML = script.content;

    let wordIndex = 0;
    let bookmarkIndex = 0;
    const extractedWords: string[] = [];
    const extractedBookmarks: { id: string; name: string }[] = [];

    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const parts = text.split(/(\s+)/);
        if (parts.length === 1 && parts[0] === '') return;

        const fragment = document.createDocumentFragment();
        parts.forEach((part) => {
          if (part.trim().length > 0) {
            const span = document.createElement('span');
            span.id = `word-${wordIndex}`;
            span.className = 'prompter-word word-future';
            span.textContent = part;
            fragment.appendChild(span);
            extractedWords.push(part);
            wordIndex++;
          } else if (part.length > 0) {
            fragment.appendChild(document.createTextNode(part));
          }
        });
        node.parentNode?.replaceChild(fragment, node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;

        if ((node as HTMLElement).hasAttribute('data-bookmark')) {
          const name = (node as HTMLElement).getAttribute('data-bookmark') || 'Bookmark';
          const id = `bookmark-target-${bookmarkIndex++}`;
          (node as HTMLElement).id = id;
          extractedBookmarks.push({ id, name });
          return;
        }

        Array.from(node.childNodes).forEach((child) => walk(child));
      }
    }

    Array.from(container.childNodes).forEach((child) => walk(child));
    setParsedData({
      html: container.innerHTML,
      words: extractedWords,
      bookmarks: extractedBookmarks,
    });
    lastMatchedIndexRef.current = 0;
    setMatchedIndex(0);
  }, [script.content]);

  const words = parsedData.words;
  const progress = words.length > 0 ? Math.min(100, ((matchedIndex + 1) / words.length) * 100) : 0;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    spokenWordsRef.current = spokenWords;
  }, [spokenWords]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  // Manual scroll loop
  const animateScroll = () => {
    if (isPlayingRef.current && scrollMode === 'manual' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop += scrollSpeed;
    }
    requestRef.current = requestAnimationFrame(animateScroll);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animateScroll);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [scrollMode, scrollSpeed]);

  // Mic volume gate
  const isSpeakingRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const reqFrameRef = useRef<number | null>(null);
  const micSensitivityRef = useRef(micSensitivity);

  useEffect(() => {
    micSensitivityRef.current = micSensitivity;
  }, [micSensitivity]);

  useEffect(() => {
    if (isPlaying && countdown === null && (scrollMode === 'voice' || isPracticeMode)) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          micStreamRef.current = stream;
          const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextCtor();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const volHistory: number[] = [];

          const checkVolume = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            volHistory.push(avg);
            if (volHistory.length > 30) volHistory.shift();
            const recentMax = Math.max(...volHistory);
            const threshold = 50 - micSensitivityRef.current * 0.45;
            isSpeakingRef.current = recentMax > threshold;
            reqFrameRef.current = requestAnimationFrame(checkVolume);
          };
          checkVolume();
        })
        .catch(console.error);
    } else {
      if (reqFrameRef.current) {
        cancelAnimationFrame(reqFrameRef.current);
        reqFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
    }

    return () => {
      if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [isPlaying, scrollMode, isPracticeMode, countdown]);

  // Speech recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      if (isPlayingRef.current && scrollMode === 'voice' && countdown === null) {
        try {
          recognition.start();
        } catch {
          /* already started */
        }
      }
    };

    recognition.onresult = (event: any) => {
      if (!isSpeakingRef.current) return;

      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += ` ${piece}`;
        else interim += piece;
      }

      if (finalChunk) {
        setSpokenWords((prev) => `${prev} ${finalChunk}`.trim());
      }
      setTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`Speech recognition error: ${event.error}`);
        setIsPlaying(false);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {
        /* noop */
      }
    };
  }, [scrollMode, countdown]);

  useEffect(() => {
    if (isPlaying && countdown === null && (scrollMode === 'voice' || isPracticeMode)) {
      try {
        recognitionRef.current?.start();
      } catch {
        /* already running */
      }
    } else {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
    }
  }, [isPlaying, scrollMode, isPracticeMode, countdown]);

  // Match speech → script index
  useEffect(() => {
    if (scrollMode !== 'voice' && !isPracticeMode) return;
    const recent = tokenizeSpeech(spokenWords, transcript).slice(-20);
    const next = matchSpokenToScript(words, recent, lastMatchedIndexRef.current);
    if (next > lastMatchedIndexRef.current) {
      lastMatchedIndexRef.current = next;
      setMatchedIndex(next);
    }
  }, [spokenWords, transcript, words, scrollMode, isPracticeMode]);

  // Apply active word highlighting to DOM
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || words.length === 0) return;

    for (let i = 0; i < words.length; i++) {
      const el = root.querySelector(`#word-${i}`);
      if (!el) continue;
      el.classList.remove('word-past', 'word-active', 'word-future');
      if (i < matchedIndex) el.classList.add('word-past');
      else if (i === matchedIndex) el.classList.add('word-active');
      else el.classList.add('word-future');
    }
  }, [matchedIndex, words, parsedData.html]);

  // Keep active word centered in voice mode
  useEffect(() => {
    if (scrollMode !== 'voice' || matchedIndex < 0 || !scrollContainerRef.current) return;
    const activeElement = scrollContainerRef.current.querySelector(`#word-${matchedIndex}`);
    if (activeElement) {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matchedIndex, scrollMode]);

  const reset = (stopPlay = true) => {
    if (stopPlay) setIsPlaying(false);
    setSpokenWords('');
    setTranscript('');
    lastMatchedIndexRef.current = 0;
    setMatchedIndex(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const startCountdown = (then: () => void) => {
    setCountdown(3);
    let n = 3;
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        setCountdown(null);
        then();
      } else {
        setCountdown(n);
        window.setTimeout(tick, 800);
      }
    };
    window.setTimeout(tick, 800);
  };

  const togglePracticeMode = async () => {
    if (isPracticeMode) {
      setIsPracticeMode(false);
      setIsPlaying(false);
      setCountdown(null);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    setAudioBlob(null);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      setIsPracticeMode(true);
      setScrollMode('voice');
      reset(false);

      startCountdown(() => {
        mediaRecorder.start();
        setIsPlaying(true);
      });
    } catch (err) {
      console.error('Microphone access denied for practice mode', err);
      setError('Microphone access is required for Practice Mode.');
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (scrollMode === 'voice' && countdown === null) {
      startCountdown(() => setIsPlaying(true));
    } else {
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'KeyM':
          e.preventDefault();
          setMirror((m) => !m);
          break;
        case 'ArrowUp':
        case 'ArrowRight':
          e.preventDefault();
          if (scrollMode === 'manual') {
            setScrollSpeed((s) => Number(Math.min(5, s + 0.1).toFixed(1)));
          } else if (e.code === 'ArrowUp' && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = Math.max(
              0,
              scrollContainerRef.current.scrollTop - 100
            );
          }
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          e.preventDefault();
          if (scrollMode === 'manual') {
            setScrollSpeed((s) => Number(Math.max(0.5, s - 0.1).toFixed(1)));
          } else if (e.code === 'ArrowDown' && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop += 100;
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scrollMode, onClose, isPlaying, countdown]);

  const estMinutes = useMemo(
    () => Math.max(1, Math.ceil(words.length / 150)),
    [words.length]
  );

  return (
    <div className="fixed inset-0 bg-[#07080a] text-[#ece7dc] flex flex-col h-screen">
      <header className="h-16 border-b border-[#2a2620] px-4 sm:px-8 flex items-center justify-between bg-[#0c0d10] z-10 shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#1a1712] rounded-sm text-[#8a8170] hover:text-[#ece7dc] transition-colors"
            title="Exit"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[#2a2620] hidden sm:block" />
          <span
            className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-widest shrink-0 ${
              isPracticeMode
                ? 'bg-red-500/10 text-red-400'
                : 'bg-[#1a1712] text-[#e8c15a]'
            }`}
          >
            {isPracticeMode ? 'Practice' : 'Live'}
          </span>
          <h1 className="text-sm font-display tracking-wide truncate max-w-[12rem] sm:max-w-xs text-white">
            {script.title}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={togglePracticeMode}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-colors border ${
              isPracticeMode
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-[#1a1712] border-[#2a2620] text-[#8a8170] hover:text-[#ece7dc]'
            }`}
          >
            <Mic className={`w-4 h-4 ${listening ? 'text-[#e8c15a]' : ''}`} />
            <span className="hidden sm:inline">
              {isPracticeMode ? 'Stop Practice' : 'Practice'}
            </span>
          </button>

          <button
            onClick={() => setMirror((m) => !m)}
            className={`p-2 rounded-sm border transition-colors ${
              mirror
                ? 'border-[#e8c15a] text-[#e8c15a] bg-[#e8c15a]/10'
                : 'border-[#2a2620] text-[#8a8170] hover:text-[#ece7dc]'
            }`}
            title="Mirror mode (M)"
          >
            <FlipHorizontal2 className="w-4 h-4" />
          </button>

          <div className="h-6 w-px bg-[#2a2620] hidden md:block" />

          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={() => setScrollMode('voice')}
              className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors ${
                scrollMode === 'voice'
                  ? 'bg-[#e8c15a] text-[#12100c]'
                  : 'bg-[#1a1712] text-[#666] hover:text-[#AAA]'
              }`}
            >
              Voice Sync
            </button>
            <button
              onClick={() => setScrollMode('manual')}
              className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors ${
                scrollMode === 'manual'
                  ? 'bg-[#e8c15a] text-[#12100c]'
                  : 'bg-[#1a1712] text-[#666] hover:text-[#AAA]'
              }`}
            >
              Manual
            </button>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-[#8a8170] hover:text-[#ece7dc] transition-colors"
            title="Reading Settings"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Progress */}
      <div className="h-1 bg-[#1a1712] shrink-0">
        <div
          className="h-full bg-[#e8c15a] transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-300 p-2 text-xs font-medium text-center border-b border-red-500/20 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden bg-[radial-gradient(ellipse_at_center,#16140f_0%,#07080a_70%)]">
        {parsedData.bookmarks.length > 0 && (
          <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-30 max-h-[80vh] overflow-y-auto no-scrollbar">
            <div className="text-[10px] text-[#666] font-bold uppercase tracking-widest text-center mb-1">
              Bookmarks
            </div>
            {parsedData.bookmarks.map((b, i) => (
              <button
                key={i}
                onClick={() => {
                  const el = document.getElementById(b.id);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="px-3 py-2 bg-[#1a1712]/85 backdrop-blur border border-[#2a2620] text-[#8a8170] hover:border-[#e8c15a] hover:text-[#e8c15a] text-xs font-semibold rounded-sm transition-all shadow-lg min-w-[80px]"
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-4 md:px-12 lg:px-24 pointer-events-none z-20 opacity-80">
          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[12px] border-l-[#e8c15a] border-b-[8px] border-b-transparent" />
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e8c15a]/25 to-transparent mx-8" />
          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-r-[12px] border-r-[#e8c15a] border-b-[8px] border-b-transparent" />
        </div>

        {countdown !== null && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div key={countdown} className="countdown-digit font-display text-[7rem] text-[#e8c15a]">
              {countdown}
            </div>
          </div>
        )}

        <section
          ref={scrollContainerRef}
          className={`absolute inset-0 overflow-y-auto px-8 md:px-24 lg:px-48 pt-[42vh] pb-[55vh] prompter-fade-mask ${
            mirror ? 'prompter-mirror' : ''
          }`}
          style={{ fontSize: `${fontSize}px`, lineHeight }}
        >
          <div
            className={`${contentWidth} mx-auto font-sans text-center tracking-wide [&_*]:!font-sans [&_*]:!text-[1em] [&_p]:mb-8 [&_div]:mb-8`}
            dangerouslySetInnerHTML={{ __html: parsedData.html }}
          />
        </section>
      </div>

      <footer className="h-24 bg-[#0c0d10] border-t border-[#2a2620] px-4 sm:px-8 flex items-center justify-between shrink-0 z-10 gap-4">
        <div className="flex items-center gap-6 min-w-0">
          {scrollMode === 'manual' && (
            <div className="hidden sm:flex flex-col gap-2">
              <label className="text-[9px] uppercase tracking-[0.2em] text-[#666]">
                Scroll Speed
              </label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.1"
                value={scrollSpeed}
                onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                className="w-36 h-1 bg-[#222] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[9px] uppercase tracking-[0.2em] text-[#666]">
              Font Size
            </label>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setFontSize((s) => Math.max(24, s - 4))}
                className="w-6 h-6 border border-[#333] flex items-center justify-center text-[10px] text-[#888] hover:border-[#e8c15a] hover:text-[#e8c15a] transition-colors"
              >
                −
              </button>
              <div className="w-8 flex items-center justify-center text-[12px] text-white font-mono">
                {fontSize}
              </div>
              <button
                onClick={() => setFontSize((s) => Math.min(120, s + 4))}
                className="w-6 h-6 border border-[#333] flex items-center justify-center text-[14px] text-[#888] hover:border-[#e8c15a] hover:text-[#e8c15a] transition-colors"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => reset(true)}
            className="w-11 h-11 rounded-full border border-[#333] flex items-center justify-center hover:bg-[#1a1712] text-[#888]"
            title="Reset"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlay}
            disabled={countdown !== null}
            className={`w-14 h-14 rounded-full bg-[#e8c15a] flex items-center justify-center hover:bg-[#f0d078] transition-colors disabled:opacity-60 ${
              isPlaying && scrollMode === 'voice' ? 'mic-live' : ''
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 text-[#12100c] fill-[#12100c]" />
            ) : (
              <Play className="w-6 h-6 text-[#12100c] fill-[#12100c] ml-0.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-4 justify-end min-w-[7rem] sm:min-w-[14rem]">
          {audioUrl ? (
            <div className="flex flex-col items-end gap-2 w-44 sm:w-52">
              <div className="flex items-center justify-between w-full">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#e8c15a]">
                  Practice Replay
                </p>
                <a
                  href={audioUrl}
                  download={`${script.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_practice.webm`}
                  className="text-[9px] uppercase tracking-wider text-white bg-[#1a1712] border border-[#2a2620] hover:border-[#e8c15a] hover:text-[#e8c15a] px-2 py-1 rounded transition-colors"
                >
                  Export
                </a>
              </div>
              <audio
                src={audioUrl}
                controls
                className="h-8 w-full [&::-webkit-media-controls-panel]:bg-[#1a1712]"
              />
            </div>
          ) : (
            <>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#666] mb-1">
                  Words
                </p>
                <p className="text-lg sm:text-xl font-mono text-[#e8c15a]">
                  {matchedIndex === 0 && !spokenWords && !transcript
                    ? 0
                    : Math.min(words.length, matchedIndex + 1)}
                  <span className="text-[#666] text-sm">/{words.length}</span>
                </p>
              </div>
              <div className="w-px h-10 bg-[#2a2620] hidden sm:block" />
              <div className="text-right hidden sm:block">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#666] mb-1">
                  Est. Time
                </p>
                <p className="text-xl font-mono text-white">{estMinutes}m</p>
              </div>
            </>
          )}
        </div>
      </footer>

      {scrollMode === 'voice' && (transcript || spokenWords) && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 max-w-2xl w-full px-6 pointer-events-none">
          <div className="bg-[#12100c]/92 backdrop-blur-md border border-[#2a2620] rounded-sm p-4 shadow-2xl">
            <p className="text-[9px] uppercase tracking-widest text-[#e8c15a] mb-2 font-bold flex items-center gap-2">
              Live Transcript
              {listening && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[#e8c15a] animate-pulse" />
              )}
            </p>
            <p className="text-sm text-[#a39a88] leading-relaxed font-sans line-clamp-2">
              …{spokenWords.split(' ').slice(-10).join(' ')}{' '}
              <span className="text-white">{transcript}</span>
            </p>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#12100c] border border-[#2a2620] p-8 rounded-sm shadow-2xl max-w-lg w-full relative">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 p-2 text-[#888] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <Settings2 className="w-6 h-6 text-[#e8c15a]" />
              <h2 className="text-xl font-display text-white">Reading Settings</h2>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">
                    Line Spacing
                  </label>
                  <select
                    value={lineHeight}
                    onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    className="w-full bg-[#1a1712] border border-[#2a2620] rounded-sm px-3 py-2 text-sm text-white focus:border-[#e8c15a] outline-none"
                  >
                    <option value={1.1}>Tight (1.1x)</option>
                    <option value={1.3}>Normal (1.3x)</option>
                    <option value={1.5}>Relaxed (1.5x)</option>
                    <option value={1.8}>Loose (1.8x)</option>
                    <option value={2.2}>Very Loose (2.2x)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">
                    Content Width
                  </label>
                  <select
                    value={contentWidth}
                    onChange={(e) => setContentWidth(e.target.value)}
                    className="w-full bg-[#1a1712] border border-[#2a2620] rounded-sm px-3 py-2 text-sm text-white focus:border-[#e8c15a] outline-none"
                  >
                    <option value="max-w-2xl">Narrow</option>
                    <option value="max-w-4xl">Medium</option>
                    <option value="max-w-6xl">Wide</option>
                    <option value="max-w-[100%]">Full Width</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">
                    Mic Sensitivity
                  </label>
                  <span className="text-xs text-[#e8c15a]">{micSensitivity}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#222] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#e8c15a] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#666]">
                  <span>Ignore noise</span>
                  <span>Highly sensitive</span>
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 text-sm text-[#ece7dc]">
                <span className="text-[10px] uppercase tracking-wider text-[#888] font-bold">
                  Mirror Display
                </span>
                <button
                  type="button"
                  onClick={() => setMirror((m) => !m)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    mirror ? 'bg-[#e8c15a]' : 'bg-[#2a2620]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      mirror ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </label>

              <div className="h-px bg-[#2a2620]" />

              <div className="flex flex-col gap-3">
                <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">
                  Saved Profiles
                </label>

                {profiles.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2 max-h-40 overflow-y-auto">
                    {profiles.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between p-2 rounded-sm border ${
                          selectedProfileId === p.id
                            ? 'bg-[#e8c15a]/10 border-[#e8c15a]'
                            : 'bg-[#1a1712] border-[#2a2620]'
                        }`}
                      >
                        <button
                          className="flex-1 text-left text-sm text-[#ece7dc]"
                          onClick={() => applyProfile(p.id)}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => deleteProfile(p.id)}
                          className="p-1 text-[#666] hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Profile name..."
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    className="flex-1 bg-[#1a1712] border border-[#2a2620] rounded-sm px-3 py-2 text-sm text-white focus:border-[#e8c15a] outline-none"
                  />
                  <button
                    onClick={saveProfile}
                    disabled={!newProfileName.trim()}
                    className="flex items-center gap-2 bg-[#1a1712] border border-[#2a2620] hover:border-[#e8c15a] hover:text-[#e8c15a] text-[#888] px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save className="w-4 h-4" /> Save
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-[#666] leading-relaxed">
                Shortcuts: Space play/pause · M mirror · ↑↓ nudge or speed · Esc exit
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
