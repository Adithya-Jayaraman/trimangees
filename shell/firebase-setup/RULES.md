# Firebase rules for TrimangeesOS

The OS talks to Firebase over plain REST with **no login**, so your rules have
to allow anonymous access. Paste these once in the Firebase console.

---

## 1. Realtime Database  (required)

Console -> Realtime Database -> **Rules**.

Simplest (open — anyone with the URL can read/write; fine for a personal
family project, and it's what your other Trimangees databases already use):

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Slightly tighter — only the two branches the OS actually uses are open:

```json
{
  "rules": {
    "apps":          { ".read": true, ".write": true },
    "trimangees-os": { ".read": true, ".write": true }
  }
}
```

- `/apps` — your app list (read to show them, write for the in-OS "Add app").
- `/trimangees-os` — per-user wallpaper/accent sync **and** file sync
  (each account's home lives at `trimangees-os/<user>/fs`). The single
  `trimangees-os` rule above already covers this — no extra rule needed.

---

## 2. Storage  (required for the in-OS "Add an app" uploader)

The Add-an-app form uploads your HTML straight into the bucket and Remove
deletes it, so Storage needs **read + write** on `apps/`. In rules v2,
`allow read` covers BOTH downloading a file (so a webview can open it) AND
listing the folder (auto-discovery); `allow write` covers upload + delete.
This opens just the `apps/` folder and leaves the rest of the bucket locked:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /apps/{allPaths=**} {
      allow read, write: if true;    // download + list + upload + delete
    }
    // everything outside apps/ stays private
  }
}
```

> This lets anyone with your bucket name read and write files under `apps/`.
> That's fine for a personal family project; if you'd rather lock writes,
> keep `allow read: if true;` only and upload apps from the Firebase console
> instead — the OS will still show and run them, you just can't add from the
> Settings form.

---

## Test it
1. Set the RTDB rules above.
2. Firebase console -> Realtime Database -> import `EXAMPLE-apps.json` at the
   root (or hand-add one child under `/apps`).
3. In the OS: **Settings -> Apps -> Reload from cloud** (or just reboot).
   Your new apps appear. The example "Sticky Notes" points at a `storagePath`,
   so also upload `sticky-notes.html` to Storage under `apps/` for it to open
   — or change its entry to a `url` you host.
