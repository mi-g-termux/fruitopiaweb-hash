import React, { useEffect, useState, useCallback } from 'react'
import { probeInstallHelper, reinitializeDynamicFirebase, clearFirebaseConfig, getDb, auth, type FirebaseRuntimeConfig, DYNAMIC_FIREBASE_KEY } from '../firebase'
import { doc, setDoc, writeBatch } from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import {
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_SMTP_SETTINGS,
  DEFAULT_SUPPORT_SETTINGS,
  setActiveEngine,
  simpleHash,
} from '../db'

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = 'idle' | 'running' | 'ok' | 'fail'
type ConnStatus  = 'idle' | 'running' | 'ok' | 'fail'

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  )
}

interface CheckRowProps {
  status: CheckStatus
  okLabel: string
  failLabel: string
}

function CheckRow({ status, okLabel, failLabel }: CheckRowProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="shrink-0 w-6 flex items-center justify-center">
        {status === 'running' && <Spinner />}
        {status === 'ok'      && <span className="text-emerald-500 text-lg">✅</span>}
        {status === 'fail'    && <span className="text-rose-500 text-lg">❌</span>}
        {status === 'idle'    && <span className="inline-block w-5 h-5 rounded-full bg-gray-200" />}
      </span>
      <span className={`text-sm ${status === 'fail' ? 'text-rose-600' : 'text-gray-700'}`}>
        {status === 'fail' ? failLabel : okLabel}
      </span>
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

interface StepDotsProps {
  total: number
  current: number
}

function StepDots({ total, current }: StepDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        if (step === current) {
          return <span key={step} className="w-8 h-2 bg-emerald-500 rounded-full transition-all duration-300" />
        }
        if (step < current) {
          return <span key={step} className="w-2 h-2 bg-emerald-500 rounded-full" />
        }
        return <span key={step} className="w-2 h-2 bg-gray-200 rounded-full" />
      })}
    </div>
  )
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const primaryBtn =
  'bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150'

const backBtn =
  'text-gray-500 hover:text-gray-700 font-medium px-4 py-2 transition-colors duration-150'

// ─── Step 6 install logic — extracted to a proper component ──────────────────

interface InstallProgressState {
  step:      number
  status:    'idle' | 'running' | 'awaiting-upload' | 'awaiting-envvars' | 'error' | 'done'
  message:   string
  error:     string
  completed: number[]
  envBlock?: string
}

interface Step6Props {
  installProgress:    InstallProgressState
  setInstallProgress: React.Dispatch<React.SetStateAction<InstallProgressState>>
  setCurrentStep:     (n: number) => void
  creds:              FirebaseRuntimeConfig
  detectedPlatform:   'php' | 'node' | 'none' | null
  admin:              { username: string; password: string; confirm: string }
  store:              { name: string; email: string; currency: string; symbol: string }
  backBtn:            string
  primaryBtn:         string
}

const ROW_LABELS = [
  'Connecting to Firebase...',
  'Saving configuration...',
  'Setting up admin authentication...',
  'Setting up store data...',
  'Creating admin account...',
  'Saving store settings...',
  'Finalising installation...',
]

