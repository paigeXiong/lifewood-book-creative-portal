import type { ReferenceAsset } from "@lifewood/domain";

function safeLegacyUrls(urls: string[]) {
  return urls.filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

export function ReferenceLinks({
  assets = [],
  urls = [],
  empty = true,
}: {
  assets?: ReferenceAsset[];
  urls?: string[];
  empty?: boolean;
}) {
  const legacyUrls = safeLegacyUrls(urls);
  if (assets.length === 0 && legacyUrls.length === 0)
    return empty ? <>—</> : null;
  return (
    <ul className="receipt-links">
      {assets.map((asset) => (
        <li key={asset.id}>
          <a href={asset.url}>{asset.fileName}</a>
        </li>
      ))}
      {legacyUrls.map((url) => (
        <li key={`legacy-${url}`}>
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </li>
      ))}
    </ul>
  );
}
