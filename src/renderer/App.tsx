import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import * as Sentry from '@sentry/electron/renderer';
import log from 'electron-log/renderer';
import { OverlayWindow } from './components/OverlayWindow';
import { Sidebar } from './components/Sidebar';
import type { View as ActiveView } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { HistoryPage } from './components/HistoryPage';
import { ModesPage } from './components/ModesPage';
import { ShortcutsPage } from './components/ShortcutsPage';
import { VocabularyPage } from './components/VocabularyPage';
import { WidgetPage } from './components/WidgetPage';
import { MicrophoneSelector } from './components/MicrophoneSelector';
import { ScanLines, NoiseOverlay, Vignette, RecIndicator } from './components/RecEffects';
import { ToastProvider } from './components/Toast';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ForceUpdateModal } from './components/ForceUpdateModal';
import { UpToDatePopup } from './components/UpToDatePopup';
import { useRecordingState } from './hooks/useRecordingState';
import { useModelStatus } from './hooks/useModelStatus';
import { useMicrophoneSelector } from './hooks/useMicrophoneSelector';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useSoundFeedback } from './hooks/useSoundFeedback';
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    log.error('React ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace', background: '#0A0A0A', height: '100vh' }}>
          <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
          <pre style={{ fontSize: 12, color: '#a3a3a3', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', border: '1px solid #525252', borderRadius: 8, color: '#d4d4d4', background: '#1a1a1a', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const isOverlay = window.location.hash === '#overlay';
  const recordingState = useRecordingState();
  useSoundFeedback(recordingState, isOverlay);
  const modelStatus = useModelStatus();
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const micSelector = useMicrophoneSelector();
  const audioRecorder = useAudioRecorder(micSelector.selectedDeviceId);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [updateState, setUpdateState] = useState<import('../shared/types').UpdateState | null>(null);
  const [upToDateVersion, setUpToDateVersion] = useState<string | null>(null);

  useEffect(() => {
    window.dictator.update.getInfo().then((state) => {
      if (state.status === 'downloaded') setUpdateState(state);
    }).catch((err) => log.warn('Failed to get update info:', err));

    return window.dictator.update.onStatusChange((state) => {
      if (state.status === 'up-to-date') {
        setUpToDateVersion(state.currentVersion);
      } else {
        setUpdateState(state.status === 'downloaded' ? state : null);
      }
    });
  }, []);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (!s.general?.firstRunComplete) {
        setIsFirstRun(true);
        setShowFirstRun(true);
      }
    }).catch((err) => log.error('Failed to load initial settings:', err));
  }, []);

  if (isOverlay) {
    return <ErrorBoundary><OverlayWindow state={recordingState} /></ErrorBoundary>;
  }

  return (
    <ErrorBoundary>
    <ToastProvider>
    <div className="flex h-screen text-neutral-200 select-none font-sans bg-[#0A0A0A]">
      <ScanLines />
      <NoiseOverlay />
      <Vignette />

      <Sidebar activeView={activeView} onNavigate={setActiveView} onSetupGuide={() => setShowFirstRun(true)} />

      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <header className="drag-region flex items-center px-5 py-3 border-b border-neutral-800/50">
          {activeView !== 'home' && <RecIndicator compact isRecording={audioRecorder.isRecording} recordingStartTime={audioRecorder.recordingStartTime} />}
          <div className="ml-auto flex items-center gap-3">
            <MicrophoneSelector {...micSelector} />
            <div className="no-drag flex items-center gap-1">
              <button
                onClick={() => window.dictator.minimize()}
                className="flex h-7 w-7 items-center justify-center rounded font-mono text-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                title="Minimize"
                aria-label="Minimize window"
              >
                &#8211;
              </button>
              <button
                onClick={() => window.dictator.closeWindow()}
                className="flex h-7 w-7 items-center justify-center rounded font-mono text-sm text-neutral-500 transition-colors hover:bg-red-900/60 hover:text-red-300"
                title="Close"
                aria-label="Close window"
              >
                &#x2715;
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {activeView === 'home' && <HomePage recordingState={recordingState} audioRecorder={audioRecorder} onNavigate={setActiveView} />}
          {activeView === 'history' && <HistoryPage />}
          {activeView === 'modes' && <ModesPage {...modelStatus} />}
          {activeView === 'vocabulary' && <VocabularyPage />}
          {activeView === 'shortcuts' && <ShortcutsPage />}
          {activeView === 'widget' && <WidgetPage />}
        </div>
      </div>
      {showFirstRun && <OnboardingWizard onComplete={(micId) => { if (micId) micSelector.setSelectedDeviceId(micId); setShowFirstRun(false); setActiveView('modes'); modelStatus.recheck(); }} onClose={isFirstRun ? undefined : () => setShowFirstRun(false)} />}
      {updateState && <ForceUpdateModal updateState={updateState} />}
      {upToDateVersion && <UpToDatePopup version={upToDateVersion} onClose={() => setUpToDateVersion(null)} />}
    </div>
    </ToastProvider>
    </ErrorBoundary>
  );
}
