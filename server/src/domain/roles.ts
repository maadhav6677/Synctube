/**
 * Role-Based Access Control (RBAC) definitions.
 *
 * A single source of truth for which permission each role holds. The
 * MessageHandler consults `can()` before mutating room state so that a
 * malicious/hacked client cannot, for example, emit `change_video` as a
 * plain Participant.
 */

export type Role = "host" | "moderator" | "participant" | "viewer";

export const ROLES: Role[] = ["host", "moderator", "participant", "viewer"];

/** Every distinct capability the backend guards. */
export type Permission =
  | "playback" // play / pause / seek
  | "change_video"
  | "assign_role"
  | "remove_participant"
  | "transfer_host";

/**
 * Permission matrix. `host` is intentionally the superset. `moderator`
 * gets playback + change_video (per the spec) but not user management.
 * `participant` and `viewer` are watch-only (viewer is an alias).
 */
const MATRIX: Record<Role, Set<Permission>> = {
  host: new Set<Permission>([
    "playback",
    "change_video",
    "assign_role",
    "remove_participant",
    "transfer_host",
  ]),
  moderator: new Set<Permission>(["playback", "change_video"]),
  participant: new Set<Permission>([]),
  viewer: new Set<Permission>([]),
};

/** Returns true when `role` is allowed to perform `permission`. */
export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

/** Roles a host is allowed to assign to others (cannot mint another host directly). */
export const ASSIGNABLE_ROLES: Role[] = ["moderator", "participant", "viewer"];

export function isAssignableRole(role: string): role is Role {
  return ASSIGNABLE_ROLES.includes(role as Role);
}

export function isValidRole(role: string): role is Role {
  return ROLES.includes(role as Role);
}
