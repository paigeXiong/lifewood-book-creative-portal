export const maxNoticePages=50;
export function readNoticeListState(search:string) {
 const params=new URLSearchParams(search);
 const status=params.get("status")??"",placement=params.get("placement")??"";
 const rawPages=params.get("pages")??"1";
 return {
  search:(params.get("q")??"").trim().slice(0,160),
  status:["draft","scheduled","published","withdrawn"].includes(status)?status:"",
  placement:["login","personal","banner"].includes(placement)?placement:"",
  pages:/^[1-9]\d*$/.test(rawPages)?Math.min(maxNoticePages,Number(rawPages)):1,
 };
}
export function noticeListSearch(state:ReturnType<typeof readNoticeListState>) {
 const params=new URLSearchParams();
 if(state.search)params.set("q",state.search);
 if(state.status)params.set("status",state.status);
 if(state.placement)params.set("placement",state.placement);
 if(state.pages>1)params.set("pages",String(state.pages));
 return params.size?`?${params}`:"";
}
export function noticeReturnPath(locale:string,search:unknown) {
 return `/${locale}/announcements${noticeListSearch(readNoticeListState(typeof search==="string"?search:""))}`;
}
