/**
 * The desktop host: one hidden Windows PowerShell 5.1 process (on every Windows 10 and 11 PC)
 * compiles a small C# class once and then drives the PC through user32 (SendInput,
 * SetCursorPos, EnumWindows, SetForegroundWindow, ShowWindow), System.Drawing for screenshots
 * and UI Automation for reading what controls a window holds. No native npm module is involved.
 *
 * The process declares itself per-monitor DPI aware before anything else, so every coordinate it
 * reads or takes (screenshots, window bounds, UI Automation bounds, the mouse) is in real screen
 * pixels on every monitor, whatever the owner's display scaling.
 *
 * Requests and replies are JSON lines over UTF-8 stdin/stdout (same pattern as the voice host):
 *   {"id":1,"op":"list_windows"}           -> {"id":1,"ok":true,"windows":[...]}
 *   {"id":2,"op":"click","x":10,"y":20}    -> {"id":2,"ok":true,...}
 *   failures                               -> {"id":2,"ok":false,"error":"..."}
 *
 * Safety that lives here, next to the input it guards (the backend checks the rest):
 *   - Sahkarmi's own windows (the pids passed in -ProtectedPids) are never clicked, typed into,
 *     focused or scrolled, so a coworker can never press its own approval buttons.
 *   - Text and keys are refused while a password field has keyboard focus, and in the Windows
 *     credential prompt; the browser's secure password sheet exists for passwords.
 */
