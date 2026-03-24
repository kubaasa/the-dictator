# Plan optymalizacji The Dictator — szybkość transkrypcji i jakość audio

## Context

Aktualny pipeline od zatrzymania nagrania do wklejenia tekstu trwa **6-15s** (local) / **3-15s** (API). Główne bottlenecki:
1. **Transkrypcja lokalna** — WASM ONNX bez GPU, model `base` ~5-10s na 60s audio
2. **Upload API** — nieskompresowany WAV (60s = 1.92MB) zamiast Opus (~240KB)
3. **AI post-processing** — sekwencyjny po transkrypcji, brak streamingu, ciężki prompt (~1800 tokenów)
4. **Auto-paste** — cold-start PowerShell na każde wklejenie (~200-400ms)
5. **Brak preprocessing audio** — cisza na krawędziach, brak normalizacji, szum marnują czas inference

Cel: **maksymalne skrócenie latencji** na wszystkich modelach, z jednoczesną poprawą jakości audio dla lepszej dokładności.

---

## Sprint 1: Quick Wins (niski effort, wysoki impact)

### 1.1 Dodaj modele Distil-Whisper do MODEL_MAP
**Plik:** `src/main/services/transcription.service.ts` (linia 8-17)

- Dodaj `distil-large-v3` → `distil-whisper/distil-large-v3` (2x szybszy niż large-v3, minimalna strata jakości)
- Dodaj `distil-medium.en` → `distil-whisper/distil-medium.en`
- Zaktualizuj `MODEL_SIZE_PRIORITY` (linia 84-86) i opisy modeli w `src/shared/constants.ts`
- **Zysk:** ~40-50% szybsza transkrypcja lokalna przy porównywalnej jakości
- **Effort:** ~30 minut

### 1.2 Silence trimming — usunięcie ciszy z krawędzi audio
**Plik:** `src/main/services/transcription.service.ts` — nowa funkcja `trimSilence()`

Dodać przed transkrypcją (zarówno local jak i API):
```
function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  // Skanuj od początku i końca, znajdź pierwszy frame > RMS threshold (0.015)
  // Zachowaj margines bezpieczeństwa 200ms (3200 samples @ 16kHz)
}
```
Wywołać w `transcribeFromBuffer()` przed `transcribeLocalFromBuffer` / `transcribeApiFromBuffer`.
- **Zysk:** 0.5-2s mniej inference (typowe nagranie ma 2-5s ciszy), mniejszy plik API upload
- **Effort:** ~2h

### 1.3 Peak normalization audio
**Plik:** `src/main/services/transcription.service.ts` — nowa funkcja `normalizeAudio()`

```
function normalizeAudio(samples: Float32Array): Float32Array {
  // Znajdź peak amplitude, przeskaluj do 0.9
  // Koszt: ~0ms (single pass over Float32)
}
```
Wywołać po trimSilence, przed transkrypcją. Zapewnia konsystentny poziom sygnału niezależnie od mikrofonu.
- **Zysk:** 5-15% lepsza dokładność transkrypcji (szczególnie przy cichym mikrofonie)
- **Effort:** ~1h

### 1.4 Kompresja audio do Opus/WebM przed wysyłką do API
**Pliki:**
- `src/renderer/hooks/useAudioRecorder.ts` — oprócz `merged.buffer` (Float32) wyślij też `mediaChunksRef` blob (WebM/Opus)
- `src/preload/preload.ts` — dodaj nowy parametr w `transcribeBuffer`
- `src/main/ipc-handlers.ts` — przekaż compressed blob do API path
- `src/main/services/transcription.service.ts` — nowa metoda `transcribeApiFromCompressed()`

Renderer już zbiera WebM/Opus via MediaRecorder. Zamiast re-enkodować do WAV, wyślij gotowy blob do OpenAI API (akceptuje webm).
- **Zysk:** 8x mniejszy upload (1.92MB → ~240KB), 50-80% szybszy upload
- **Effort:** ~4h

### 1.5 Skrócenie AI system prompt
**Plik:** `src/shared/types.ts` (linia 108-149)

Skondensować 42-liniowy prompt do ~15 linii zachowując te same reguły. Mniej tokenów input = szybszy response.
- **Zysk:** 100-300ms na AI post-processing
- **Effort:** ~2h

