import { afterEach, describe, expect, it, vi } from "vitest";
import { projectService } from "@lifewood/api-client";

afterEach(() => vi.unstubAllGlobals());
describe("asset transfer transport", () => {
  it("passes locale, cancellation, progress and the same retry identifier to the server", async () => {
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({token:"token"}),{status:200})));
    const xhr = { upload: {} as XMLHttpRequestUpload, status:200, responseText:'{"draft":{"version":2},"asset":{"id":"stored"}}', open:vi.fn(), setRequestHeader:vi.fn(), send:vi.fn(), abort:vi.fn(), withCredentials:false, onload:null as null|(()=>void), onerror:null as null|(()=>void), onabort:null as null|(()=>void) };
    vi.stubGlobal("XMLHttpRequest",vi.fn(()=>xhr));
    const progress=vi.fn();const controller=new AbortController();const file=new File(["png"],"test.png",{type:"image/png"});
    const promise=projectService.uploadAsset("project/1",1,"character-reference",file,"en-US",controller.signal,"character-1",{uploadId:"same-attempt",onProgress:progress});
    await vi.waitFor(()=>expect(xhr.send).toHaveBeenCalledOnce());
    expect(xhr.open).toHaveBeenCalledWith("POST","/api/projects/project%2F1/files?categoryId=character-reference");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("Accept-Language","en-US");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-CSRF-TOKEN","token");
    const body=xhr.send.mock.calls[0][0] as FormData;
    expect(body.get("uploadId")).toBe("same-attempt");expect(body.get("characterId")).toBe("character-1");expect(body.get("file")).toBe(file);
    xhr.upload.onprogress!.call(xhr as unknown as XMLHttpRequest, {lengthComputable:true,loaded:30,total:100} as ProgressEvent);
    expect(progress).toHaveBeenLastCalledWith(30);
    xhr.onload!();await expect(promise).resolves.toMatchObject({draft:{version:2}});
    expect(progress).toHaveBeenLastCalledWith(100);
    const second=projectService.uploadAsset("p",2,"book-cover",file,"zh-CN",controller.signal,undefined,{uploadId:"same-attempt",onProgress:progress});
    await vi.waitFor(()=>expect(xhr.send).toHaveBeenCalledTimes(2));
    xhr.abort.mockImplementation(()=>xhr.onabort?.());controller.abort();
    await expect(second).rejects.toMatchObject({name:"AbortError"});expect(xhr.abort).toHaveBeenCalledOnce();
  });
});
