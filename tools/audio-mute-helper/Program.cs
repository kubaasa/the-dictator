using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace TheDictator.AudioMuteHelper;

/// <summary>
/// NDJSON helper for The Dictator: enumerates Windows audio sessions via WASAPI (NAudio),
/// mutes everything except the excluded PIDs while the parent app is recording, then
/// restores prior state on stop / EOF / restore command.
/// </summary>
public static class Program
{
    private const int DescendantsCacheTtlMs = 200;
    private const int ProcessNameCacheTtlMs = 2000;

    private static readonly object _lock = new();
    private static readonly object _stdoutLock = new();
    private static bool _muting;
    private static HashSet<int> _excludePids = new();
    private static int _excludeRootPid;
    private static List<MutedRef> _muted = new();
    private static Dictionary<string, MutedRef> _mutedBySid = new();
    private static Dictionary<int, MutedRef> _mutedByPid = new();
    private static CancellationTokenSource? _pollCts;
    private static MMDeviceEnumerator? _scanEnumerator;
    private static MMDeviceEnumerator? _notifEnumerator;
    private static DeviceNotificationClient? _notifClient;
    private static HashSet<string> _duckOptedSessions = new();
    private static HashSet<int> _cachedDescendants = new();
    private static long _cachedDescendantsAt;
    private static readonly Dictionary<int, (string Name, long At)> _processNameCache = new();

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static int Main(string[] _)
    {
        Emit(new { @event = "ready" });

        try
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
            {
                try
                {
                    HandleLine(line);
                }
                catch (Exception ex)
                {
                    SafeEmit(new { @event = "error", message = "handle: " + ex.Message });
                }
            }
        }
        catch (Exception ex)
        {
            SafeEmit(new { @event = "error", message = "fatal: " + ex.Message });
        }
        finally
        {
            try { StopMutingInternal(); } catch { /* best-effort */ }
        }
        return 0;
    }

    private static void HandleLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        if (!root.TryGetProperty("cmd", out var cmdEl)) return;
        var cmd = cmdEl.GetString();

        switch (cmd)
        {
            case "ping":
                Emit(new { @event = "pong" });
                break;

            case "start":
                var excludes = new HashSet<int>();
                if (root.TryGetProperty("excludePids", out var ep) && ep.ValueKind == JsonValueKind.Array)
                {
                    foreach (var x in ep.EnumerateArray()) excludes.Add(x.GetInt32());
                }
                int rootPid = 0;
                if (root.TryGetProperty("excludeRootPid", out var rp) && rp.ValueKind == JsonValueKind.Number)
                {
                    rootPid = rp.GetInt32();
                }
                StartMuting(excludes, rootPid);
                break;

            case "stop":
                StopMutingInternal();
                Emit(new { @event = "stopped" });
                break;

            case "restore":
                var items = new List<SnapshotItem>();
                if (root.TryGetProperty("sessions", out var ss) && ss.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in ss.EnumerateArray())
                    {
                        items.Add(new SnapshotItem(
                            Pid: s.GetProperty("pid").GetInt32(),
                            Name: s.TryGetProperty("name", out var nm) ? (nm.GetString() ?? "") : "",
                            Volume: s.TryGetProperty("volume", out var vl) ? (float)vl.GetDouble() : 0f,
                            Muted: s.TryGetProperty("muted", out var mu) && mu.GetBoolean()
                        ));
                    }
                }
                RestoreFromSnapshot(items);
                Emit(new { @event = "restored" });
                break;

            default:
                Emit(new { @event = "error", message = "unknown cmd: " + (cmd ?? "<null>") });
                break;
        }
    }

    private static void StartMuting(HashSet<int> excludePids, int rootPid)
    {
        lock (_lock)
        {
            if (_muting)
            {
                Emit(new { @event = "error", message = "already muting" });
                return;
            }
            _muting = true;
            _excludePids = excludePids;
            _excludeRootPid = rootPid;
            _muted = new List<MutedRef>();
            _mutedBySid = new Dictionary<string, MutedRef>();
            _mutedByPid = new Dictionary<int, MutedRef>();
            _duckOptedSessions = new HashSet<string>();
            _cachedDescendants = new HashSet<int>();
            _cachedDescendantsAt = 0;
            _processNameCache.Clear();
            _scanEnumerator ??= new MMDeviceEnumerator();
        }

        var (initial, reMuted) = ScanAndMute();
        Emit(new
        {
            @event = "snapshot",
            sessions = initial.Select(SessionPayload).ToArray(),
        });
        foreach (var r in reMuted) Emit(new { @event = "reMuted", session = SessionPayload(r) });

        // Subscribe to Windows audio endpoint events. Critical for Bluetooth headsets:
        // when the user activates the mic, Windows switches the device from A2DP (output)
        // to HFP (bidirectional) profile, which causes a NEW MMDevice endpoint to appear.
        // Polling every 25ms would catch this with up to 25ms latency, but the notification
        // fires within ~5ms — closing the window during which audio plays unmuted on the
        // new endpoint.
        try
        {
            _notifEnumerator = new MMDeviceEnumerator();
            _notifClient = new DeviceNotificationClient(reason => OnDeviceEvent(reason));
            _notifEnumerator.RegisterEndpointNotificationCallback(_notifClient);
        }
        catch (Exception ex)
        {
            SafeEmit(new { @event = "error", message = "notif register: " + ex.Message });
        }

        _pollCts = new CancellationTokenSource();
        var token = _pollCts.Token;
        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                // 25ms safety-net polling. Real-time response comes from
                // IMMNotificationClient callbacks (OnDeviceEvent), this is just a fallback.
                try { await Task.Delay(25, token); } catch { break; }
                if (token.IsCancellationRequested) break;
                try
                {
                    var (newOnes, reMutedOnes) = ScanAndMute();
                    foreach (var s in newOnes)
                    {
                        Emit(new { @event = "sessionAdded", session = SessionPayload(s) });
                    }
                    foreach (var r in reMutedOnes)
                    {
                        Emit(new { @event = "reMuted", session = SessionPayload(r) });
                    }
                }
                catch (Exception ex)
                {
                    SafeEmit(new { @event = "error", message = "poll: " + ex.Message });
                }
            }
        }, token);
    }

    /// <summary>
    /// Fired by the Windows audio service whenever an audio endpoint state changes
    /// (device added/removed, default device changed, state Active→Inactive, etc.).
    /// We immediately re-scan and mute any sessions on newly visible devices.
    /// </summary>
    private static void OnDeviceEvent(string reason)
    {
        if (!_muting) return;
        try
        {
            var (newOnes, reMutedOnes) = ScanAndMute();
            if (newOnes.Count > 0 || reMutedOnes.Count > 0)
            {
                Emit(new { @event = "deviceEvent", reason });
            }
            foreach (var s in newOnes)
            {
                Emit(new { @event = "sessionAdded", session = SessionPayload(s) });
            }
            foreach (var r in reMutedOnes)
            {
                Emit(new { @event = "reMuted", session = SessionPayload(r) });
            }
        }
        catch (Exception ex)
        {
            SafeEmit(new { @event = "error", message = "notif handler: " + ex.Message });
        }
    }

    /// <summary>
    /// Enumerates every active audio session. New ones (matching neither sessionId nor PID)
    /// get muted and recorded. Existing ones we previously muted that someone else has flipped
    /// back to Mute=false get re-muted (apps occasionally auto-unmute themselves, e.g. when a
    /// new mic stream activates). Returns (newly-muted, re-muted) tuples for caller logging.
    /// </summary>
    private static (List<MutedRef> added, List<MutedRef> reMuted) ScanAndMute()
    {
        var added = new List<MutedRef>();
        var reMuted = new List<MutedRef>();
        var liveExcludes = GetLiveExcludes();

        try
        {
            var enumerator = _scanEnumerator ?? (_scanEnumerator = new MMDeviceEnumerator());
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            for (int d = 0; d < devices.Count; d++)
            {
                MMDevice? device = null;
                try { device = devices[d]; } catch { continue; }
                if (device == null) continue;
                try
                {
                    var sessions = device.AudioSessionManager?.Sessions;
                    if (sessions == null) continue;
                    for (int i = 0; i < sessions.Count; i++)
                    {
                        AudioSessionControl? session;
                        try { session = sessions[i]; } catch { continue; }
                        if (session == null) continue;
                        ProcessSession(session, liveExcludes, added, reMuted);
                        if (!_muting) return (added, reMuted);
                    }
                }
                catch { /* device manager error */ }
            }
        }
        catch (Exception ex)
        {
            SafeEmit(new { @event = "error", message = "enum: " + ex.Message });
        }
        return (added, reMuted);
    }

    private static void ProcessSession(
        AudioSessionControl session, HashSet<int> liveExcludes,
        List<MutedRef> added, List<MutedRef> reMuted)
    {
        try
        {
            var pid = (int)session.GetProcessID;
            if (pid == 0) return; // system sounds session — leave alone
            if (liveExcludes.Contains(pid))
            {
                // Our own descendant — opt out of Windows Communications Ducking so the
                // audio cue stays at full volume while the mic is active.
                TryOptOutOfDucking(session);
                return;
            }
            var sid = SafeSessionId(session);
            lock (_lock)
            {
                if (!_muting) return;

                MutedRef? existing = null;
                if (sid.Length > 0) _mutedBySid.TryGetValue(sid, out existing);
                if (existing == null && sid.Length == 0) _mutedByPid.TryGetValue(pid, out existing);

                var sv = session.SimpleAudioVolume;

                if (existing != null)
                {
                    // Re-mute defense — apps occasionally auto-unmute themselves on audio
                    // engine reset (mic activation, device change, etc.). Volume=0 is the
                    // belt-and-suspenders catch for exclusive-mode bypass and apps that
                    // ignore SetMute.
                    var wasUnmuted = !sv.Mute;
                    var hadVolume = sv.Volume > 0.0001f;
                    if (wasUnmuted) sv.Mute = true;
                    if (hadVolume) sv.Volume = 0f;
                    if (wasUnmuted || hadVolume) reMuted.Add(existing);
                    return;
                }

                var prevMuted = sv.Mute;
                var prevVol = sv.Volume;
                if (!prevMuted) sv.Mute = true;
                sv.Volume = 0f;
                var entry = new MutedRef
                {
                    Pid = pid,
                    Name = SafeProcessName(pid),
                    SessionId = sid,
                    PrevVolume = prevVol,
                    PrevMuted = prevMuted,
                    Control = session,
                };
                _muted.Add(entry);
                if (sid.Length > 0) _mutedBySid[sid] = entry;
                else _mutedByPid[pid] = entry;
                added.Add(entry);
            }
        }
        catch { /* session died mid-enumeration */ }
    }

    private static HashSet<int> GetLiveExcludes()
    {
        var result = new HashSet<int>(_excludePids);
        if (_excludeRootPid <= 0) return result;
        var now = Environment.TickCount64;
        if (now - _cachedDescendantsAt > DescendantsCacheTtlMs)
        {
            // Audio service utility / GPU processes are spawned lazily by Electron — refresh
            // descendants periodically so newly-spawned children get excluded promptly.
            _cachedDescendants = GetDescendantPids(_excludeRootPid);
            _cachedDescendantsAt = now;
        }
        foreach (var pid in _cachedDescendants) result.Add(pid);
        return result;
    }

    private static void StopMutingInternal()
    {
        CancellationTokenSource? cts;
        List<MutedRef> snapshot;
        MMDeviceEnumerator? notifEnum;
        DeviceNotificationClient? notifClient;
        lock (_lock)
        {
            if (!_muting) return;
            _muting = false;
            cts = _pollCts;
            _pollCts = null;
            snapshot = _muted;
            _muted = new List<MutedRef>();
            notifEnum = _notifEnumerator;
            notifClient = _notifClient;
            _notifEnumerator = null;
            _notifClient = null;
        }
        try { cts?.Cancel(); } catch { /* ignore */ }
        try
        {
            if (notifEnum != null && notifClient != null)
            {
                notifEnum.UnregisterEndpointNotificationCallback(notifClient);
            }
        }
        catch { /* ignore — destructor will clean up COM ref */ }

        foreach (var entry in snapshot)
        {
            try
            {
                var ctrl = entry.Control;
                if (ctrl == null) continue;
                var sv = ctrl.SimpleAudioVolume;
                // Restore volume first so there's no audible blip at zero when mute flips off
                sv.Volume = entry.PrevVolume;
                sv.Mute = entry.PrevMuted;
            }
            catch { /* process gone, session disposed */ }
        }
    }

    private static void RestoreFromSnapshot(List<SnapshotItem> snapshot)
    {
        if (snapshot.Count == 0) return;
        try
        {
            var enumerator = new MMDeviceEnumerator();
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            for (int d = 0; d < devices.Count; d++)
            {
                MMDevice? device;
                try { device = devices[d]; } catch { continue; }
                if (device == null) continue;
                try
                {
                    var sessions = device.AudioSessionManager?.Sessions;
                    if (sessions == null) continue;
                    for (int i = 0; i < sessions.Count; i++)
                    {
                        AudioSessionControl? session;
                        try { session = sessions[i]; } catch { continue; }
                        if (session == null) continue;
                        try
                        {
                            var pid = (int)session.GetProcessID;
                            if (pid == 0) continue;
                            var name = SafeProcessName(pid);
                            var match = snapshot.FirstOrDefault(s =>
                                s.Pid == pid &&
                                (string.IsNullOrEmpty(s.Name) || s.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                            );
                            if (match == null) continue;
                            var sv = session.SimpleAudioVolume;
                            sv.Volume = match.Volume;
                            sv.Mute = match.Muted;
                        }
                        catch { /* session error */ }
                    }
                }
                catch { /* device error */ }
            }
        }
        catch (Exception ex)
        {
            SafeEmit(new { @event = "error", message = "restore: " + ex.Message });
        }
    }

    // --- Process descendant enumeration (Win32 toolhelp32) ---

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private static HashSet<int> GetDescendantPids(int rootPid)
    {
        var result = new HashSet<int> { rootPid };
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == IntPtr.Zero || snapshot == INVALID_HANDLE_VALUE) return result;
        try
        {
            var parents = new Dictionary<int, int>();
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            if (Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    parents[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                } while (Process32NextW(snapshot, ref entry));
            }
            // Iterative tree-grow: keep adding pids whose parent is already in the set
            bool changed;
            do
            {
                changed = false;
                foreach (var (pid, parent) in parents)
                {
                    if (result.Contains(parent) && !result.Contains(pid))
                    {
                        result.Add(pid);
                        changed = true;
                    }
                }
            } while (changed);
        }
        catch { /* best-effort */ }
        finally
        {
            CloseHandle(snapshot);
        }
        return result;
    }

    private static object SessionPayload(MutedRef m) =>
        new { pid = m.Pid, name = m.Name, volume = m.PrevVolume, muted = m.PrevMuted };

    private static string SafeProcessName(int pid)
    {
        var now = Environment.TickCount64;
        lock (_lock)
        {
            if (_processNameCache.TryGetValue(pid, out var hit) && now - hit.At < ProcessNameCacheTtlMs)
                return hit.Name;
        }
        string name;
        try
        {
            using var p = Process.GetProcessById(pid);
            name = p.ProcessName ?? "";
        }
        catch { name = ""; }
        lock (_lock) { _processNameCache[pid] = (name, now); }
        return name;
    }

    private static string SafeSessionId(AudioSessionControl session)
    {
        try { return session.GetSessionInstanceIdentifier ?? ""; } catch { return ""; }
    }

    private static void Emit(object payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        lock (_stdoutLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static void SafeEmit(object payload)
    {
        try { Emit(payload); } catch { /* stdout might be closed */ }
    }

    private record MutedRef
    {
        public int Pid { get; init; }
        public string Name { get; init; } = "";
        public string SessionId { get; init; } = "";
        public float PrevVolume { get; init; }
        public bool PrevMuted { get; init; }
        public AudioSessionControl? Control { get; set; }
    }

    private record SnapshotItem(int Pid, string Name, float Volume, bool Muted);

    // --- Opt-out from Windows Communications Ducking via IAudioSessionControl2 ---

    private static readonly FieldInfo? _naudioInnerControlField = typeof(AudioSessionControl)
        .GetField("audioSessionControlInterface", BindingFlags.NonPublic | BindingFlags.Instance);

    private static void TryOptOutOfDucking(AudioSessionControl session)
    {
        try
        {
            var sid = SafeSessionId(session);
            // Track per session-instance ID so we only opt out once per session lifetime.
            // PID isn't enough — one process can host multiple audio sessions.
            if (sid.Length == 0) return;
            lock (_lock)
            {
                if (_duckOptedSessions.Contains(sid)) return;
            }
            var inner = _naudioInnerControlField?.GetValue(session);
            if (inner is IAudioSessionControl2COM control2)
            {
                control2.SetDuckingPreference(true);
                lock (_lock) { _duckOptedSessions.Add(sid); }
            }
        }
        catch
        {
            // Session might be in a state where SetDuckingPreference fails — try again next poll
        }
    }

    /// <summary>
    /// Local COM declaration of IAudioSessionControl2. The IID matches the Windows definition,
    /// so casting the underlying NAudio RCW to this interface uses QueryInterface internally.
    /// Method ordering MUST match the vtable layout of IAudioSessionControl + the extensions
    /// in IAudioSessionControl2.
    /// </summary>
    [ComImport]
    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2COM
    {
        // IAudioSessionControl (vtable order)
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, [In] ref Guid eventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, [In] ref Guid eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam([In] ref Guid groupingParam, [In] ref Guid eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr newNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr newNotifications);
        // IAudioSessionControl2 extensions
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
        [PreserveSig] int GetProcessId(out uint retVal);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    /// <summary>
    /// COM callback receiver for Windows audio endpoint state changes. Forwards every
    /// notification to a single <see cref="Action{T}"/> trigger which kicks off ScanAndMute.
    /// Callbacks arrive on COM threads — the trigger must be reentrancy-safe.
    /// </summary>
    private sealed class DeviceNotificationClient : IMMNotificationClient
    {
        private readonly Action<string> _onChange;
        public DeviceNotificationClient(Action<string> onChange) { _onChange = onChange; }

        public void OnDeviceStateChanged(string deviceId, DeviceState newState)
            => _onChange($"stateChanged:{newState}");

        public void OnDeviceAdded(string pwstrDeviceId)
            => _onChange("deviceAdded");

        public void OnDeviceRemoved(string deviceId)
            => _onChange("deviceRemoved");

        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            if (flow == DataFlow.Render) _onChange($"defaultChanged:{role}");
        }

        public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key)
        {
            // Property changes (volume, name, format) — usually not interesting for us
        }
    }
}
