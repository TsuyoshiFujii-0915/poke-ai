import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface DesktopWindowConfig {
  width: number;
  height: number;
  minWidth: number;
}

interface TauriConfig {
  app: {
    windows: DesktopWindowConfig[];
  };
}

test("uses the established 16:10 default window and partner width", (): void => {
  const configPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const cssPath = new URL("../src/App.css", import.meta.url);
  const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;
  const css = readFileSync(cssPath, "utf8");
  const windowConfig = config.app.windows[0];
  const partnerWidthMatch = /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+(\d+)px;/.exec(css);

  assert.ok(windowConfig, "The desktop window configuration is missing");
  assert.ok(partnerWidthMatch, "The partner column width is missing");

  const partnerWidth = Number.parseInt(partnerWidthMatch[1], 10);

  assert.equal(windowConfig.width * 10, windowConfig.height * 16);
  assert.equal(windowConfig.width, 1440);
  assert.equal(windowConfig.minWidth, 1180);
  assert.equal(partnerWidth, 372);
});
