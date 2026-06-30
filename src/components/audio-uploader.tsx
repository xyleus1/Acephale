"use client";
import { useRef, useState } from "react";

export function AudioUploader({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadBlob(blob: Blob, filename = "recording.webm") {
    setState("uploading");
    try {
      const fd = new FormData();
      fd.append("audio", new File([blob], filename, { type: blob.type || "audio/webm" }));
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      onTranscript(json.transcript ?? "");
      setState("done");
    } catch (e) {
      setErrorMsg(String(e));
      setState("error");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        uploadBlob(blob);
      };
      mr.start();
      setState("recording");
    } catch {
      setErrorMsg("Microphone access denied");
      setState("error");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadBlob(file, file.name);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {state === "idle" || state === "done" || state === "error" ? (
          <>
            <button
              type="button"
              className="secondary btn-sm"
              style={{ fontSize: 11 }}
              onClick={startRecording}
            >
              ⏺ Record
            </button>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>or</span>
            <button
              type="button"
              className="secondary btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => fileInputRef.current?.click()}
            >
              ↑ Upload audio
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </>
        ) : state === "recording" ? (
          <button
            type="button"
            className="btn-sm"
            style={{ background: "var(--danger)", color: "#fff", fontSize: 11 }}
            onClick={stopRecording}
          >
            ⏹ Stop recording
          </button>
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Transcribing…</span>
        )}
        {state === "done" && (
          <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 600 }}>✓ Transcribed</span>
        )}
      </div>
      {state === "error" && (
        <span style={{ fontSize: 11, color: "var(--danger)" }}>{errorMsg}</span>
      )}
    </div>
  );
}
