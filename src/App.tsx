/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { auth, signIn } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import ScriptManager from './components/ScriptManager';
import TeleprompterView from './components/TeleprompterView';
import { Script, AppUser } from './types';
import { ensureSampleScript } from './lib/localStore';
import { Mic, Sparkles } from 'lucide-react';

const GUEST_KEY = 'vocalprompt:guest';

function guestUser(): AppUser {
  return {
    uid: 'guest-local',
    displayName: 'Guest',
    email: null,
    isGuest: true,
  };
}

export default function App() {
  const [activeScript, setActiveScript] = useState<Script | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const savedGuest = localStorage.getItem(GUEST_KEY) === '1';
    if (savedGuest) {
      ensureSampleScript('guest-local');
      setUser(guestUser());
      setLoading(false);
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        localStorage.removeItem(GUEST_KEY);
        setUser({
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          isGuest: false,
        });
      } else if (!savedGuest && localStorage.getItem(GUEST_KEY) !== '1') {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const continueAsGuest = () => {
    localStorage.setItem(GUEST_KEY, '1');
    ensureSampleScript('guest-local');
    setAuthError(null);
    setUser(guestUser());
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signIn();
    } catch {
      setAuthError('Google sign-in failed. You can continue as a guest instead.');
    } finally {
      setAuthBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#2a2a2a] border-t-[#e8c15a] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen relative overflow-hidden text-[#ece7dc] flex flex-col items-center justify-center p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,#2a2418_0%,transparent_45%),radial-gradient(ellipse_at_80%_90%,#1a1510_0%,transparent_40%),linear-gradient(160deg,#07080a_0%,#12100c_50%,#07080a_100%)]" />
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%224%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.55%22/></svg>')]" />

        <div className="relative max-w-lg w-full text-center">
          <div className="mx-auto mb-8 w-16 h-16 rounded-full border border-[#e8c15a]/35 bg-[#e8c15a]/10 flex items-center justify-center shadow-[0_0_40px_rgba(232,193,90,0.15)]">
            <Mic className="w-7 h-7 text-[#e8c15a]" />
          </div>
          <p className="font-display text-5xl sm:text-6xl tracking-tight text-white mb-3">
            VocalPrompt
          </p>
          <p className="text-[#a39a88] text-base leading-relaxed mb-10 max-w-md mx-auto">
            A voice-synced teleprompter with live word highlighting, practice
            recording, and mirrored glass mode.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={continueAsGuest}
              className="w-full bg-[#e8c15a] text-[#12100c] py-3.5 rounded-sm font-semibold hover:bg-[#f0d078] transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Start prompting
            </button>
            <button
              onClick={handleGoogleSignIn}
              disabled={authBusy}
              className="w-full bg-transparent border border-[#3a342a] text-[#ece7dc] py-3.5 rounded-sm font-semibold hover:border-[#e8c15a]/50 hover:bg-[#1a1712] transition-colors disabled:opacity-60"
            >
              {authBusy ? 'Signing in…' : 'Sign in with Google to sync'}
            </button>
          </div>
          {authError && (
            <p className="mt-4 text-sm text-red-300/90">{authError}</p>
          )}
          <p className="mt-6 text-xs text-[#6f675a]">
            Guest mode keeps scripts on this device. Google sync stores them in
            your cloud library.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07080a] text-[#ece7dc] selection:bg-[#e8c15a] selection:text-[#12100c]">
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
