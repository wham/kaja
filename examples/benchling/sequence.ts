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
  kaja.table(Object.entries(sequence.fields), ([field, value]) => ({ field, value: value.displayValue }));
}

if (sequence.annotations.length) {
  kaja.table(
    [...sequence.annotations].sort((a, b) => a.start - b.start),
    (annotation) => ({
      feature: annotation.name,
      type: annotation.type,
      start: annotation.start + 1,
      end: annotation.end,
      strand: annotation.strand < 0 ? "−" : "+",
      length: `${annotation.end - annotation.start} bp`,
    }),
    { title: "Annotations" },
  );
}

if (sequence.primers.length) {
  kaja.table(
    sequence.primers,
    (primer) => ({ primer: primer.name, bases: primer.bases, "binds at": primer.bindPosition, strand: primer.strand < 0 ? "−" : "+" }),
    { title: "Primers" },
  );
}

for (const translation of sequence.translations) {
  kaja.text(`${translation.name || "Translation"} ${translation.start + 1}..${translation.end}`);
  kaja.code(translation.aminoAcids.replace(/(.{60})/g, "$1\n"), "text");
}

kaja.code(`>${sequence.name}\n${sequence.bases.replace(/(.{60})/g, "$1\n")}`, "text");