---

## Sprint 2: Optymalizacje połączeń (średni effort)

### 2.1 AI connection warmup podczas transkrypcji
**Plik:** `src/main/services/ai.service.ts` — nowa metoda `warmup()`
**Plik:** `src/main/ipc-handlers.ts` (linia 178) — wywołaj `aiService.warmup()` równolegle z `broadcastState('transcribing')`

Gdy transkrypcja się zaczyna, nawiąż połączenie TCP+TLS z providerem AI (OpenAI/Anthropic). Kiedy transkrypcja się skończy, połączenie już czeka.
- **Zysk:** 100-200ms (TCP + TLS handshake)
- **Effort:** ~4h

### 2.2 Streaming AI responses
**Plik:** `src/main/services/ai.service.ts` — zmień `client.chat.completions.create()` na `stream: true`

Zbieraj chunki, połącz, zwróć kompletny tekst. TTFT (time to first token) jest szybszy niż czekanie na pełną odpowiedź JSON.
- **Zysk:** 200-500ms na AI post-processing
- **Effort:** ~8h (OpenAI + Anthropic)

### 2.3 Groq API jako opcja transkrypcji
**Pliki:**
- `src/shared/types.ts` — rozszerz `TranscriptionEngine` o `'groq'`
- `src/shared/types.ts` — dodaj `transcription.groqApiKey` do `AppSettings`
- `src/main/services/transcription.service.ts` — nowa metoda `transcribeGroqFromBuffer()`

Groq oferuje Whisper na dedykowanym hardware: 60s audio w <1s. Kompatybilne API (OpenAI SDK shape).
- **Zysk:** Potencjalnie najszybsza transkrypcja API — <1s na 60s audio
- **Effort:** ~4h

### 2.4 Pre-warm PowerShell process
**Plik:** `src/main/services/paste.service.ts`

Zamiast cold-startować PowerShell na każde wklejenie, utrzymuj persistent process z Add-Type już skompilowanym. Wysyłaj komendy paste przez stdin.
- **Zysk:** 200-300ms na każde wklejenie
- **Effort:** ~4h

---

## Sprint 3: GPU-accelerated local transcription (wysoki effort, najwyższy impact)

### 3.1 ONNX Runtime z DirectML (zamiast WASM)
**Pliki:**
- `package.json` — dodaj `onnxruntime-node`
- `vite.main.config.ts` — dodaj `onnxruntime-node` do externals
- `forge.config.ts` — dodaj do rebuildConfig jeśli natywny
- `src/main/services/transcription.service.ts` — zmień execution provider na DirectML

DirectML to Microsoft's GPU abstraction (NVIDIA + AMD + Intel GPU). Nie wymaga CUDA. Działa na każdym Windows GPU.

**Alternatywa (wyższy effort, wyższy zysk):** Whisper.cpp jako native N-API addon z CUDA/Vulkan. Ale DirectML jest prostszy i pokrywa 90% zysku.

- **Zysk:** 3-10x szybsza transkrypcja lokalna (60s audio: 1-3s zamiast 5-10s)
- **Effort:** ~1-2 tygodnie
- **Ryzyko:** Wymaga testowania na różnych GPU, fallback do WASM jeśli brak GPU

### 3.2 (Opcjonalnie) WebGPU execution provider
Electron 40 wspiera WebGPU. ONNX Runtime ma eksperymentalne wsparcie. Lżejsza alternatywa dla DirectML — bez natywnych addonów.
- **Zysk:** 3-5x vs WASM
- **Effort:** ~1 tydzień
- **Ryzyko:** Eksperymentalne API, nie wszystkie GPU

---

## Sprint 4: Streaming pipeline (najwyższy effort)

### 4.1 Real-time chunked transcription (transkrypcja podczas nagrywania)
**Pliki:**
- `src/renderer/hooks/useAudioRecorder.ts` — wysyłaj chunki audio co 3-5s przez IPC
- `src/main/ipc-handlers.ts` — nowy handler dla streaming chunks
- `src/main/services/transcription.service.ts` — incremental transcription

