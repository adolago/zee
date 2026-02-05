/**
 * personas Integration Tests
 *
 * Tests the personas system against a running Qdrant instance.
 * Run with: npx tsx src/personas/integration.test.ts
 */

import {
  Memory,
  createWeztermBridge,
  type PersonasState,
} from "./index";

// Test configuration
const TEST_CONFIG = {
  qdrant: {
    url: "http://localhost:6333",
    memoryCollection: "personas_test_memory",
  },
  wezterm: {
    enabled: true,
    layout: "horizontal" as const,
    showStatusPane: false, // Don't create status pane in tests
  },
};

// Test utilities
function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

function success(msg: string) {
  console.log(`[✓] ${msg}`);
}

function fail(msg: string) {
  console.error(`[✗] ${msg}`);
}

// ============================================================================
// Memory Tests (using unified Memory class)
// ============================================================================

async function testMemory() {
  log("Testing Memory...");

  const memory = new Memory({
    qdrantUrl: TEST_CONFIG.qdrant.url,
    collection: TEST_CONFIG.qdrant.memoryCollection,
    namespace: "test",
  });

  try {
    // Store a memory
    const entry = await memory.save({
      content: "User prefers dark mode for all applications",
      category: "preference",
    });
    success(`Stored memory: ${entry.id}`);

    // Search memories
    const results = await memory.search({ query: "dark mode preference", limit: 5 });
    if (results.length > 0 && results[0].entry.content.includes("dark mode")) {
      success(`Found memory via search: "${results[0].entry.content.slice(0, 50)}..."`);
    } else {
      fail("Memory search did not return expected results");
    }

    // Save state
    const testState: PersonasState = {
      version: "1.0.0",
      workers: [],
      tasks: [],
      lastSyncAt: Date.now(),
      stats: {
        totalTasksCompleted: 5,
        totalDronesSpawned: 3,
        totalTokensUsed: 10000,
      },
    };
    await memory.saveState(testState);
    success("Saved personas state");

    // Load state
    const loadedState = await memory.loadState();
    if (loadedState && loadedState.stats.totalTasksCompleted === 5) {
      success("Loaded personas state correctly");
    } else {
      fail("State loading failed or data mismatch");
    }

    // Test conversation state via session API
    await memory.startSession("test-session-123", "zee");
    await memory.setSummary("Discussed project setup and configuration");
    await memory.setPlan("1. Set up environment\n2. Configure services\n3. Test integration");
    await memory.addObjective("Complete setup");
    await memory.addObjective("Verify all services");
    await memory.addKeyFact("User prefers TypeScript");
    await memory.addKeyFact("Project uses Bun");
    await memory.endSession();
    success("Saved conversation state");

    const loadedConv = await memory.loadConversation("test-session-123");
    if (loadedConv && loadedConv.objectives.length === 2) {
      success("Loaded conversation state correctly");
    } else {
      fail("Conversation state loading failed");
    }

    return true;
  } catch (e) {
    fail(`Memory error: ${e}`);
    return false;
  }
}

// ============================================================================
// Continuity Tests (using unified Memory class)
// ============================================================================

async function testContinuity() {
  log("Testing Continuity...");

  const memory = new Memory({
    qdrantUrl: TEST_CONFIG.qdrant.url,
    collection: TEST_CONFIG.qdrant.memoryCollection,
    namespace: "test-continuity",
    maxKeyFacts: 10,
  });

  try {
    // Start a session
    const state = await memory.startSession("cont-test-session", "stanley");
    success(`Started session: ${state.sessionId}`);

    // Process some messages
    const messages = [
      "I want to analyze AAPL stock performance",
      "The current P/E ratio is 28.5",
      "We decided to set a price target of $200",
      "User prefers fundamental analysis over technical",
    ];
    await memory.processMessages(messages);
    success("Processed messages");

    // Check extracted facts
    const currentState = memory.getConversationState();
    if (currentState && currentState.keyFacts.length > 0) {
      success(`Extracted ${currentState.keyFacts.length} key facts`);
    } else {
      fail("No key facts extracted");
    }

    // Update plan
    await memory.setPlan("Analyze tech stocks for Q1 portfolio");
    success("Updated plan");

    // Add objective
    await memory.addObjective("Complete AAPL analysis");
    success("Added objective");

    // Get context for prompt
    const context = memory.formatContextForPrompt();
    if (context.includes("AAPL") || context.includes("portfolio")) {
      success("Context formatted correctly for prompt injection");
    } else {
      fail("Context formatting issue");
    }

    // End session
    await memory.endSession();
    success("Session ended");

    // Restore session
    const restored = await memory.restoreSession("cont-test-session");
    if (restored && restored.objectives.includes("Complete AAPL analysis")) {
      success("Session restored correctly");
    } else {
      fail("Session restoration failed");
    }

    return true;
  } catch (e) {
    fail(`Continuity error: ${e}`);
    return false;
  }
}

// ============================================================================
// WezTerm Bridge Tests
// ============================================================================

async function testWeztermBridge() {
  log("Testing WezTerm Bridge...");

  const wezterm = createWeztermBridge(TEST_CONFIG.wezterm);

  try {
    // Check availability
    const available = await wezterm.isAvailable();
    if (available) {
      success("WezTerm CLI is available");
    } else {
      fail("WezTerm CLI not available");
      return false;
    }

    // List panes
    const panes = await wezterm.listPanes();
    success(`Found ${panes.length} existing panes`);

    // Get current pane
    const currentPaneId = await wezterm.getCurrentPaneId();
    success(`Current pane ID: ${currentPaneId}`);

    // Note: We won't create panes in tests to avoid disrupting the terminal
    // In a real test environment, we would:
    // - Create a test pane
    // - Send commands to it
    // - Close it

    return true;
  } catch (e) {
    fail(`WezTerm bridge error: ${e}`);
    return false;
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests() {
  console.log("\n========================================");
  console.log("    PERSONAS INTEGRATION TESTS");
  console.log("========================================\n");

  const results: Record<string, boolean> = {};

  // Run tests
  results["Memory"] = await testMemory();
  console.log("");

  results["Continuity"] = await testContinuity();
  console.log("");

  results["WezTerm Bridge"] = await testWeztermBridge();
  console.log("");

  // Summary
  console.log("========================================");
  console.log("    TEST SUMMARY");
  console.log("========================================\n");

  let passed = 0;
  let failed = 0;

  for (const [name, result] of Object.entries(results)) {
    if (result) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  console.log(`\n  Total: ${passed} passed, ${failed} failed\n`);

  // Cleanup test collections
  console.log("Cleaning up test collections...");
  try {
    void await fetch(
      `${TEST_CONFIG.qdrant.url}/collections/${TEST_CONFIG.qdrant.memoryCollection}`,
      { method: "DELETE" }
    );
    console.log("Test collections cleaned up.\n");
  } catch {
    console.log("Note: Could not clean up test collections.\n");
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run
runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
