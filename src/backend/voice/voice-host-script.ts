/**
 * The voice host: Windows PowerShell 5.1 (on every Windows 10 and 11 PC) loads the sherpa-onnx
 * .NET binding and keeps one speech-to-text and one text-to-speech model in memory. Requests and
 * replies are JSON lines over UTF-8 stdin/stdout, so Hindi, Bengali and every other script reach
 * the engine intact (the command-line tools only receive the ANSI code page).
 *
 * Requests:  {"id":1,"op":"transcribe","asr":{...},"pcm":"C:\\...\\clip.f32"}
 *            {"id":2,"op":"speak","tts":{...},"text":"…","sid":2,"speed":1,"out":"C:\\...\\a.wav"}
 *            {"id":3,"op":"ping"}
 * Replies:   {"id":1,"ok":true,"text":"…"}  or  {"id":1,"ok":false,"error":"…"}
 */
export const VOICE_HOST_SCRIPT = `param([string]$Lib, [string]$Binding)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web.Extensions
Add-Type -Path $Binding
$source = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using SherpaOnnx;

public static class SahkarmiVoiceHost {
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr LoadLibraryW(string path);

  static OfflineRecognizer recognizer;
  static string recognizerKey;
  static OfflineTts tts;
  static string ttsKey;
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

  public static void Run(string lib) {
    // Windows ships an older onnxruntime.dll in System32; load ours by full path first.
    foreach (var name in new[] { "onnxruntime.dll", "sherpa-onnx-c-api.dll" }) {
      if (LoadLibraryW(Path.Combine(lib, name)) == IntPtr.Zero) {
        throw new Exception("Could not load " + name + " (Windows error " + Marshal.GetLastWin32Error() + ")");
      }
    }
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    output.AutoFlush = true;
    output.WriteLine(Json.Serialize(new Dictionary<string, object> { { "ready", true } }));
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Trim().Length == 0) continue;
      var reply = new Dictionary<string, object>();
      object id = null;
      try {
        var request = Json.Deserialize<Dictionary<string, object>>(line);
        if (request.ContainsKey("id")) id = request["id"];
        var op = Text(request, "op");
        if (op == "transcribe") reply["text"] = Transcribe(request);
        else if (op == "speak") Speak(request, reply);
        else if (op == "unload") Unload();
        else if (op != "ping") throw new Exception("Unknown request: " + op);
        reply["ok"] = true;
      } catch (Exception error) {
        reply["ok"] = false;
        reply["error"] = error.Message;
      }
      reply["id"] = id;
      output.WriteLine(Json.Serialize(reply));
    }
  }

  static string Text(Dictionary<string, object> map, string key) {
    object value;
    return map.TryGetValue(key, out value) && value != null ? value.ToString() : "";
  }

  static int Number(Dictionary<string, object> map, string key, int fallback) {
    object value;
    if (!map.TryGetValue(key, out value) || value == null) return fallback;
    return Convert.ToInt32(value);
  }

  static Dictionary<string, object> Section(Dictionary<string, object> map, string key) {
    object value;
    if (!map.TryGetValue(key, out value) || !(value is Dictionary<string, object>)) {
      throw new Exception("Missing " + key + " settings");
    }
    return (Dictionary<string, object>)value;
  }

  static void Unload() {
    if (recognizer != null) { recognizer.Dispose(); recognizer = null; recognizerKey = null; }
    if (tts != null) { tts.Dispose(); tts = null; ttsKey = null; }
  }

  static string Transcribe(Dictionary<string, object> request) {
    var asr = Section(request, "asr");
    var key = Json.Serialize(asr);
    if (recognizer == null || recognizerKey != key) {
      if (recognizer != null) recognizer.Dispose();
      recognizer = null;
      var config = new OfflineRecognizerConfig();
      var model = config.ModelConfig;
      model.Tokens = Text(asr, "tokens");
      model.NumThreads = Number(asr, "threads", 4);
      var kind = Text(asr, "kind");
      if (kind == "nemo-ctc") {
        var nemo = model.NeMoCtc;
        nemo.Model = Text(asr, "model");
        model.NeMoCtc = nemo;
      } else if (kind == "whisper") {
        var whisper = model.Whisper;
        whisper.Encoder = Text(asr, "encoder");
        whisper.Decoder = Text(asr, "decoder");
        whisper.Language = Text(asr, "language");
        whisper.Task = "transcribe";
        whisper.TailPaddings = -1;
        model.Whisper = whisper;
      } else {
        throw new Exception("Unknown speech-to-text model kind: " + kind);
      }
      config.ModelConfig = model;
      recognizer = new OfflineRecognizer(config);
      recognizerKey = key;
    }
    var bytes = File.ReadAllBytes(Text(request, "pcm"));
    var samples = new float[bytes.Length / 4];
    Buffer.BlockCopy(bytes, 0, samples, 0, samples.Length * 4);
    var stream = recognizer.CreateStream();
    stream.AcceptWaveform(16000, samples);
    recognizer.Decode(stream);
    var text = stream.Result.Text;
    stream.Dispose();
    return text == null ? "" : text.Trim();
  }

  static void Speak(Dictionary<string, object> request, Dictionary<string, object> reply) {
    var settings = Section(request, "tts");
    var key = Json.Serialize(settings);
    if (tts == null || ttsKey != key) {
      if (tts != null) tts.Dispose();
      tts = null;
      var config = new OfflineTtsConfig();
      var model = config.Model;
      model.NumThreads = Number(settings, "threads", 4);
      var kind = Text(settings, "kind");
      if (kind == "vits") {
        var vits = model.Vits;
        vits.Model = Text(settings, "model");
        vits.Tokens = Text(settings, "tokens");
        model.Vits = vits;
      } else if (kind == "kokoro") {
        var kokoro = model.Kokoro;
        kokoro.Model = Text(settings, "model");
        kokoro.Voices = Text(settings, "voices");
        kokoro.Tokens = Text(settings, "tokens");
        kokoro.Lexicon = Text(settings, "lexicon");
        model.Kokoro = kokoro;
      } else {
        throw new Exception("Unknown voice kind: " + kind);
      }
      config.Model = model;
      config.MaxNumSentences = 1;
      tts = new OfflineTts(config);
      ttsKey = key;
    }
    var speed = request.ContainsKey("speed") ? Convert.ToSingle(request["speed"]) : 1.0f;
    var audio = tts.Generate(Text(request, "text"), speed, Number(request, "sid", 0));
    var path = Text(request, "out");
    audio.SaveToWaveFile(path);
    reply["path"] = path;
    reply["sampleRate"] = audio.SampleRate;
    reply["seconds"] = audio.NumSamples / (double)audio.SampleRate;
  }
}
'@
Add-Type -ReferencedAssemblies @($Binding, "System.Web.Extensions") -TypeDefinition $source
[SahkarmiVoiceHost]::Run($Lib)
`;
