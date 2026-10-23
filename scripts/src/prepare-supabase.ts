import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSupabaseSchemaPlan } from "@workspace/db/supabase-schema-plan";

const directory = resolve(import.meta.dirname, "../../generated-artifacts");
await mkdir(directory, { recursive: true });
const file = resolve(directory, "supabase-oldtime-schema.sql");
await writeFile(file, await createSupabaseSchemaPlan());
console.log("Generated additive schema plan: generated-artifacts/supabase-oldtime-schema.sql");
console.log("No database connection or schema change was made by this command.");
