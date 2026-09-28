import { formatCode, type ErrorCode, type Notice, type Person, type Snapshot } from "../../shared/protocol";

/** How to refer to a friend: their name, else their cat's name, else their code. */
export function nameOf(p: Person | undefined | null): string {
  return p?.profile?.owner || p?.profile?.cat || (p ? formatCode(p.code) : "your friend");
}

export function catOf(p: Person | undefined | null): string {
  return p?.profile?.cat || "their cat";
}

const ERRORS: Record<ErrorCode, (who: string, myCat: string) => string> = {
  bad_message: () => "Something went wrong. Try again.",
  not_authed: () => "Still connecting. Try again in a moment.",
  bad_token: () => "This install's identity was rejected by the server.",
  no_such_cat: () => "No cat has that friend code. Check it and try again.",
  self: () => "That's your own friend code!",
  not_friends: (who) => `You and ${who} aren't friends yet.`,
  already_friends: (who) => `You and ${who} are already friends.`,
  too_many_friends: () => "You've reached the friend limit.",
  too_many_pending: () => "Too many friend requests are waiting. Try again later.",
  rate_limited: () => "Slow down a little. Try again in a while.",
  cat_busy: (_w, cat) => `${cat} is already out visiting.`,
  host_full: (who) => `${who} already has 3 visiting cats.`,
  unreachable: () => "Couldn't reach the server. Try again.",
};

/** One line for a toast, or null when a notice needs no toast. */
export function describeNotice(n: Notice, state: Snapshot | null): string | null {
  const myCat = state?.me.profile.cat ?? "Your cat";
  const who = nameOf(n.who);
  switch (n.kind) {
    case "friend_request": return `🐾 ${who} wants to be friends. Open Kitty Next Door to accept.`;
    case "friend_added": return `💛 You and ${who} are friends now!`;
    case "guest_arrived": return `🐾 ${catOf(n.who)} came to visit from ${who}!`;
    case "guest_left": return `${catOf(n.who)} went home.`;
    case "cat_home":
      if (n.reason === "sent_home") return `🏠 ${who} sent ${myCat} home.`;
      if (n.reason === "timeout") return `🏠 ${myCat} came back from ${who}'s.`;
      if (n.reason === "unfriended") return `🏠 ${myCat} came home.`;
      return `🏠 ${myCat} is back home.`;
    case "error": return n.error ? ERRORS[n.error](who, myCat) : null;
  }
}
