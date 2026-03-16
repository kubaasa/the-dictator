The Dictator — podsumowanie sesji
===================================

Co zrobiono
-----------

Faza 1 (szkielet + audio) — zainicjalizowano Electron Forge z Vite 6 + React 19 + Tailwind v4.
Stworzono pełną strukturę projektu: main process z tray i IPC, preload z contextBridge (window.dictator),
renderer z React UI (przycisk nagrywania + overlay + settings).
Audio recording działa przez Web Audio API → IPC → WAV w main process.

Faza 2 (hotkey) — zainstalowano uiohook-napi, dodano HOTKEY_TOGGLE do IPC,
podłączono globalny hotkey do toggle nagrywania w rendererze.
Vite main config ma external na uiohook-napi. HotkeyService zaimplementowany w main process.
Push-to-talk (hold mode) zaimplementowany.

UI został dopracowany: przycisk z animowanymi pierścieniami, drag region w headerze.

Faza 3 (transkrypcja offline) — przepisano na @xenova/transformers
(pure-JS ONNX runtime, brak CMake). TranscriptionService w main process ładuje pipeline z HuggingFace.
Model wybierany z listy: tiny / base / small / medium / large-v3. Pobierany automatycznie z progress-barem
(tylko pliki >20 MB liczone do postępu — unikanie fałszywych skoków). Możliwy cancel downloadu
przez AbortController z monkey-patchem global.fetch. Status modelu: downloaded / downloading / not downloaded.

Faza 4 (transkrypcja online) — zaimplementowano obsługę OpenAI Whisper API (whisper-1).
TranscriptionService ma metodę transcribeApi() korzystającą z oficjalnego openai SDK.
Klucz API przechowywany w electron-store, nigdy nie opuszcza lokalnej maszyny poza wywołaniem OpenAI.
Obsługa języka (auto lub konkretny język) dla obu silników.

Faza 5 (AI post-processing + tryby) — ZROBIONE.
AIService (src/main/services/ai.service.ts) z obsługą trzech providerów: OpenAI, Anthropic, Ollama.
5 trybów dyktowania: voice (czyszczenie transkryptu), email, chat, note, custom.
Każdy tryb ma edytowalny system prompt z opcją reset do domyślnego.
Zakładka Modes w UI: wybór trybu (pills), edytor promptu, test prompt panel.
Cycling trybu przez hotkey (Ctrl+Shift+M).

Faza 6 (auto-paste) — ZROBIONE w całości.
PasteService (src/main/services/paste.service.ts) implementuje pełny przepływ:
  1. captureTarget() — przy starcie nagrywania, przez PowerShell + Win32 GetForegroundWindow,
     pobiera HWND okna, które ma focus. Pomija własne okna Electrona i shell Windows.
  2. simulatePaste() — po zakończeniu transkrypcji: PowerShell SetForegroundWindow + ShowWindow(9) +
     SendKeys("^v") — przełącza focus na docelowe okno i wysyła Ctrl+V.
  Clipboard jest wypełniany tekstem przez Electron clipboard API przed wywołaniem simulatePaste().
  restoreClipboard zaimplementowany (AppSettings.dictation.restoreClipboard).

UI — przepisano layout na dwupanelowy: Sidebar + widok główny.
Sidebar z nawigacją Home / Modes / Shortcuts / Widget / History, z możliwością zwinięcia do ikon.

ModesPage:
  - toggle engine: Local (offline) / OpenAI API (w sekcji Transcription)
  - wybór języka: pills English / Polish
  - wybór rozmiaru modelu: karta grid z indicatorami pobierania i progress-barem
  - sekcja API key (Whisper + AI provider)
  - AI provider: pills None / OpenAI / Anthropic / Ollama
  - wybór modelu AI: karta grid z opisami
  - temperatura (slider)
  - edytor system promptu per tryb + test panel

ShortcutsPage (Faza 7 — częściowo):
  - toggle recording mode: Toggle / Push-to-Talk (pills)
  - per-shortcut editing z capture keyboardem (klik → oczekiwanie na kombę)
  - walidacja kolizji skrótów, reset do domyślnych
  - grayed-out nieaktywne skróty zależnie od wybranego trybu

WidgetPage (Faza 7 / 8 — częściowo):
  - wybór widgetu: Mini (VoiceBar) / Maxi (MaxiWidget)
  - slider rozmiaru (0–100%)
  - slider opacity (30–100%)

HistoryPage (Faza 9 — częściowo):
  - grupowanie wpisów po dacie (Today / Yesterday / Earlier this week / ...)
  - SQLite przez better-sqlite3, HistoryService

Overlay (widgety):
  - VoiceBar (Mini): animowana pill z pulsującymi barkami
  - MaxiWidget (Maxi): rolling waveform, tryb, przycisk cancel, czas nagrywania
  - OverlayWindow.tsx: osobne BrowserWindow (frameless, transparent, always-on-top)


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
      |                                     | brak pełnego UX verification (size/opacity scaling,
      |                                     | pozycja okna, obsługa błędów w overlay)
9     | Historia + zaawansowane             | W toku — HistoryPage z grupowaniem gotowa,
      |                                     | brak: wyszukiwania, filtrowania, eksportu
10    | Packaging (NSIS)                    | Do zrobienia


Znane problemy / TODO
---------------------

- SettingsPage.tsx jest w starym stylu (zinc colors, select dropdowns) — nie pasuje wizualnie
  do reszty aplikacji (neutral colors, pill selectors)
- autoStart (general.autoStart) w settings — nie wiadomo czy jest podpięty pod Electron's
  app.setLoginItemSettings()
- Overlay window size/opacity slider — czy faktycznie skaluje BrowserWindow? (do weryfikacji)
- HistoryPage: brak wyszukiwania po tekście i filtrowania po trybie
- Widget position persistence — x/y w AppSettings, ale czy drag jest poprawnie zapisywany?
- Sprite sheet hitman-head.png (overlay) — stary system animacji, nieużywany od refaktoru do VoiceBar/MaxiWidget
