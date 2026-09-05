import { expect, test } from "bun:test";
import { clampZoom, DEFAULT_ZOOM, ZOOM_STEPS, zoomAfter, zoomGesture } from "./zoom";

test("a gesture takes the next step of the ladder", () => {
  expect(zoomAfter(100, "in")).toBe(110);
  expect(zoomAfter(100, "out")).toBe(90);
  expect(zoomAfter(150, "reset")).toBe(DEFAULT_ZOOM);
});

test("the ends of the ladder hold", () => {
  const smallest = ZOOM_STEPS[0];
  const largest = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  expect(zoomAfter(smallest, "out")).toBe(smallest);
  expect(zoomAfter(largest, "in")).toBe(largest);
});

test("a zoom off the ladder lands back on it", () => {
  expect(zoomAfter(120, "in")).toBe(125);
  expect(zoomAfter(120, "out")).toBe(110);
  expect(clampZoom(1000)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
});

test("the keys are read with either modifier, and a keypad's own are read too", () => {
  expect(zoomGesture({ key: "=", metaKey: true, ctrlKey: false })).toBe("in");
  expect(zoomGesture({ key: "+", metaKey: false, ctrlKey: true })).toBe("in");
  expect(zoomGesture({ key: "-", metaKey: true, ctrlKey: false })).toBe("out");
  expect(zoomGesture({ key: "_", metaKey: true, ctrlKey: false })).toBe("out");
  expect(zoomGesture({ key: "0", metaKey: true, ctrlKey: false })).toBe("reset");
});

test("a key without the modifier is somebody typing", () => {
  expect(zoomGesture({ key: "-", metaKey: false, ctrlKey: false })).toBeUndefined();
  expect(zoomGesture({ key: "0", metaKey: false, ctrlKey: false })).toBeUndefined();
  expect(zoomGesture({ key: "k", metaKey: true, ctrlKey: false })).toBeUndefined();
});
