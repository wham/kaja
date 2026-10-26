import { kaja } from "kaja";
import { Activity } from "github";

const pageSize = 50;

kaja.text("Your notifications, unread marked. Type in the box to filter what has loaded.");

kaja.table(
  async function* () {
    for (let page = 1; ; page++) {
      const { items } = await Activity.ListNotificationsForAuthenticatedUser({ all: true, perPage: pageSize, page });
      yield* items;
      if (items.length < pageSize) return;
    }
  },
  (thread) => ({
    unread: thread.unread ? "●" : "",
    subject: thread.subject?.title ?? "",
    why: thread.reason.replaceAll("_", " "),
    repo: thread.repository?.fullName ?? "",
    updated: thread.updatedAt,
  }),
  { pageSize },
);
