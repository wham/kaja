import { kaja } from "kaja";
import { WorkflowTasks } from "benchling";

const today = new Date().toISOString().slice(0, 10);
const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const tasks = kaja.pages((nextToken) => WorkflowTasks.ListWorkflowTasks({ scheduledOnLte: weekOut, archiveReason: "NOT_ARCHIVED", pageSize: 100, nextToken }));

const lanes = new Map<string, number>();
const overdue = kaja.table({ title: "Overdue" });
let late = 0;

for await (const task of tasks) {
  const status = task.status?.statusType ?? "PENDING";
  lanes.set(status, (lanes.get(status) ?? 0) + 1);
  if (status === "COMPLETED" || status === "CANCELLED" || status === "INVALID") continue;
  if (task.scheduledOn >= today) continue;
  late++;
  overdue.row({
    task: task.displayId,
    name: task.schema?.name ?? "",
    group: task.workflowTaskGroup?.name ?? "",
    assignee: task.assignee?.name ?? "unassigned",
    scheduled: task.scheduledOn,
    status: task.status?.displayName ?? status,
    link: task.webUrl,
  });
}

kaja.text(late ? `${late} open tasks are past their date.` : "Nothing open is past its date.");

kaja.table(
  ["PENDING", "IN_PROGRESS", "FAILED", "COMPLETED", "CANCELLED", "INVALID"].filter((status) => lanes.has(status)),
  (status) => ({ status: status.toLowerCase().replace(/_/g, " "), [`tasks scheduled through ${weekOut}`]: lanes.get(status) }),
);
