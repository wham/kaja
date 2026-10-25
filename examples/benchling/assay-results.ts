import { kaja } from "kaja";
import { AssayResults, Schemas } from "benchling";

const { assayResultSchemas } = await Schemas.ListAssayResultSchemas({ pageSize: 100 });
const schema = await kaja.askSelect(
  "Which results?",
  assayResultSchemas
    .filter((schema) => !schema.archiveRecord)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((schema) => ({ label: schema.name, value: schema })),
);

const days = await kaja.askInt("From how many days back?");
const since = new Date(Date.now() - days * 86_400_000).toISOString();
const columns = schema.fieldDefinitions.filter((field) => !field.archiveRecord);

kaja.table(
  ["created", "by", ...columns.map((field) => (field.unit ? `${field.name} (${field.unit.symbol})` : field.name)), "reviewed"],
  async function* () {
    for (let nextToken = ""; ; ) {
      const page = await AssayResults.ListAssayResults({ schemaId: schema.id, createdAtGte: since, sort: "createdAt:desc", pageSize: 100, nextToken });
      yield* page.assayResults.map((result) => [
        new Date(result.createdAt).toLocaleString(),
        result.creator?.name ?? "",
        ...columns.map((field) => result.fields[field.name]?.displayValue ?? ""),
        result.isReviewed ? "yes" : "",
      ]);
      if (!(nextToken = page.nextToken)) return;
    }
  },
  { pageSize: 25 },
);
