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

const results = kaja.pages((nextToken) =>
  AssayResults.ListAssayResults({ schemaId: schema.id, createdAtGte: since, sort: "createdAt:desc", pageSize: 100, nextToken }),
);

kaja.table(
  results,
  (result) => ({
    created: result.createdAt,
    by: result.creator?.name ?? "",
    ...Object.fromEntries(
      columns.map((field) => [field.unit ? `${field.name} (${field.unit.symbol})` : field.name, result.fields[field.name]?.displayValue ?? ""]),
    ),
    reviewed: result.isReviewed ? "yes" : "",
  }),
  { title: schema.name, pageSize: 25 },
);
