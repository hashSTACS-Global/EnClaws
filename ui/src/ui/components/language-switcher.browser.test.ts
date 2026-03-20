import { describe, expect, it, beforeEach, afterEach } from "vitest";
import "./language-switcher.js";
import type { LanguageSwitcher } from "./language-switcher.js";

describe("language-switcher rendering logic", () => {
  let el: LanguageSwitcher;

  beforeEach(() => {
    el = document.createElement("language-switcher");
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.removeChild(el);
  });

  it("renders with default en locale and interpolates icons correctly", async () => {
    // Wait for lit element to render
    await el.updateComplete;

    expect(el.locale).toBe("en");

    // Check that English label is used
    expect(el.shadowRoot?.textContent).toContain("English");

    // Check for the critical interpolation fix:
    // it should not literally print "${globeIcon}" or "\${globeIcon}"
    // but instead render the SVG element for the globe
    const renderedText = el.shadowRoot?.innerHTML || "";
    expect(renderedText).not.toContain("${globeIcon}");
    expect(renderedText).not.toContain("\\${globeIcon}");

    // Verify an svg is actually present
    const svgElement = el.shadowRoot?.querySelector("svg");
    expect(svgElement).not.toBeNull();
  });

  it("switches to zh-CN locale labels", async () => {
    el.locale = "zh-CN";
    await el.updateComplete;

    expect(el.shadowRoot?.textContent).toContain("简体中文");
  });
});
