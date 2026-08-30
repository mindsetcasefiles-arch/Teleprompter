import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, ZoomIn, ZoomOut, RotateCcw, Mic, Settings2, SkipBack, X, Save, Trash2 } from 'lucide-react';
import { Script, ReadingProfile } from '../types';
import { doc, setDoc, onSnapshot, deleteDoc, addDoc, updateDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { profilesCollection, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { User } from 'firebase/auth';

interface Props {
  script: Script;
  user: User;
  onClose: () => void;
}

export default function TeleprompterView({ script, user, onClose }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(isPlaying);
  
  // Modes
  const [scrollMode, setScrollMode] = useState<'voice' | 'manual'>('voice');
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  
  // Audio Recording
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Teleprompter state
  const [fontSize, setFontSize] = useState(48);
  const [lineHeight, setLineHeight] = useState(1.5);
  const [contentWidth, setContentWidth] = useState('max-w-4xl');
  const [scrollSpeed, setScrollSpeed] = useState(2); // pixels per frame roughly
  const [micSensitivity, setMicSensitivity] = useState(50); // 0 to 100
  
  // Reading Profiles
  const [showSettings, setShowSettings] = useState(false);
  const [profiles, setProfiles] = useState<ReadingProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [newProfileName, setNewProfileName] = useState('');

  useEffect(() => {
    if (!user) return;
    const qProfiles = query(profilesCollection, where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(qProfiles, (snapshot) => {
      const loadedProfiles: ReadingProfile[] = [];
      snapshot.forEach((docSnap) => {
        loadedProfiles.push({ id: docSnap.id, ...docSnap.data() } as ReadingProfile);
      });
      setProfiles(loadedProfiles);
    });
    return () => unsubscribe();
  }, [user]);

  const saveProfile = async () => {
    if (!newProfileName.trim()) return;
    try {
      const docRef = await addDoc(profilesCollection, {
        userId: user.uid,
        name: newProfileName.trim(),
        fontSize,
        lineHeight,
        contentWidth,
        micSensitivity,
        createdAt: serverTimestamp()
      });
      setSelectedProfileId(docRef.id);
      setNewProfileName('');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'profiles');
    }
  };

  const deleteProfile = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'profiles', id));
      if (selectedProfileId === id) setSelectedProfileId('');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `profiles/${id}`);
    }
  };

  const applyProfile = (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      setSelectedProfileId(profile.id);
      setFontSize(profile.fontSize);
      setLineHeight(profile.lineHeight);
      setContentWidth(profile.contentWidth);
      if (profile.micSensitivity !== undefined) {
        setMicSensitivity(profile.micSensitivity);
      }
    }
  };

  
  // Voice sync state
  const [spokenWords, setSpokenWords] = useState<string>("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const requestRef = useRef<number>();
  const lastMatchedIndexRef = useRef<number>(0);

  const [parsedData, setParsedData] = useState<{ html: string, words: string[], bookmarks: {id: string, name: string}[] }>({ html: '', words: [], bookmarks: [] });

  useEffect(() => {
    const container = document.createElement('div');
    container.innerHTML = script.content;
    
    let wordIndex = 0;
    let bookmarkIndex = 0;
    const extractedWords: string[] = [];
    const extractedBookmarks: {id: string, name: string}[] = [];
    
    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const parts = text.split(/(\s+)/);
        if (parts.length === 1 && parts[0] === '') return;
        
        const fragment = document.createDocumentFragment();
        parts.forEach(part => {
          if (part.trim().length > 0) {
            const span = document.createElement('span');
            span.id = `word-${wordIndex}`;
            span.className = 'prompter-word inline-block mx-[0.15em] mb-[0.25em] text-[#E5E5E5]';
            span.textContent = part;
            fragment.appendChild(span);
            extractedWords.push(part);
            wordIndex++;
          } else if (part.length > 0) {
            fragment.appendChild(document.createTextNode(part)); // keep whitespace
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
          return; // Skip turning the bookmark's own text into spoken words
        }

        Array.from(node.childNodes).forEach(child => walk(child));
      }
    }
    
    Array.from(container.childNodes).forEach(child => walk(child));
    
    setParsedData({
      html: container.innerHTML,
      words: extractedWords,
      bookmarks: extractedBookmarks
    });
  }, [script.content]);

  const words = parsedData.words;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Manual Scroll Animation Loop
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

  const isSpeakingRef = useRef<boolean>(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const reqFrameRef = useRef<number | null>(null);
  const micSensitivityRef = useRef(micSensitivity);

  useEffect(() => {
    micSensitivityRef.current = micSensitivity;
  }, [micSensitivity]);

  useEffect(() => {
    if (isPlaying && (scrollMode === 'voice' || isPracticeMode)) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        micStreamRef.current = stream;
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContext();
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
          for(let i=0; i<dataArray.length; i++) {
             sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          
          volHistory.push(avg);
          if (volHistory.length > 30) volHistory.shift(); // roughly 500ms rolling window
          
          const recentMax = Math.max(...volHistory);
          // Sensitivity 100 -> threshold 5 (very sensitive)
          // Sensitivity 0 -> threshold 50 (needs loud voice)
          const threshold = 50 - (micSensitivityRef.current * 0.45);
          isSpeakingRef.current = recentMax > threshold;
          
          reqFrameRef.current = requestAnimationFrame(checkVolume);
        };
        checkVolume();
      }).catch(console.error);
    } else {
       if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); reqFrameRef.current = null; }
       if (audioContextRef.current && audioContextRef.current.state !== 'closed') { audioContextRef.current.close().catch(console.error); audioContextRef.current = null; }
       if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    }
    
    return () => {
       if (reqFrameRef.current) { cancelAnimationFrame(reqFrameRef.current); }
       if (audioContextRef.current && audioContextRef.current.state !== 'closed') { audioContextRef.current.close().catch(console.error); }
       if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, [isPlaying, scrollMode, isPracticeMode]);
  
  // Voice Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      if (!isSpeakingRef.current) return; // Ignore background noise when volume is below sensitivity threshold

      let currentTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          setSpokenWords(prev => prev + ' ' + event.results[i][0].transcript);
        } else {
          currentTranscript += event.results[i][0].transcript;
        }
      }
      setTranscript(currentTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error !== 'no-speech') {
        setError(`Speech recognition error: ${event.error}`);
        setIsPlaying(false);
      }
    };

    recognition.onend = () => {
      // Re-start if still playing and in voice mode (or practice mode tracking voice)
      if (isPlayingRef.current && scrollMode === 'voice') {
        try {
          recognition.start();
        } catch(e) {}
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [scrollMode]);

  useEffect(() => {
    if (isPlaying) {
      if (scrollMode === 'voice' || isPracticeMode) {
        try {
          recognitionRef.current?.start();
        } catch (e) {
          console.error(e);
        }
      }
    } else {
      recognitionRef.current?.stop();
    }
  }, [isPlaying, scrollMode, isPracticeMode]);

  // Practice Mode Recording Setup
  const togglePracticeMode = async () => {
    if (isPracticeMode) {
      // Stop practice
      setIsPracticeMode(false);
      setIsPlaying(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    } else {
      // Start practice
      setAudioBlob(null);
      audioChunksRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          setAudioBlob(blob);
          stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start();
        
        setIsPracticeMode(true);
        setIsPlaying(true);
        // Ensure voice sync is tracking the words
        setScrollMode('voice'); 
        reset(false);
      } catch (err) {
        console.error("Microphone access denied for practice mode", err);
        setError("Microphone access is required for Practice Mode.");
      }
    }
  };

  const togglePlay = () => setIsPlaying(!isPlaying);

  const reset = (stopPlay = true) => {
    if (stopPlay) setIsPlaying(false);
    setSpokenWords("");
    setTranscript("");
    lastMatchedIndexRef.current = 0;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Improved matching logic to handle missed/extra words
  const spokenWordsArray = (spokenWords + ' ' + transcript).toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  // Only process recent words to prevent old history from false-matching and jumping the prompter
  const recentSpoken = spokenWordsArray.slice(-20);
  
  // Start searching near our last known position to prevent jumping to the beginning of the script
  let currentScriptIndex = Math.max(0, lastMatchedIndexRef.current - 5);
  let matchedIndex = lastMatchedIndexRef.current;
  
  for (let sIndex = 0; sIndex < recentSpoken.length; sIndex++) {
    const cleanSpoken = recentSpoken[sIndex].replace(/[.,!?;:]/g, '');
    if (!cleanSpoken) continue;
    
    // Look ahead in the script to find a match (window of 15 words)
    for (let lookahead = 0; lookahead < 15; lookahead++) {
      const checkIndex = currentScriptIndex + lookahead;
      if (checkIndex >= words.length) break;
      
      const cleanWord = words[checkIndex].toLowerCase().replace(/[.,!?;:]/g, '');
      if (cleanWord === cleanSpoken || cleanSpoken.includes(cleanWord) || (cleanWord.length > 3 && cleanSpoken.includes(cleanWord.substring(0, 4)))) {
        matchedIndex = checkIndex;
        currentScriptIndex = checkIndex + 1;
        break;
      }
    }
  }

  // Update our persistent cursor to avoid falling behind
  if (matchedIndex > lastMatchedIndexRef.current) {
    lastMatchedIndexRef.current = matchedIndex;
  }

  useEffect(() => {
    // Auto-scroll to the active word only in voice mode
    if (scrollMode === 'voice' && matchedIndex > 0 && scrollContainerRef.current) {
      const activeElement = scrollContainerRef.current.querySelector(`#word-${matchedIndex}`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [matchedIndex, scrollMode]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent triggering if typing in an input/textarea (though rare in this view)
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setIsPlaying(p => !p);
          break;
        case 'ArrowUp':
        case 'ArrowRight':
          e.preventDefault();
          if (scrollMode === 'manual') {
            setScrollSpeed(s => {
              const newSpeed = Math.min(5, s + 0.1);
              return Number(newSpeed.toFixed(1));
            });
          } else if (e.code === 'ArrowUp' && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = Math.max(0, scrollContainerRef.current.scrollTop - 100);
          }
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          e.preventDefault();
          if (scrollMode === 'manual') {
            setScrollSpeed(s => {
              const newSpeed = Math.max(0.5, s - 0.1);
              return Number(newSpeed.toFixed(1));
            });
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
  }, [scrollMode, onClose]);

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] text-[#E5E5E5] flex flex-col h-screen">
      {/* Header */}
      <header className="h-16 border-b border-[#2A2A2A] px-8 flex items-center justify-between bg-[#0D0D0D] z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-[#1A1A1A] rounded-sm text-[#888] hover:text-[#E5E5E5] transition-colors" title="Exit">
            <Square className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[#2A2A2A]"></div>
          <span className="text-[10px] bg-[#222] px-2 py-1 rounded text-[#D4AF37] font-bold uppercase tracking-widest">
            {isPracticeMode ? 'PRACTICE MODE' : 'LIVE SCRIPT'}
          </span>
          <h1 className="text-sm font-serif italic tracking-wide truncate max-w-xs">{script.title}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={togglePracticeMode} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-colors border ${isPracticeMode ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#888] hover:text-[#E5E5E5]'}`}
          >
            <Mic className="w-4 h-4" />
            {isPracticeMode ? 'Stop Practice' : 'Practice'}
          </button>

          <div className="h-6 w-px bg-[#2A2A2A] mx-2"></div>
          
          <button onClick={() => setScrollMode('voice')} className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors ${scrollMode === 'voice' ? 'bg-[#D4AF37] text-[#0A0A0A]' : 'bg-[#1A1A1A] text-[#666] hover:text-[#AAA]'}`}>
            Voice Sync
          </button>
          <button onClick={() => setScrollMode('manual')} className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-colors ${scrollMode === 'manual' ? 'bg-[#D4AF37] text-[#0A0A0A]' : 'bg-[#1A1A1A] text-[#666] hover:text-[#AAA]'}`}>
            Manual Scroll
          </button>

          <div className="h-6 w-px bg-[#2A2A2A] mx-2"></div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 text-[#888] hover:text-[#E5E5E5] transition-colors"
            title="Reading Settings"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-400 p-2 text-xs font-medium text-center border-b border-red-500/20 shrink-0">
          {error}
        </div>
      )}

      {/* Prompter Canvas Wrapper */}
      <div className="flex-1 relative overflow-hidden bg-[radial-gradient(circle_at_center,_#111_0%,_#050505_100%)]">
        
        {/* Bookmarks Navigation */}
        {parsedData.bookmarks.length > 0 && (
          <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-30 max-h-[80vh] overflow-y-auto no-scrollbar">
            <div className="text-[10px] text-[#666] font-bold uppercase tracking-widest text-center mb-1">Bookmarks</div>
            {parsedData.bookmarks.map((b, i) => (
              <button 
                key={i}
                onClick={() => {
                  const el = document.getElementById(b.id);
                  if (el) {
                     el.scrollIntoView({behavior: 'smooth', block: 'center'});
                  }
                }}
                className="px-3 py-2 bg-[#1A1A1A]/80 backdrop-blur border border-[#2A2A2A] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37] text-xs font-semibold rounded-sm transition-all shadow-lg min-w-[80px]"
                title={`Jump to ${b.name}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {/* Center Focus Marker */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-4 md:px-12 lg:px-24 pointer-events-none z-20 opacity-80">
          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[12px] border-l-[#D4AF37] border-b-[8px] border-b-transparent drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]"></div>
          <div className="flex-1 h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37]/20 to-transparent mx-8"></div>
          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-r-[12px] border-r-[#D4AF37] border-b-[8px] border-b-transparent drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]"></div>
        </div>

        <section 
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto px-8 md:px-24 lg:px-48 pt-[45vh] pb-[60vh]"
          style={{ fontSize: `${fontSize}px`, lineHeight: lineHeight }}
        >
          <div 
            className={`${contentWidth} mx-auto font-sans text-center tracking-wide leading-relaxed [&_*]:!font-sans [&_*]:!text-[1em] [&_p]:mb-6 [&_div]:mb-6`}
            dangerouslySetInnerHTML={{ __html: parsedData.html }}
          />
        </section>
      </div>
      
      {/* Footer Controls */}
      <footer className="h-24 bg-[#121212] border-t border-[#2A2A2A] px-8 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-10">
          {scrollMode === 'manual' && (
            <div className="flex flex-col gap-2">
              <label className="text-[9px] uppercase tracking-[0.2em] text-[#666]">Scroll Speed</label>
              <input 
                type="range" 
                min="0.5" 
                max="5" 
                step="0.1"
                value={scrollSpeed}
                onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                className="w-48 h-1 bg-[#222] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[9px] uppercase tracking-[0.2em] text-[#666]">Font Size</label>
            <div className="flex gap-1 items-center">
              <button onClick={() => setFontSize(s => Math.max(24, s - 4))} className="w-6 h-6 border border-[#333] flex items-center justify-center text-[10px] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors">-</button>
              <div className="w-8 flex items-center justify-center text-[12px] text-white font-mono">{fontSize}</div>
              <button onClick={() => setFontSize(s => Math.min(120, s + 4))} className="w-6 h-6 border border-[#333] flex items-center justify-center text-[14px] text-[#888] hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors">+</button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => reset(true)} className="w-12 h-12 rounded-full border border-[#333] flex items-center justify-center hover:bg-[#1A1A1A] text-[#888]">
            <SkipBack className="w-5 h-5" />
          </button>
          
          <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:bg-[#b5952f] transition-colors">
            {isPlaying ? (
              <div className="w-4 h-5 bg-[#0A0A0A] rounded-sm flex gap-1">
                <div className="w-1.5 h-full bg-[#0A0A0A]"></div>
              </div>
            ) : (
              <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[12px] border-l-[#0A0A0A] border-b-[8px] border-b-transparent ml-1"></div>
            )}
          </button>
        </div>

        <div className="flex items-center gap-6 justify-end w-[250px]">
          {audioBlob ? (
            <div className="flex flex-col items-end gap-2 w-48">
              <div className="flex items-center justify-between w-full">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#D4AF37]">Practice Replay</p>
                <a
                  href={URL.createObjectURL(audioBlob)}
                  download={`${script.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_practice.webm`}
                  className="text-[9px] uppercase tracking-wider text-white bg-[#1A1A1A] border border-[#2A2A2A] hover:border-[#D4AF37] hover:text-[#D4AF37] px-2 py-1 rounded transition-colors"
                  title="Export Recording"
                >
                  Export
                </a>
              </div>
              <audio src={URL.createObjectURL(audioBlob)} controls className="h-8 w-full [&::-webkit-media-controls-panel]:bg-[#1A1A1A]" />
            </div>
          ) : (
            <>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#666] mb-1">Words Read</p>
                <p className="text-xl font-mono text-[#D4AF37]">{Math.max(0, matchedIndex + 1)}</p>
              </div>
              <div className="w-[1px] h-10 bg-[#2A2A2A]"></div>
              <div className="text-right hidden sm:block">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#666] mb-1">Est. Time</p>
                <p className="text-xl font-mono text-white">{Math.max(1, Math.ceil(words.length / 150))}m</p>
              </div>
              <div className="w-[1px] h-10 bg-[#2A2A2A] hidden sm:block"></div>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-[0.2em] text-[#666] mb-1">Total Words</p>
                <p className="text-xl font-mono text-white">{words.length}</p>
              </div>
            </>
          )}
        </div>
      </footer>
      
      {/* Live Transcript View Overlay */}
      {scrollMode === 'voice' && (transcript || spokenWords) && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 max-w-2xl w-full px-6">
          <div className="bg-[#121212]/90 backdrop-blur-md border border-[#2A2A2A] rounded-sm p-4 shadow-2xl">
            <p className="text-[9px] uppercase tracking-widest text-[#D4AF37] mb-2 font-bold">Live Transcript</p>
            <p className="text-sm text-[#AAA] leading-relaxed font-sans line-clamp-2">
              ...{spokenWords.split(' ').slice(-10).join(' ')} <span className="text-white">{transcript}</span>
            </p>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#121212] border border-[#2A2A2A] p-8 rounded-sm shadow-2xl max-w-lg w-full relative">
            <button 
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 p-2 text-[#888] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <Settings2 className="w-6 h-6 text-[#D4AF37]" />
              <h2 className="text-xl font-serif text-white">Reading Settings</h2>
            </div>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">Line Spacing</label>
                  <select 
                    value={lineHeight}
                    onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-sm px-3 py-2 text-sm text-white focus:border-[#D4AF37] outline-none"
                  >
                    <option value={1.1}>Tight (1.1x)</option>
                    <option value={1.3}>Normal (1.3x)</option>
                    <option value={1.5}>Relaxed (1.5x)</option>
                    <option value={1.8}>Loose (1.8x)</option>
                    <option value={2.2}>Very Loose (2.2x)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">Content Width</label>
                  <select 
                    value={contentWidth}
                    onChange={(e) => setContentWidth(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-sm px-3 py-2 text-sm text-white focus:border-[#D4AF37] outline-none"
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
                  <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">Mic Sensitivity</label>
                  <span className="text-xs text-[#D4AF37]">{micSensitivity}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#222] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[#D4AF37] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#666]">
                  <span>Ignore Background Noise</span>
                  <span>Highly Sensitive</span>
                </div>
              </div>
              
              <div className="h-px bg-[#2A2A2A] my-2"></div>
              
              <div className="flex flex-col gap-3">
                <label className="text-[10px] uppercase tracking-wider text-[#888] font-bold">Saved Profiles</label>
                
                {profiles.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2 max-h-40 overflow-y-auto">
                    {profiles.map(p => (
                      <div key={p.id} className={`flex items-center justify-between p-2 rounded-sm border ${selectedProfileId === p.id ? 'bg-[#D4AF37]/10 border-[#D4AF37]' : 'bg-[#1A1A1A] border-[#2A2A2A]'}`}>
                        <button 
                          className="flex-1 text-left text-sm text-[#E5E5E5]"
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
                    className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-sm px-3 py-2 text-sm text-white focus:border-[#D4AF37] outline-none"
                  />
                  <button 
                    onClick={saveProfile}
                    disabled={!newProfileName.trim()}
                    className="flex items-center gap-2 bg-[#1A1A1A] border border-[#2A2A2A] hover:border-[#D4AF37] hover:text-[#D4AF37] text-[#888] px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Save className="w-4 h-4" /> Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