export const DESKTOP_HOST_SCRIPT = String.raw`param([string]$ProtectedPids = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class SahkarmiDesktopHost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public INPUTUNION u; }

  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);

  const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004,
    MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010, MOUSEEVENTF_MIDDLEDOWN = 0x0020,
    MOUSEEVENTF_MIDDLEUP = 0x0040, MOUSEEVENTF_WHEEL = 0x0800, MOUSEEVENTF_HWHEEL = 0x01000;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001, KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
  const int SW_RESTORE = 9;
  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x00000080;
  const uint GW_OWNER = 4, GA_ROOT = 2;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };
  static readonly HashSet<uint> Protected = new HashSet<uint>();
  static readonly HashSet<string> NoTypingProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    "CredentialUIBroker", "consent", "LockApp", "LogonUI"
  };
  static string dpiMode = "unaware";

  public static void Run(string protectedPids) {
    try {
      // -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (Windows 10 1703+).
      if (SetProcessDpiAwarenessContext(new IntPtr(-4))) dpiMode = "per-monitor-v2";
      else if (SetProcessDPIAware()) dpiMode = "system";
    } catch (EntryPointNotFoundException) {
      if (SetProcessDPIAware()) dpiMode = "system";
    }
    foreach (var part in (protectedPids ?? "").Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries)) {
      uint pid; if (uint.TryParse(part, out pid)) Protected.Add(pid);
    }
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    output.AutoFlush = true;
    var hello = new Dictionary<string, object> { { "ready", true }, { "dpi", dpiMode }, { "pid", Process.GetCurrentProcess().Id } };
    output.WriteLine(Json.Serialize(hello));
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Trim().Length == 0) continue;
      var reply = new Dictionary<string, object>();
      object id = null;
      try {
        var request = Json.Deserialize<Dictionary<string, object>>(line);
        if (request.ContainsKey("id")) id = request["id"];
        Handle(Text(request, "op"), request, reply);
        reply["ok"] = true;
      } catch (Exception error) {
        reply.Clear();
        reply["ok"] = false;
        reply["error"] = error.Message;
      }
      reply["id"] = id;
      output.WriteLine(Json.Serialize(reply));
    }
  }

  static void Handle(string op, Dictionary<string, object> r, Dictionary<string, object> reply) {
    switch (op) {
      case "ping": reply["dpi"] = dpiMode; return;
      case "list_windows": reply["windows"] = ListWindows(Bool(r, "includeMinimized", true)); reply["foreground"] = Hex(GetForegroundWindow()); return;
      case "focus_window": reply["window"] = Describe(Focus(FindWindow(r, true))); reply["focused"] = true; return;
      case "screenshot": Screenshot(r, reply); return;
      case "cursor": { POINT p; GetCursorPos(out p); reply["x"] = p.X; reply["y"] = p.Y; return; }
      case "move": { int x = Int(r, "x"), y = Int(r, "y"); MoveTo(x, y); reply["x"] = x; reply["y"] = y; return; }
      case "click": Click(r, reply); return;
      case "scroll": Scroll(r, reply); return;
      case "drag": Drag(r, reply); return;
      case "type": TypeText(Text(r, "text"), Text(r, "method", "auto"), reply); return;
      case "key": Keys(r, reply); return;
      case "launch": Launch(r, reply); return;
      case "close_window": CloseWindow(r, reply); return;
      case "read_ui": ReadUi(r, reply); return;
      case "find_element": FindElement(r, reply); return;
      default: throw new Exception("Unknown request: " + op);
    }
  }

  // ------------------------------------------------------------------ windows

  static string Hex(IntPtr handle) { return "0x" + handle.ToInt64().ToString("X"); }

  static string TitleOf(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    var text = new StringBuilder(length + 1);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString();
  }

  static uint PidOf(IntPtr hWnd) { uint pid; GetWindowThreadProcessId(hWnd, out pid); return pid; }

  static string ProcessName(uint pid) {
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  static RECT BoundsOf(IntPtr hWnd) {
    RECT rect;
    if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) != 0) {
      GetWindowRect(hWnd, out rect);
    }
    return rect;
  }

  static bool IsAppWindow(IntPtr hWnd) {
    if (!IsWindowVisible(hWnd)) return false;
    if (GetWindowTextLength(hWnd) == 0) return false;
    if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
    int cloaked;
    if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return false;
    return true;
  }

  static List<IntPtr> AppWindows() {
    var found = new List<IntPtr>();
    EnumWindows((hWnd, lParam) => { if (IsAppWindow(hWnd)) found.Add(hWnd); return true; }, IntPtr.Zero);
    return found;
  }

  static Dictionary<string, object> Describe(IntPtr hWnd) {
    var rect = BoundsOf(hWnd);
    uint pid = PidOf(hWnd);
    return new Dictionary<string, object> {
      { "handle", Hex(hWnd) }, { "title", TitleOf(hWnd) }, { "pid", (long)pid },
      { "process", ProcessName(pid) }, { "x", rect.Left }, { "y", rect.Top },
      { "width", rect.Right - rect.Left }, { "height", rect.Bottom - rect.Top },
      { "minimized", IsIconic(hWnd) }, { "maximized", IsZoomed(hWnd) },
      { "foreground", hWnd == GetForegroundWindow() }, { "sahkarmi", Protected.Contains(pid) }
    };
  }

  static List<object> ListWindows(bool includeMinimized) {
    var list = new List<object>();
    foreach (var hWnd in AppWindows()) {
      if (!includeMinimized && IsIconic(hWnd)) continue;
      list.Add(Describe(hWnd));
    }
    return list;
  }

  static IntPtr ParseHandle(string text) {
    text = text.Trim();
    long value = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
      ? Convert.ToInt64(text.Substring(2), 16) : Convert.ToInt64(text);
    return new IntPtr(value);
  }

  /** A window by handle, pid or title substring; with none given, the foreground window. */
  static IntPtr FindWindow(Dictionary<string, object> r, bool required) {
    var handle = Text(r, "handle", null);
    if (!string.IsNullOrEmpty(handle)) {
      var hWnd = ParseHandle(handle);
      if (!IsWindow(hWnd)) throw new Exception("No window has the handle " + handle + " any more. List the windows again.");
      return hWnd;
    }
    long pid = Long(r, "pid", 0);
    var title = Text(r, "title", null);
    if (pid == 0 && string.IsNullOrEmpty(title)) {
      if (required) throw new Exception("Name the window: give a title, a pid or a handle from desktop_list_windows.");
      return GetForegroundWindow();
    }
    IntPtr best = IntPtr.Zero;
    foreach (var hWnd in AppWindows()) {
      if (pid != 0 && PidOf(hWnd) != pid) continue;
      if (!string.IsNullOrEmpty(title)) {
        var own = TitleOf(hWnd);
        if (own.IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) continue;
        if (string.Equals(own, title, StringComparison.OrdinalIgnoreCase)) return hWnd;
      }
      if (best == IntPtr.Zero) best = hWnd;
    }
    if (best == IntPtr.Zero) {
      throw new Exception("No open window matches " + (string.IsNullOrEmpty(title) ? "pid " + pid : "\"" + title + "\"") + ". Call desktop_list_windows to see what is open.");
    }
    return best;
  }

  static void Guard(IntPtr hWnd, string doing) {
    if (hWnd == IntPtr.Zero) return;
    var root = GetAncestor(hWnd, GA_ROOT);
    if (root == IntPtr.Zero) root = hWnd;
    if (Protected.Contains(PidOf(root))) {
      throw new Exception("That is Sahkarmi's own window. A coworker cannot " + doing + " Sahkarmi itself; ask the owner in chat instead.");
    }
  }

  static IntPtr Focus(IntPtr hWnd) {
    Guard(hWnd, "focus");
    if (IsIconic(hWnd)) { ShowWindow(hWnd, SW_RESTORE); Thread.Sleep(150); }
    if (GetForegroundWindow() == hWnd) return hWnd;
    uint ours = GetCurrentThreadId();
    uint pid;
    uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    bool attached = theirs != 0 && theirs != ours && AttachThreadInput(ours, theirs, true);
    try {
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
    } finally {
      if (attached) AttachThreadInput(ours, theirs, false);
    }
    if (GetForegroundWindow() != hWnd) {
      // Windows only lets the process that sent the last input change the foreground window.
      SendKeys(new[] { new KeyStroke(0x12, false) }, true);
      SetForegroundWindow(hWnd);
    }
    Thread.Sleep(80);
    if (GetForegroundWindow() != hWnd) throw new Exception("Windows did not let the window come to the front. Ask the owner to click it once, or try again.");
    return hWnd;
  }

  // ------------------------------------------------------------------ screenshots

  static void Screenshot(Dictionary<string, object> r, Dictionary<string, object> reply) {
    int maxWidth = Math.Max(320, Math.Min(3840, Int(r, "maxWidth", 1280)));
    bool hasWindow = !string.IsNullOrEmpty(Text(r, "handle", null)) || Long(r, "pid", 0) != 0 || !string.IsNullOrEmpty(Text(r, "title", null));
    Rectangle area;
    Bitmap capture;
    var screens = System.Windows.Forms.Screen.AllScreens;
    var displays = new List<object>();
    for (int i = 0; i < screens.Length; i++) {
      var b = screens[i].Bounds;
      displays.Add(new Dictionary<string, object> { { "index", i }, { "primary", screens[i].Primary }, { "x", b.X }, { "y", b.Y }, { "width", b.Width }, { "height", b.Height } });
    }
    reply["displays"] = displays;
    if (hasWindow) {
      var hWnd = FindWindow(r, true);
      if (IsIconic(hWnd)) throw new Exception("That window is minimized. Call desktop_focus_window first.");
      var rect = BoundsOf(hWnd);
      area = new Rectangle(rect.Left, rect.Top, Math.Max(1, rect.Right - rect.Left), Math.Max(1, rect.Bottom - rect.Top));
      capture = CaptureWindow(hWnd, area);
      reply["window"] = Describe(hWnd);
    } else {
      var all = Bool(r, "allDisplays", false);
      if (all) area = System.Windows.Forms.SystemInformation.VirtualScreen;
      else {
        int index = Int(r, "display", -1);
        var screen = index >= 0 && index < screens.Length ? screens[index] : System.Windows.Forms.Screen.PrimaryScreen;
        area = screen.Bounds;
      }
      capture = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
      using (var g = Graphics.FromImage(capture)) g.CopyFromScreen(area.Location, Point.Empty, area.Size);
    }
    using (capture) {
      double scale = area.Width > maxWidth ? (double)maxWidth / area.Width : 1.0;
      int width = Math.Max(1, (int)Math.Round(area.Width * scale));
      int height = Math.Max(1, (int)Math.Round(area.Height * scale));
      using (var scaled = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
        using (var g = Graphics.FromImage(scaled)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.DrawImage(capture, 0, 0, width, height);
        }
        var format = Text(r, "format", "jpeg");
        using (var stream = new MemoryStream()) {
          if (format == "png") { scaled.Save(stream, ImageFormat.Png); reply["mime"] = "image/png"; }
          else {
            var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)Math.Max(30, Math.Min(95, Int(r, "quality", 80))));
            scaled.Save(stream, codec, parameters);
            reply["mime"] = "image/jpeg";
          }
          reply["data"] = Convert.ToBase64String(stream.ToArray());
        }
      }
      reply["left"] = area.X; reply["top"] = area.Y;
      reply["captureWidth"] = area.Width; reply["captureHeight"] = area.Height;
      reply["width"] = width; reply["height"] = height; reply["scale"] = scale;
      reply["dpi"] = dpiMode;
    }
  }

  static Bitmap CaptureWindow(IntPtr hWnd, Rectangle area) {
    // PrintWindow paints the window even when other windows cover it; it draws the full window
    // rect (shadow included), so crop to the visible frame. Blank means it failed: copy the screen.
    RECT full; GetWindowRect(hWnd, out full);
    int fullWidth = Math.Max(1, full.Right - full.Left), fullHeight = Math.Max(1, full.Bottom - full.Top);
    using (var whole = new Bitmap(fullWidth, fullHeight, PixelFormat.Format24bppRgb)) {
      bool printed;
      using (var g = Graphics.FromImage(whole)) {
        var hdc = g.GetHdc();
        try { printed = PrintWindow(hWnd, hdc, 2); } finally { g.ReleaseHdc(hdc); }
      }
      var bitmap = new Bitmap(area.Width, area.Height, PixelFormat.Format24bppRgb);
      using (var g = Graphics.FromImage(bitmap)) {
        if (printed && !IsBlank(whole)) {
          g.DrawImage(whole, new Rectangle(0, 0, area.Width, area.Height), new Rectangle(area.X - full.Left, area.Y - full.Top, area.Width, area.Height), GraphicsUnit.Pixel);
        } else {
          g.CopyFromScreen(area.Location, Point.Empty, area.Size);
        }
      }
      return bitmap;
    }
  }

  static bool IsBlank(Bitmap bitmap) {
    int stepX = Math.Max(1, bitmap.Width / 16), stepY = Math.Max(1, bitmap.Height / 16);
    for (int x = 0; x < bitmap.Width; x += stepX)
      for (int y = 0; y < bitmap.Height; y += stepY) {
        var c = bitmap.GetPixel(x, y);
        if (c.R != 0 || c.G != 0 || c.B != 0) return false;
      }
    return true;
  }

  // ------------------------------------------------------------------ mouse

  static INPUT Mouse(uint flags, uint data) {
    var input = new INPUT { type = INPUT_MOUSE };
    input.u.mi = new MOUSEINPUT { dwFlags = flags, mouseData = data };
    return input;
  }

  static void Send(INPUT[] inputs) {
    if (inputs.Length == 0) return;
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new Exception("Windows blocked the input (error " + Marshal.GetLastWin32Error() + "). An app running as administrator, or a secure screen such as a UAC prompt, cannot be controlled.");
  }

  static void MoveTo(int x, int y) {
    var virt = System.Windows.Forms.SystemInformation.VirtualScreen;
    if (x < virt.Left || y < virt.Top || x >= virt.Right || y >= virt.Bottom) {
      throw new Exception("(" + x + ", " + y + ") is off the screen; the screen spans " + virt.Left + "," + virt.Top + " to " + (virt.Right - 1) + "," + (virt.Bottom - 1) + ".");
    }
    SetCursorPos(x, y);
    // A zero relative move makes apps see a real WM_MOUSEMOVE at the new spot (hover effects).
    Send(new[] { Mouse(MOUSEEVENTF_MOVE, 0) });
  }

  static IntPtr WindowAt(int x, int y) {
    var hWnd = WindowFromPoint(new POINT { X = x, Y = y });
    var root = hWnd == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hWnd, GA_ROOT);
    return root == IntPtr.Zero ? hWnd : root;
  }

  static void Click(Dictionary<string, object> r, Dictionary<string, object> reply) {
    int x = Int(r, "x"), y = Int(r, "y");
    var target = WindowAt(x, y);
    Guard(target, "click");
    var button = Text(r, "button", "left");
    uint down, up;
    if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
    else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
    else { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; }
    int clicks = Math.Max(1, Math.Min(3, Int(r, "clicks", 1)));
    MoveTo(x, y);
    Thread.Sleep(30);
    for (int i = 0; i < clicks; i++) {
      Send(new[] { Mouse(down, 0), Mouse(up, 0) });
      if (i + 1 < clicks) Thread.Sleep(60);
    }
    reply["x"] = x; reply["y"] = y;
    if (target != IntPtr.Zero) reply["window"] = Describe(target);
  }

  static void Scroll(Dictionary<string, object> r, Dictionary<string, object> reply) {
    int x = Int(r, "x"), y = Int(r, "y");
    Guard(WindowAt(x, y), "scroll");
    MoveTo(x, y);
    int down = Int(r, "deltaY", 0), right = Int(r, "deltaX", 0);
    var inputs = new List<INPUT>();
    // Positive deltaY scrolls down (towards the end), like a browser; the wheel counts the other way.
    if (down != 0) inputs.Add(Mouse(MOUSEEVENTF_WHEEL, unchecked((uint)(-down * 120))));
    if (right != 0) inputs.Add(Mouse(MOUSEEVENTF_HWHEEL, unchecked((uint)(right * 120))));
    Send(inputs.ToArray());
    reply["x"] = x; reply["y"] = y;
  }

  static void Drag(Dictionary<string, object> r, Dictionary<string, object> reply) {
    int fx = Int(r, "fromX"), fy = Int(r, "fromY"), tx = Int(r, "toX"), ty = Int(r, "toY");
    Guard(WindowAt(fx, fy), "drag in");
    Guard(WindowAt(tx, ty), "drop onto");
    var button = Text(r, "button", "left");
    uint down = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
    uint up = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
    MoveTo(fx, fy);
    Thread.Sleep(40);
    Send(new[] { Mouse(down, 0) });
    try {
      int steps = 12;
      for (int i = 1; i <= steps; i++) {
        SetCursorPos(fx + (tx - fx) * i / steps, fy + (ty - fy) * i / steps);
        Send(new[] { Mouse(MOUSEEVENTF_MOVE, 0) });
        Thread.Sleep(15);
      }
    } finally {
      Send(new[] { Mouse(up, 0) });
    }
    reply["x"] = tx; reply["y"] = ty;
  }

  // ------------------------------------------------------------------ keyboard

  public struct KeyStroke { public ushort Vk; public bool Extended; public KeyStroke(ushort vk, bool extended) { Vk = vk; Extended = extended; } }

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
    return input;
  }

  /** Presses the keys in order and releases them in reverse: one chord such as ctrl+shift+s. */
  static void SendKeys(KeyStroke[] chord, bool skipGuard) {
    var inputs = new List<INPUT>();
    foreach (var k in chord) inputs.Add(Key(k.Vk, 0, k.Extended ? KEYEVENTF_EXTENDEDKEY : 0));
    for (int i = chord.Length - 1; i >= 0; i--) inputs.Add(Key(chord[i].Vk, 0, KEYEVENTF_KEYUP | (chord[i].Extended ? KEYEVENTF_EXTENDEDKEY : 0)));
    Send(inputs.ToArray());
  }

  /** Refuses typing into Sahkarmi, the Windows sign-in/credential prompts, or a focused password field. */
  /** Returns the UI framework of the focused control ("Win32", "XAML", "Chrome", ...), or "". */
  static string GuardTyping(bool passwordSafe) {
    var fg = GetForegroundWindow();
    Guard(fg, "type into");
    var name = ProcessName(PidOf(fg));
    if (NoTypingProcesses.Contains(name)) throw new Exception("That is a Windows sign-in or credential prompt. Coworkers never type there; ask the owner to do it.");
    if (passwordSafe) return "";
    bool password = false;
    string framework = "";
    try {
      var focused = AutomationElement.FocusedElement;
      if (focused != null) { password = focused.Current.IsPassword; framework = focused.Current.FrameworkId ?? ""; }
    } catch { }
    if (!password) return framework;
    throw new Exception("A password field has the keyboard focus. Coworkers never type passwords into apps; use sahkarmi request_secure_input in the browser, or ask the owner to type it.");
  }

  static void TypeText(string text, string method, Dictionary<string, object> reply) {
    var framework = GuardTyping(false);
    var target = GetForegroundWindow();
    reply["framework"] = framework;
    // XAML/WinUI apps (Windows 11 Notepad, Settings, Store apps) read a VK_PACKET's character only
    // when they get round to the key, so a fast run of them comes out as the latest character
    // repeated ("one two" -> "eeeeooo"). For those, paste the text and put the clipboard back.
    bool xaml = framework == "XAML" || framework == "WinUI" || framework == "DirectUI" || HostsXaml(target);
    reply["xaml"] = xaml;
    bool paste = method == "paste" || (method == "auto" && xaml);
    reply["method"] = paste ? "paste" : "keys";
    if (paste) { PasteText(text, target); reply["typed"] = text.Length; return; }
    var step = new List<INPUT>();
    int typed = 0;
    for (int i = 0; i < text.Length; i++) {
      char c = text[i];
      if (c == (char)13) continue;
      if (c == (char)10) { step.Add(Key(0x0D, 0, 0)); step.Add(Key(0x0D, 0, KEYEVENTF_KEYUP)); }
      else if (c == (char)9) { step.Add(Key(0x09, 0, 0)); step.Add(Key(0x09, 0, KEYEVENTF_KEYUP)); }
      else {
        // KEYEVENTF_UNICODE sends the UTF-16 unit itself: any script, no SendKeys escaping, any keyboard layout.
        step.Add(Key(0, c, KEYEVENTF_UNICODE));
        step.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
      }
      // A surrogate pair (emoji) goes in one SendInput with its second half.
      if (char.IsHighSurrogate(c) && i + 1 < text.Length) continue;
      // One character per SendInput, paced: XAML apps (Windows 11 Notepad, Store apps) read a
      // burst of VK_PACKETs late and repeat the last character ("desktop test" -> "tttttttttttt").
      Send(step.ToArray());
      step.Clear();
      typed++;
      WaitForApp(target);
      // Stop if the owner (or a popup) moved the focus to another window mid-text.
      if (typed % 8 == 0 && GetForegroundWindow() != target) {
        throw new Exception("The focus moved to another window after " + typed + " characters, so typing stopped. Check the screen and focus the right window.");
      }
    }
    if (step.Count > 0) Send(step.ToArray());
    reply["typed"] = text.Length;
  }

  static string ClassOf(IntPtr hWnd) {
    var name = new StringBuilder(256);
    GetClassName(hWnd, name, name.Capacity);
    return name.ToString();
  }

  /** A UWP/WinUI window, or a classic window hosting XAML islands (Windows 11 Notepad, Explorer, Terminal). */
  static bool HostsXaml(IntPtr top) {
    if (top == IntPtr.Zero) return false;
    if (ClassOf(top) == "ApplicationFrameWindow") return true;
    bool found = false;
    EnumChildWindows(top, (child, lParam) => {
      var name = ClassOf(child);
      if (name.Contains("InputSite") || name.Contains("DesktopChildSiteBridge") || name.Contains("DesktopWindowXamlSource") || name == "Windows.UI.Core.CoreWindow") { found = true; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static void PasteText(string text, IntPtr target) {
    System.Windows.Forms.IDataObject saved = null;
    try { saved = System.Windows.Forms.Clipboard.GetDataObject(); } catch { }
    var copy = new System.Windows.Forms.DataObject();
    bool hadData = false;
    if (saved != null) {
      foreach (var format in saved.GetFormats(false)) {
        try { var data = saved.GetData(format, false); if (data != null) { copy.SetData(format, false, data); hadData = true; } } catch { }
      }
    }
    string crlf = "" + (char)13 + (char)10, lf = "" + (char)10;
    var normalized = text.Replace(crlf, lf).Replace(lf, crlf);
    SetClipboard(() => System.Windows.Forms.Clipboard.SetText(normalized, System.Windows.Forms.TextDataFormat.UnicodeText));
    try {
      if (GetForegroundWindow() != target) throw new Exception("The focus moved to another window, so nothing was pasted.");
      SendKeys(new[] { new KeyStroke(0x11, false), new KeyStroke(0x56, false) }, false);
      WaitForApp(target);
      // The app reads the clipboard on its own time; give it that before the owner's copy returns.
      Thread.Sleep(400);
    } finally {
      try {
        if (hadData) SetClipboard(() => System.Windows.Forms.Clipboard.SetDataObject(copy, true));
        else SetClipboard(() => System.Windows.Forms.Clipboard.Clear());
      } catch { }
    }
  }

  static void SetClipboard(Action action) {
    for (int attempt = 0; ; attempt++) {
      try { action(); return; }
      catch (System.Runtime.InteropServices.ExternalException) {
        // Another app has the clipboard open for a moment.
        if (attempt >= 9) throw new Exception("The clipboard is busy; try again.");
        Thread.Sleep(50);
      }
    }
  }

  /** Lets the window's UI thread catch up: a pause, then a no-op message it must answer. */
  static void WaitForApp(IntPtr target) {
    Thread.Sleep(12);
    IntPtr ignored;
    SendMessageTimeout(target, 0 /* WM_NULL */, IntPtr.Zero, IntPtr.Zero, 0x0002 /* SMTO_ABORTIFHUNG */, 250, out ignored);
  }

  static void Keys(Dictionary<string, object> r, Dictionary<string, object> reply) {
    var chords = r.ContainsKey("chords") ? r["chords"] as System.Collections.ArrayList : null;
    if (chords == null || chords.Count == 0) throw new Exception("No keys given.");
    GuardTyping(Bool(r, "passwordSafe", false));
    int repeat = Math.Max(1, Math.Min(50, Int(r, "repeat", 1)));
    for (int n = 0; n < repeat; n++) {
      foreach (var chordValue in chords) {
        var chord = new List<KeyStroke>();
        foreach (var keyValue in (System.Collections.ArrayList)chordValue) {
          var key = (Dictionary<string, object>)keyValue;
          chord.Add(new KeyStroke((ushort)Convert.ToInt32(key["vk"]), key.ContainsKey("extended") && Convert.ToBoolean(key["extended"])));
        }
        SendKeys(chord.ToArray(), false);
        Thread.Sleep(30);
      }
    }
    reply["sent"] = chords.Count * repeat;
  }

  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  /** WM_CLOSE: the same as the window's own close button, so the app may still ask to save. */
  static void CloseWindow(Dictionary<string, object> r, Dictionary<string, object> reply) {
    var hWnd = FindWindow(r, true);
    Guard(hWnd, "close");
    reply["window"] = Describe(hWnd);
    PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
    var watch = Stopwatch.StartNew();
    while (watch.ElapsedMilliseconds < 2000 && IsWindow(hWnd) && IsWindowVisible(hWnd)) Thread.Sleep(150);
    reply["closed"] = !IsWindow(hWnd) || !IsWindowVisible(hWnd);
  }

  // ------------------------------------------------------------------ launching

  static void Launch(Dictionary<string, object> r, Dictionary<string, object> reply) {
    var target = Text(r, "target");
    var arguments = Text(r, "arguments", "");
    var before = new HashSet<IntPtr>(AppWindows());
    string how;
    int pid = 0;
    if (Bool(r, "shellOnly", false)) {
      pid = Start(target, arguments);
      how = "opened";
    } else {
      try {
        pid = Start(target, arguments);
        how = "started";
      } catch (Exception) {
        var app = FindStartMenuApp(target);
        if (app == null) throw new Exception("Windows found no app called \"" + target + "\". Give the full path of the .exe, or the name exactly as it shows in the Start menu.");
        Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + app[1]) { UseShellExecute = true });
        how = "started from the Start menu as \"" + app[0] + "\"";
      }
    }
    reply["how"] = how;
    if (pid != 0) reply["pid"] = pid;
    int waitMs = Math.Max(0, Math.Min(15000, Int(r, "waitMs", 4000)));
    var freshHandles = new List<IntPtr>();
    var watch = Stopwatch.StartNew();
    while (watch.ElapsedMilliseconds < waitMs) {
      Thread.Sleep(250);
      foreach (var hWnd in AppWindows()) if (!before.Contains(hWnd)) freshHandles.Add(hWnd);
      if (freshHandles.Count > 0) break;
    }
    // Apps keep loading after their window shows (Notepad reopens earlier tabs and retitles
    // itself): wait until the titles stay the same for a moment before reporting.
    string lastTitles = null;
    var settle = Stopwatch.StartNew();
    while (freshHandles.Count > 0 && settle.ElapsedMilliseconds < 5000) {
      var titles = string.Join("|", freshHandles.Select(TitleOf));
      if (titles == lastTitles) break;
      lastTitles = titles;
      Thread.Sleep(600);
    }
    reply["newWindows"] = freshHandles.Where(IsWindow).Select(h => (object)Describe(h)).ToList();
  }

  static int Start(string target, string arguments) {
    var info = new ProcessStartInfo(target) { UseShellExecute = true };
    if (!string.IsNullOrEmpty(arguments)) info.Arguments = arguments;
    using (var process = Process.Start(info)) {
      if (process == null) return 0;
      try { return process.Id; } catch { return 0; }
    }
  }

  /** [display name, AppUserModelID] of the Start menu app whose name best matches. */
  static string[] FindStartMenuApp(string name) {
    var shellType = Type.GetTypeFromProgID("Shell.Application");
    object shell = Activator.CreateInstance(shellType);
    try {
      object folder = shellType.InvokeMember("NameSpace", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { "shell:AppsFolder" });
      if (folder == null) return null;
      object items = folder.GetType().InvokeMember("Items", System.Reflection.BindingFlags.InvokeMethod, null, folder, null);
      int count = (int)items.GetType().InvokeMember("Count", System.Reflection.BindingFlags.GetProperty, null, items, null);
      string[] contains = null;
      for (int i = 0; i < count; i++) {
        object item = items.GetType().InvokeMember("Item", System.Reflection.BindingFlags.InvokeMethod, null, items, new object[] { i });
        var display = (string)item.GetType().InvokeMember("Name", System.Reflection.BindingFlags.GetProperty, null, item, null);
        var path = (string)item.GetType().InvokeMember("Path", System.Reflection.BindingFlags.GetProperty, null, item, null);
        if (string.Equals(display, name, StringComparison.OrdinalIgnoreCase)) return new[] { display, path };
        if (contains == null && display != null && display.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0) contains = new[] { display, path };
      }
      return contains;
    } finally {
      Marshal.ReleaseComObject(shell);
    }
  }

  // ------------------------------------------------------------------ UI Automation

  static string ControlTypeName(AutomationElement element) {
    var name = element.Current.ControlType.ProgrammaticName ?? "";
    return name.StartsWith("ControlType.") ? name.Substring(12) : name;
  }

  static Dictionary<string, object> Node(AutomationElement element, int depth, bool withValue) {
    var current = element.Current;
    var rect = current.BoundingRectangle;
    var node = new Dictionary<string, object> { { "depth", depth }, { "type", ControlTypeName(element) }, { "name", Clip(current.Name, 160) } };
    if (!string.IsNullOrEmpty(current.AutomationId)) node["automationId"] = Clip(current.AutomationId, 80);
    if (!rect.IsEmpty && !double.IsInfinity(rect.X)) {
      node["x"] = (int)rect.X; node["y"] = (int)rect.Y; node["width"] = (int)rect.Width; node["height"] = (int)rect.Height;
    }
    if (!current.IsEnabled) node["disabled"] = true;
    if (current.HasKeyboardFocus) node["focused"] = true;
    if (current.IsOffscreen) node["offscreen"] = true;
    if (current.IsPassword) node["password"] = true;
    else if (withValue) {
      object pattern;
      if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
        try { var value = ((ValuePattern)pattern).Current.Value; if (!string.IsNullOrEmpty(value)) node["value"] = Clip(value, 400); } catch { }
      }
      if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
        try { node["toggle"] = ((TogglePattern)pattern).Current.ToggleState.ToString(); } catch { }
      }
    }
    return node;
  }

  static string Clip(string text, int max) {
    if (string.IsNullOrEmpty(text)) return "";
    text = text.Replace("\r", " ").Replace("\n", " ");
    return text.Length > max ? text.Substring(0, max) + "..." : text;
  }

  static void ReadUi(Dictionary<string, object> r, Dictionary<string, object> reply) {
    var hWnd = FindWindow(r, false);
    if (hWnd == IntPtr.Zero) throw new Exception("No window is in front. Name one with title or pid.");
    if (IsIconic(hWnd)) throw new Exception("That window is minimized. Call desktop_focus_window first.");
    int maxDepth = Math.Max(1, Math.Min(25, Int(r, "maxDepth", 12)));
    int maxNodes = Math.Max(10, Math.Min(1500, Int(r, "maxNodes", 400)));
    var root = AutomationElement.FromHandle(hWnd);
    var nodes = new List<object>();
    var walker = TreeWalker.ControlViewWalker;
    var stack = new Stack<KeyValuePair<AutomationElement, int>>();
    stack.Push(new KeyValuePair<AutomationElement, int>(root, 0));
    bool truncated = false;
    var watch = Stopwatch.StartNew();
    while (stack.Count > 0) {
      if (nodes.Count >= maxNodes || watch.ElapsedMilliseconds > 15000) { truncated = true; break; }
      var entry = stack.Pop();
      try { nodes.Add(Node(entry.Key, entry.Value, true)); } catch (ElementNotAvailableException) { continue; }
      if (entry.Value >= maxDepth) continue;
      var children = new List<AutomationElement>();
      try {
        for (var child = walker.GetFirstChild(entry.Key); child != null; child = walker.GetNextSibling(child)) children.Add(child);
      } catch (ElementNotAvailableException) { }
      for (int i = children.Count - 1; i >= 0; i--) stack.Push(new KeyValuePair<AutomationElement, int>(children[i], entry.Value + 1));
    }
    reply["window"] = Describe(hWnd);
    reply["nodes"] = nodes;
    reply["truncated"] = truncated;
  }

  /** The first control in a window whose name (and type, if given) matches; for clicking by element. */
  static void FindElement(Dictionary<string, object> r, Dictionary<string, object> reply) {
    var hWnd = FindWindow(r, false);
    if (hWnd == IntPtr.Zero) throw new Exception("No window is in front. Name one with title or pid.");
    var name = Text(r, "name");
    var type = Text(r, "controlType", "");
    var root = AutomationElement.FromHandle(hWnd);
    Condition condition = Condition.TrueCondition;
    var all = root.FindAll(TreeScope.Descendants, condition);
    AutomationElement exact = null, partial = null;
    foreach (AutomationElement element in all) {
      try {
        var current = element.Current;
        if (current.IsOffscreen) continue;
        if (type.Length > 0 && !string.Equals(ControlTypeName(element), type, StringComparison.OrdinalIgnoreCase)) continue;
        var own = current.Name ?? "";
        if (string.Equals(own, name, StringComparison.OrdinalIgnoreCase)) { exact = element; break; }
        if (partial == null && own.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0) partial = element;
      } catch (ElementNotAvailableException) { }
    }
    var found = exact ?? partial;
    if (found == null) throw new Exception("No visible control named \"" + name + "\"" + (type.Length > 0 ? " of type " + type : "") + " in \"" + TitleOf(hWnd) + "\". Call desktop_read_ui to see the controls.");
    var node = Node(found, 0, false);
    if (!node.ContainsKey("x")) throw new Exception("That control has no position on screen.");
    reply["element"] = node;
    reply["window"] = Describe(hWnd);
  }

  // ------------------------------------------------------------------ request fields

  static string Text(Dictionary<string, object> r, string key) {
    var value = Text(r, key, null);
    if (value == null) throw new Exception("Missing " + key + ".");
    return value;
  }
  static string Text(Dictionary<string, object> r, string key, string fallback) {
    object value; return r.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
  }
  static int Int(Dictionary<string, object> r, string key) {
    object value; if (!r.TryGetValue(key, out value) || value == null) throw new Exception("Missing " + key + ".");
    return Convert.ToInt32(value);
  }
  static int Int(Dictionary<string, object> r, string key, int fallback) {
    object value; return r.TryGetValue(key, out value) && value != null ? Convert.ToInt32(value) : fallback;
  }
  static long Long(Dictionary<string, object> r, string key, long fallback) {
    object value; return r.TryGetValue(key, out value) && value != null ? Convert.ToInt64(value) : fallback;
  }
  static bool Bool(Dictionary<string, object> r, string key, bool fallback) {
    object value; return r.TryGetValue(key, out value) && value != null ? Convert.ToBoolean(value) : fallback;
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
  [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,
  [System.Drawing.Bitmap].Assembly.Location,
  [System.Windows.Forms.Screen].Assembly.Location,
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location,
  "System.Core"
)
[SahkarmiDesktopHost]::Run($ProtectedPids)
`;
