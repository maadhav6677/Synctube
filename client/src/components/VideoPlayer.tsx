import { useEffect, useRef } from "react";
import {
  loadYouTubeAPI,
  type YouTubePlayer,
  type YouTubePlayerErrorEvent,
  type YouTubePlayerStateEvent,
} from "../youtube";
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
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const suppress = useRef(false);
  const suppressTimer = useRef<number | null>(null);
  const lastVideoId = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const canControlRef = useRef(canControl);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekRef = useRef(onSeek);
  snapshotRef.current = snapshot;
  canControlRef.current = canControl;
  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onSeekRef.current = onSeek;

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const YT = window.YT;
        if (!YT) {
          onError("Unable to initialize the YouTube player.");
          return;
        }
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
      if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
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

    suppressLocalEvents(initial ? 800 : 500);

    // Cue a newly selected video and wait for YouTube's CUED event before
    // applying its play/pause state. Calling playVideo immediately after
    // cueVideoById is unreliable on slower client connections.
    const videoChanged = Boolean(s.videoId && s.videoId !== lastVideoId.current);
    if (videoChanged && s.videoId) {
      lastVideoId.current = s.videoId;
      player.cueVideoById({ videoId: s.videoId, startSeconds: s.currentTime });
    } else if (s.videoId) {
      applyPlaybackState(s);
    }
  }

  function applyPlaybackState(s: VideoSnapshot) {
    const player = playerRef.current;
    if (!player || !s.videoId) return;

    // Re-sync the playhead if the browser has visibly drifted from the room.
    const currentTime = player.getCurrentTime?.() ?? 0;
    if (Math.abs(currentTime - s.currentTime) > 0.75) {
      player.seekTo(s.currentTime, true);
    }

    if (s.playState === "playing") player.playVideo?.();
    else player.pauseVideo?.();
  }

  function suppressLocalEvents(duration: number) {
    suppress.current = true;
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      suppress.current = false;
      suppressTimer.current = null;
    }, duration);
  }

  function onPlayerStateChange(e: YouTubePlayerStateEvent) {
    const YT = window.YT;
    if (!YT) return;

    // A cue is asynchronous. Apply the newest server state only after the
    // selected video is ready, so a host's already-playing video starts for
    // participants as well as for late joiners.
    if (e.data === YT.PlayerState.CUED) {
      suppressLocalEvents(500);
      applyPlaybackState(snapshotRef.current);
      return;
    }

    if (!canControlRef.current) {
      // Participants may watch but cannot create a competing local timeline.
      // This also corrects a keyboard/media-key action that reaches YouTube.
      if (!suppress.current) applySnapshot(snapshotRef.current, false);
      return;
    }

    if (suppress.current) return;
    const player = playerRef.current;
    const t = player?.getCurrentTime() ?? 0;

    if (e.data === YT.PlayerState.PLAYING) {
      // Distinguish a real play from a seek-while-playing using the last known state.
      if (snapshotRef.current.playState !== "playing") onPlayRef.current(t);
      else onSeekRef.current(t);
    } else if (e.data === YT.PlayerState.PAUSED) {
      onPauseRef.current(t);
    }
  }

  function onPlayerError(e: YouTubePlayerErrorEvent) {
    const code = e.data;
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
      {!canControl && snapshot.videoId && <div className="video-lock" aria-hidden="true" />}
      {!snapshot.videoId && (
        <div className="video-empty">No video loaded. {canControl ? "Paste a YouTube URL below." : "Waiting for host…"}</div>
      )}
    </div>
  );
}
