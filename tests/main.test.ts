// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const registerSW = vi.fn();
const { startApp } = vi.hoisted(() => ({
  startApp: vi.fn(),
}));

vi.mock("../src/app.ts", () => ({ startApp }));
vi.mock("../src/styles.css", () => ({}));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  (globalThis as { __registerSW?: typeof registerSW }).__registerSW = registerSW;
  registerSW.mockClear();
  startApp.mockClear();
});

describe("main", () => {
  it("registers the service worker and starts the app", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import("../src/main.ts");
    expect(registerSW).toHaveBeenCalledWith({ immediate: true });
    expect(startApp).toHaveBeenCalledWith(document.querySelector("#app"));
  });

  it("throws when #app is missing", async () => {
    await expect(import("../src/main.ts")).rejects.toThrow("#app missing");
    expect(registerSW).toHaveBeenCalledWith({ immediate: true });
    expect(startApp).not.toHaveBeenCalled();
  });
});
