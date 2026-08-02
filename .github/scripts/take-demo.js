const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = ".github/demo";
const APP_URL = "http://localhost:41520";
const DEFAULT_TIMEOUT = 15000;

// Helper to wait for a selector with clear logging
async function waitFor(page, selector, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    console.error(`  ✗ Timeout waiting for: ${description}`);
    console.error(`    Selector: ${selector}`);
    throw new Error(`Timeout waiting for: ${description} (selector: ${selector})`);
  }
}

// Helper to wait for a locator to be visible
async function waitForLocator(locator, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await locator.waitFor({ timeout, state: "visible" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    console.error(`  ✗ Timeout waiting for: ${description}`);
    throw new Error(`Timeout waiting for: ${description}`);
  }
}

// Helper to wait for text to disappear
async function waitForTextHidden(page, text, description, timeout = DEFAULT_TIMEOUT) {
  console.log(`  Waiting for: ${description}...`);
  try {
    await page.getByText(text).first().waitFor({ timeout, state: "hidden" });
    console.log(`  ✓ ${description}`);
  } catch (error) {
    // Text might not exist at all, which is fine
    console.log(`  ✓ ${description} (text not present)`);
  }
}

// Small delay for visual stability before screenshots
async function settleDelay(page, ms = 300) {
  await page.waitForTimeout(ms);
}

async function takeDemo() {
  const browser = await chromium.launch();

  // Create a browser context with video recording enabled
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: DEMO_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await context.newPage();

  try {
    // Navigate to the app
    console.log("Navigating to app...");
    await page.goto(APP_URL);

    // Wait for app to fully load - sidebar with services tree
    await waitFor(page, 'nav[aria-label="Services and methods"]', "services navigation");

    // Wait for project compilation to complete (loading state disappears)
    // The sidebar shows "Loading..." text while projects compile
    console.log("  Waiting for: projects to compile...");
    try {
      await page.waitForFunction(() => {
        const loadingItem = document.getElementById('loading-tree-view-item');
        const loadingText = document.body.innerText.includes('Loading...');
        return !loadingItem && !loadingText;
      }, { timeout: 30000 });
      console.log("  ✓ Projects compiled");
    } catch {
      console.log("  ⚠ Compilation wait timed out, checking for content anyway");
    }

    // Now wait for actual service/method tree items to appear
    // These are TreeView items that are NOT the loading placeholder
    await waitFor(page, 'li[role="treeitem"]:not(#loading-tree-view-item)', "service tree items", 10000).catch(async () => {
      // Fallback: check for any clickable method text
      console.log("  ⚠ TreeView items not found with role, trying text-based check");
      await waitFor(page, 'nav[aria-label="Services and methods"] ul', "services list", 5000);
    });
    await settleDelay(page);

    // 1. Home screenshot - app once loaded
    console.log("Taking home screenshot...");
    await page.screenshot({ path: `${DEMO_DIR}/home.png` });

    // 2. New app screenshot - open the "New app" dialog (app type picker).
    // The "+" opens a dialog, not a tab. This screenshot is optional.
    console.log("Checking for New app button...");
    const newAppButton = page.locator('button[aria-label="New app"]').first();

    if ((await newAppButton.count()) > 0 && (await newAppButton.isVisible())) {
      console.log("Taking new app screenshot...");
      await newAppButton.click();

      // Wait for the New app dialog (app type picker) to open
      await waitFor(page, 'div[role="dialog"]', "new app dialog to open");
      await settleDelay(page);

      await page.screenshot({ path: `${DEMO_DIR}/newproject.png` });

      // Close the dialog
      const cancelButton = page.getByRole("button", { name: "Cancel" }).first();
      if ((await cancelButton.count()) > 0) {
        await cancelButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.locator('div[role="dialog"]').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      await settleDelay(page);
    } else {
      console.log("New app button not found, skipping screenshot");
    }

    // 3. Call screenshot - click the theatre ListShows method, run it, wait for results
    console.log("Taking call screenshot...");

    // Expand the whole tree so the target method is reliably visible; default
    // expansion depends on compile timing and isn't deterministic.
    const unfoldAll = page.getByRole("button", { name: "Unfold All" });
    if ((await unfoldAll.count()) > 0) {
      await unfoldAll.click();
      await settleDelay(page);
    }

    // Click on the ListShows method (theatre) in the sidebar tree
    const methodItem = page.getByText('ListShows', { exact: true }).first();
    await waitForLocator(methodItem, "ListShows method in sidebar");
    await methodItem.click();

    // Wait for method tab to become active
    await waitFor(page, '[role="tab"][aria-selected="true"]', "method tab to become active");
    await settleDelay(page);

    // Click the Run button
    const runButtonSelectors = ['button:has-text("Run")'];

    let runButtonClicked = false;
    for (const selector of runButtonSelectors) {
      const btn = page.locator(selector).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click();
        runButtonClicked = true;
        console.log(`  ✓ Clicked Run button using: ${selector}`);
        break;
      }
    }

    if (!runButtonClicked) {
      // Last resort: use getByRole
      const roleButton = page.getByRole('button', { name: /run/i }).first();
      if ((await roleButton.count()) > 0) {
        await roleButton.click();
        console.log("  ✓ Clicked Run button using role selector");
        runButtonClicked = true;
      }
    }

    if (!runButtonClicked) {
      throw new Error("Could not find Run button with any selector");
    }

    // Wait for console to show results
    // The console header's call select appears as soon as the call is issued
    await waitFor(page, '[data-testid="console-call-select"]', "call to appear in console");

    // The response status line only renders once the response (or error) lands
    console.log("  Waiting for: response to complete...");
    await waitFor(page, '[data-testid="console-status"]', "response to complete").catch(() => {
      console.log("  ⚠ Response completion check timed out, proceeding anyway");
    });
    await settleDelay(page, 500);

    await page.screenshot({ path: `${DEMO_DIR}/call.png` });

    // 4. Compile log screenshot - open it from the status bar and expand an app
    console.log("Taking compiler screenshot...");

    // The compile status in the status bar is the way in: it opens a popover
    // listing every app, and picking one opens its log.
    await page.locator('button[aria-label*="open app status"]').click();
    await waitFor(page, '[data-testid="app-status-row"]', "app status popover");
    await settleDelay(page, 300);
    await page.locator('[data-testid="app-status-row"]').first().click();

    // Wait for the compile log tab to become active
    await waitFor(page, '[role="tab"][aria-selected="true"]:has-text("Compile log")', "Compile log tab to become active");

    // Wait for compiler content to load - either project items or loading state to finish
    await waitForTextHidden(page, "Loading configuration", "configuration to load");
    await waitFor(page, '[data-testid="compiler-item"]', "compiler project items", 10000).catch(() => {
      console.log("  ⚠ No compiler items found, continuing anyway");
    });
    await settleDelay(page);

    // Opening the log from the popover expands that app's logs already
    await waitFor(page, '[data-testid="compiler-logs"]', "logs to expand", 5000).catch(() => {
      console.log("  ✓ Logs expansion state unknown, proceeding");
    });
    await settleDelay(page);

    await page.screenshot({ path: `${DEMO_DIR}/compiler.png` });

    console.log("All screenshots taken successfully!");
  } catch (error) {
    console.error("Error taking demo:", error);
    // Take a debug screenshot on error
    await page.screenshot({ path: `${DEMO_DIR}/error.png` });
    throw error;
  } finally {
    // Close page and context to finalize video recording
    await page.close();
    await context.close();

    // Rename the video file to demo.webm
    // Playwright saves videos with auto-generated names, we need to rename
    const files = fs.readdirSync(DEMO_DIR);
    const videoFile = files.find(f => f.endsWith('.webm') && f !== 'demo.webm');
    if (videoFile) {
      const oldPath = path.join(DEMO_DIR, videoFile);
      const newPath = path.join(DEMO_DIR, 'demo.webm');
      fs.renameSync(oldPath, newPath);
      console.log("Video saved as demo.webm");
    }

    await browser.close();
  }
}

takeDemo();
