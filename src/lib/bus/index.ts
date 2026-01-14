/**
 * File Bus Module
 *
 * Re-exports all public types and functions from the bus module.
 */

// Types
export type {
  JsonValue,
  BusRecord,
  ReplyAddress,
  Event,
  InlineComment,
  OutboundPayload,
  Action,
  BridgeContext,
  ActionResult,
  InboundBridge,
  OutboundBridge,
  FullBridge,
  Bridge,
  DispatcherBusState,
  BridgeActionState,
} from "./types.js";

export { hasEvents, hasActions } from "./types.js";

// Manager
export {
  getBusDir,
  initBusDir,
  hasBusDir,
  appendEvent,
  readEvents,
  readAllEvents,
  appendAction,
  readActions,
  readAllActions,
  loadDispatcherState,
  saveDispatcherState,
  loadBridgeState,
  saveBridgeState,
  loadBridgeActionState,
  saveBridgeActionState,
  deduplicateEvents,
  pruneProcessedIds,
  // Global bus (RFC: Global Bridges & Core Bridge)
  initGlobalBus,
  hasGlobalBus,
  getGlobalBusDir,
  appendGlobalEvent,
  readGlobalEvents,
  appendGlobalAction,
  readGlobalActions,
  loadGlobalDispatcherState,
  saveGlobalDispatcherState,
  loadGlobalBridgeState,
  saveGlobalBridgeState,
} from "./manager.js";

// Registry
export {
  BridgeRegistry,
  routeAction,
  getDefaultRegistry,
  resetDefaultRegistry,
  type RouteActionResult,
} from "./registry.js";

// Runner
export {
  initBusRunner,
  getBusRunner,
  tickBusEvents,
  tickBusActions,
  readBusEventsForTriage,
  appendBusAction,
  feedbackToEvents,
  createCommentAction,
} from "./runner.js";
