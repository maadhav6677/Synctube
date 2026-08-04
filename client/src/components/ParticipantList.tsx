import type { Participant, Role } from "../types";

interface Props {
  participants: Participant[];
  meId: string;
  amHost: boolean;
  onAssignRole: (userId: string, role: Role) => void;
  onRemove: (userId: string) => void;
  onTransferHost: (userId: string) => void;
}

const ROLE_BADGE: Record<Role, string> = {
  host: "👑 Host",
  moderator: "🛡️ Moderator",
  participant: "👤 Participant",
  viewer: "👁️ Viewer",
};

export function ParticipantList({
  participants,
  meId,
  amHost,
  onAssignRole,
  onRemove,
  onTransferHost,
}: Props) {
  return (
    <div className="panel">
      <h3>Participants ({participants.length})</h3>
      <ul className="participant-list">
        {participants.map((p) => (
          <li key={p.id} className="participant-row">
            <div className="participant-main">
              <span className="participant-name">
                {p.username}
                {p.id === meId && <span className="you-tag"> (you)</span>}
              </span>
              <span className={`role-badge role-${p.role}`}>{ROLE_BADGE[p.role]}</span>
            </div>

            {amHost && p.id !== meId && (
              <div className="participant-actions">
                <select
                  aria-label={`Assign role to ${p.username}`}
                  value={["moderator", "participant", "viewer"].includes(p.role) ? p.role : "participant"}
                  onChange={(e) => onAssignRole(p.id, e.target.value as Role)}
                  disabled={p.role === "host"}
                >
                  <option value="moderator">Moderator</option>
                  <option value="participant">Participant</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="btn-small" onClick={() => onTransferHost(p.id)} title="Transfer host">
                  👑
                </button>
                <button className="btn-small btn-danger" onClick={() => onRemove(p.id)} title="Remove">
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
