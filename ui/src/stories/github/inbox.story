import { kaja } from "kaja";
import { Activity } from "github";

const threads = kaja.pages((page) => Activity.ListNotificationsForAuthenticatedUser({ all: true, perPage: 50, page }), { page: 1 });

kaja.text("Your notifications, unread marked. Type in the box to filter what has loaded.");

kaja.table(
  threads,
  (thread) => ({
    unread: thread.unread ? "●" : "",
    subject: thread.subject?.title ?? "",
    why: thread.reason.replaceAll("_", " "),
    repo: thread.repository?.fullName ?? "",
    updated: thread.updatedAt,
  }),
  { pageSize: 50 },
);
