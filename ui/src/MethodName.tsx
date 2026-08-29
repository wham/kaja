import { Method } from "./apps";
import { cn } from "./cn";
import { httpRequestOf, pathParts } from "./httpMethod";

/**
 * A method, wherever one is named: the path its own API gives it, or the name the
 * proto surface gave it where there is no path.
 *
 * A REST operation is addressed by its verb and path — that is what its documentation
 * says, what a person pastes from it, and what a script now writes — so a generated
 * `GetShow` standing in for `GET /shows/{showId}` is Kaja's name for something that
 * already had one.
 *
 * Two things are dimmed and the rest is the name: the **verb**, which qualifies the
 * path rather than naming it, and each `{parameter}`, which is a blank to fill rather
 * than part of the address. It is the treatment a filename's extension gets and the
 * one the deeplink sheet gives a URL's scheme and keys — the same restraint, so the
 * tree stays one list of names in one font.
 *
 * A fragment rather than an element, so the caller owns truncation, font and weight.
 */
export function MethodName({ method, className }: { method: Method; className?: string }) {
  const request = httpRequestOf(method);
  if (!request) return <>{method.name}</>;

  return (
    <>
      <span className={cn("text-muted-foreground", className)}>{request.verb}</span>{" "}
      {pathParts(request.path).map((part, index) =>
        part.parameter ? (
          <span key={index} className={cn("text-muted-foreground", className)}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
