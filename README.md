# TrimangeesOS 3.1 - START HERE

Everything below is written so you can follow it step by step. Total hands-on time: about 20 minutes
(plus waiting while GitHub builds the ISO for you).

## Rule #1: nothing goes on C: or D:

- The ISO is built by GitHub, not by your PC.
- You will save the ISO and the virtual machine only on the TRIMANGEES drive (call it T: below; for you it is E:\TRIMANGEES - use its real letter).
- Two settings make sure VirtualBox does not sneak files onto C: (see Part 3, steps 1 and 2).

## Part 1 - Let GitHub build it (about 5 minutes of your time)

1. Open github.com and sign in (make a free account if you need one).
2. Click the + at the top right, then **New repository**. Name: `TrimangeesOS`. Choose **Private**. Click **Create repository**.
3. Click **uploading an existing file**. Unzip the package first, open the TrimangeesOS folder, select everything
   inside (folders `shell`, `system`, `build`, and this README) and drag it into the page. Click **Commit changes**.
4. The hidden `.github` folder often does not upload by drag and drop, so do this one extra step:
   click **Add file > Create new file**, type exactly `.github/workflows/build-iso.yml` as the name
   (typing the slashes makes the folders), open the file `build-iso.yml` from the package in Notepad,
   copy everything, paste it in, click **Commit changes**.
5. Click the **Actions** tab. Choose **Build TrimangeesOS ISO** on the left, then **Run workflow**. Wait
   about an hour. You can close the tab and come back.
6. When it shows a green tick, click **Releases** (right side of the repo page) and download the ISO file(s).
   **Your browser will want to save to C: (Downloads)**. Avoid that: right-click each download link,
   choose **Save link as**, and pick the TRIMANGEES drive. (Or in Chrome: Settings > Downloads > turn on
   "Ask where to save each file".)
7. If there are two files, `TrimangeesOS.iso.part00` and `.part01`, open Command Prompt, type `T:` then Enter, then
   `copy /b TrimangeesOS.iso.part00 + TrimangeesOS.iso.part01 TrimangeesOS.iso`

## Part 2 - If the build fails

Open the failed run in Actions, copy the last 30 red lines and send them to me. Do not try to fix it yourself.

## Part 3 - Run it in VirtualBox (keeps everything on the drive)

1. **VirtualBox > File > Preferences > General > Default Machine Folder**: change it to `T:\VMs`. OK.
2. Click **New**. Name: TrimangeesOS. **Folder: T:\VMs** (check it says T:, not C:). ISO image: pick the ISO from T:.
   Type Linux, Version Ubuntu (64-bit). Tick "Skip unattended installation" if offered.
3. Memory 4096 MB (more is better), CPUs 2 or more.
4. Hard disk: **Create a virtual hard disk now**, size **50 GB**, leave "Pre-allocate full size" OFF. Finish.
   This disk is created inside T:\VMs, so it is your TriFS and it sits on the drive.
5. Select the VM > Settings > Display: Graphics Controller **VMSVGA**, Video Memory 128 MB. OK.
6. Start the VM. The ISO boots to the setup wizard.

## First boot: the wizard does it all

It walks you through, one screen at a time: the drive (it finds your blank 50 GB disk and sets it up as TriFS),
your name, PIN and picture, copying your old cloud apps into TriFS (with your OK), cloud sync on/off, colours.
When it finishes, sign in with your PIN. Later you can change anything in Settings.

## Everyday use

- **Windows programs (.exe/.msi):** double-click in Files, or right-click > Run with Wine. Installed programs appear in the Start menu.
- **Your own apps:** Settings > Apps > Add a program, or drop an .exe / .html / .AppImage into the Applications folder.
- **Right-click anywhere in Files or on the desktop > New:** folder, text, HTML, Python, script, CSV and about 20 more, or "Empty file (any type)".
- **Desktop shortcuts to anything:** right-click a file, folder or Start-menu app > Create desktop shortcut. Or desktop right-click > New > Shortcut (web address, folder path, or app name).
- **Terminal:** type any Linux command. Programs that ask a question work. For full-screen programs like nano, htop, python, type `xterm` for a full terminal window.
  You have full sudo. Software you install with `apt` is now kept on TriFS and is still there after a restart (it belongs to the ISO build you installed it on).
- **App Store:** Start > App Store. VLC, LibreOffice, GIMP, VS Code and more (from Flathub, stored on TriFS). They then show up in Start.
- **Files:** Ctrl+click / Shift+click to select many, Ctrl+C / X / V, Delete sends to the Recycle Bin (left side), Space previews, pictures show thumbnails, drag files between folders (hold Ctrl to copy).
  Right-click: Compress to ZIP, Extract here, Open terminal here, Pin to taskbar, Create desktop shortcut.
- **Bottom right:** desktop number (4 virtual desktops, Ctrl+Alt+Left/Right), sound, Wi-Fi, notifications (history), calendar (click the clock), and the thin button at the far right = Show desktop.
- **Windows (VirtualBox):** Settings > VirtualBox explains clipboard, drag and drop and shared folders (all one-time clicks in the VirtualBox menu). Also tick **View > Auto-resize Guest Display** for a full-screen desktop.
- **Windows programs:** Settings > Windows programs has one-click add-ons (Visual C++, .NET, fonts) if an .exe will not start.
- **Backups:** your home folder is copied to TriFS once a day (last 3 kept). Settings > Backups.
- **Themes:** Settings > Themes & Wallpapers (desktop and sign-in screen).
- **If something breaks:** Settings > Developer > **Copy diagnostics**, then paste it to me.
- **Updating without a new ISO:** each build also has a small file `shell-update.zip` on the Releases page. Settings > Desktop updates > install it (or press "Get the latest update"). If the desktop crashes 3 times it goes into safe mode and puts the bad update aside by itself.
- **Chrome and the Trimangees Browser** are both in the Start menu. Downloads go to Downloads on TriFS.
- **Safe shutdown:** Start > power > Shut down (it closes TriFS properly).
- **Emergency text console:** Ctrl+Alt+F2, user `trimangees`, password `trimangees`. Back: Ctrl+Alt+F1.

## Honest limits

- Booting it on the real computer (instead of Windows) should work from a USB stick but is untested. Keep Windows until you have tried it.
- Windows programs needing DirectX 12 or anti-cheat will not run. Wine is good, not perfect.
- Chrome, Wine's mono/gecko add-ons are downloaded during the GitHub build; if one is missing the build still works and says so in its log.
