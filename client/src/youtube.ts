/** Extracts an 11-char YouTube video id from a URL or returns the id as-is. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Bare id
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1, 12) || null;
    }
    if (url.searchParams.get("v")) return url.searchParams.get("v");
    // /embed/<id> or /shorts/<id>
    const m = url.pathname.match(/\/(embed|shorts)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[2];
  } catch {
    /* not a URL */
  }
  return null;
}

/** Loads the YouTube IFrame API script once and resolves when ready. */
let apiPromise: Promise<void> | null = null;
export function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).YT?.Player) return resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    (window as any).onYouTubeIframeAPIReady = () => resolve();
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error("Failed to load the YouTube IFrame API"));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}