function Step6Install({
  installProgress,
  setInstallProgress,
  setCurrentStep,
  creds,
  detectedPlatform,
  admin,
  store,
  backBtn,
  primaryBtn,
}: Step6Props) {
  const markDone = useCallback((n: number) =>
    setInstallProgress(p => ({ ...p, completed: [...p.completed, n] })), [setInstallProgress])

  const markRunning = useCallback((n: number, msg: string) =>
    setInstallProgress(p => ({ ...p, step: n, status: 'running', message: msg, error: '' })),
    [setInstallProgress])

  const markError = useCallback((msg: string) =>
    setInstallProgress(p => ({ ...p, status: 'error', error: msg })), [setInstallProgress])

  const runInstallFromStep3 = useCallback(async () => {

    // Helper: wraps a promise with a timeout so a Firestore permission-denied
    // or network stall surfaces as an error instead of hanging forever.
    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `"${label}" timed out after ${ms / 1000}s. ` +
            `Most likely cause: Firestore security rules are blocking the write. ` +
            `Deploy firestore.rules from this project (firebase deploy --only firestore:rules) then try again.`
          )), ms)
        ),
      ]);
    }

    // Sub-step 3 — Create Firebase Auth user and sign in
    // This authenticates all subsequent Firestore writes (sub-steps 4-7) so
    // the security rules don't reject them with PERMISSION_DENIED.
    markRunning(3, 'Setting up admin authentication...')
    try {
      const adminEmail = admin.username.trim() + '@fruitopia-admin.internal'
      const stablePassword = 'ftp_' + btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      try {
        await withTimeout(
          createUserWithEmailAndPassword(auth!, adminEmail, stablePassword),
          15000, 'Creating admin authentication',
        )
      } catch (e1: any) {
        if (e1?.code === 'auth/email-already-in-use') {
          // User already exists from a previous install — just sign in
          await withTimeout(
            signInWithEmailAndPassword(auth!, adminEmail, stablePassword),
            15000, 'Signing in admin',
          )
        } else {
          throw e1
        }
      }
      markDone(3)
    } catch (e: any) { markError(e?.message || 'Failed to create admin authentication'); return }

    // Sub-step 4 — Seed store data (single batched write — one round trip)
    markRunning(4, 'Setting up store data...')
    try {
      const db    = getDb()
      const batch = writeBatch(db)
      for (const p of DEFAULT_PRODUCTS)   batch.set(doc(db, 'products',   p.id), p)
      for (const c of DEFAULT_CATEGORIES) batch.set(doc(db, 'categories', c.id), c)
      for (const c of DEFAULT_COUPONS)    batch.set(doc(db, 'coupons',    c.id), c)
      for (const r of DEFAULT_REVIEWS)    batch.set(doc(db, 'reviews',    r.id), r)
      await withTimeout(batch.commit(), 20000, 'Setting up store data')
      markDone(4)
    } catch (e: any) { markError(e?.message || 'Failed to seed data'); return }

    // Sub-step 5 — Create admin account
    markRunning(5, 'Creating admin account...')
    try {
      const db = getDb()
      await withTimeout(
        setDoc(doc(db, 'settings', 'adminSettings'), {
          username: admin.username,
          password: simpleHash(admin.password),
        }),
        15000, 'Creating admin account'
      )
      markDone(5)
    } catch (e: any) { markError(e?.message || 'Failed to create admin'); return }

    // Sub-step 6 — Save store settings (batched)
    markRunning(6, 'Saving store settings...')
    try {
      const db     = getDb()
      const batch2 = writeBatch(db)
      batch2.set(doc(db, 'settings', 'siteSettings'), {
        ...DEFAULT_SITE_SETTINGS,
        websiteName:    store.name,
        siteTitle:      store.name + ' — Fresh Organic Smoothies',
        contactEmail:   store.email,
        currency:       store.currency,
        currencySymbol: store.symbol,
      })
      batch2.set(doc(db, 'settings', 'paymentSettings'), DEFAULT_PAYMENT_SETTINGS)
      batch2.set(doc(db, 'settings', 'smtpSettings'),    DEFAULT_SMTP_SETTINGS)
      batch2.set(doc(db, 'settings', 'supportSettings'), DEFAULT_SUPPORT_SETTINGS)
      await withTimeout(batch2.commit(), 15000, 'Saving store settings')
      markDone(6)
    } catch (e: any) { markError(e?.message || 'Failed to save settings'); return }

    // Sub-step 7 — Finalise
    markRunning(7, 'Finalising installation...')
    try {
      const db = getDb()
      await withTimeout(
        setDoc(doc(db, 'settings', 'install_status'), {
          installed:   true,
          installedAt: new Date().toISOString(),
          platform:    detectedPlatform || 'unknown',
          storeName:   store.name,
        }),
        15000, 'Finalising installation'
      )
      markDone(7)
      setInstallProgress(p => ({ ...p, status: 'done', message: 'Installation complete!' }))
      setCurrentStep(7)
      // Cache the installed state so App.tsx skips Firestore on every future page load.
      try { localStorage.setItem('fruitopia_installed', 'true'); } catch {}
      // Notify App.tsx to re-evaluate installState — handles the case where
      // Firebase was already configured so onFirebaseReadyChange never re-fires.
      if (typeof (window as any).__fruitopiaCheckInstall === 'function') {
        setTimeout(() => (window as any).__fruitopiaCheckInstall(), 300)
      }
    } catch (e: any) { markError(e?.message || 'Failed to finalise') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, store, detectedPlatform, markDone, markRunning, markError, setInstallProgress, setCurrentStep])

  const runInstall = useCallback(async () => {
    setInstallProgress({ step: 0, status: 'running', message: '', error: '', completed: [] })

    // Sub-step 1 — Connect
    markRunning(1, 'Connecting to Firebase...')
    try {
      await reinitializeDynamicFirebase(creds)
      // Switch the active engine to Firebase so the app reads from Firestore,
      // not localStorage. Otherwise everything falls back to local mock mode
      // even though Firebase is configured and working.
      setActiveEngine('firebase')
      markDone(1)
    } catch (e: any) { markError(e?.message || 'Firebase connection failed'); return }

    // Sub-step 2 — Save config
    markRunning(2, 'Saving configuration...')
    let saved = false
    let saveError = ''
    if (detectedPlatform === 'php') {
      try {
        const r = await fetch('/install-helper.php', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify(creds),
        })
        const body = await r.json().catch(() => null)
        if (r.ok) saved = true
        else saveError = body?.message || `PHP installer returned HTTP ${r.status}`
      } catch (e: any) { saveError = e?.message || 'PHP installer is not reachable' }
    } else if (detectedPlatform === 'node') {
      try {
        const r = await fetch('/api/save-config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify(creds),
        })
        const body = await r.json().catch(() => null)
        if (r.ok && body?.success) {
          saved = true
        } else if (body?.needsEnvVars && body?.envBlock) {
          // Vercel (read-only FS) — also save to browser so admin can finish this session,
          // then show env-var paste UI for permanent fix.
          try { localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify(creds)) } catch {}
          setInstallProgress(p => ({
            ...p,
            status: 'awaiting-envvars',
            envBlock: body.envBlock,
            message: body.message || 'Add these environment variables in Vercel and redeploy.',
          }))
          return
        } else {
          saveError = body?.message || `Node installer returned HTTP ${r.status}`
        }
      } catch (e: any) { saveError = e?.message || 'Node installer is not reachable' }
    } else {
      saveError = 'No writable installer endpoint was detected on this host.'
    }

    if (saved) {
      markDone(2)
      await runInstallFromStep3()
    } else {
      // Trigger download, pause for manual upload
      const blob = new Blob([JSON.stringify(creds, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'firebase-config.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      try {
        localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify(creds))
      } catch {}
      setInstallProgress(p => ({
        ...p,
        status: 'awaiting-upload',
        message: saveError
          ? `${saveError} Downloaded firebase-config.json for manual upload. A browser fallback was also saved so you can continue on this device.`
          : 'Downloaded firebase-config.json for manual upload. A browser fallback was also saved so you can continue on this device.',
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, detectedPlatform, markDone, markRunning, markError, runInstallFromStep3, setInstallProgress])

  const isBlocking =
    installProgress.status === 'running' ||
    installProgress.status === 'awaiting-upload' ||
    installProgress.status === 'awaiting-envvars'

  function getRowStatus(rowIndex: number): 'pending' | 'running' | 'completed' | 'error' {
    const n = rowIndex + 1
    if (installProgress.completed.includes(n))                       return 'completed'
    if (installProgress.status === 'error'   && installProgress.step === n) return 'error'
    if (installProgress.status === 'running' && installProgress.step === n) return 'running'
    return 'pending'
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Installing</h2>
        <p className="text-gray-500 text-sm">
          {installProgress.status === 'idle'
            ? 'Ready to install. Click the button below to begin.'
            : installProgress.status === 'done'
            ? 'All done! Redirecting…'
            : installProgress.message || 'Working…'}
        </p>
      </div>

      {/* Progress rows */}
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl px-4">
        {ROW_LABELS.map((label, i) => {
          const status = getRowStatus(i)
          return (
            <div key={i} className="flex items-center gap-3 py-3">
              <span className="shrink-0 w-6 flex items-center justify-center">
                {status === 'running'   && <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                {status === 'completed' && <span className="text-emerald-500 text-lg">✅</span>}
                {status === 'error'     && <span className="text-rose-500 text-lg">❌</span>}
                {status === 'pending'   && <span className="inline-block w-3 h-3 rounded-full bg-gray-200" />}
              </span>
              <span className={`text-sm ${
                status === 'completed' ? 'text-emerald-700 font-medium' :
                status === 'error'     ? 'text-rose-600' :
                status === 'running'   ? 'text-gray-800 font-medium' :
                'text-gray-400'
              }`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Awaiting upload amber notice */}
      {installProgress.status === 'awaiting-upload' && (
        <div className="bg-amber-50 border-l-4 border-amber-500 text-amber-800 p-4 rounded">
          <p className="font-semibold text-sm mb-1">⚠️ Manual step required</p>
          <p className="text-sm mb-3">
            Upload <strong>firebase-config.json</strong> (just downloaded) to your website
            <strong> public folder / web root</strong>, then click Continue. If you are testing locally,
            you can click Continue now because the installer also saved a browser fallback.
          </p>
          <button
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors duration-150"
            onClick={async () => {
              markDone(2)
              setInstallProgress(p => ({ ...p, status: 'running', message: 'Continuing with saved browser config…' }))
              await runInstallFromStep3()
            }}
          >
            ✅ I've uploaded it, Continue →
          </button>
        </div>
      )}

      {/* Awaiting Vercel env-vars paste */}
      {installProgress.status === 'awaiting-envvars' && installProgress.envBlock && (
        <div className="bg-sky-50 border-l-4 border-sky-500 text-sky-900 p-4 rounded space-y-3">
          <p className="font-semibold text-sm">🔧 One-time Vercel setup — permanent fix</p>
          <p className="text-xs leading-relaxed">
            Vercel's filesystem is read-only, so the installer can't write{' '}
            <code className="bg-white px-1 rounded">firebase-config.json</code> there. Paste these
            environment variables in <strong>Vercel → Project → Settings → Environment Variables</strong>
            {' '}(check Production + Preview + Development), then trigger a <strong>Redeploy</strong>.
            After that, the installer will <strong>never</strong> appear again on any browser or device.
          </p>
          <div className="relative">
            <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded-lg overflow-x-auto select-all max-h-56">
{installProgress.envBlock}
            </pre>
            <button
              type="button"
              onClick={() => { try { navigator.clipboard.writeText(installProgress.envBlock || '') } catch {} }}
              className="absolute top-2 right-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
          <p className="text-[11px] text-sky-800">
            A browser fallback was also saved so you can finish this install session right now.
            Click Continue to proceed — but remember to set the env-vars + redeploy so other users don't see this wizard.
          </p>
          <button
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors duration-150"
            onClick={async () => {
              markDone(2)
              setInstallProgress(p => ({ ...p, status: 'running', message: 'Continuing with saved browser config…' }))
              await runInstallFromStep3()
            }}
          >
            ✅ I've added the env-vars (or skipping for now), Continue →
          </button>
        </div>
      )}



      {/* Error banner */}
      {installProgress.status === 'error' && (() => {
        const isRulesError =
          /permission.denied|missing.*permission|insufficient.*permission|unauthorized|timed out/i
            .test(installProgress.error);
        return (
          <div className="bg-rose-50 border border-rose-300 text-rose-700 p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold">Installation error</p>
            <p className="break-words">{installProgress.error}</p>
            {isRulesError && (
              <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 space-y-1">
                <p className="font-bold">⚠️ Firestore security rules need to be deployed</p>
                <p className="text-xs">Run this command in your project folder, then click Try Again:</p>
                <pre className="bg-white border border-amber-200 rounded px-3 py-2 text-xs font-mono select-all mt-1">
                  firebase deploy --only firestore:rules
                </pre>
                <p className="text-xs mt-1">
                  Don't have firebase-tools? Run first:{' '}
                  <code className="bg-white border border-amber-200 rounded px-1 py-0.5 font-mono text-xs">
                    npm install -g firebase-tools
                  </code>
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Action row */}
      <div className="flex items-center justify-between">
        {!isBlocking ? (
          <button className={backBtn} onClick={() => setCurrentStep(5)}>← Back</button>
        ) : (
          <span />
        )}

        <div className="flex gap-3">
          {installProgress.status === 'error' && (
            <button
              className={primaryBtn}
              onClick={() => {
                setInstallProgress({ step: 0, status: 'idle', message: '', error: '', completed: [] })
                setTimeout(runInstall, 50)
              }}
            >
              Try Again
            </button>
          )}
          {installProgress.status === 'idle' && (
            <button className={primaryBtn} onClick={runInstall}>
              Install Now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InstallWizard() {
  // ── Wizard navigation ──────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<number>(1)

  // ── Step 1: silent platform detection ─────────────────────────────────────
  const [detectedPlatform, setDetectedPlatform] =
    useState<'php' | 'node' | 'none' | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await probeInstallHelper()
        setDetectedPlatform(result)
      } catch {
        setDetectedPlatform('none')
      }
    })()
  }, [])

  // ── Step 2: requirement checks ─────────────────────────────────────────────
  const [checks, setChecks] = useState<{
    internet: CheckStatus
    storage:  CheckStatus
    firebase: CheckStatus
  }>({ internet: 'idle', storage: 'idle', firebase: 'idle' })

  useEffect(() => {
    if (currentStep !== 2) return
    const alreadyOk =
      checks.internet === 'ok' &&
      checks.storage  === 'ok' &&
      checks.firebase === 'ok'
    if (alreadyOk) return
    runChecks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep])

  async function runChecks() {
    // Reset all to idle first
    setChecks({ internet: 'idle', storage: 'idle', firebase: 'idle' })

    // Check 1 — Internet
    setChecks(c => ({ ...c, internet: 'running' }))
    await new Promise(r => setTimeout(r, 300))
    const internetOk = navigator.onLine === true
    setChecks(c => ({ ...c, internet: internetOk ? 'ok' : 'fail' }))

    // Check 2 — Browser Storage
    setChecks(c => ({ ...c, storage: 'running' }))
    await new Promise(r => setTimeout(r, 300))
    let storageOk = false
    try {
      localStorage.setItem('_fruitopia_test', '1')
      localStorage.removeItem('_fruitopia_test')
      storageOk = true
    } catch {
      storageOk = false
    }
    setChecks(c => ({ ...c, storage: storageOk ? 'ok' : 'fail' }))

    // Check 3 — Firebase Reachable
    setChecks(c => ({ ...c, firebase: 'running' }))
    let firebaseOk = false
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        await fetch('https://firestore.googleapis.com', {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal,
        })
        firebaseOk = true
      } catch {
        firebaseOk = false
      } finally {
        clearTimeout(timer)
      }
    } catch {
      firebaseOk = false
    }
    setChecks(c => ({ ...c, firebase: firebaseOk ? 'ok' : 'fail' }))
  }

  const anyCheckFailed =
    checks.internet === 'fail' ||
    checks.storage  === 'fail' ||
    checks.firebase === 'fail'

  const allChecksOk =
    checks.internet === 'ok' &&
    checks.storage  === 'ok' &&
    checks.firebase === 'ok'

  // ── Step 3: Firebase credentials ──────────────────────────────────────────
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('reset') === '1') {
        localStorage.removeItem('fruitopia_installed')
        localStorage.removeItem('fruitopia_active_engine')
        localStorage.removeItem(DYNAMIC_FIREBASE_KEY)
      } else {
        const raw = localStorage.getItem(DYNAMIC_FIREBASE_KEY)
        if (raw && /your-|your-project|your-firebase-api-key/i.test(raw)) {
          localStorage.removeItem(DYNAMIC_FIREBASE_KEY)
          localStorage.removeItem('fruitopia_active_engine')
        }
      }
    } catch {}
  }, [])

  const [creds, setCreds] = useState<FirebaseRuntimeConfig>({
    apiKey:            '',
    authDomain:        '',
    projectId:         '',
    storageBucket:     '',
    messagingSenderId: '',
    appId:             '',
    databaseId:        '',
  })

  const [connTest, setConnTest] =
    useState<{ status: ConnStatus; message: string }>({
      status:  'idle',
      message: '',
    })

  function handleCredChange(field: keyof typeof creds) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setCreds(prev => ({ ...prev, [field]: e.target.value }))
      // Reset conn test result when user edits credentials
      if (connTest.status !== 'idle') {
        setConnTest({ status: 'idle', message: '' })
      }
    }
  }

  async function handleTestConnection() {
    setConnTest({ status: 'running', message: '' })
    try {
      await reinitializeDynamicFirebase(creds)
      // Test succeeded — undo the side effects so App.tsx doesn't detect
      // Firebase as configured and redirect away from the wizard.
      clearFirebaseConfig()
      setConnTest({ status: 'ok', message: '✅ Connected successfully!' })
    } catch (e: any) {
      setConnTest({
        status:  'fail',
        message: e?.message || String(e),
      })
    }
  }

  const testDisabled =
    !creds.apiKey.trim() ||
    !creds.authDomain.trim() ||
    !creds.projectId.trim() ||
    connTest.status === 'running'

  // ── Step 4: Admin account ──────────────────────────────────────────────────
  const [admin, setAdmin] = useState({ username: '', password: '', confirm: '' })
  const [showPwd,     setShowPwd]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [adminErrors, setAdminErrors] =
    useState<{ username?: string; password?: string; confirm?: string }>({})

  function handleAdminChange(field: keyof typeof admin) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setAdmin(prev => ({ ...prev, [field]: e.target.value }))
      // Clear the error for this field as soon as user types
      if (adminErrors[field]) {
        setAdminErrors(prev => { const n = { ...prev }; delete n[field]; return n })
      }
    }
  }

  function handleAdminNext() {
    const errs: typeof adminErrors = {}
    if (admin.username.trim().length < 3)
      errs.username = 'Username must be at least 3 characters'
    if (admin.password.length < 6)
      errs.password = 'Password must be at least 6 characters'
    if (admin.password !== admin.confirm)
      errs.confirm = 'Passwords do not match'
    setAdminErrors(errs)
    if (Object.keys(errs).length === 0) setCurrentStep(5)
  }

  // ── Step 5–7 store / progress state (used by Prompt 2) ────────────────────
  const [store, setStore] = useState({
    name:     'Fruitopia',
    email:    '',
    currency: 'USD',
    symbol:   '$',
  })

  const [storeNameError, setStoreNameError] = useState('')

  const [installProgress, setInstallProgress] = useState<InstallProgressState>({
    step: 0, status: 'idle', message: '', error: '', completed: [],
  })

  // ── Shared input style ─────────────────────────────────────────────────────
  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent ' +
    'placeholder-gray-400'

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-amber-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">

        {/* Step indicator */}
        <StepDots total={7} current={currentStep} />

        {/* ── STEP 1 — Welcome ─────────────────────────────────────────────── */}
        {currentStep === 1 && (
          <div className="flex flex-col items-center text-center gap-7">
            {/* Logo mark */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-widest text-emerald-500 uppercase">Store Setup</p>
              <h1 className="text-3xl font-bold text-gray-900">Welcome to Fruitopia</h1>
              <p className="text-gray-500 text-base leading-relaxed max-w-sm mx-auto">
                Let's get your store configured and ready for customers in about 2 minutes.
              </p>
            </div>

            <div className="w-full border-t border-gray-100 pt-5 flex flex-col gap-3 items-center">
              <button className={primaryBtn} onClick={() => setCurrentStep(2)}>
                Begin Setup →
              </button>
              <p className="text-xs text-gray-400">No coding required · Takes ~2 min</p>
            </div>
          </div>
        )}

        {/* ── STEP 2 — Requirements Check ──────────────────────────────────── */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Requirements Check</h2>
              <p className="text-gray-500 text-sm">Verifying your environment before we continue.</p>
            </div>

            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl px-4">
              <CheckRow
                status={checks.internet}
                okLabel="Internet connection active"
                failLabel="No internet connection. Please connect and retry."
              />
              <CheckRow
                status={checks.storage}
                okLabel="Browser storage available"
                failLabel="localStorage blocked. Check browser privacy settings."
              />
              <CheckRow
                status={checks.firebase}
                okLabel="Firebase servers reachable"
                failLabel="Cannot reach Firebase. Check internet or firewall."
              />
            </div>

            <div className="flex items-center justify-between">
              {/* Back is hidden on step 1 — shown from step 2 onward */}
              <button className={backBtn} onClick={() => setCurrentStep(1)}>
                ← Back
              </button>

              <div className="flex gap-3">
                {anyCheckFailed && (
                  <button
                    className="border border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-semibold px-5 py-3 rounded-lg transition-colors duration-150"
                    onClick={() => runChecks()}
                  >
                    Retry
                  </button>
                )}
                <button
                  className={primaryBtn}
                  disabled={!allChecksOk}
                  onClick={() => setCurrentStep(3)}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3 — Firebase Credentials ────────────────────────────────── */}
        {currentStep === 3 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Firebase Credentials</h2>
              <p className="text-gray-500 text-sm">
                Get these from Firebase Console → Project Settings → Your apps → SDK setup
              </p>
              <a
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-emerald-600 underline text-sm hover:text-emerald-700"
              >
                🔗 Open Firebase Console
              </a>
            </div>

            <div className="flex flex-col gap-3">
              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="AIzaSy..."
                  value={creds.apiKey}
                  onChange={handleCredChange('apiKey')}
                />
              </div>

              {/* Auth Domain */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Auth Domain <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project.firebaseapp.com"
                  value={creds.authDomain}
                  onChange={handleCredChange('authDomain')}
                />
              </div>

              {/* Project ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project-id"
                  value={creds.projectId}
                  onChange={handleCredChange('projectId')}
                />
              </div>

              {/* Storage Bucket */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Storage Bucket
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project.appspot.com"
                  value={creds.storageBucket}
                  onChange={handleCredChange('storageBucket')}
                />
              </div>

              {/* Messaging Sender ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Messaging Sender ID
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="123456789012"
                  value={creds.messagingSenderId}
                  onChange={handleCredChange('messagingSenderId')}
                />
              </div>

              {/* App ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  App ID
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="1:123456789012:web:abc123..."
                  value={creds.appId}
                  onChange={handleCredChange('appId')}
                />
              </div>

              {/* Database ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Database ID
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="(default)"
                  value={creds.databaseId}
                  onChange={handleCredChange('databaseId')}
                />
              </div>
            </div>

            {/* Test Connection button */}
            <button
              className={primaryBtn}
              disabled={testDisabled}
              onClick={handleTestConnection}
            >
              {connTest.status === 'running' ? (
                <span className="flex items-center gap-2 justify-center">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Testing…
                </span>
              ) : (
                'Test Connection →'
              )}
            </button>

            {/* Connection result banner */}
            {connTest.status === 'ok' && (
              <div className="bg-emerald-50 border border-emerald-500 text-emerald-700 p-3 rounded-lg text-sm">
                {connTest.message}
              </div>
            )}
            {connTest.status === 'fail' && (
              <div className="bg-rose-50 border border-rose-500 text-rose-700 p-3 rounded-lg text-sm break-words">
                {connTest.message}
              </div>
            )}

            {/* Nav row */}
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(2)}>
                ← Back
              </button>
              <button
                className={primaryBtn}
                disabled={connTest.status !== 'ok'}
                onClick={() => setCurrentStep(4)}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4 — Admin Account ────────────────────────────────────────── */}
        {currentStep === 4 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Admin Account</h2>
              <p className="text-gray-500 text-sm">Create your store administrator credentials.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Admin Username */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Username <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${adminErrors.username ? 'border-rose-400' : ''}`}
                  placeholder="admin"
                  value={admin.username}
                  onChange={handleAdminChange('username')}
                />
                {adminErrors.username && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.username}</p>
                )}
              </div>

              {/* Admin Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className={`${inputClass} pr-10 ${adminErrors.password ? 'border-rose-400' : ''}`}
                    placeholder="••••••••"
                    value={admin.password}
                    onChange={handleAdminChange('password')}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={() => setShowPwd(v => !v)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    {showPwd ? (
                      // Eye-off icon
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      // Eye icon
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {adminErrors.password && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.password}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className={`${inputClass} pr-10 ${adminErrors.confirm ? 'border-rose-400' : ''}`}
                    placeholder="••••••••"
                    value={admin.confirm}
                    onChange={handleAdminChange('confirm')}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={() => setShowConfirm(v => !v)}
                    aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirm ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {adminErrors.confirm && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.confirm}</p>
                )}
              </div>
            </div>

            {/* Nav row */}
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(3)}>
                ← Back
              </button>
              <button className={primaryBtn} onClick={handleAdminNext}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5 — Store Information ───────────────────────────────────── */}
        {currentStep === 5 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Store Information</h2>
              <p className="text-gray-500 text-sm">Tell us a bit about your store.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Store Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${storeNameError ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  placeholder="Fruitopia"
                  value={store.name}
                  onChange={e => {
                    setStore(prev => ({ ...prev, name: e.target.value }))
                    if (storeNameError) setStoreNameError('')
                  }}
                />
                {storeNameError && (
                  <p className="text-rose-500 text-sm mt-1">{storeNameError}</p>
                )}
              </div>

              {/* Contact Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Email
                </label>
                <input
                  type="email"
                  className={inputClass}
                  placeholder="hello@fruitopia.com"
                  value={store.email}
                  onChange={e => setStore(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Currency
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="USD"
                  value={store.currency}
                  onChange={e => setStore(prev => ({ ...prev, currency: e.target.value }))}
                />
              </div>

              {/* Currency Symbol */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Currency Symbol
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="$"
                  value={store.symbol}
                  onChange={e => setStore(prev => ({ ...prev, symbol: e.target.value }))}
                />
              </div>
            </div>

            <p className="text-gray-500 text-sm">These can be changed anytime in the Admin Panel.</p>

            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(4)}>
                ← Back
              </button>
              <button
                className={primaryBtn}
                onClick={() => {
                  if (!store.name.trim()) {
                    setStoreNameError('Store name is required.')
                    return
                  }
                  setStoreNameError('')
                  setCurrentStep(6)
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 6 — Installing ───────────────────────────────────────────── */}
        {currentStep === 6 && (
          <Step6Install
            installProgress={installProgress}
            setInstallProgress={setInstallProgress}
            setCurrentStep={setCurrentStep}
            creds={creds}
            detectedPlatform={detectedPlatform}
            admin={admin}
            store={store}
            backBtn={backBtn}
            primaryBtn={primaryBtn}
          />
        )}

        {/* ── STEP 7 — Success ─────────────────────────────────────────────── */}
        {currentStep === 7 && (
          <div className="flex flex-col items-center gap-6 text-center">
            {/* Green checkmark circle */}
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <span className="text-5xl select-none">✅</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-bold text-gray-900">Installation Complete!</h2>
              <p className="text-gray-600">Your Fruitopia store is ready.</p>
            </div>

            {/* Checklist */}
            <div className="w-full bg-gray-50 border border-gray-100 rounded-xl px-6 py-4 text-left space-y-2">
              {[
                'Firebase connected',
                'Configuration saved',
                'Admin authentication created',
                'Store data created',
                'Admin account created',
                'Settings saved',
                'Installation finalised',
              ].map((label, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span className="text-gray-600">{label}</span>
                </div>
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-3 w-full">
              <button
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
                onClick={() => { window.location.href = '/' }}
              >
                🏪 Go to Store →
              </button>
              <button
                className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
                onClick={() => { window.location.href = '/admin' }}
              >
                ⚙️ Go to Admin Panel →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
