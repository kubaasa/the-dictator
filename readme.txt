The Dictator — podsumowanie projektu
=====================================

Co zrobiono
-----------

Faza 1 (szkielet + audio) — zainicjalizowano Electron Forge z Vite 6 + React 19 + Tailwind v4.
Stworzono pełną strukturę projektu: main process z tray i IPC, preload z contextBridge (window.dictator),
renderer z React UI (przycisk nagrywania + overlay + settings).
Audio recording działa przez Web Audio API → IPC → WAV w main process.
Persistent AudioContext — AudioContext tworzony raz i reużywany, eliminuje latency przy starcie nagrywania.

Faza 2 (hotkey) — zainstalowano uiohook-napi, dodano HOTKEY_TOGGLE do IPC,
podłączono globalny hotkey do toggle nagrywania w rendererze.
Vite main config ma external na uiohook-napi. HotkeyService zaimplementowany w main process.
Push-to-talk (hold mode) zaimplementowany z safety timeout 65s.
Walidacja kolizji klawiszy. Domyślne skróty:
  - Toggle Recording: Ctrl+Tab
  - Cancel Recording: Escape
  - Push-to-Talk: Ctrl+X
  - Show Window: Ctrl+Shift+D

UI został dopracowany: przycisk z animowanymi pierścieniami, drag region w headerze.

Faza 3 (transkrypcja offline) — przepisano na @xenova/transformers
(pure-JS ONNX runtime, brak CMake). TranscriptionService w main process ładuje pipeline z HuggingFace.
Model wybierany z listy: tiny / base / small / medium / large-v3. Pobierany automatycznie z progress-barem
(tylko pliki >20 MB liczone do postępu — unikanie fałszywych skoków). Możliwy cancel downloadu
przez AbortController z monkey-patchem global.fetch. Status modelu: downloaded / downloading / not downloaded.
Max 8 transkrypcji przed resetem WASM heap (guard max_new_tokens).

Faza 4 (transkrypcja online) — zaimplementowano obsługę OpenAI Whisper API (whisper-1).
TranscriptionService ma metodę transcribeApi() korzystającą z oficjalnego openai SDK.
Klucz API przechowywany w electron-store, nigdy nie opuszcza lokalnej maszyny poza wywołaniem OpenAI.
Obsługa języka (auto lub konkretny język) dla obu silników.

Faza 5 (AI post-processing + tryby) — ZROBIONE.
AIService (src/main/services/ai.service.ts) z obsługą dwóch providerów: OpenAI, Anthropic.
Cached clients — re-create przy zmianie API key. Max 4096 tokenów dla Anthropic.
5 trybów dyktowania: voice (czyszczenie transkryptu), email, chat, note, custom.
Każdy tryb ma edytowalny system prompt z opcją reset do domyślnego.
Modele AI (domyślne — najtańsze/najszybsze):
  - OpenAI: gpt-4.1-nano / gpt-4.1-mini / gpt-4.1
  - Anthropic: claude-sonnet-4-6 / claude-haiku-4-5

Faza 6 (auto-paste) — ZROBIONE w całości.
PasteService (src/main/services/paste.service.ts) implementuje pełny przepływ:
  1. captureTarget() — przy starcie nagrywania, przez PowerShell + Win32 GetForegroundWindow,
     pobiera HWND okna, które ma focus. Pomija własne okna Electrona i shell Windows
     (Progman, Shell_TrayWnd, Desktop).
  2. simulatePaste() — po zakończeniu transkrypcji: PowerShell SetForegroundWindow + SendInput
     z flagą KEYEVENTF_UNICODE (0x0004) — wpisuje tekst znak po znaku jako WM_CHAR messages.
     Zastąpiono wcześniejszy Ctrl+V (SendKeys "^v") dla kompatybilności z TUI apps
     (terminale, vim, Claude Code itp.).
  Clipboard jest wypełniany tekstem przez Electron clipboard API.
  restoreClipboard zaimplementowany (AppSettings.dictation.restoreClipboard) — przywraca
  oryginalną zawartość schowka po wklejeniu.

UI — przepisano layout na dwupanelowy: Sidebar + widok główny.
Sidebar (collapsible do ikon) z nawigacją: Home / Processing / Shortcuts / Widget / History.