Co 3-5s wysyłaj dotychczas zebrane audio do Whisper. Wyświetlaj progresywne wyniki w overlay. Po zatrzymaniu — ostatni pass na kompletnym audio.
- **Zysk:** Perceived latency spada do ~0-2s (tekst pojawia się jeszcze podczas mówienia)
- **Effort:** ~2 tygodnie
- **Ryzyko:** Wyższe zużycie CPU/GPU, interim results mogą się różnić od finalnych

### 4.2 Native Win32 paste addon
**Plik:** nowy `native/win32-paste/` — ~100 linii C, N-API wrapper na SendInput

Eliminuje PowerShell entirely. Paste w ~5ms zamiast 200-400ms.
- **Zysk:** 200-400ms
- **Effort:** ~1 tydzień (jeśli build system natywny już skonfigurowany z 3.1)

---

## Analiza konkurencji

| App | Technologia | GPU | Streaming | Latencja |
|-----|------------|-----|-----------|----------|
| **SuperWhisper** (macOS) | whisper.cpp + CoreML/Metal | Tak (Apple Silicon) | Tak | ~1-2s |
| **Wispr Flow** (macOS/Win) | Cloud (proprietary) + whisper.cpp offline | Tak | Tak | <1s (claimed) |
| **MacWhisper** | whisper.cpp + CoreML + INT8/INT4 quantization | Tak | Nie | ~2-3s |
| **Whispering** (open source) | @xenova/transformers (WASM) | Nie | Nie | ~5-15s |
| **The Dictator** (teraz) | @xenova/transformers (WASM) | Nie | Nie | ~6-15s |

**Kluczowy wniosek:** Wszyscy poważni konkurenci używają whisper.cpp z GPU. WASM jest OK na prototyp, ale nie może konkurować na szybkość. DirectML/CUDA to **game-changer**.

---

## Szacowane latencje po optymalizacjach

| Scenariusz | Teraz | Po Sprint 1 | Po Sprint 2 | Po Sprint 3 |
|---|---|---|---|---|
| Local (base, 10s audio) | 3-5s | 2-4s | 2-3s | **0.5-1.5s** (GPU) |
| Local (base, 60s audio) | 5-10s | 4-8s | 3-6s | **1-3s** (GPU) |
| API OpenAI (10s audio) | 2-5s | 1-3s | 1-2s | 1-2s |
| API Groq (10s audio) | — | — | **<1s** | <1s |
| AI post-processing | 0.5-3s | 0.3-2s | **0.2-1s** | 0.2-1s |
| Auto-paste | 200-400ms | 200-400ms | **50-100ms** | **5-10ms** |
| **Total stop→paste** | **6-15s** | **4-10s** | **2-6s** | **<3s** |

---

## Verification

Po każdym sprincie:
1. **Benchmark:** Zmierz czas od `broadcastState('transcribing')` do `broadcastState('done')` na 10s i 60s próbkach audio
2. **A/B test jakości:** Przetestuj te same nagrania (cichy mikrofon, głośne tło, normalny) przed i po normalizacji/trimming
3. **Regression test:** Upewnij się że pipeline nie produkuje nowych halucynacji (szczególnie po trimSilence)
4. `npm start` + manualne testy nagrywania na różnych aplikacjach docelowych (terminal, przeglądarka, Word)
5. **Logowanie latencji:** Dodaj `console.time`/`console.timeEnd` do każdego kroku pipeline'u w `ipc-handlers.ts`

## Kluczowe pliki do modyfikacji

| Plik | Zmiany |
|------|--------|
| `src/main/services/transcription.service.ts` | Distil-Whisper, silence trimming, normalizacja, Opus upload, Groq, DirectML |
| `src/main/ipc-handlers.ts` | AI warmup równoległy, compressed audio path, latency logging |
| `src/main/services/ai.service.ts` | Streaming responses, connection warmup, prompt condensation |
| `src/renderer/hooks/useAudioRecorder.ts` | Wysyłka WebM blob obok Float32 |
| `src/main/services/paste.service.ts` | Persistent PowerShell / native addon |
| `src/shared/types.ts` | Nowe settings (groqApiKey, itp.), DEFAULT_SETTINGS |
| `src/shared/constants.ts` | Opisy modeli Distil-Whisper, nowe IPC channels |
| `src/preload/preload.ts` | Nowy parametr w transcribeBuffer (compressed blob) |
