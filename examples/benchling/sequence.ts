import { kaja } from "kaja";
import { DNASequences } from "benchling";

const id = kaja.input.id ?? (await kaja.askStr("Which DNA sequence? (seq_…)"));
const sequence = await DNASequences.GetDNASequence({ dnaSequenceId: id });

kaja.text(
  `${sequence.name}${sequence.entityRegistryId ? ` (${sequence.entityRegistryId})` : ""}: ${sequence.length.toLocaleString()} bp, ${sequence.isCircular ? "circular" : "linear"}, ${sequence.schema?.name ?? "no schema"}. ${sequence.webUrl}`,
);

const gc = [...sequence.bases.toUpperCase()].filter((base) => base === "G" || base === "C").length;
kaja.text(`GC content ${((gc / Math.max(sequence.bases.length, 1)) * 100).toFixed(1)}%.`);

if (Object.keys(sequence.fields).length) {
  const fields = kaja.table(["field", "value"]);
  for (const [name, field] of Object.entries(sequence.fields)) fields.row(name, field.displayValue);
}

if (sequence.annotations.length) {
  const annotations = kaja.table(["feature", "type", "start", "end", "strand", "length"]);
  for (const annotation of [...sequence.annotations].sort((a, b) => a.start - b.start)) {
    annotations.row(
      annotation.name,
      annotation.type,
      annotation.start + 1,
      annotation.end,
      annotation.strand < 0 ? "−" : "+",
      `${annotation.end - annotation.start} bp`,
    );
  }
}

if (sequence.primers.length) {
  const primers = kaja.table(["primer", "bases", "binds at", "strand"]);
  for (const primer of sequence.primers) primers.row(primer.name, primer.bases, primer.bindPosition, primer.strand < 0 ? "−" : "+");
}

for (const translation of sequence.translations) {
  kaja.text(`${translation.name || "Translation"} ${translation.start + 1}..${translation.end}`);
  kaja.code(translation.aminoAcids.replace(/(.{60})/g, "$1\n"), "text");
}

kaja.code(`>${sequence.name}\n${sequence.bases.replace(/(.{60})/g, "$1\n")}`, "text");
