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
Vite main config ma external na uiohook-napi.

UI został dopracowany: przycisk z animowanymi pierścieniami, drag region w headerze, widok main/settings.


Status faz
----------

Faza  | Zakres                              | Status
------|-------------------------------------|-----------------------------
1     | Szkielet + audio recording          | Done
2     | Global hotkey + push-to-talk        | W trakcie — hook podłączony, brakuje pełnego HotkeyService w main i HotkeyRecorder w UI
3     | Transkrypcja offline (whisper.cpp)   | Do zrobienia
4     | Transkrypcja online (OpenAI API)     | Do zrobienia
5     | AI post-processing + tryby           | Do zrobienia
6     | Auto-paste (nut-js)                  | Do zrobienia
7     | Settings UI (pełny)                  | Do zrobienia
8     | Overlay + UX polish                  | Do zrobienia
9     | Historia + zaawansowane              | Do zrobienia
10    | Packaging (NSIS)                     | Do zrobienia


Następny krok
-------------

Dokończyć Fazę 2 — napisać HotkeyService w main process (klasa opakowująca uiohook-napi
z konfiguracją skrótu, obsługą toggle i push-to-talk) oraz HotkeyRecorder w UI do zmiany skrótu.
