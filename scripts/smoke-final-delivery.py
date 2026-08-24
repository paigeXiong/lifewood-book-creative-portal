import argparse
import http.cookiejar
import json
import sqlite3
import urllib.error
import urllib.request
import uuid


def client(base_url: str):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(method: str, path: str, payload=None, headers=None):
        body = None if payload is None else json.dumps(payload).encode()
        merged = {"Accept": "application/json", **(headers or {})}
        if body is not None:
            merged["Content-Type"] = "application/json"
        response = opener.open(urllib.request.Request(base_url + path, body, merged, method=method))
        content = response.read()
        return json.loads(content) if content else None

    def write(method: str, path: str, payload):
        token = request("GET", "/api/auth/csrf")["token"]
        return request(method, path, payload, {"X-CSRF-TOKEN": token})

    return opener, request, write


def multipart_file(field: str, name: str, content_type: str, content: bytes, note: str):
    boundary = "----lifewood" + uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\n{note}\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{name}\"\r\nContent-Type: {content_type}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    return boundary, b"".join(parts)


def mp4_box(kind: bytes, payload: bytes):
    return (8 + len(payload)).to_bytes(4, "big") + kind + payload


def video_fixture():
    ftyp = mp4_box(b"ftyp", b"isom" + (512).to_bytes(4, "big") + b"isommp42")
    handler = mp4_box(b"hdlr", b"\0\0\0\0" + b"\0\0\0\0" + b"vide")
    description = mp4_box(b"stsd", b"\0\0\0\0" + (1).to_bytes(4, "big") + mp4_box(b"avc1", b""))
    sizes = mp4_box(b"stsz", b"\0\0\0\0" + (4).to_bytes(4, "big") + (1).to_bytes(4, "big"))
    sample_table = mp4_box(b"stbl", description + sizes)
    media = mp4_box(b"mdia", handler + mp4_box(b"minf", sample_table))
    return ftyp + mp4_box(b"moov", mp4_box(b"trak", media)) + mp4_box(b"mdat", b"\0\0\0\1")


def empty_video_shell():
    ftyp = mp4_box(b"ftyp", b"isom" + (512).to_bytes(4, "big") + b"isommp42")
    handler = mp4_box(b"hdlr", b"\0\0\0\0" + b"\0\0\0\0" + b"vide")
    return ftyp + mp4_box(b"moov", mp4_box(b"trak", mp4_box(b"mdia", handler)))


def delivery_request(base_url: str, project_id: str, token: str, content: bytes):
    boundary, body = multipart_file("file", "final.mp4", "video/mp4", content, "Emergency final delivery")
    return urllib.request.Request(f"{base_url}/api/admin/projects/{project_id}/deliveries", body, {"Content-Type": f"multipart/form-data; boundary={boundary}", "X-CSRF-TOKEN": token, "Accept": "application/json"}, method="POST")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--database", required=True)
    args = parser.parse_args()

    owner_opener, owner_request, owner_write = client(args.base_url)
    owner = owner_write("POST", "/api/auth/bootstrap", {"displayName": "Delivery Owner", "email": "owner@delivery.local", "password": "OwnerDelivery!2026"})
    customer = owner_write("POST", "/api/admin/users", {"displayName": "Delivery Customer", "email": "customer@delivery.local", "password": "CustomerDelivery!2026", "role": "customer"})

    customer_opener, customer_request, customer_write = client(args.base_url)
    customer_write("POST", "/api/auth/login", {"email": "customer@delivery.local", "password": "CustomerDelivery!2026", "rememberMe": False})
    draft = customer_write("POST", "/api/projects", {})
    token = owner_request("GET", "/api/auth/csrf")["token"]
    video = video_fixture()
    try:
        owner_opener.open(delivery_request(args.base_url, draft["id"], token, video))
        raise RuntimeError("A draft project accepted a final delivery.")
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise

    with sqlite3.connect(args.database) as database:
        database.execute("UPDATE projects SET status = 'submitted' WHERE id = ?", (draft["id"],))
        database.commit()

    fake_video = mp4_box(b"ftyp", b"isom" + (512).to_bytes(4, "big") + b"isommp42")
    try:
        owner_opener.open(delivery_request(args.base_url, draft["id"], token, fake_video))
        raise RuntimeError("A container without a video track was accepted.")
    except urllib.error.HTTPError as error:
        if error.code != 400:
            raise

    try:
        owner_opener.open(delivery_request(args.base_url, draft["id"], token, empty_video_shell()))
        raise RuntimeError("An empty video container was accepted.")
    except urllib.error.HTTPError as error:
        if error.code != 400:
            raise

    delivery = json.loads(owner_opener.open(delivery_request(args.base_url, draft["id"], token, video)).read())
    if delivery["fileName"] != "final.mp4":
        raise RuntimeError("Final delivery metadata was not returned.")

    visible = customer_request("GET", f"/api/projects/{draft['id']}/deliveries")
    if [item["id"] for item in visible] != [delivery["id"]]:
        raise RuntimeError("The customer could not see the published final delivery.")

    owner_write("POST", "/api/admin/users", {"displayName": "Other Customer", "email": "other@delivery.local", "password": "OtherCustomer!2026", "role": "customer"})
    other_opener, other_request, other_write = client(args.base_url)
    other_write("POST", "/api/auth/login", {"email": "other@delivery.local", "password": "OtherCustomer!2026", "rememberMe": False})
    try:
        other_request("GET", f"/api/projects/{draft['id']}/deliveries")
        raise RuntimeError("Another customer accessed the delivery list.")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    try:
        other_opener.open(f"{args.base_url}/api/projects/{draft['id']}/deliveries/{delivery['id']}/file")
        raise RuntimeError("Another customer downloaded the final delivery.")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    detail = owner_request("GET", f"/api/admin/projects/{draft['id']}")
    if detail["workflowStatus"] != "completed":
        raise RuntimeError("Publishing did not apply the completed shortcut status.")
    owner_write("PUT", f"/api/admin/projects/{draft['id']}/workflow", {"workflowStatus": "in_production", "priority": "urgent", "assigneeUserId": owner["id"]})
    adjusted = owner_request("GET", f"/api/admin/projects/{draft['id']}")
    if adjusted["workflowStatus"] != "in_production":
        raise RuntimeError("The workflow status was not manually adjustable after delivery.")
    downloaded = customer_opener.open(f"{args.base_url}/api/projects/{draft['id']}/deliveries/{delivery['id']}/file").read()
    if downloaded != video:
        raise RuntimeError("The customer download did not match the uploaded final video.")

    print("Emergency final delivery smoke test passed.")
    print("Upload and immediate customer visibility: passed")
    print("Automatic completed shortcut and later manual status change: passed")
    print("Owner-scoped customer listing and download: passed")


if __name__ == "__main__":
    main()
