/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  FirebaseGate — Boot-level gate that blocks the app until Firebase is
 *  either confirmed ready or the user opts to run the Install Wizard.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Renders:
 *   1. 'checking'  →  Loading spinner
 *   2. 'install'   →  <InstallWizard />  (no Firebase config at all)
 *   3. 'error'     →  Friendly error card with "Retry" & "Run Wizard" buttons
 *   4. 'ready'     →  {children}  (Firebase is live)
 *
 * The gate subscribes to onFirebaseReadyChange so it updates reactively
 * after the Install Wizard completes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import {
  getIsFirebaseConfigured,
  onFirebaseReadyChange,
  firebaseBootPromise,
} from '../firebase';
import InstallWizard from './InstallWizard';

type GateState = 'checking' | 'install' | 'error' | 'ready';

interface FirebaseGateProps {
  children: React.ReactNode;
}

export const FirebaseGate: React.FC<FirebaseGateProps> = ({ children }) => {
  const [gateState, setGateState] = useState<GateState>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      setGateState('checking');
      setErrorMessage('');

      // Wait for Firebase SDK to fully boot (creates the db instance)
      try {
        await firebaseBootPromise;
      } catch (bootErr: any) {
        if (cancelled) return;
        setErrorMessage(bootErr?.message || 'Firebase SDK failed to initialise.');
        setGateState('error');
        return;
      }

      if (cancelled) return;

      if (!getIsFirebaseConfigured()) {
        // No Firebase config at all — direct to Install Wizard
        setGateState('install');
        return;
      }

      // Firebase is configured and booted — all good
      setGateState('ready');
    }

    evaluate();

    // Reactively re-evaluate when Firebase ready-state changes
    // (e.g. after Install Wizard writes config, or user refreshes credentials)
    const unsub = onFirebaseReadyChange((ready) => {
      if (ready) {
        setGateState('ready');
        setErrorMessage('');
      } else {
        // Firebase became unconfigured (likely from
        // clearFirebaseConfig in the wizard)
        setGateState('install');
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ── Checking ──────────────────────────────────────────────────────────────
  if (gateState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-[3px] border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400 font-semibold tracking-wide">
          Initialising…
        </p>
      </div>
    );
  }

  // ── Install Wizard ────────────────────────────────────────────────────────
  if (gateState === 'install') {
    return <InstallWizard />;
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (gateState === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-slate-200 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
            <span className="text-3xl">⚠️</span>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-800">
              Firebase Connection Error
            </h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              The app couldn't connect to Firebase. Check your configuration or
              run the setup wizard.
            </p>
          </div>

          {errorMessage && (
            <pre className="bg-rose-50 border border-rose-200 text-rose-700 text-xs text-left p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
              {errorMessage}
            </pre>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setGateState('checking');
                setErrorMessage('');
                // Re-evaluate after a short delay
                setTimeout(() => {
                  if (getIsFirebaseConfigured()) {
                    setGateState('ready');
                  } else {
                    setGateState('install');
                  }
                }, 500);
              }}
              className="flex-1 cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setGateState('install')}
              className="flex-1 cursor-pointer bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
            >
              Run Setup Wizard
            </button>
          </div>

          <p className="text-[10px] text-slate-400">
            Need help? Check your Firebase project settings and ensure
            Firestore is created.
          </p>
        </div>
      </div>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────────────────
  return <>{children}</>;
};

export default FirebaseGate;
