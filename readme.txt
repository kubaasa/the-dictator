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

UI został dopracowany: przycisk z animowanymi pierścieniami, drag region w headerze.

Faza 3 (transkrypcja offline) — pierwotnie nodejs-whisper, następnie przepisano na @xenova/transformers
(pure-JS ONNX runtime, brak CMake). TranscriptionService w main process ładuje pipeline z HuggingFace.
Model wybierany z listy: tiny / base / small / medium / large-v3. Pobierany automatycznie z progress-barem
(tylko pliki >20 MB liczone do postępu — unikanie fałszywych skoków). Możliwy cancel downloadu
przez AbortController z monkey-patchem global.fetch. Status modelu: downloaded / downloading / not downloaded.
W dropdownie modeli widoczny jest indicator (checkmark = pobrany, chmurka = nie pobrany).

Faza 4 (transkrypcja online) — zaimplementowano obsługę OpenAI Whisper API (whisper-1).
TranscriptionService ma metodę transcribeApi() korzystającą z oficjalnego openai SDK.
Klucz API przechowywany w electron-store, nigdy nie opuszcza lokalnej maszyny poza wywołaniem OpenAI.
Obsługa języka (auto lub konkretny język) dla obu silników.

Faza 6 (auto-paste) — ZROBIONE w całości.
PasteService (src/main/services/paste.service.ts) implementuje pełny przepływ:
  1. captureTarget() — przy starcie nagrywania, przez PowerShell + Win32 GetForegroundWindow,
     pobiera HWND okna, które ma focus. Pomija własne okna Electrona i shell Windows (Progman, taskbar itp.).
  2. simulatePaste() — po zakończeniu transkrypcji: PowerShell SetForegroundWindow + ShowWindow(9) +
     SendKeys("^v") — przełącza focus na docelowe okno i wysyła Ctrl+V.
  Clipboard jest wypełniany tekstem przez Electron clipboard API przed wywołaniem simulatePaste().
  restoreClipboard nie jest jeszcze zrobiony (stary schowek jest nadpisywany).

UI — przepisano layout na dwupanelowy: Sidebar + widok główny.
Sidebar z nawigacją Home / Modes, z możliwością zwinięcia do ikon.
Strona Modes (refaktor w ostatniej sesji):
  - toggle engine: Local (offline) / OpenAI API
  - wybór języka: dropdown z 16 językami (auto-detect domyślny)
  - wybór rozmiaru modelu: custom dropdown z indicatorami pobierania
  - progress-bar pobierania, przycisk Cancel, przycisk "Open models folder"
  - sekcja API key (widoczna tylko przy engine=api): pole password + Save
Strona Home: nagrywanie, stan transkrypcji, textarea z wynikiem, przyciski Copy i Clear.

Selektor mikrofonu (MicrophoneSelector.tsx + useMicrophoneSelector hook):
  - enumeruje urządzenia audio przez navigator.mediaDevices
  - requestuje permission przy starcie (żeby labels były widoczne)
  - nasłuchuje zmian urządzeń (podłączenie/odłączenie)
  - wybrany deviceId jest przekazywany do useAudioRecorder

Overlay (refaktor + animacja sprite):
  - OverlayWindow.tsx uproszczony — logika animacji wydzielona
  - HitmanHead.tsx + SpriteAnimation.tsx — system animacji sprite-sheet
  - hitman.ts — konfiguracja postaci: idle(0), speaking([1,2]), transcribing(3), error(4)
  - sprite sheet: src/renderer/assets/sprites/hitman-head.png (128x128 per frame)
  - useVoiceActivity hook — wykrywa aktywność głosu z Web Audio API (AnalyserNode)
  - stan overlay: idle / speaking / transcribing / error


Status faz
----------

Faza  | Zakres                              | Status
------|-------------------------------------|-----------------------------
1     | Szkielet + audio recording          | Done
2     | Global hotkey + push-to-talk        | Done
3     | Transkrypcja offline (@xenova)      | Done
4     | Transkrypcja online (OpenAI API)    | Done (wymaga testu z prawdziwym kluczem API)
5     | AI post-processing + tryby          | Do zrobienia
6     | Auto-paste (PasteService)           | Done
7     | Settings UI (pełny)                 | W toku — Modes gotowe, brak ogólnych ustawień (hotkey, autoPaste toggle)
8     | Overlay + UX polish                 | W toku — sprite animation gotowa, brak dopracowania UX
9     | Historia + zaawansowane             | Do zrobienia
10    | Packaging (NSIS)                    | Do zrobienia


Następny krok
-------------

OPCJA A — Faza 5: AI post-processing + tryby dyktowania
  Przetwarzanie transkryptu przez LLM (np. Claude / GPT) przed wklejeniem.
  Tryby: notatki, e-mail, kod, itp. — każdy z własnym system promptem.
  Wymaga: IPC dla trybów, UI do wyboru trybu (prawdopodobnie w Modes lub Home), klucz API do LLM.

OPCJA B — Faza 7 (domknięcie Settings):
  - Toggle autoPaste w UI (aktualnie hardcoded w store defaults)
  - Możliwość zmiany globalnego hotkey z poziomu UI
  - Restoring clipboard po wklejeniu (PasteService.simulatePaste nie przywraca starego schowka)

OPCJA C — Testy e2e / manualne:
  - Przetestować transkrypcję API z prawdziwym kluczem OpenAI
  - Przetestować auto-paste w różnych aplikacjach (VSCode, Notepad, przeglądarka)
  - Przetestować selektor mikrofonu z zewnętrznym urządzeniem


Znane problemy / TODO
---------------------

- restoreClipboard nie zaimplementowany — po auto-paste schowek zostaje z tekstem transkrypcji
- Sprite sheet hitman-head.png wymaga sprawdzenia czy klatki są poprawnie ustawione (128x128 x5 klatek)
- ModesPage: toggle engine (local/api) jest w store, ale useAudioRecorder/TranscriptionService
  musi sprawdzać aktualny engine przy każdym nagraniu (upewnij się że flow jest spójny)
- Overlay window: nie wiadomo czy animacja playing jest podpięta pod realny VAD (sprawdź useVoiceActivity)
