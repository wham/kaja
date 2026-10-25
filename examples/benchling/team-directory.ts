import { kaja } from "kaja";
import { Teams, Users } from "benchling";

const { teams } = await Teams.ListTeams({ sort: "name:asc", pageSize: 100 });
const teamId = await kaja.askSelect(
  "Which team?",
  teams.map((team) => ({ label: team.organization ? `${team.name} · ${team.organization.name}` : team.name, value: team.id })),
);

const members = kaja.table(["name", "handle", "role", "last seen"]);
let count = 0;

for (let nextToken = ""; ; ) {
  const page = await Teams.ListTeamMemberships({ teamId, pageSize: 100, nextToken });
  for (const membership of page.memberships) {
    const user = membership.user;
    if (!user) continue;
    count++;
    members.row(user.name, `@${user.handle}`, membership.role.toLowerCase(), () => lastSeen(user.id));
  }
  if (!(nextToken = page.nextToken)) break;
}

kaja.text(`${count} ${count === 1 ? "person" : "people"} on ${teams.find((team) => team.id === teamId)?.name}.`);

async function lastSeen(userId: string) {
  const activity = await Users.GetUserActivity({ userId });
  if (!activity.lastSeen) return "never";
  const days = Math.floor((Date.now() - new Date(activity.lastSeen).getTime()) / 86_400_000);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
