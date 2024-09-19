import { expect, test, vi } from "vitest";
import { Service } from "./project";
import { registerGlobalTriggers } from "./projectLoader";

test("registerGlobalTriggers", () => {
  if (typeof window === "undefined") {
    globalThis.window = {} as any;
  }

  delete window["TestService" as any];
  const globalTrigger = vi.fn();
  const services: Service[] = [
    {
      name: "TestService",
      methods: [
        {
          name: "TestMethod",
          editorCode: "",
          globalTrigger,
        },
      ],
    },
  ];

  registerGlobalTriggers(services);

  expect(window["TestService" as any]).toBeDefined();
  expect(window["TestService" as any]["TestMethod" as any]).toBeDefined();
  (window["TestService" as any]["TestMethod" as any] as any)();

  expect(globalTrigger).toHaveBeenCalled();
});
