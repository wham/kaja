import { kaja } from "kaja";
import { Activity } from "github";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const pageSize = 50;

kaja.text("Your notifications, unread marked. Type in the box to filter what has loaded.");

const inbox = kaja.table(
  ["", "repo", "subject", "kind", "reason", "updated"],
  async function* () {
    for (let page = 1; ; page++) {
      const { items } = await Activity.ListNotificationsForAuthenticatedUser({ all: true, perPage: pageSize, page });
      yield* items.map((thread) => [
        thread.unread ? "●" : "",
        thread.repository.fullName,
        thread.subject.title,
        thread.subject.type,
        thread.reason.replaceAll("_", " "),
        ago(thread.updatedAt),
      ]);
      if (items.length < pageSize) return;
    }
  },
  { pageSize },
);
