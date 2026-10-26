import { kaja } from "kaja";
import { DNASequences } from "benchling";

const bases = (kaja.input.bases ?? (await kaja.askStr("Which bases are you looking for?"))).replace(/\s+/g, "").toUpperCase();
if (!/^[ACGTRYSWKMBDHVN]+$/.test(bases)) throw new Error(`${bases} is not a DNA sequence.`);

const sequences = kaja.pages((nextToken) =>
  DNASequences.SearchDnaSequences({ bases, archiveReason: "NOT_ARCHIVED", sort: "modifiedAt:desc", pageSize: 50, nextToken }),
);

const hits = kaja.table({ title: `Sequences containing ${bases}` });
let found = 0;

for await (const sequence of sequences) {
  found++;
  hits.row({
    name: kaja.run("sequence", { id: sequence.id }, { label: sequence.name }),
    "registry id": sequence.entityRegistryId,
    length: `${sequence.length.toLocaleString()} bp`,
    "found at": positions(sequence.bases.toUpperCase(), bases, sequence.isCircular).join(", "),
  });
}

kaja.text(found ? `${bases.length} bp found in ${found} sequence${found === 1 ? "" : "s"}.` : `No sequence contains ${bases}.`);

function positions(haystack: string, needle: string, circular: boolean) {
  const reverse = [...needle]
    .reverse()
    .map((base) => ({ A: "T", T: "A", G: "C", C: "G" })[base] ?? base)
    .join("");
  const searched = circular ? haystack + haystack.slice(0, needle.length - 1) : haystack;
  const at: string[] = [];
  for (const [strand, probe] of [
    ["+", needle],
    ["−", reverse],
  ] as const) {
    for (let i = searched.indexOf(probe); i !== -1 && i < haystack.length; i = searched.indexOf(probe, i + 1)) {
      at.push(`${strand}${i + 1}`);
    }
  }
  return at;
}
