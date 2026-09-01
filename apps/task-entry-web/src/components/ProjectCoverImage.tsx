import { useState } from "react";
import placeholderCoverUrl from "../assets/project-cover-placeholder.svg";

export function ProjectCoverImage({ coverUrl, coverAlt, placeholderAlt, className, width, height, loading }: {
  coverUrl?: string | null;
  coverAlt: string;
  placeholderAlt: string;
  className: string;
  width: number;
  height: number;
  loading?: "eager" | "lazy";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasUsableCover = Boolean(coverUrl) && failedUrl !== coverUrl;

  return <img
    className={`${className}${hasUsableCover ? "" : " cover-placeholder"}`}
    src={hasUsableCover ? coverUrl! : placeholderCoverUrl}
    alt={hasUsableCover ? coverAlt : placeholderAlt}
    width={width}
    height={height}
    loading={loading}
    onError={() => { if (hasUsableCover && coverUrl) setFailedUrl(coverUrl); }}
  />;
}
