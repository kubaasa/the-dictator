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
Model wybierany z listy: tiny / base / small / medium. Pobierany automatycznie z progress-barem
(tylko pliki >20 MB liczone do postępu — unikanie fałszywych skoków). Możliwy cancel downloadu
przez AbortController z monkey-patchem global.fetch. Status modelu: downloaded / downloading / not downloaded.

Faza 4 (transkrypcja online) — zaimplementowano obsługę OpenAI Whisper API (whisper-1).
TranscriptionService ma metodę transcribeApi() korzystającą z oficjalnego openai SDK.
Klucz API przechowywany w electron-store, nigdy nie opuszcza lokalnej maszyny poza wywołaniem OpenAI.
Obsługa języka (auto lub konkretny język) dla obu silników.

UI — przepisano layout na dwupanelowy: Sidebar + widok główny.
Sidebar z nawigacją Home / Modes, z możliwością zwinięcia do ikon.
Strona Modes: toggle Local (offline) / OpenAI API, wybór rozmiaru modelu,
progress-bar pobierania, przycisk "Open models folder".
Strona Home: nagrywanie, stan transkrypcji, textarea z wynikiem, przyciski Copy i Clear.

Faza 6 (clipboard) — częściowo: po transkrypcji tekst jest automatycznie kopiowany do schowka
przez Electron clipboard API (ustawienie autoPaste w store). User wkleja ręcznie Ctrl+V.
Brak symulacji klawiatury (nut-js nie zainstalowany) — to pozostaje do zrobienia.


Status faz
----------

Faza  | Zakres                              | Status
------|-------------------------------------|-----------------------------
1     | Szkielet + audio recording          | Done
2     | Global hotkey + push-to-talk        | Done
3     | Transkrypcja offline (@xenova)      | Done
4     | Transkrypcja online (OpenAI API)    | Wykonane / Nie przetestowane
5     | AI post-processing + tryby          | Do zrobienia
6     | Auto-paste (nut-js)                 | W toku — clipboard gotowy, brak symulacji Ctrl+V
7     | Settings UI (pełny)                 | Do zrobienia
8     | Overlay + UX polish                 | Do zrobienia
9     | Historia + zaawansowane             | Do zrobienia
10    | Packaging (NSIS)                    | Do zrobienia



Następny krok
-------------

Faza 5 — AI post-processing + tryby dyktowania (np. tryb notatek, e-mail, kod).
Przetwarzanie transkryptu przez model językowy przed wklejeniem do schowka.
