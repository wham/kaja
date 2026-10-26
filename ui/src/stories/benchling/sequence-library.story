import { kaja } from "kaja";
import { DnaSequence, User } from "benchling";

const people = new Map<string, PromiseLike<string>>();
const person = (id: string) => {
  if (!people.has(id))
    people.set(
      id,
      User.Get({ userId: id }).then((user) => user?.name ?? ""),
    );
  return people.get(id)!;
};

kaja.table(
  kaja.pages((nextToken) => DnaSequence.List({ sort: "modifiedAt:desc", pageSize: 50, nextToken })),
  (sequence) => ({
    name: kaja.run("sequence", { id: sequence.id }, { label: sequence.name }),
    "registry id": sequence.entityRegistryId,
    length: `${sequence.bases.length.toLocaleString()} bp`,
    topology: sequence.isCircular ? "circular" : "linear",
    modified: sequence.modifiedAt,
    by: sequence.creator ? () => person(sequence.creator!.id) : "",
  }),
  { title: "DNA sequences", pageSize: 50 },
);
