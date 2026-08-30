import React, { useState, useEffect, useRef } from 'react';
import { db, scriptsCollection, foldersCollection, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { onSnapshot, addDoc, updateDoc, serverTimestamp, query, orderBy, where, deleteDoc, doc } from 'firebase/firestore';
import { signOut, User } from 'firebase/auth';
import { Script, Folder } from '../types';
import { Plus, FileText, Upload, Trash2, Play, Search, Tag, LogOut, Clock, Edit2, Loader2, CheckCircle2, Folder as FolderIcon, FolderPlus, Bold, Italic, Underline, Sparkles } from 'lucide-react';

interface Props {
  onSelectScript: (script: Script) => void;
  user: User;
}

export default function ScriptManager({ onSelectScript, user }: Props) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Editor State
  const editorRef = useRef<HTMLDivElement>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ title: '', content: '', tags: '', folderId: '' });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Folder Creation State
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderCreate, setShowFolderCreate] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormatting, setIsFormatting] = useState(false);

  const handleAutoFormat = async () => {
    if (!formData.content.trim() || isFormatting) return;
    setIsFormatting(true);
    try {
      // Remove HTML tags for clean API sending if needed, but it's fine as is.
      const response = await fetch('/api/format-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: formData.content })
      });
      
      if (!response.ok) {
        throw new Error('Failed to format script');
      }
      
      const data = await response.json();
      setFormData(prev => ({ ...prev, content: data.formattedText }));
      if (editorRef.current) {
        editorRef.current.innerHTML = data.formattedText;
      }
    } catch (error) {
      console.error("Auto format error:", error);
      alert("Failed to auto-format script. Please check your connection and try again.");
    } finally {
      setIsFormatting(false);
    }
  };

  useEffect(() => {
    // Scripts Listener
    const qScripts = query(scriptsCollection, where('userId', '==', user.uid));
    const unsubscribeScripts = onSnapshot(qScripts, (snapshot) => {
      const loadedScripts: Script[] = [];
      snapshot.forEach((doc) => {
        loadedScripts.push({ id: doc.id, ...doc.data() } as Script);
      });
      loadedScripts.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeB - timeA;
      });
      setScripts(loadedScripts);
      setLoading(false);
    }, (err) => {
      setLoading(false);
      handleFirestoreError(err, OperationType.GET, 'scripts');
    });

    // Folders Listener
    const qFolders = query(foldersCollection, where('userId', '==', user.uid));
    const unsubscribeFolders = onSnapshot(qFolders, (snapshot) => {
      const loadedFolders: Folder[] = [];
      snapshot.forEach((doc) => {
        loadedFolders.push({ id: doc.id, ...doc.data() } as Folder);
      });
      loadedFolders.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
        return timeB - timeA;
      });
      setFolders(loadedFolders);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'folders');
    });

    return () => {
      unsubscribeScripts();
      unsubscribeFolders();
    };
  }, [user.uid]);

  // Auto-save effect for editing existing scripts
  useEffect(() => {
    if (!currentScriptId || !formVisible) return;
    
    setSaveStatus('saving');
    
    const timeoutId = setTimeout(async () => {
      try {
        const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        await updateDoc(doc(db, 'scripts', currentScriptId), {
          title: formData.title.trim() || 'Untitled Script',
          content: formData.content,
          tags: tagsArray,
          folderId: formData.folderId || null
        });
        setSaveStatus('saved');
        
        setTimeout(() => {
          setSaveStatus(current => current === 'saved' ? 'idle' : current);
        }, 2000);
      } catch (error) {
        setSaveStatus('idle'); 
        handleFirestoreError(error, OperationType.UPDATE, `scripts/${currentScriptId}`);
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
  }, [formData, currentScriptId, formVisible]);

  // Editor Initial Content Sync
  useEffect(() => {
    if (formVisible && editorRef.current) {
      if (editorRef.current.innerHTML !== formData.content) {
        editorRef.current.innerHTML = formData.content;
      }
    }
  }, [formVisible, currentScriptId]); // only run when opening form or switching script

  const handleOpenCreate = () => {
    setCurrentScriptId(null);
    setFormData({ title: '', content: '', tags: '', folderId: selectedFolderId || '' });
    setFormVisible(true);
    setSaveStatus('idle');
  };

  const handleEdit = (script: Script, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentScriptId(script.id);
    setFormData({
       title: script.title,
       content: script.content,
       tags: (script.tags || []).join(', '),
       folderId: script.folderId || ''
    });
    setFormVisible(true);
    setSaveStatus('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (currentScriptId) {
      setFormVisible(false);
      setCurrentScriptId(null);
      return;
    }

    if (!formData.title.trim() || !formData.content.trim()) return;

    const tagsArray = formData.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);

    try {
      await addDoc(scriptsCollection, {
        title: formData.title.trim(),
        content: formData.content.trim(),
        tags: tagsArray,
        userId: user.uid,
        folderId: formData.folderId || null,
        createdAt: serverTimestamp()
      });
      setFormVisible(false);
      setFormData({ title: '', content: '', tags: '', folderId: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scripts');
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    
    try {
      await addDoc(foldersCollection, {
        name: newFolderName.trim(),
        userId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewFolderName("");
      setShowFolderCreate(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'folders');
    }
  };

  const handleDeleteFolder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this folder? Scripts inside will be moved to 'All Scripts'.")) {
      try {
        // Find scripts in this folder and remove their folderId
        const scriptsInFolder = scripts.filter(s => s.folderId === id);
        for (const script of scriptsInFolder) {
          await updateDoc(doc(db, 'scripts', script.id), { folderId: null });
        }
        await deleteDoc(doc(db, 'folders', id));
        if (selectedFolderId === id) setSelectedFolderId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `folders/${id}`);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          await addDoc(scriptsCollection, {
            title: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
            content: content,
            tags: [],
            userId: user.uid,
            folderId: selectedFolderId || null,
            createdAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'scripts');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this script?")) {
      try {
        await deleteDoc(doc(db, 'scripts', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `scripts/${id}`);
      }
    }
  };

  const filteredScripts = scripts.filter(s => {
    const query = searchQuery.toLowerCase();
    const titleMatch = s.title.toLowerCase().includes(query);
    const tagsMatch = s.tags?.some(tag => tag.toLowerCase().includes(query));
    const folderMatch = selectedFolderId ? s.folderId === selectedFolderId : true;
    return (titleMatch || tagsMatch) && folderMatch;
  });

  return (
    <div className="max-w-6xl mx-auto p-6 flex flex-col md:flex-row gap-8">
      {/* Sidebar - Folders */}
      <div className="w-full md:w-64 shrink-0 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-serif italic tracking-wide text-white">VocalPrompt</h1>
          <p className="text-[#888] mt-2 text-[10px] uppercase tracking-[0.2em] mb-8">Studio Manager</p>
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-sm font-medium ${
              selectedFolderId === null 
                ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-l-2 border-[#D4AF37]' 
                : 'text-[#AAA] hover:bg-[#1A1A1A] hover:text-[#E5E5E5] border-l-2 border-transparent'
            }`}
          >
            <FileText className="w-4 h-4" />
            All Scripts
          </button>
          
          <div className="h-px bg-[#2A2A2A] my-2 mx-2"></div>
          
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[#666] font-bold">Collections</span>
            <button 
              onClick={() => setShowFolderCreate(!showFolderCreate)}
              className="text-[#888] hover:text-[#D4AF37] transition-colors"
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
                className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-sm px-2 py-1 text-xs text-white focus:border-[#D4AF37] outline-none"
              />
              <button type="submit" className="bg-[#D4AF37] text-black px-2 py-1 text-xs rounded-sm font-medium">Add</button>
            </form>
          )}

          {folders.map(folder => (
            <div
              key={folder.id}
              onClick={() => setSelectedFolderId(folder.id)}
              className={`group flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-sm font-medium cursor-pointer ${
                selectedFolderId === folder.id 
                  ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-l-2 border-[#D4AF37]' 
                  : 'text-[#AAA] hover:bg-[#1A1A1A] hover:text-[#E5E5E5] border-l-2 border-transparent'
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
              onClick={() => signOut(auth)}
              className="bg-transparent border border-[#2A2A2A] text-[#888] px-3 py-2.5 rounded-sm hover:bg-[#1A1A1A] hover:text-[#E5E5E5] transition-colors flex items-center justify-center gap-2 text-sm font-semibold w-full"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#888]" />
            <input 
              type="text"
              placeholder="Search scripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-[#0F0F0F] focus:bg-[#1A1A1A] border border-[#2A2A2A] focus:border-[#D4AF37] rounded-sm outline-none transition-all text-white text-sm"
            />
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <label className="cursor-pointer bg-[#1A1A1A] border border-[#2A2A2A] text-[#E5E5E5] px-4 py-2.5 rounded-sm hover:bg-[#222] transition-colors flex items-center gap-2 text-sm font-semibold shadow-sm">
              <Upload className="w-4 h-4 text-[#888]" />
              Upload .txt
              <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
            </label>
            <button 
              onClick={handleOpenCreate}
              className="bg-[#D4AF37] text-[#0A0A0A] px-4 py-2.5 rounded-sm hover:bg-[#b5952f] transition-colors flex items-center gap-2 text-sm font-semibold shadow-[0_0_20px_rgba(212,175,55,0.2)]"
            >
              <Plus className="w-4 h-4" />
              New Script
            </button>
          </div>
        </div>

        {formVisible && (
          <div className="bg-[#121212] p-6 rounded-sm shadow-sm border border-[#2A2A2A] mb-8 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-serif text-white">
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
                    <span className="text-[#D4AF37] flex items-center gap-1">
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
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2A2A2A] bg-[#0A0A0A] focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none transition-all text-white text-sm"
                  required={!currentScriptId}
                />
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2A2A2A] bg-[#0A0A0A] focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none transition-all text-white text-sm"
                />
                <select
                  value={formData.folderId}
                  onChange={(e) => setFormData({ ...formData, folderId: e.target.value })}
                  className="w-full md:col-span-1 px-4 py-3 rounded-sm border border-[#2A2A2A] bg-[#0A0A0A] focus:border-[#D4AF37] focus:ring-1 focus:ring-[#D4AF37] outline-none transition-all text-white text-sm appearance-none"
                >
                  <option value="">No Folder</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-full rounded-sm border border-[#2A2A2A] bg-[#0A0A0A] focus-within:border-[#D4AF37] focus-within:ring-1 focus-within:ring-[#D4AF37] transition-all mb-4 overflow-hidden flex flex-col">
                <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2A2A2A] bg-[#121212]">
                   <button type="button" onClick={() => document.execCommand('bold', false)} className="p-1.5 text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors" title="Bold"><Bold className="w-4 h-4" /></button>
                   <button type="button" onClick={() => document.execCommand('italic', false)} className="p-1.5 text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors" title="Italic"><Italic className="w-4 h-4" /></button>
                   <button type="button" onClick={() => document.execCommand('underline', false)} className="p-1.5 text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors" title="Underline"><Underline className="w-4 h-4" /></button>
                   <div className="h-4 w-px bg-[#2A2A2A] mx-2"></div>
                   <button 
                     type="button" 
                     onClick={() => {
                       const name = prompt('Enter a name for this bookmark (e.g. Intro, Part 1):');
                       if (name) {
                         document.execCommand('insertHTML', false, `<span data-bookmark="${name}" style="background-color: #2A2A2A; color: #D4AF37; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; font-family: sans-serif; margin: 0 4px;" contenteditable="false">🔖 ${name}</span>&nbsp;`);
                       }
                     }}
                     className="p-1.5 text-[#888] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors" 
                     title="Insert Bookmark"
                   >
                     🔖
                   </button>
                   <div className="h-4 w-px bg-[#2A2A2A] mx-2"></div>
                   <button 
                     type="button" 
                     onClick={handleAutoFormat} 
                     disabled={isFormatting}
                     className="p-1.5 text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors flex items-center gap-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed" 
                     title="Auto Format with AI"
                   >
                     {isFormatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                     Auto Format
                   </button>
                </div>
                <div 
                   ref={editorRef}
                   contentEditable
                   onInput={(e) => setFormData({ ...formData, content: e.currentTarget.innerHTML })}
                   className="w-full px-4 py-3 min-h-[200px] max-h-[500px] overflow-y-auto outline-none text-white text-sm font-sans [&_b]:font-bold [&_i]:italic [&_u]:underline [&_strong]:font-bold [&_em]:italic [&_p]:mb-4 [&_div]:mb-4 empty:before:content-['Type_or_paste_your_script_here...'] empty:before:text-[#666]"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setFormVisible(false)}
                  className="px-5 py-2.5 rounded-sm text-sm font-semibold text-[#888] hover:bg-[#1A1A1A] transition-colors"
                >
                  {currentScriptId ? 'Close' : 'Cancel'}
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2.5 rounded-sm text-sm font-semibold bg-[#D4AF37] text-[#0A0A0A] hover:bg-[#b5952f] transition-colors shadow-sm"
                >
                  {currentScriptId ? 'Done' : 'Save Script'}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#121212] border border-[#2A2A2A] rounded-sm h-48 animate-pulse"></div>
            ))}
          </div>
        ) : filteredScripts.length === 0 ? (
          <div className="text-center py-24 bg-[#0F0F0F] rounded-sm border border-[#2A2A2A] border-dashed">
            <FolderIcon className="w-12 h-12 text-[#333] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-1">
              {selectedFolderId ? "This folder is empty" : "No scripts found"}
            </h3>
            <p className="text-[#888] max-w-sm mx-auto text-sm">
              {searchQuery ? "Try a different search term." : "Create a new script or upload a text file to get started."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredScripts.map(script => {
              const cleanContent = script.content.replace(/<[^>]*>?/gm, '');
              const wordCount = cleanContent.split(/\s+/).filter(w => w.length > 0).length;
              const estTime = Math.max(1, Math.ceil(wordCount / 150));
              const folderName = folders.find(f => f.id === script.folderId)?.name;
              
              return (
              <div 
                key={script.id}
                onClick={() => onSelectScript(script)}
                className="group bg-[#121212] border border-[#2A2A2A] rounded-sm p-6 hover:shadow-[0_0_15px_rgba(212,175,55,0.05)] hover:border-[#D4AF37] transition-all cursor-pointer flex flex-col h-56 relative"
              >
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <button 
                    onClick={(e) => handleEdit(script, e)}
                    className="p-2 text-[#666] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-sm transition-colors"
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
                  <div className="w-10 h-10 rounded-sm bg-[#1A1A1A] border-l-2 border-[#D4AF37] flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-[#888]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#E5E5E5] truncate pr-16">{script.title}</h3>
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
                      <span key={idx} className="flex items-center gap-1 bg-[#1A1A1A] text-[#AAA] px-2 py-0.5 rounded text-[9px] uppercase tracking-wider">
                        <Tag className="w-2.5 h-2.5 text-[#D4AF37]" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                
                <div className="mt-4 pt-4 border-t border-[#2A2A2A] flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-wider font-medium text-[#666]">
                      {script.createdAt?.toDate ? script.createdAt.toDate().toLocaleDateString() : 'Just now'}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider font-medium text-[#888] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {wordCount} words • ~{estTime}m
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 text-[#AAA] font-medium text-xs uppercase tracking-wider group-hover:text-[#D4AF37] transition-colors">
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

