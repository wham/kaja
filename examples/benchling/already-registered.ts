import { kaja } from "kaja";
import { DnaSequence } from "benchling";

const bases = (kaja.input.bases ?? (await kaja.askStr("Paste the bases"))).replace(/\s+/g, "").toUpperCase();
if (!/^[ACGTRYSWKMBDHVN]+$/.test(bases)) throw new Error("Those bases are not DNA.");

const matches = kaja.table({ title: `${bases.length.toLocaleString()} bp` });
let found = 0;

for await (const sequence of kaja.pages((nextToken) => DnaSequence.List({ basesAnyOf: [bases], sort: "createdAt:asc", pageSize: 50, nextToken }))) {
  found++;
  matches.row({
    name: kaja.run("sequence", { id: sequence.id }, { label: sequence.name }),
    "registry id": sequence.entityRegistryId,
    topology: sequence.isCircular ? "circular" : "linear",
    created: sequence.createdAt,
  });
}

kaja.text(
  found
    ? `Benchling already holds this sequence ${found === 1 ? "once" : `${found} times`}, reading either strand and any rotation.`
    : "Benchling holds no sequence with exactly these bases.",
);
