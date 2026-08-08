import { FormControl } from "./components/form-control";
import { Input } from "./components/input";

interface AppNameFieldProps {
  id: string;
  name: string;
  onNameChange: (name: string) => void;
  duplicate: boolean;
  readOnly?: boolean;
  // The module the generated imports name, where the app's type fixes it. An app
  // whose own proto files decide it leaves the rest of the path open.
  sourcePath?: string;
  // Where the value came from, said only while it is still that value.
  caption?: string;
}

// AppNameField is the Name field every app form shares. The name is not a label:
// it is the folder every generated import starts with, so the field says so by
// showing the import line it produces rather than by explaining it. The segment
// the field decides is the lit one.
export function AppNameField({ id, name, onNameChange, duplicate, readOnly = false, sourcePath, caption }: AppNameFieldProps) {
  const folder = name.trim();

  return (
    <FormControl>
      <FormControl.Label htmlFor={id}>Name</FormControl.Label>
      <Input id={id} value={name} placeholder="App name" disabled={readOnly} onChange={(event) => onNameChange(event.target.value)} />
      {duplicate ? (
        <FormControl.Validation variant="error">An app with this name already exists</FormControl.Validation>
      ) : (
        caption && <FormControl.Caption>{caption}</FormControl.Caption>
      )}
      {folder && (
        <FormControl.Caption className="truncate font-mono">
          {'import { … } from "'}
          <span className="text-foreground">{folder}</span>
          {`/${sourcePath ?? "…"}"`}
        </FormControl.Caption>
      )}
    </FormControl>
  );
}
