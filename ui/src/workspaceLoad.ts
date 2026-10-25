import { setValuesWorkspace } from "./browserValues";
import { rpcErrorMessage } from "./rpcMessage";
import { GetWorkspaceResponse } from "./server/api";
import { getApiClient } from "./server/connection";

// How long to wait before asking again for a workspace the server did not answer
// with. Backed off to the ceiling, because a server that is down stays down a while.
const RETRY_MS = 1000;
const RETRY_MAX_MS = 15000;

// The workspace is what everything on screen waits for, and the request is
// tiny - so it is sent as soon as the script runs, ahead of opening the storage
// and mounting the tree, and the window picks up the answer instead of asking again.
let preloadedWorkspace: Promise<GetWorkspaceResponse> | undefined;

function fetchWorkspace(): Promise<GetWorkspaceResponse> {
  return getApiClient()
    .getWorkspace({})
    .then((call) => {
      setValuesWorkspace(call.response.workspace?.id ?? "");
      return call.response;
    });
}

export function preloadWorkspace(): void {
  preloadedWorkspace = fetchWorkspace();
  // Nothing has claimed it yet; a failure is reported where it is awaited.
  preloadedWorkspace.catch(() => {});
}

export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MS * 2 ** attempt, RETRY_MAX_MS);
}

/**
 * The workspace, however long the server takes to answer. A window opened before its
 * server was up used to stay blank for good; now it asks again, backing off, and says
 * so in the footer each time it is refused.
 */
export async function loadWorkspace(): Promise<GetWorkspaceResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = preloadedWorkspace ?? fetchWorkspace();
    preloadedWorkspace = undefined;
    try {
      return await response;
    } catch (error) {
      console.error(`Failed to read the workspace: ${rpcErrorMessage(error)}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
}

/**
 * Whether a watched workspace is news. The watch sends the state it opens on, so a
 * change made while the stream was down is applied and the state the window already
 * holds is not. An empty generation is a server that states none, and is always news.
 */
export function isNewGeneration(applied: string | undefined, next: string): boolean {
  return next === "" || next !== applied;
}
