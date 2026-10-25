import { kaja } from "kaja";
import { DNASequences } from "benchling";

const bases = (kaja.input.bases ?? (await kaja.askStr("Which bases are you looking for?"))).replace(/\s+/g, "").toUpperCase();
if (!/^[ACGTRYSWKMBDHVN]+$/.test(bases)) throw new Error(`${bases} is not a DNA sequence.`);

const hits = kaja.table(["name", "registry id", "length", "found at", ""]);
let found = 0;

for (let nextToken = ""; ; ) {
  const page = await DNASequences.SearchDnaSequences({ bases, archiveReason: "NOT_ARCHIVED", sort: "modifiedAt:desc", pageSize: 50, nextToken });
  for (const sequence of page.dnaSequences) {
    found++;
    hits.row(
      sequence.name,
      sequence.entityRegistryId,
      `${sequence.length.toLocaleString()} bp`,
      positions(sequence.bases.toUpperCase(), bases, sequence.isCircular).join(", "),
      kaja.run("sequence", { id: sequence.id }, { label: "Open" }),
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

kaja.text(found ? `${bases.length} bp found in ${found} sequence${found === 1 ? "" : "s"}.` : `No sequence contains ${bases}.`);

function positions(haystack: string, needle: string, circular: boolean) {
  const reverse = [...needle].reverse().map((base) => ({ A: "T", T: "A", G: "C", C: "G" })[base] ?? base).join("");
  const searched = circular ? haystack + haystack.slice(0, needle.length - 1) : haystack;
  const at: string[] = [];
  for (const [strand, probe] of [["+", needle], ["−", reverse]] as const) {
    for (let i = searched.indexOf(probe); i !== -1 && i < haystack.length; i = searched.indexOf(probe, i + 1)) {
      at.push(`${strand}${i + 1}`);
    }
  }
  return at;
}
