# Kitty Next Door Live: Privacy

Kitty Next Door Live lets your cat visit friends in real time. To do that, it talks to one server run for this project on Cloudflare Workers.

## What is sent to the server
- **Your friend code**, plus a random secret that proves the code is yours. The server stores only a hash of the secret.
- **Your cat's name and coat, and the name you choose to show friends** (optional).
- **Your friend list and pending friend requests.**
- **Visits:** who your cat is visiting, the note and gift you attach, and when the visit ends.
- **Letters** you choose to send with a visit (plain text, up to 1,500 characters). Only the friend you send them to can read them.
- **The Kitty Park:** if you send your cat to the park, **your cat's name and coat are shown publicly** on the park page to anyone who opens it. Your own name and your friend code are never shown there.

Your friends see your cat's name and coat, your chosen name, and the notes and letters you send them. Park visitors see only your cat's name and coat, and only while your cat is in the park. Names that trip a basic word filter are shown as the coat instead (for example, "Ginger cat"), and cats can be removed from the park for abuse.

## What is never sent
- The pages you visit, what you type, your browsing history, or anything else from websites.
- Your mouse movements or clicks. The cat reacts to them only inside your browser.
- Analytics or tracking of any kind.

## The website
The website (kitty-next-door.kittynextdoor.workers.dev) uses Cloudflare Web Analytics to count page views. It sets no cookies and doesn't track individual visitors. The download buttons go through short links that count how many times each button is clicked. Only a number per button per day is stored: no IP addresses and no identifiers.

## How long it's kept
Your record stays on the server until you delete it. A visit ends by itself after a couple of hours, and a trip to the park after an hour.
A letter is stored only while the cat that carries it is visiting. When the cat goes home, the letter is deleted from the server. The park keeps no history: a cat's entry is removed as soon as it leaves.

## Deleting your data
Open the extension popup, choose **Settings → Delete my account**, and confirm. The server then removes your record and friend list, sends visiting cats home in both directions, and forgets your friend code. Uninstalling the extension alone doesn't delete the server record, so delete your account first.

## Contact
Questions or deletion requests: open an issue at https://github.com/fahmid-juboraj/kitty-next-door.