HomePage:
  - przycisk nagrywania z animowanymi pierścieniami i efektami (scanlines, noise, vignette)
  - statystyki z HistoryService: total words, total time, recordings count, avg WPM
  - timecode display (HH:MM:SS) w sidebarze

ModesPage (Processing):
  - pipeline status bar — wizualny przepływ: Recording → Transcription → AI → Paste
  - toggle engine: Local (offline) / OpenAI API (w sekcji Transcription)
  - wybór języka: pills English / Polish
  - wybór rozmiaru modelu: karta grid z indicatorami pobierania i progress-barem
  - sekcja API key (Whisper + AI provider)
  - AI provider: pills None / OpenAI / Anthropic (merged AI section)
  - wybór modelu AI: karta grid z opisami
  - temperatura (slider)
  - edytor system promptu per tryb + test panel

ShortcutsPage:
  - toggle recording mode: Toggle / Push-to-Talk (pills)
  - per-shortcut editing z capture keyboardem (klik → oczekiwanie na kombę)
  - 4 skróty: toggleRecording, cancelRecording, pushToTalk, showWindow
  - walidacja kolizji skrótów, PTT wymaga modifier+key, reset do domyślnych
  - grayed-out nieaktywne skróty zależnie od wybranego trybu

WidgetPage:
  - wybór widgetu: Mini (VoiceBar) / Maxi (MaxiWidget) z comparison table
  - tabela porównawcza: audio bars, form factor, hover expand, error display,
    processing state, drag support

HistoryPage:
  - grupowanie wpisów po dacie (Today / Yesterday / 2 days ago / ...)
  - SQLite przez better-sqlite3 (WAL mode), HistoryService
  - schema: RecordingEntry (id, date, text, wordCount, rawWordCount, durationSeconds,
    appName, audioPath, mode)
  - migracja schema (dodawanie rawWordCount do starych rekordów)
  - expand/collapse wpisów, usuwanie rekordów
  - odtwarzanie audio przez custom protocol recording://

Overlay (widgety):
  - VoiceBar (Mini): 6-bar pill waveform, attack/release smoothing LERP,
    init animation (3 waves), hover expand info, error state (red glow)
  - MaxiWidget (Maxi): 60-bar waveform (Hanning envelope — spindle shape),
    REC indicator, timecode, shortcut hints, processing state z glitch animation,
    cancel button, drag & drop (x/y w AppSettings)
  - OverlayWindow.tsx: osobne BrowserWindow (frameless, transparent, always-on-top),
    rozmiary: Mini 210x62, Maxi 520x170, clampToVisibleArea() do screen bounds
  - hidden gdy idle, widoczne tylko podczas nagrywania/processing


Status faz
----------

Faza  | Zakres                              | Status
------|-------------------------------------|-----------------------------
1     | Szkielet + audio recording          | Done
2     | Global hotkey + push-to-talk        | Done
3     | Transkrypcja offline (@xenova)      | Done
4     | Transkrypcja online (OpenAI API)    | Done
5     | AI post-processing + tryby          | Done
6     | Auto-paste (PasteService)           | Done
7     | Settings UI (pełny)                 | W toku — ShortcutsPage done, WidgetPage done,
      |                                     | SettingsPage (General) jest w starym stylu (zinc/select),
      |                                     | nie pasuje wizualnie do reszty aplikacji
8     | Overlay + UX polish                 | W toku — VoiceBar + MaxiWidget zrobione,
      |                                     | brak pełnego UX verification (pozycja okna,
      |                                     | obsługa błędów w overlay)
9     | Historia + zaawansowane             | W toku — HistoryPage z grupowaniem + delete + audio
      |                                     | playback gotowa, brak: wyszukiwania, filtrowania, eksportu
10    | Packaging (NSIS)                    | Do zrobienia


Znane problemy / TODO
---------------------

- SettingsPage.tsx jest w starym stylu (zinc colors, select dropdowns) — nie pasuje wizualnie
  do reszty aplikacji (neutral colors, pill selectors)
- autoStart (general.autoStart) w settings — nie wiadomo czy jest podpięty pod Electron's
  app.setLoginItemSettings()
- HistoryPage: brak wyszukiwania po tekście i filtrowania po trybie
- Widget position persistence — x/y w AppSettings, drag zaimplementowany w MaxiWidget,
  do weryfikacji czy pozycja jest poprawnie zapisywana/odczytywana
