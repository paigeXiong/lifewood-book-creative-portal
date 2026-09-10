import { safeLinkUrl } from "@lifewood/domain";
import type { ReferenceAsset } from "@lifewood/domain";

function safeLegacyUrls(urls: string[]) {
  return urls.flatMap(value => { const safe = safeLinkUrl(value); return safe ? [safe] : []; });
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
          <a href={safeLinkUrl(asset.url, true)}>{asset.fileName}</a>
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
