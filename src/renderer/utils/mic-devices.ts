import { AUTO_MIC_DEVICE_ID } from '../../shared/constants';

export interface MicDevice {
  deviceId: string;
  label: string;
}

/** Chromium's virtual endpoints that follow the Windows default / communications roles. */
export const VIRTUAL_DEVICE_IDS = new Set(['default', 'communications']);

// Chromium labels its virtual endpoints "Default - <real label>" / "Communications - <real label>".
const VIRTUAL_LABEL_PREFIX = /^(default|communications)\s+-\s+/i;
// Chromium on Windows appends " (Bluetooth)" to output labels of Bluetooth endpoints.
const BLUETOOTH_SUFFIX = /\s*\(bluetooth\)\s*$/i;

export function listMics(all: MediaDeviceInfo[]): MicDevice[] {
  return all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** Content of the first balanced "(...)" group, e.g. "Realtek(R) Audio" from "Speaker (Realtek(R) Audio)". */
function firstParenGroup(text: string): string | null {
  const open = text.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/**
 * Reduces a Windows endpoint label to the name of the physical device, so the A2DP output
 * and the HFP input of one headset compare equal:
 *   "Default - Słuchawki (AirPods Pro - Find My) (Bluetooth)"      -> "airpods pro - find my"
 *   "Zestaw słuchawkowy (AirPods Pro (Kuba) - Find My Hands-Free)" -> "airpods pro - find my"
 *   "Speaker (Realtek(R) Audio)"                                    -> "realtek audio"
 */
export function deviceNameFromLabel(label: string): string {
  const stripped = label.replace(VIRTUAL_LABEL_PREFIX, '').replace(BLUETOOTH_SUFFIX, '').trim();
  const inner = firstParenGroup(stripped) ?? stripped;
  return inner
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\bhands-?free(\s+ag(\s+audio)?)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 0 = no match, 1 = one name is a prefix of the other (HFP labels sometimes keep a residue the
 * output label lacks), 2 = exact. Prefix matches rank by how little the names differ, so a
 * headset whose name is a prefix of another's ("airpods" / "airpods pro") can't steal its mic.
 */
function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (a.startsWith(b) || b.startsWith(a)) return 1 / (1 + Math.abs(a.length - b.length));
  return 0;
}

/**
 * Picks the mic of the Bluetooth headset the user listens through. Windows moves its default
 * *input* only when a new endpoint arrives, and a Bluetooth headset exposes output (A2DP) and
 * mic (HFP) as separate endpoints, so the headset picked as output in the volume flyout would
 * otherwise keep recording from the old mic. Wired outputs don't have that asymmetry, so for
 * them (and when no mic matches) this returns Chromium's 'default' = Windows default input.
 */
export function resolveAutoMic(all: MediaDeviceInfo[]): string {
  const outputs = all.filter((d) => d.kind === 'audiooutput');
  const defaultOutput = outputs.find((d) => d.deviceId === 'default') ?? outputs[0];
  if (!defaultOutput?.label || !BLUETOOTH_SUFFIX.test(defaultOutput.label)) return 'default';

  const outputName = deviceNameFromLabel(defaultOutput.label);
  let best: { deviceId: string; score: number } | null = null;
  for (const d of all) {
    if (d.kind !== 'audioinput' || VIRTUAL_DEVICE_IDS.has(d.deviceId)) continue;
    const score = nameMatchScore(deviceNameFromLabel(d.label), outputName);
    if (score > (best?.score ?? 0)) best = { deviceId: d.deviceId, score };
  }
  return best?.deviceId ?? 'default';
}

/**
 * Maps the saved preference to the device id handed to getUserMedia. Before the first
 * enumeration the list is empty; trust the preference then instead of guessing.
 */
export function resolveActiveMic(preference: string | null, all: MediaDeviceInfo[]): string {
  if (!preference || preference === AUTO_MIC_DEVICE_ID) return resolveAutoMic(all);
  if (all.length === 0) return preference;
  const present = all.some((d) => d.kind === 'audioinput' && d.deviceId === preference);
  return present ? preference : resolveAutoMic(all);
}
