import { expect, test } from "bun:test";
import { apiError } from "./wails-transport";

// The desktop side answers a failed API call with the Twirp error itself, so the
// sentence the server wrote is the one the tab shows.
test("recovers the server's message and code from a Twirp error", () => {
  const error = apiError(JSON.stringify({ code: "invalid_argument", msg: 'variable name "a b" must start with a letter' }));
  expect(error?.message).toBe('variable name "a b" must start with a letter');
  expect(error?.code).toBe("invalid_argument");
});

test("reads the same error out of an Error rejection", () => {
  expect(apiError(new Error(JSON.stringify({ code: "internal", msg: "failed to save configuration" })))?.message).toBe("failed to save configuration");
});

// Anything that isn't a Twirp error is a transport failure, and keeps saying so.
test("leaves a transport failure alone", () => {
  expect(apiError("premature EOF")).toBeUndefined();
  expect(apiError(new Error("Unknown error"))).toBeUndefined();
  expect(apiError('{"not":"a twirp error"}')).toBeUndefined();
  expect(apiError("{ truncated")).toBeUndefined();
});
