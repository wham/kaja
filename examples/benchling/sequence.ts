import { kaja } from "kaja";
import { DnaSequence } from "benchling";

const id = kaja.input.id ?? (await kaja.askStr("Which DNA sequence? (seq_…)"));
const sequence = await DnaSequence.Get({ dnaSequenceId: id });

kaja.text(
  `${sequence.name}${sequence.entityRegistryId ? ` (${sequence.entityRegistryId})` : ""}: ${sequence.bases.length.toLocaleString()} bp, ${sequence.isCircular ? "circular" : "linear"}.`,
);

const gc = [...sequence.bases.toUpperCase()].filter((base) => base === "G" || base === "C").length;
kaja.text(`GC content ${((gc / Math.max(sequence.bases.length, 1)) * 100).toFixed(1)}%.`);

const annotations = [];
for await (const annotation of kaja.pages((nextToken) => DnaSequence.AnnotationsList({ dnaSequenceId: id, pageSize: 100, nextToken }))) {
  annotations.push(annotation);
}
if (annotations.length) {
  kaja.table(
    annotations.sort((a, b) => a.start - b.start),
    (annotation) => ({
      feature: annotation.name,
      type: annotation.type,
      start: annotation.start + 1,
      end: annotation.end,
      strand: strand(annotation.strand),
      length: `${annotation.end - annotation.start} bp`,
    }),
    { title: "Annotations" },
  );
}

const primers = [];
for await (const primer of kaja.pages((nextToken) => DnaSequence.PrimersList({ dnaSequenceId: id, pageSize: 100, nextToken }))) {
  primers.push(primer);
}
if (primers.length) {
  kaja.table(
    primers,
    (primer) => ({
      "binds at": `${primer.start + 1}..${primer.end}`,
      strand: strand(primer.strand),
      bases: sequence.bases.slice(primer.start, primer.end).toUpperCase(),
      overhang: primer.overhangLength ? `${primer.overhangLength} bp` : "",
    }),
    { title: "Primers" },
  );
}

for await (const translation of kaja.pages((nextToken) => DnaSequence.TranslationsList({ dnaSequenceId: id, pageSize: 100, nextToken }))) {
  kaja.text(`${translation.name || "Translation"} ${translation.start + 1}..${translation.end} ${strand(translation.strand)}`);
  kaja.code(translation.aminoAcids.replace(/(.{60})/g, "$1\n"), "text");
}

kaja.code(`>${sequence.name}\n${sequence.bases.replace(/(.{60})/g, "$1\n")}`, "text");

function strand(value: string) {
  return value === "REVERSE" ? "−" : value === "FORWARD" ? "+" : "";
}
