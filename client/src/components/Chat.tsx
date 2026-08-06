import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  meId: string;
  onSend: (text: string) => void;
}

function formatSentAt(timestamp: number): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function Chat({ messages, meId, onSend }: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="panel chat-panel">
      <h3>Chat</h3>
      <div className="chat-messages">
        {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
        {messages.map((m, i) => {
          const sentAt = formatSentAt(m.at);
          return (
            <div key={i} className={`chat-msg ${m.userId === meId ? "mine" : ""}`}>
              <div className="chat-message-meta">
                <span className="chat-author">{m.username}</span>
                {sentAt && <time className="chat-time" dateTime={new Date(m.at).toISOString()}>{sentAt}</time>}
              </div>
              <span className="chat-text">{m.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          maxLength={500}
        />
        <button type="submit" className="btn-small">Send</button>
      </form>
    </div>
  );
}
