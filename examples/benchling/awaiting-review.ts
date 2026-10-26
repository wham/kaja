import { kaja } from "kaja";
import { Entry, Review, User } from "benchling";

const people = new Map<string, PromiseLike<string>>();
const person = (id: string) => {
  if (!people.has(id))
    people.set(
      id,
      User.Get({ userId: id }).then((user) => user?.name ?? ""),
    );
  return people.get(id)!;
};

const reviews = kaja.pages((nextToken) => Review.List({ sort: "createdAt:asc", pageSize: 100, nextToken, earlyAccess: "true" }));

const queue = kaja.table({ title: "Waiting for review" });
const load = new Map<string, number>();
let waiting = 0;

for await (const review of reviews) {
  if (review.status !== "NEEDS_REVIEW") continue;
  waiting++;
  const pending = review.reviewers.filter((reviewer) => reviewer.reviewerStatus === "PENDING" && reviewer.user);
  for (const reviewer of pending) load.set(reviewer.user!.id, (load.get(reviewer.user!.id) ?? 0) + 1);
  const entry = review.reviewableId.startsWith("etr_") ? Entry.Get({ entryId: review.reviewableId, earlyAccess: "true" }) : undefined;
  queue.row({
    entry: entry ? entry.then((entry) => entry?.displayId ?? review.reviewableId) : review.reviewableId,
    title: entry ? entry.then((entry) => entry?.name ?? "") : "",
    "sent by": review.reviewSender ? () => person(review.reviewSender!.id) : "",
    reviewers: pending.length ? () => Promise.all(pending.map((reviewer) => person(reviewer.user!.id))).then((names) => names.join(", ")) : "nobody",
    waiting: review.createdAt,
  });
}

if (!waiting) {
  kaja.text("Nothing is waiting for review.");
} else {
  kaja.text(`${waiting} ${waiting === 1 ? "item is" : "items are"} waiting for review.`);
  kaja.table(
    [...load].sort((a, b) => b[1] - a[1]),
    ([id, items]) => ({ reviewer: () => person(id), "items waiting": items }),
  );
}
