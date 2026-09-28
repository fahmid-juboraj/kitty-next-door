# Kitty Next Door Live: Privacy

Kitty Next Door Live lets your cat visit friends in real time. To do that, it talks to one server run for this project on Cloudflare Workers.

## What is sent to the server
- **Your friend code**, plus a random secret that proves the code is yours. The server stores only a hash of the secret.
- **Your cat's name and coat, and the name you choose to show friends** (optional).
- **Your friend list and pending friend requests.**
- **Visits:** who your cat is visiting, the note and gift you attach, and when the visit ends.

Your friends see your cat's name and coat, your chosen name, and the notes you send them.

## What is never sent
- The pages you visit, what you type, your browsing history, or anything else from websites.
- Your mouse movements or clicks. The cat reacts to them only inside your browser.
- Analytics or tracking of any kind.

## How long it's kept
Your record stays on the server until you delete it. A visit ends by itself after a couple of hours.

## Deleting your data
Open the extension popup, choose **Settings → Delete my account**, and confirm. The server then removes your record and friend list, sends visiting cats home in both directions, and forgets your friend code. Uninstalling the extension alone doesn't delete the server record, so delete your account first.

## Contact
Questions or deletion requests: open an issue at https://github.com/fahmid-juboraj/kitty-next-door.
