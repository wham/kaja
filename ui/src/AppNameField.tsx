import { FormControl } from "./components/form-control";
import { Input } from "./components/input";

interface AppNameFieldProps {
  id: string;
  name: string;
  onNameChange: (name: string) => void;
  duplicate: boolean;
  readOnly?: boolean;
  // Where the value came from, said only while it is still that value.
  caption?: string;
}

// AppNameField is the Name field every app form shares. The name is not a label:
// it is what every generated import names, so the field says so by showing the
// import line it produces rather than by explaining it.
export function AppNameField({ id, name, onNameChange, duplicate, readOnly = false, caption }: AppNameFieldProps) {
  const module = name.trim();

  return (
    <FormControl>
      <FormControl.Label htmlFor={id}>Name</FormControl.Label>
      <Input id={id} value={name} placeholder="App name" disabled={readOnly} onChange={(event) => onNameChange(event.target.value)} />
      {duplicate ? (
        <FormControl.Validation variant="error">An app with this name already exists</FormControl.Validation>
      ) : (
        caption && <FormControl.Caption>{caption}</FormControl.Caption>
      )}
      {module && (
        <FormControl.Caption className="truncate font-mono">
          {'import { … } from "'}
          <span className="text-foreground">{module}</span>
          {'"'}
        </FormControl.Caption>
      )}
    </FormControl>
  );
}
