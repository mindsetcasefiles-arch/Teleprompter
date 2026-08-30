/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { auth, signIn } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import ScriptManager from './components/ScriptManager';
import TeleprompterView from './components/TeleprompterView';
import { Script } from './types';
import { Mic } from 'lucide-react';

export default function App() {
  const [activeScript, setActiveScript] = useState<Script | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#333] border-t-[#D4AF37] animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-[#E5E5E5] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#121212] p-8 rounded-sm border border-[#2A2A2A] shadow-xl text-center">
          <div className="w-16 h-16 bg-[#1A1A1A] rounded-full mx-auto mb-6 flex items-center justify-center border border-[#333]">
            <Mic className="w-8 h-8 text-[#D4AF37]" />
          </div>
          <h1 className="text-3xl font-serif italic tracking-wide text-white mb-2">VocalPrompt</h1>
          <p className="text-[#888] text-sm mb-8">Sign in to sync your scripts securely.</p>
          <button 
            onClick={signIn}
            className="w-full bg-[#E5E5E5] text-[#0A0A0A] py-3 rounded-sm font-semibold hover:bg-white transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E5E5E5] font-sans selection:bg-[#D4AF37] selection:text-[#0A0A0A]">
      {activeScript ? (
        <TeleprompterView 
          script={activeScript} 
          user={user}
          onClose={() => setActiveScript(null)} 
        />
      ) : (
        <ScriptManager onSelectScript={setActiveScript} user={user} />
      )}
    </div>
  );
}
