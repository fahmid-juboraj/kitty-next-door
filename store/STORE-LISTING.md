# Store listing kit: Kitty Next Door Live

Everything to paste into Firefox Add-ons (AMO) and Microsoft Edge Add-ons (Partner Center). The Chrome Web Store uses the same texts and images.

## Files to upload

| Where | File |
|---|---|
| Firefox: package | `release-upload/kitty-next-door-live-firefox-0.1.0.zip` |
| Firefox: source code (asked for because the code is bundled) | `release-upload/kitty-next-door-live-source-0.1.0.zip` |
| Edge: package | `release-upload/kitty-next-door-live-edge-0.1.0.zip` |
| Chrome: package | `release-upload/kitty-next-door-live-chrome-0.1.0.zip` |
| Logo (Edge needs 300×300) | `assets/icon-300.png` |
| Screenshots (1280×800) | `store/screenshot-1-visit.png`, `store/screenshot-2-popup.png`, `store/screenshot-3-landing.png` |
| Small promo tile (Edge/Chrome, 440×280) | `store/promo-440x280.png` |
| Large promo tile (Edge 1400×560, optional) | `store/promo-1400x560.png` |

## Common fields

- **Name:** Kitty Next Door Live (comes from the manifest)
- **Short description / summary** (comes from the manifest):
  A cat that keeps you company on every page, and really walks over to visit your friends.
- **Website:** https://kitty-next-door.kittynextdoor.workers.dev
- **Support:** https://github.com/fahmid-juboraj/kitty-next-door/issues
- **Privacy policy URL:** https://github.com/fahmid-juboraj/kitty-next-door/blob/main/realtime/PRIVACY.md
- **Source code:** https://github.com/fahmid-juboraj/kitty-next-door

### Description (paste as is; about 1,300 characters)

```
Kitty Next Door is a little cat that lives at the bottom of your web pages and keeps you company while you work, study or browse.

• It walks, sits, loafs and naps on every page, and clicks pass straight through it, so it never gets in your way.
• Its eyes follow your cursor, and it slow-blinks at you, which is how cats say "I trust you".
• Step away from the computer and it curls up to sleep. Come back and it wakes up to greet you.
• Rub your mouse over it to pet it: it purrs and shows little hearts. Click it for a "mrrp". Pick it up by the scruff and it looks deeply unimpressed.

VISIT YOUR FRIENDS, IN REAL TIME
Every cat has a short friend code. Add a friend once, then send your cat with a note and a small gift (a fish, a ball of yarn, a flower or a toy mouse). Your cat walks off your screen and appears on your friend's a moment later, sits with their cat and delivers your note. It comes home after a couple of hours, or whenever you call it. If your friend is offline, your cat waits and walks in when they're back.

PRIVATE BY DESIGN
The cat never reads the pages you visit, what you type or your browsing history. Only what visits need is sent: your cat's name and coat, the name you choose to show friends, your friends list and your visit notes. You can delete your account at any time from the popup.

Choose from four coats: Ginger, Grey Tabby, Cream and Midnight. Free, no ads.
```

## Firefox Add-ons (addons.mozilla.org)

1. Sign in at https://addons.mozilla.org/developers/, then choose **Submit a New Add-on → On this site**.
2. Upload `kitty-next-door-live-firefox-0.1.0.zip`. Compatible platforms: **Firefox** (desktop) only; leave Android unchecked.
3. **"Do you need to submit source code?"** Answer **Yes** and upload `kitty-next-door-live-source-0.1.0.zip`.
4. **Categories:** Games & Entertainment (and Social & Communication, if a second one is allowed).
5. **Tags:** cat, pet, virtual pet, desktop pet, companion, cute, friends, cozy
6. **License:** choose **Custom license**, and paste the text of `LICENSE` (PolyForm Noncommercial 1.0.0), or link to it.
7. **Privacy policy:** paste the text of `realtime/PRIVACY.md`.
8. **Notes to reviewer:** paste the "Notes for reviewers" section below.

Data collection is declared in the manifest (`personallyIdentifyingInfo` for the display name, `personalCommunications` for visit notes), and Firefox 140+ asks the user for consent at install time.

## Microsoft Edge Add-ons (Partner Center)

1. At https://partner.microsoft.com/dashboard/microsoftedge, choose **Create new extension**, then upload `kitty-next-door-live-edge-0.1.0.zip`.
2. **Availability:** Public, all markets.
3. **Properties:** Category **Entertainment** (or the closest option offered). Website and support links as above. Mature content: no.
4. **Privacy → Single purpose:**
   `Shows an animated companion cat on web pages that the user can interact with, and lets users send their cat to visit friends' browsers in real time.`
5. **Privacy → Permission justifications:**
   - **storage:** Saves the cat's settings (name, coat, sites where it's hidden), the user's friend code, and where the cat is on screen, so it's the same in every tab.
   - **idle:** Tells when the user steps away, so the cat can fall asleep and greet them when they return. It also disconnects from the server while the user is idle.
   - **alarms:** Wakes the background script once a minute, to reconnect to the visits server if the browser has unloaded it.
   - **activeTab:** Lets the popup offer "Hide on this site" for the current tab's website.
   - **Host access (content script on http/https pages):** Draws the cat on the pages the user visits. The script only draws the cat and reads the mouse position; it doesn't read or send page content.
6. **Remote code:** **No, I am not using remote code.** The extension only exchanges JSON messages with its server over a WebSocket.
7. **Data usage:** tick **Personally identifiable information** (the display name the user chooses) and **Personal communications** (visit notes sent to friends). Tick every certification (not sold, not used for unrelated purposes, not used for creditworthiness).
8. **Privacy policy URL:** as above.
9. **Store listing (English):** description as above; logo `assets/icon-300.png`; small tile `store/promo-440x280.png`; large tile `store/promo-1400x560.png`; the three screenshots.
   **Search terms** (at most 7, each 30 characters or fewer): `desktop pet`, `virtual pet`, `cute cat`, `cat companion`, `browser pet`, `cozy`, `friends`
10. **Notes for certification:** paste the section below.

## Notes for reviewers (Firefox and Edge)

```
No account or login is needed. The extension creates an anonymous friend code on first run.

Basic check: open any http/https page. A cat appears at the bottom of the page. Move the mouse (its eyes follow), rub the cursor over it (it purrs), click it, or drag it.

Friend visits need two browsers, because a cat can only visit a friend:
1. Install the extension in two browser profiles (or two browsers). Open the toolbar popup in each.
2. In profile A, copy "Your friend code". In profile B, paste it into "Add a friend by code" and click Add.
3. In profile A, click Accept under "Friend requests".
4. In profile B, click "Send <cat name>". B's cat walks off B's screen and appears on pages in profile A within a second or two, with the note.
5. "Call home" in B, or "Send home" in A, brings it back.

Server: wss://kitty-next-door.kittynextdoor.workers.dev (Cloudflare Workers). It exchanges JSON messages only. No remote code is loaded.
Source code: https://github.com/fahmid-juboraj/kitty-next-door (the extension is in realtime/extension).
Build from the attached source: `npm ci && npm run build`. The output in realtime/extension/dist/ matches the submitted package byte for byte.
```
