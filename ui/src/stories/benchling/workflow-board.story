import { kaja } from "kaja";
import { User, WorkflowTask } from "benchling";

const days = Number(kaja.input.days ?? 30);
const today = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - days * 86_400_000).toISOString();
const done = new Set(["COMPLETED", "COMPLETED_AFTER_REVIEW", "CANCELLED", "INVALID", "SKIPPED"]);

const people = new Map<string, PromiseLike<string>>();
const person = (id: string) => {
  if (!people.has(id))
    people.set(
      id,
      User.Get({ userId: id }).then((user) => user?.name ?? ""),
    );
  return people.get(id)!;
};

const tasks = kaja.pages((nextToken) => WorkflowTask.List({ modifiedAtGte: since, pageSize: 100, nextToken }));

const lanes = new Map<string, number>();
const overdue = kaja.table({ title: "Overdue" });
let late = 0;

for await (const task of tasks) {
  lanes.set(task.status, (lanes.get(task.status) ?? 0) + 1);
  if (done.has(task.status) || !task.scheduledOn || task.scheduledOn >= today) continue;
  late++;
  overdue.row({
    task: task.displayId,
    name: task.name,
    assignee: task.assignee ? () => person(task.assignee!.id) : "unassigned",
    scheduled: task.scheduledOn,
    status: task.status.toLowerCase().replace(/_/g, " "),
  });
}

kaja.text(late ? `${late} open tasks are past their date.` : "Nothing open is past its date.");

kaja.table(
  [...lanes].sort((a, b) => b[1] - a[1]),
  ([status, tasks]) => ({ status: status.toLowerCase().replace(/_/g, " "), [`tasks touched in the last ${days} days`]: tasks }),
);
