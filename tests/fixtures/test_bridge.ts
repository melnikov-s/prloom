/**
 * Test bridge module for dynamic loading tests.
 * This is a minimal inbound-only bridge for testing.
 */

import type {
  InboundBridge,
  BridgeContext,
  JsonValue,
  Event,
} from "../../src/lib/bus/types.js";

export const bridge: InboundBridge = {
  name: "test-dynamic",

  async events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{ events: Event[]; state: JsonValue }> {
    // Always return empty events for testing
    return {
      events: [],
      state: state ?? {},
    };
  },
};

export default bridge;
