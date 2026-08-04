import { useEffect, useRef } from "react";
import { loadYouTubeAPI } from "../youtube";
import type { VideoSnapshot } from "../types";

interface Props {
  /** Latest authoritative state from the server. */
  snapshot: VideoSnapshot;
  /** Whether this client may drive playback (host/moderator). */
  canControl: boolean;
  /** Emitted when a controller performs a local play/pause/seek. */
  onPlay: (time: number) => void;
  onPause: (time: number) => void;
  onSeek: (time: number) => void;
  /** Reports a YouTube error in language the room host can act on. */
  onError: (message: string) => void;
}

/**
 * Wraps the YouTube IFrame player and keeps it in lock-step with the server
 * snapshot. The core challenge is avoiding feedback loops: applying a remote
 * state change fires the same YT events a human action would. We guard with a
 * `suppress` ref so programmatic updates don't echo back to the server.
 */
export function VideoPlayer({ snapshot, canControl, onPlay, onPause, onSeek, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const suppress = useRef(false);
  const lastVideoId = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const YT = (window as any).YT;
        playerRef.current = new YT.Player(containerRef.current, {
          width: "100%",
          height: "100%",
          // Use YouTube's privacy-enhanced player. It avoids depending on
          // third-party YouTube cookies while retaining the IFrame API.
          host: "https://www.youtube-nocookie.com",
          // Start with an empty player. The authoritative room snapshot is
          // applied in onReady so newly selected and already-selected videos
          // follow the exact same load path.
          playerVars: {
            controls: 1,
            rel: 0,
            modestbranding: 1,
            // The IFrame API uses this to verify messages from the embedding
            // page. It is required for reliable playback on localhost and in
            // the deployed application.
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              applySnapshot(snapshotRef.current, true);
            },
            onStateChange: onPlayerStateChange,
            onError: onPlayerError,
          },
        });
      })
      .catch(() => {
        if (!cancelled) onError("Unable to load the YouTube player. Check your network or content blocker.");
      });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to server snapshots.
  useEffect(() => {
    if (readyRef.current) applySnapshot(snapshot, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  function applySnapshot(s: VideoSnapshot, initial: boolean) {
    const player = playerRef.current;
    if (!player) return;

    suppress.current = true;

    // Load or cue a different video. A newly selected video starts paused, so
    // `cueVideoById` is the correct YouTube API call: it shows a ready player
    // without racing `loadVideoById` against an immediate pause.
    const videoChanged = Boolean(s.videoId && s.videoId !== lastVideoId.current);
    if (videoChanged && s.videoId) {
      lastVideoId.current = s.videoId;
      if (s.playState === "playing") {
        player.loadVideoById({ videoId: s.videoId, startSeconds: s.currentTime });
      } else {
        player.cueVideoById({ videoId: s.videoId, startSeconds: s.currentTime });
      }
    } else if (s.videoId) {
      // Re-sync the playhead if we've drifted more than ~1s.
      const cur = player.getCurrentTime?.() ?? 0;
      if (Math.abs(cur - s.currentTime) > 1) {
        player.seekTo(s.currentTime, true);
      }
    }

    // The cue branch above is already paused. Only control playback for a
    // video that was already loaded so we never interrupt its initial load.
    if (!videoChanged && s.videoId) {
      if (s.playState === "playing") player.playVideo?.();
      else player.pauseVideo?.();
    }

    // Release the guard after the YT events settle.
    setTimeout(() => (suppress.current = false), initial ? 800 : 400);
  }

  function onPlayerStateChange(e: any) {
    if (!canControl || suppress.current) return;
    const YT = (window as any).YT;
    const player = playerRef.current;
    const t = player?.getCurrentTime?.() ?? 0;

    if (e.data === YT.PlayerState.PLAYING) {
      // Distinguish a real play from a seek-while-playing using the last known state.
      if (snapshotRef.current.playState !== "playing") onPlay(t);
      else onSeek(t);
    } else if (e.data === YT.PlayerState.PAUSED) {
      onPause(t);
    }
  }

  function onPlayerError(e: any) {
    const code = Number(e?.data);
    const message =
      code === 100
        ? "YouTube says this video is private, removed, or unavailable."
        : code === 101 || code === 150
          ? "This video's owner has disabled embedded playback on YouTube."
          : code === 153
            ? "YouTube could not verify this page. Disable content blockers and reload."
            : code === 2
              ? "YouTube rejected the video ID. Try pasting the video's standard URL."
              : "YouTube could not play this video. Try another embeddable video.";
    onError(message);
  }

  return (
    <div className="video-wrap">
      <div ref={containerRef} className="video-frame" />
      {!snapshot.videoId && (
        <div className="video-empty">No video loaded. {canControl ? "Paste a YouTube URL below." : "Waiting for host…"}</div>
      )}
    </div>
  );
}
