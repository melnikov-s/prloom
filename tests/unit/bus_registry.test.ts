import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  BridgeRegistry,
  routeAction,
  getDefaultRegistry,
  resetDefaultRegistry,
} from "../../src/lib/bus/registry.js";
import type {
  Bridge,
  InboundBridge,
  OutboundBridge,
  FullBridge,
  Action,
  BridgeContext,
  BridgeLogger,
} from "../../src/lib/bus/types.js";

// Mock logger for tests
const mockLog: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

beforeEach(() => {
  resetDefaultRegistry();
});

afterEach(() => {
  resetDefaultRegistry();
});

// =============================================================================
// Test Fixtures
// =============================================================================

const mockInboundBridge: InboundBridge = {
  name: "mock-inbound",
  events: async (_ctx, _state) => ({ events: [], state: {} }),
};

const mockOutboundBridge: OutboundBridge = {
  name: "mock-outbound",
  targets: ["target-a"],
  actions: async (_ctx, _action) => ({ success: true }),
};

const mockFullBridge: FullBridge = {
  name: "mock-full",
  targets: ["target-b", "target-c"],
  events: async (_ctx, _state) => ({ events: [], state: {} }),
  actions: async (_ctx, _action) => ({ success: true }),
};

// =============================================================================
// Registration Tests
// =============================================================================

test("register adds bridge to registry", () => {
  const registry = new BridgeRegistry();

  registry.register(mockInboundBridge);

  expect(registry.get("mock-inbound")).toBe(mockInboundBridge);
});

test("register throws for duplicate bridge name", () => {
  const registry = new BridgeRegistry();

  registry.register(mockInboundBridge);

  expect(() => registry.register(mockInboundBridge)).toThrow(
    'Bridge "mock-inbound" is already registered'
  );
});

test("register throws for duplicate target", () => {
  const registry = new BridgeRegistry();

  const bridge1: OutboundBridge = {
    name: "bridge-1",
    targets: ["shared-target"],
    actions: async () => ({ success: true }),
  };

  const bridge2: OutboundBridge = {
    name: "bridge-2",
    targets: ["shared-target"],
    actions: async () => ({ success: true }),
  };

  registry.register(bridge1);

  expect(() => registry.register(bridge2)).toThrow(
    'Target "shared-target" is already claimed by bridge "bridge-1"'
  );
});

// =============================================================================
// Target Lookup Tests
// =============================================================================

test("getTargetBridge returns correct bridge", () => {
  const registry = new BridgeRegistry();

  registry.register(mockOutboundBridge);
  registry.register(mockFullBridge);

  expect(registry.getTargetBridge("target-a")).toBe(mockOutboundBridge);
  expect(registry.getTargetBridge("target-b")).toBe(mockFullBridge);
  expect(registry.getTargetBridge("target-c")).toBe(mockFullBridge);
});

test("getTargetBridge returns undefined for unclaimed target", () => {
  const registry = new BridgeRegistry();

  registry.register(mockOutboundBridge);

  expect(registry.getTargetBridge("unknown-target")).toBeUndefined();
});

test("hasTarget checks target existence", () => {
  const registry = new BridgeRegistry();

  registry.register(mockOutboundBridge);

  expect(registry.hasTarget("target-a")).toBe(true);
  expect(registry.hasTarget("unknown")).toBe(false);
});

// =============================================================================
// Bridge Filtering Tests
// =============================================================================

test("getAllBridges returns all registered bridges", () => {
  const registry = new BridgeRegistry();

  registry.register(mockInboundBridge);
  registry.register(mockOutboundBridge);

  const bridges = registry.getAllBridges();

  expect(bridges.length).toBe(2);
  expect(bridges).toContain(mockInboundBridge);
  expect(bridges).toContain(mockOutboundBridge);
});

test("getEventBridges returns only bridges with events()", () => {
  const registry = new BridgeRegistry();

  registry.register(mockInboundBridge);
  registry.register(mockOutboundBridge);
  registry.register(mockFullBridge);

  const eventBridges = registry.getEventBridges();

  expect(eventBridges.length).toBe(2);
  expect(eventBridges).toContain(mockInboundBridge);
  expect(eventBridges).toContain(mockFullBridge);
  expect(eventBridges).not.toContain(mockOutboundBridge);
});

test("getActionBridges returns only bridges with actions()", () => {
  const registry = new BridgeRegistry();

  registry.register(mockInboundBridge);
  registry.register(mockOutboundBridge);
  registry.register(mockFullBridge);

  const actionBridges = registry.getActionBridges();

  expect(actionBridges.length).toBe(2);
  expect(actionBridges).toContain(mockOutboundBridge);
  expect(actionBridges).toContain(mockFullBridge);
  expect(actionBridges).not.toContain(mockInboundBridge);
});

// =============================================================================
// Action Routing Tests
// =============================================================================

test("routeAction routes to correct bridge", async () => {
  const registry = new BridgeRegistry();
  let actionReceived: Action | undefined = undefined;

  const bridge: OutboundBridge = {
    name: "test-bridge",
    targets: ["test-target"],
    actions: async (_ctx, action) => {
      actionReceived = action;
      return { success: true };
    },
  };

  registry.register(bridge);

  const ctx: BridgeContext = {
    repoRoot: "/test",
    worktree: "/test/worktree",
    log: mockLog,
  };

  const action: Action = {
    id: "action-1",
    type: "respond",
    target: { target: "test-target" },
    payload: { type: "comment", message: "Hello" },
  };

  const result = await routeAction(registry, ctx, action);

  expect(result).toBeDefined();
  expect(result?.bridgeName).toBe("test-bridge");
  expect(result?.result.success).toBe(true);
  expect(actionReceived).toBeDefined();
  expect(actionReceived!.id).toBe("action-1");
});

test("routeAction returns undefined for unclaimed target", async () => {
  const registry = new BridgeRegistry();

  const ctx: BridgeContext = {
    repoRoot: "/test",
    worktree: "/test/worktree",
    log: mockLog,
  };

  const action: Action = {
    id: "action-1",
    type: "respond",
    target: { target: "unclaimed-target" },
    payload: { type: "comment", message: "Hello" },
  };

  const result = await routeAction(registry, ctx, action);

  expect(result).toBeUndefined();
});

// =============================================================================
// Default Registry Tests
// =============================================================================

test("getDefaultRegistry returns singleton", () => {
  const registry1 = getDefaultRegistry();
  const registry2 = getDefaultRegistry();

  expect(registry1).toBe(registry2);
});

test("resetDefaultRegistry clears singleton", () => {
  const registry1 = getDefaultRegistry();
  registry1.register(mockInboundBridge);

  resetDefaultRegistry();

  const registry2 = getDefaultRegistry();
  expect(registry2.get("mock-inbound")).toBeUndefined();
});
