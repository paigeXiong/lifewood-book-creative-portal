export function followOidc(url: string) {
  if (!/^\/api\/auth\/oidc\/authorize\?ticket=[A-F0-9]{64}$/.test(url)) throw new Error("Invalid login destination");
  window.location.assign(url);
}
