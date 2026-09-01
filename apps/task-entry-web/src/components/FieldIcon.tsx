import type { ReactNode } from "react";

type FieldIconName =
  | "organization" | "person" | "email" | "phone" | "brand" | "project" | "target" | "calendar"
  | "audience" | "book" | "title" | "author" | "genre" | "highlight" | "summary" | "language"
  | "duration" | "platform" | "role" | "story" | "personality" | "appearance" | "age" | "gender"
  | "clothing" | "emotion" | "voice" | "style" | "image" | "pace" | "tone" | "accent"
  | "pronunciation" | "message" | "scene" | "preference" | "music" | "avoid";

const paths: Record<FieldIconName, ReactNode> = {
  organization: <><path d="M4 20V6l8-3 8 3v14" /><path d="M8 9h1m6 0h1M8 13h1m6 0h1M8 17h1m6 0h1M10 20v-4h4v4" /></>,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-4.2 2.9-6.3 7-6.3s6.4 2.1 7 6.3" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></>,
  phone: <path d="M7.2 3.8 10 8 8.2 9.8a15.8 15.8 0 0 0 6 6l1.8-1.8 4.2 2.8-.8 3a2 2 0 0 1-2 1.4C9.4 20.3 3.7 14.6 2.8 6.6a2 2 0 0 1 1.4-2l3-.8Z" />,
  brand: <><path d="M4 4h7l9 9-7 7-9-9V4Z" /><circle cx="8" cy="8" r="1.2" /></>,
  project: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6V4h8v2M3 11h18M10 11v2h4v-2" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="m12 12 6-6m-2 0h2v2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M7 14h2m3 0h2m3 0h1M7 17h2m3 0h2" /></>,
  audience: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6m0-5c3.4 0 5.3 1.7 5.8 5" /></>,
  book: <><path d="M4 4.5h6a3 3 0 0 1 3 3V20a3 3 0 0 0-3-3H4V4.5Z" /><path d="M20 4.5h-4a3 3 0 0 0-3 3V20a3 3 0 0 1 3-3h4V4.5Z" /></>,
  title: <><path d="M5 6h14M12 6v13M8 19h8" /></>,
  author: <><circle cx="8" cy="8" r="3" /><path d="M3 19c.5-3.6 2.2-5.4 5-5.4s4.5 1.8 5 5.4M15 6h6m-6 4h6m-6 4h4" /></>,
  genre: <><path d="M4 5h6l2 3h8v11H4V5Z" /><path d="M4 9h16" /></>,
  highlight: <><path d="m12 3 1.7 5.3H19l-4.3 3.2 1.7 5.2-4.4-3.2-4.4 3.2 1.7-5.2L5 8.3h5.3L12 3Z" /></>,
  summary: <><path d="M5 4h14v16H5V4Z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z" /></>,
  duration: <><circle cx="12" cy="13" r="8" /><path d="M9 3h6M12 13V8m0 5 3 2" /></>,
  platform: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6m-7.6 6 7.6 3.6" /></>,
  role: <><path d="M5 20v-2a7 7 0 0 1 14 0v2" /><circle cx="12" cy="8" r="4" /><path d="m17 4 1 2 2 .5-1.5 1.5.4 2.1" /></>,
  story: <><path d="M5 4h14v16H5V4Z" /><path d="M8 8h8M8 12h6M8 16h4" /></>,
  personality: <><path d="M8 4a4 4 0 0 0-3.5 6A4 4 0 0 0 8 16v4h4V4H8Zm8 0a4 4 0 0 1 3.5 6A4 4 0 0 1 16 16v4h-4V4h4Z" /></>,
  appearance: <><path d="M4 12s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  age: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  gender: <><circle cx="10" cy="10" r="5" /><path d="m14 6 5-5m-4 0h4v4M10 15v6m-3-3h6" /></>,
  clothing: <><path d="m8 4-5 4 3 4 2-1v9h8v-9l2 1 3-4-5-4c-.6 1.5-1.9 2.3-4 2.3S8.6 5.5 8 4Z" /></>,
  emotion: <><circle cx="12" cy="12" r="9" /><path d="M8 10h.01M16 10h.01M8 15c1.2 1.2 2.5 1.8 4 1.8s2.8-.6 4-1.8" /></>,
  voice: <><path d="M6 9v6m4-9v12m4-15v18m4-12v6" /></>,
  style: <><path d="m12 3 2.2 5.2L20 10l-4.4 3.7.2 5.8L12 16.7l-3.8 2.8.2-5.8L4 10l5.8-1.8L12 3Z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5" /></>,
  pace: <><path d="M4 17h3l2-5 3 8 3-12 2 9h3" /></>,
  tone: <><path d="M4 16V8m4 11V5m4 16V3m4 15V6m4 10V8" /></>,
  accent: <><path d="M4 15c2-5 4-7.5 6-7.5S14 10 16 15m-8 3h8M18 6h2m-1-1v2" /></>,
  pronunciation: <><path d="M4 9v6m4-9v12m4-15v18m4-12v6m4-3v1" /></>,
  message: <><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M8 9h8m-8 4h5" /></>,
  scene: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m8 5 2 4m4-4 2 4M3 9h18" /></>,
  preference: <><path d="M5 7h14M8 4v6M5 17h14m-4-3v6M5 12h14m-7-3v6" /></>,
  music: <><path d="M9 18V6l10-2v12M9 10l10-2" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  avoid: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
};

export function FieldIcon({ name }: { name: FieldIconName }) {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </g>
    </svg>
  );
}
