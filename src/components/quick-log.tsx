"use client";
import { useRef, useState, useTransition } from "react";
import { AudioUploader } from "./audio-uploader";

const TYPE_BUTTONS = [
  { type: "CALL", label: "Call", tone: "call" },
  { type: "VISIT", label: "Visit", tone: "visit" },
  { type: "EMAIL", label: "Email", tone: "email" },
] as const;

export function QuickLog({
  companyId,
  companyName,
  action,
}: {
  companyId: string;
  companyName: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(type: string) {
    if (!text.trim() && !transcript.trim()) return;
    const fd = new FormData();
    fd.append("companyId", companyId);
    fd.append("type", type);
    fd.append("body", text);
    fd.append("transcript", transcript);
    fd.append("subject", text.split("\n")[0].slice(0, 120));
    fd.append("occurredAt", new Date().toISOString().split("T")[0]);
    setSubmitted(true);
    startTransition(async () => {
      await action(fd);
      setText("");
      setTranscript("");
      setShowAudio(false);
      setSubmitted(false);
    });
  }

  return (
    <div className="quick-log">
      <textarea
        placeholder={`What happened with ${companyName}?`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        disabled={isPending}
        className="quick-log-textarea"
      />

      {transcript && (
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={3}
          placeholder="Transcript (editable)"
          className="quick-log-textarea transcript"
        />
      )}

      <div className="quick-log-actions">
        {TYPE_BUTTONS.map(({ type, label, tone }) => (
          <button
            key={type}
            type="button"
            disabled={isPending || (!text.trim() && !transcript.trim())}
            onClick={() => submit(type)}
            className={`quick-log-submit ${tone}`}
          >
            {submitted && isPending ? "Saving..." : `Log ${label}`}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowAudio((v) => !v)}
          className="quick-log-audio-toggle"
        >
          {showAudio ? "Hide audio" : "Voice note"}
        </button>
      </div>

      {showAudio && (
        <div className="quick-log-audio-panel">
          <AudioUploader onTranscript={(t) => { setTranscript(t); setShowAudio(false); }} />
        </div>
      )}
    </div>
  );
}
