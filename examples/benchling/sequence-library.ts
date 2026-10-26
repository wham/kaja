import { kaja } from "kaja";
import { DNASequences } from "benchling";

kaja.table(
  (search) => kaja.pages((nextToken) => DNASequences.ListDNASequences({ nameIncludes: search, sort: "modifiedAt:desc", pageSize: 50, nextToken })),
  (sequence) => ({
    name: kaja.run("sequence", { id: sequence.id }, { label: sequence.name }),
    "registry id": sequence.entityRegistryId,
    length: `${sequence.length.toLocaleString()} bp`,
    topology: sequence.isCircular ? "circular" : "linear",
    modified: sequence.modifiedAt,
    by: sequence.creator?.name ?? "",
  }),
  { title: "DNA sequences", pageSize: 50 },
);
