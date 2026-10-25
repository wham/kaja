import { kaja } from "kaja";
import { DNASequences } from "benchling";

kaja.table(
  ["name", "registry id", "length", "topology", "modified", "by", ""],
  async function* (search) {
    for (let nextToken = ""; ; ) {
      const page = await DNASequences.ListDNASequences({ nameIncludes: search, sort: "modifiedAt:desc", pageSize: 50, nextToken });
      yield* page.dnaSequences.map((sequence) => [
        sequence.name,
        sequence.entityRegistryId,
        `${sequence.length.toLocaleString()} bp`,
        sequence.isCircular ? "circular" : "linear",
        new Date(sequence.modifiedAt).toLocaleDateString(),
        sequence.creator?.name ?? "",
        kaja.run("sequence", { id: sequence.id }, { label: "Open" }),
      ]);
      if (!(nextToken = page.nextToken)) return;
    }
  },
  { pageSize: 50 },
);
