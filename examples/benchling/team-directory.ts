import { kaja } from "kaja";
import { Teams, Users } from "benchling";

const { teams } = await Teams.ListTeams({ sort: "name:asc", pageSize: 100 });
const teamId = await kaja.askSelect(
  "Which team?",
  teams.map((team) => ({ label: team.organization ? `${team.name} · ${team.organization.name}` : team.name, value: team.id })),
);

const team = teams.find((team) => team.id === teamId)?.name ?? "";
const members = kaja.table({ title: team });
let count = 0;

for await (const { user, role } of kaja.pages((nextToken) => Teams.ListTeamMemberships({ teamId, pageSize: 100, nextToken }))) {
  if (!user) continue;
  count++;
  members.row({
    name: user.name,
    handle: `@${user.handle}`,
    role: role.toLowerCase(),
    "last seen": async () => (await Users.GetUserActivity({ userId: user.id })).lastSeen || "never",
  });
}

kaja.text(`${count} ${count === 1 ? "person" : "people"} on ${team}.`);
