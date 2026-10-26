import { kaja } from "kaja";
import { Team, User } from "benchling";

const { items: teams } = await Team.List({ pageSize: 100 });
const team = await kaja.askSelect(
  "Which team?",
  teams.sort((a, b) => a.name.localeCompare(b.name)).map((team) => ({ label: team.name, value: team })),
);

const members = kaja.table({ title: team.name });
let count = 0;

for await (const membership of kaja.pages((nextToken) => Team.MembershipsList({ teamId: team.id, pageSize: 100, nextToken }))) {
  if (!membership.member) continue;
  count++;
  const user = User.Get({ userId: membership.member.id });
  members.row({
    name: user.then((user) => user?.name ?? ""),
    handle: user.then((user) => (user ? `@${user.username}` : "")),
    role: membership.role.toLowerCase(),
    "last seen": user.then((user) => user?.lastSeen || "never"),
  });
}

kaja.text(`${count} ${count === 1 ? "person" : "people"} on ${team.name}.`);
