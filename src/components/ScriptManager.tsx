import { useState, useEffect, useRef, type FormEvent, type MouseEvent, type ChangeEvent } from 'react';
import {
  db,
  scriptsCollection,
  foldersCollection,
  auth,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Script, Folder, AppUser } from '../types';
import {
  getLocalScripts,
  saveLocalScripts,
  getLocalFolders,
  saveLocalFolders,
  createId,
  ensureSampleScript,
} from '../lib/localStore';
import {
  Plus,
  FileText,
  Upload,
  Trash2,
  Play,
  Search,
  Tag,
  LogOut,
  Clock,
  Edit2,
  Loader2,
  CheckCircle2,
  Folder as FolderIcon,
  FolderPlus,
  Bold,
  Italic,
  Underline,
  Sparkles,
  Bookmark,
} from 'lucide-react';

interface Props {
  onSelectScript: (script: Script) => void;
  user: AppUser;
}

export default function ScriptManager({ onSelectScript, user }: Props) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    tags: '',
    folderId: '',
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderCreate, setShowFolderCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormatting, setIsFormatting] = useState(false);

  const refreshLocal = () => {
    setScripts(ensureSampleScript(user.uid));
    setFolders(getLocalFolders().filter((f) => f.userId === user.uid));
    setLoading(false);
  };

  useEffect(() => {
    if (user.isGuest) {
      refreshLocal();
      return;
    }

    const qScripts = query(scriptsCollection, where('userId', '==', user.uid));
    const unsubscribeScripts = onSnapshot(
      qScripts,
      (snapshot) => {
        const loadedScripts: Script[] = [];
        snapshot.forEach((d) => {
          loadedScripts.push({ id: d.id, ...d.data() } as Script);
        });
        loadedScripts.sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
          return timeB - timeA;
        });
        setScripts(loadedScripts);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.GET, 'scripts');
      }
    );

    const qFolders = query(foldersCollection, where('userId', '==', user.uid));
    const unsubscribeFolders = onSnapshot(
      qFolders,
      (snapshot) => {
        const loadedFolders: Folder[] = [];
        snapshot.forEach((d) => {
          loadedFolders.push({ id: d.id, ...d.data() } as Folder);
        });
        loadedFolders.sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
          return timeB - timeA;
        });
        setFolders(loadedFolders);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'folders');
      }
    );

    return () => {
      unsubscribeScripts();
      unsubscribeFolders();
    };
  }, [user.uid, user.isGuest]);

  useEffect(() => {
    if (!currentScriptId || !formVisible) return;

    setSaveStatus('saving');
    const timeoutId = setTimeout(async () => {
      try {
        const tagsArray = formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        if (user.isGuest) {
          const next = getLocalScripts().map((s) =>
            s.id === currentScriptId
              ? {
                  ...s,
                  title: formData.title.trim() || 'Untitled Script',
                  content: formData.content,
                  tags: tagsArray,
                  folderId: formData.folderId || null,
                }
              : s
          );
          saveLocalScripts(next);
          setScripts(next);
        } else {
          await updateDoc(doc(db, 'scripts', currentScriptId), {
            title: formData.title.trim() || 'Untitled Script',
            content: formData.content,
            tags: tagsArray,
            folderId: formData.folderId || null,
          });
        }
        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus((current) => (current === 'saved' ? 'idle' : current));
        }, 2000);
      } catch (error) {
        setSaveStatus('idle');
        handleFirestoreError(error, OperationType.UPDATE, `scripts/${currentScriptId}`);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [formData, currentScriptId, formVisible, user.isGuest]);

  useEffect(() => {
    if (formVisible && editorRef.current) {
      if (editorRef.current.innerHTML !== formData.content) {
        editorRef.current.innerHTML = formData.content;
      }
    }
  }, [formVisible, currentScriptId]);

  const handleAutoFormat = async () => {
    if (!formData.content.trim() || isFormatting) return;
    setIsFormatting(true);
    try {
      const response = await fetch('/api/format-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: formData.content }),
      });

      if (!response.ok) throw new Error('Failed to format script');

      const data = await response.json();
      setFormData((prev) => ({ ...prev, content: data.formattedText }));
      if (editorRef.current) editorRef.current.innerHTML = data.formattedText;
    } catch (error) {
      console.error('Auto format error:', error);
      alert(
        'Auto-format needs a Gemini API key on the server. You can still edit formatting manually.'
      );
    } finally {
      setIsFormatting(false);
    }
  };

  const handleOpenCreate = () => {
    setCurrentScriptId(null);
    setFormData({
      title: '',
      content: '',
      tags: '',
      folderId: selectedFolderId || '',
    });
    setFormVisible(true);
    setSaveStatus('idle');
  };

  const handleEdit = (script: Script, e: MouseEvent) => {
    e.stopPropagation();
    setCurrentScriptId(script.id);
    setFormData({
      title: script.title,
      content: script.content,
      tags: (script.tags || []).join(', '),
      folderId: script.folderId || '',
    });
    setFormVisible(true);
    setSaveStatus('idle');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (currentScriptId) {
      setFormVisible(false);
      setCurrentScriptId(null);
      return;
    }

    if (!formData.title.trim() || !formData.content.trim()) return;
    const tagsArray = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      if (user.isGuest) {
        const next = [
          {
            id: createId('script'),
            title: formData.title.trim(),
            content: formData.content.trim(),
            tags: tagsArray,
            userId: user.uid,
            folderId: formData.folderId || null,
            createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
          },
          ...getLocalScripts(),
        ];
        saveLocalScripts(next);
        setScripts(next);
      } else {
        await addDoc(scriptsCollection, {
          title: formData.title.trim(),
          content: formData.content.trim(),
          tags: tagsArray,
          userId: user.uid,
          folderId: formData.folderId || null,
          createdAt: serverTimestamp(),
        });
      }
      setFormVisible(false);
      setFormData({ title: '', content: '', tags: '', folderId: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scripts');
    }
  };

  const handleCreateFolder = async (e: FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      if (user.isGuest) {
        const next = [
          {
            id: createId('folder'),
            name: newFolderName.trim(),
            userId: user.uid,
            createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
          },
          ...getLocalFolders(),
        ];
        saveLocalFolders(next);
        setFolders(next.filter((f) => f.userId === user.uid));
      } else {
        await addDoc(foldersCollection, {
          name: newFolderName.trim(),
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      setNewFolderName('');
      setShowFolderCreate(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'folders');
    }
  };

  const handleDeleteFolder = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        "Delete this folder? Scripts inside will move to 'All Scripts'."
      )
    ) {
      return;
    }

    try {
      if (user.isGuest) {
        const nextScripts = getLocalScripts().map((s) =>
          s.folderId === id ? { ...s, folderId: null } : s
        );
        saveLocalScripts(nextScripts);
        setScripts(nextScripts);
        const nextFolders = getLocalFolders().filter((f) => f.id !== id);
        saveLocalFolders(nextFolders);
        setFolders(nextFolders.filter((f) => f.userId === user.uid));
      } else {
        const scriptsInFolder = scripts.filter((s) => s.folderId === id);
        for (const script of scriptsInFolder) {
          await updateDoc(doc(db, 'scripts', script.id), { folderId: null });
        }
        await deleteDoc(doc(db, 'folders', id));
      }
      if (selectedFolderId === id) setSelectedFolderId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `folders/${id}`);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      try {
        if (user.isGuest) {
          const next = [
            {
              id: createId('script'),
              title: file.name.replace(/\.[^/.]+$/, ''),
              content,
              tags: [],
              userId: user.uid,
              folderId: selectedFolderId || null,
              createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
            },
            ...getLocalScripts(),
          ];
          saveLocalScripts(next);
          setScripts(next);
        } else {
          await addDoc(scriptsCollection, {
            title: file.name.replace(/\.[^/.]+$/, ''),
            content,
            tags: [],
            userId: user.uid,
            folderId: selectedFolderId || null,
            createdAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'scripts');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDelete = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this script?')) return;
    try {
      if (user.isGuest) {
        const next = getLocalScripts().filter((s) => s.id !== id);
        saveLocalScripts(next);
        setScripts(next);
      } else {
        await deleteDoc(doc(db, 'scripts', id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `scripts/${id}`);
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem('vocalprompt:guest');
    if (!user.isGuest) await signOut(auth);
    window.location.reload();
  };

  const filteredScripts = scripts.filter((s) => {
    const q = searchQuery.toLowerCase();
    const titleMatch = s.title.toLowerCase().includes(q);
    const tagsMatch = s.tags?.some((tag) => tag.toLowerCase().includes(q));
    const folderMatch = selectedFolderId ? s.folderId === selectedFolderId : true;
    return (titleMatch || tagsMatch) && folderMatch;
  });

  return (
    <div className="max-w-6xl mx-auto p-6 flex flex-col md:flex-row gap-8 min-h-screen">
      <div className="w-full md:w-64 shrink-0 flex flex-col gap-4">
        <div>
          <h1 className="text-4xl font-display tracking-tight text-white">VocalPrompt</h1>
          <p className="text-[#8a8170] mt-2 text-[10px] uppercase tracking-[0.2em] mb-2">
            Studio Manager
          </p>
          {user.isGuest ? (
            <p className="text-[11px] text-[#666] mb-6">Guest · scripts stay on this device</p>
          ) : (
            <p className="text-[11px] text-[#666] mb-6 truncate">
              {user.email || user.displayName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-sm font-medium ${
              selectedFolderId === null
                ? 'bg-[#e8c15a]/10 text-[#e8c15a] border-l-2 border-[#e8c15a]'
                : 'text-[#AAA] hover:bg-[#1a1712] hover:text-[#ece7dc] border-l-2 border-transparent'
            }`}
          >
            <FileText className="w-4 h-4" />
            All Scripts
          </button>

          <div className="h-px bg-[#2a2620] my-2 mx-2" />

          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[#666] font-bold">
              Collections
            </span>
            <button
              onClick={() => setShowFolderCreate(!showFolderCreate)}
              className="text-[#888] hover:text-[#e8c15a] transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {showFolderCreate && (
            <form onSubmit={handleCreateFolder} className="px-3 mb-2 flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-[#1a1712] border border-[#2a2620] rounded-sm px-2 py-1 text-xs text-white focus:border-[#e8c15a] outline-none"
              />
              <button
                type="submit"
                className="bg-[#e8c15a] text-black px-2 py-1 text-xs rounded-sm font-medium"
              >
                Add
              </button>
            </form>
          )}

          {folders.map((folder) => (
            <div
              key={folder.id}
              onClick={() => setSelectedFolderId(folder.id)}
              className={`group flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-sm font-medium cursor-pointer ${
                selectedFolderId === folder.id
                  ? 'bg-[#e8c15a]/10 text-[#e8c15a] border-l-2 border-[#e8c15a]'
                  : 'text-[#AAA] hover:bg-[#1a1712] hover:text-[#ece7dc] border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center gap-3 truncate pr-2">
                <FolderIcon className="w-4 h-4 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </div>
              <button
                onClick={(e) => handleDeleteFolder(folder.id, e)}
                className="opacity-0 group-hover:opacity-100 text-[#666] hover:text-red-400 p-1"
                title="Delete folder"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-auto pt-8">
          <button
            onClick={handleSignOut}
            className="bg-transparent border border-[#2a2620] text-[#888] px-3 py-2.5 rounded-sm hover:bg-[#1a1712] hover:text-[#ece7dc] transition-colors flex items-center justify-center gap-2 text-sm font-semibold w-full"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
            {user.isGuest ? 'Exit Guest' : 'Sign Out'}
          </button>
        </div>
      </div>

      <div className="flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#888]" />
            <input
              type="text"
              placeholder="Search scripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-[#0f0e0b] focus:bg-[#1a1712] border border-[#2a2620] focus:border-[#e8c15a] rounded-sm outline-none transition-all text-white text-sm"
            />
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <label className="cursor-pointer bg-[#1a1712] border border-[#2a2620] text-[#ece7dc] px-4 py-2.5 rounded-sm hover:bg-[#222] transition-colors flex items-center gap-2 text-sm font-semibold shadow-sm">
              <Upload className="w-4 h-4 text-[#888]" />
              Upload .txt
              <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={handleOpenCreate}
              className="bg-[#e8c15a] text-[#12100c] px-4 py-2.5 rounded-sm hover:bg-[#f0d078] transition-colors flex items-center gap-2 text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              New Script
            </button>
          </div>
        </div>

        {formVisible && (
          <div className="bg-[#12100c] p-6 rounded-sm shadow-sm border border-[#2a2620] mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-display text-white">
                {currentScriptId ? 'Edit Script' : 'Create New Script'}
              </h2>
              {currentScriptId && (
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold">
                  {saveStatus === 'saving' && (
                    <span className="text-[#888] flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                    </span>
                  )}
                  {saveStatus === 'saved' && (
                    <span className="text-[#e8c15a] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <input
                  type="text"
                  placeholder="Script Title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2a2620] bg-[#07080a] focus:border-[#e8c15a] outline-none transition-all text-white text-sm"
                  required={!currentScriptId}
                />
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2a2620] bg-[#07080a] focus:border-[#e8c15a] outline-none transition-all text-white text-sm"
                />
                <select
                  value={formData.folderId}
                  onChange={(e) => setFormData({ ...formData, folderId: e.target.value })}
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2a2620] bg-[#07080a] focus:border-[#e8c15a] outline-none transition-all text-white text-sm appearance-none"
                >
                  <option value="">No Folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full rounded-sm border border-[#2a2620] bg-[#07080a] focus-within:border-[#e8c15a] transition-all mb-4 overflow-hidden flex flex-col">
                <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2620] bg-[#12100c]">
                  <button
                    type="button"
                    onClick={() => document.execCommand('bold', false)}
                    className="p-1.5 text-[#888] hover:text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors"
                    title="Bold"
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => document.execCommand('italic', false)}
                    className="p-1.5 text-[#888] hover:text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors"
                    title="Italic"
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => document.execCommand('underline', false)}
                    className="p-1.5 text-[#888] hover:text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors"
                    title="Underline"
                  >
                    <Underline className="w-4 h-4" />
                  </button>
                  <div className="h-4 w-px bg-[#2a2620] mx-2" />
                  <button
                    type="button"
                    onClick={() => {
                      const name = prompt(
                        'Enter a name for this bookmark (e.g. Intro, Part 1):'
                      );
                      if (name) {
                        document.execCommand(
                          'insertHTML',
                          false,
                          `<span data-bookmark="${name}" style="background-color: #2a2620; color: #e8c15a; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; font-family: sans-serif; margin: 0 4px;" contenteditable="false">🔖 ${name}</span>&nbsp;`
                        );
                      }
                    }}
                    className="p-1.5 text-[#888] hover:text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors"
                    title="Insert Bookmark"
                  >
                    <Bookmark className="w-4 h-4" />
                  </button>
                  <div className="h-4 w-px bg-[#2a2620] mx-2" />
                  <button
                    type="button"
                    onClick={handleAutoFormat}
                    disabled={isFormatting}
                    className="p-1.5 text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors flex items-center gap-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Auto Format with AI"
                  >
                    {isFormatting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Auto Format
                  </button>
                </div>
                <div
                  ref={editorRef}
                  contentEditable
                  onInput={(e) =>
                    setFormData({ ...formData, content: e.currentTarget.innerHTML })
                  }
                  className="w-full px-4 py-3 min-h-[200px] max-h-[500px] overflow-y-auto outline-none text-white text-sm font-sans [&_b]:font-bold [&_i]:italic [&_u]:underline [&_strong]:font-bold [&_em]:italic [&_p]:mb-4 [&_div]:mb-4 empty:before:content-['Type_or_paste_your_script_here...'] empty:before:text-[#666]"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFormVisible(false)}
                  className="px-5 py-2.5 rounded-sm text-sm font-semibold text-[#888] hover:bg-[#1a1712] transition-colors"
                >
                  {currentScriptId ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-sm text-sm font-semibold bg-[#e8c15a] text-[#12100c] hover:bg-[#f0d078] transition-colors shadow-sm"
                >
                  {currentScriptId ? 'Done' : 'Save Script'}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-[#12100c] border border-[#2a2620] rounded-sm h-48 animate-pulse"
              />
            ))}
          </div>
        ) : filteredScripts.length === 0 ? (
          <div className="text-center py-24 bg-[#0f0e0b] rounded-sm border border-[#2a2620] border-dashed">
            <FolderIcon className="w-12 h-12 text-[#333] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-1">
              {selectedFolderId ? 'This folder is empty' : 'No scripts found'}
            </h3>
            <p className="text-[#888] max-w-sm mx-auto text-sm">
              {searchQuery
                ? 'Try a different search term.'
                : 'Create a new script or upload a text file to get started.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredScripts.map((script) => {
              const cleanContent = script.content.replace(/<[^>]*>?/gm, '');
              const wordCount = cleanContent
                .split(/\s+/)
                .filter((w) => w.length > 0).length;
              const estTime = Math.max(1, Math.ceil(wordCount / 150));
              const folderName = folders.find((f) => f.id === script.folderId)?.name;

              return (
                <div
                  key={script.id}
                  onClick={() => onSelectScript(script)}
                  className="group bg-[#12100c] border border-[#2a2620] rounded-sm p-6 hover:border-[#e8c15a] transition-all cursor-pointer flex flex-col h-56 relative"
                >
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                    <button
                      onClick={(e) => handleEdit(script, e)}
                      className="p-2 text-[#666] hover:text-[#e8c15a] hover:bg-[#e8c15a]/10 rounded-sm transition-colors"
                      title="Edit script"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(script.id, e)}
                      className="p-2 text-[#666] hover:text-red-400 hover:bg-red-500/10 rounded-sm transition-colors"
                      title="Delete script"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-sm bg-[#1a1712] border-l-2 border-[#e8c15a] flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-[#888]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#ece7dc] truncate pr-16">
                        {script.title}
                      </h3>
                      {folderName && (
                        <span className="text-[10px] text-[#666] flex items-center gap-1 mt-0.5">
                          <FolderIcon className="w-3 h-3" /> {folderName}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[#888] line-clamp-2 flex-1 text-xs leading-relaxed">
                    {cleanContent}
                  </p>

                  {script.tags && script.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {script.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="flex items-center gap-1 bg-[#1a1712] text-[#AAA] px-2 py-0.5 rounded text-[9px] uppercase tracking-wider"
                        >
                          <Tag className="w-2.5 h-2.5 text-[#e8c15a]" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-[#2a2620] flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider font-medium text-[#666]">
                        {script.createdAt?.toDate
                          ? script.createdAt.toDate().toLocaleDateString()
                          : 'Just now'}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider font-medium text-[#888] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {wordCount} words · ~{estTime}m
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[#AAA] font-medium text-xs uppercase tracking-wider group-hover:text-[#e8c15a] transition-colors">
                      <Play className="w-4 h-4" />
                      <span>Prompt</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
