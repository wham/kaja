import { CircleX, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { copyText } from "./clipboard";
import { cn } from "./cn";
import { rpcErrorMessage } from "./rpcMessage";
import { signsIn } from "./variableExpansion";
import { isWailsEnvironment, openInBrowser } from "./wails";

export interface SignInProblem {
  message: string;
  detail: string;
}

// SignInState is the one slot a sign-in card carries: the button, the browser it is
// waiting on, and the way it can fail. A sign-in that worked is not a state of its
// own; the form says that from what it reads next. The code is what a server kaja
// cannot be sent back from asks the person to type over there, so waiting on one is
// waiting with something to say.
export type SignInState = { status: "idle" } | { status: "waiting"; userCode: string } | { status: "problem"; problem: SignInProblem };

interface SignInResponse {
  authorizationUrl: string;
  userCode: string;
  authorized: boolean;
  problem?: SignInProblem;
}

// followSignIn reads a sign-in's stream to its end: the first message is the page to
// open, and the last one arrives once the person has finished there. It reports
// whether the sign-in happened.
export async function followSignIn(
  call: { responses: AsyncIterable<SignInResponse>; trailers: PromiseLike<unknown> },
  setState: (state: SignInState) => void,
): Promise<boolean> {
  setState({ status: "waiting", userCode: "" });
  const failed = (problem: SignInProblem) => {
    setState({ status: "problem", problem });
    return false;
  };
  try {
    for await (const response of call.responses) {
      if (response.authorizationUrl) {
        // The desktop's window is not a browser, and a page it navigated away from
        // would be the app gone.
        if (isWailsEnvironment()) openInBrowser(response.authorizationUrl);
        else window.open(response.authorizationUrl, "_blank", "noopener");
        setState({ status: "waiting", userCode: response.userCode });
        continue;
      }
      if (response.problem) return failed(response.problem);
      if (response.authorized) {
        // A browser keeps the sign-in from the trailer, which the read that follows
        // has to carry.
        await Promise.resolve(call.trailers).catch(() => undefined);
        setState({ status: "idle" });
        return true;
      }
    }
    setState({ status: "idle" });
    return false;
  } catch (error) {
    return failed({ message: "The sign-in failed.", detail: rpcErrorMessage(error) });
  }
}

// The code the person carries to the page that was opened. It is shown in full and
// copyable, being a value that has to be typed somewhere else in the next minute.
function UserCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyText(code).then((landed) => {
      if (landed) setCopied(true);
    });
  };
  return (
    <div className="flex items-center gap-1 pl-6">
      <span className="font-mono text-sm tracking-[0.18em] text-foreground">{code}</span>
      <IconButton
        size="xs"
        variant="ghost"
        tooltip="native"
        icon={Copy}
        aria-label={copied ? "Copied the code" : "Copy the code"}
        className={cn("h-5 w-5 [&_svg]:size-3", copied && "text-foreground")}
        onClick={copy}
      />
    </div>
  );
}

interface SignInStatusProps {
  state: SignInState;
  signedIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  // Present where Kaja's own registration is what would be used, and where something
  // typed over it could be given back. Never both.
  onOwnClient?: () => void;
  onBundled?: () => void;
}

// A detail is often a Go error, which is lowercase by convention and reads as a broken
// sentence under a capitalised one.
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// One slot, like the source field's: the button, the browser it is waiting on, and
// the way it can fail.
export function SignInStatus({ state, signedIn, onSignIn, onSignOut, onOwnClient, onBundled }: SignInStatusProps) {
  if (state.status === "waiting") {
    return (
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Spinner />
          <span>{state.userCode ? "Enter this code in the browser to finish signing in." : "Waiting for the browser. Finish signing in there."}</span>
        </div>
        {state.userCode && <UserCode code={state.userCode} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant={signedIn ? "ghost" : "default"} size="sm" onClick={onSignIn}>
          {signedIn ? "Sign in again" : state.status === "problem" ? "Try again" : "Sign in…"}
        </Button>
        {signedIn && (
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        )}
        {onOwnClient && (
          <Button variant="ghost" size="sm" onClick={onOwnClient}>
            Use my own client ID
          </Button>
        )}
        {onBundled && (
          <Button variant="ghost" size="sm" onClick={onBundled}>
            Back to Kaja's
          </Button>
        )}
      </div>
      {state.status === "problem" && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <CircleX className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            {state.problem.message}
            {state.problem.detail && <span className="block break-words text-muted-foreground">{sentence(state.problem.detail)}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// SignInVariable says where the sign-in is kept, which is a variable like any other:
// it is listed under Variables and travels with the workspace's stored values.
export function SignInVariable({ credential, variables }: { credential: string; variables: { [key: string]: string } }) {
  if (!signsIn(credential, variables)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Kept in the <span className="font-mono text-foreground">{credential.trim().slice(2, -1)}</span> variable.
    </p>
  );
}
