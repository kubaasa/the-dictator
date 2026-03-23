import { app, net } from 'electron';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseNotes?: string;
}

const GITHUB_REPO = 'kubaasa/the-dictator';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class UpdateService {
  private lastCheck: UpdateInfo | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic update checks. First check runs after a short delay
   * to avoid slowing down app startup.
   */
  start(): void {
    // Initial check after 30s
    setTimeout(() => this.checkForUpdates(), 30_000);
    this.checkTimer = setInterval(() => this.checkForUpdates(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /** Return cached update info, or check now if never checked. */
  async getUpdateInfo(): Promise<UpdateInfo> {
    if (this.lastCheck) return this.lastCheck;
    return this.checkForUpdates();
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion();
    try {
      const data = await this.fetchLatestRelease();
      if (!data || !data.tag_name) {
        this.lastCheck = { available: false, currentVersion };
        return this.lastCheck;
      }

      const latestVersion = data.tag_name.replace(/^v/, '');
      const available = this.isNewer(latestVersion, currentVersion);

      this.lastCheck = {
        available,
        currentVersion,
        latestVersion,
        downloadUrl: data.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`,
        releaseNotes: data.body ?? undefined,
      };
      return this.lastCheck;
    } catch (err) {
      console.warn('[Dictator] Update check failed:', err instanceof Error ? err.message : err);
      this.lastCheck = { available: false, currentVersion };
      return this.lastCheck;
    }
  }

  private async fetchLatestRelease(): Promise<{ tag_name: string; html_url: string; body: string } | null> {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const response = await net.fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': `TheDictator/${app.getVersion()}`,
      },
    });

    if (response.status === 404) return null; // no releases yet
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);

    return response.json() as Promise<{ tag_name: string; html_url: string; body: string }>;
  }

  /** Simple semver comparison: returns true if latest > current */
  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
    const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
  }
}
