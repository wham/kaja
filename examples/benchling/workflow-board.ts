import { kaja } from "kaja";
import { WorkflowTasks } from "benchling";

const today = new Date().toISOString().slice(0, 10);
const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const lanes = new Map<string, number>();
const overdue = kaja.table(["task", "name", "group", "assignee", "scheduled", "status", ""]);
let late = 0;

for (let nextToken = ""; ; ) {
  const page = await WorkflowTasks.ListWorkflowTasks({ scheduledOnLte: weekOut, archiveReason: "NOT_ARCHIVED", pageSize: 100, nextToken });
  for (const task of page.workflowTasks) {
    const status = task.status?.statusType ?? "PENDING";
    lanes.set(status, (lanes.get(status) ?? 0) + 1);
    if (status === "COMPLETED" || status === "CANCELLED" || status === "INVALID") continue;
    if (task.scheduledOn >= today) continue;
    late++;
    overdue.row(
      task.displayId,
      task.schema?.name ?? "",
      task.workflowTaskGroup?.name ?? "",
      task.assignee?.name ?? "unassigned",
      task.scheduledOn,
      task.status?.displayName ?? status,
      task.webUrl,
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

kaja.text(late ? `${late} open tasks are past their date.` : "Nothing open is past its date.");

const board = kaja.table(["status", "tasks scheduled through " + weekOut]);
for (const status of ["PENDING", "IN_PROGRESS", "FAILED", "COMPLETED", "CANCELLED", "INVALID"]) {
  if (lanes.has(status)) board.row(status.toLowerCase().replace(/_/g, " "), lanes.get(status)!);
}
