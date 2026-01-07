import { EventEmitter } from "events";
import type { State, PlanState } from "./state.js";

export interface DispatcherEvent {
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  planId?: string;
  message: string;
}

export interface DispatcherUIState {
  state: State;
  events: DispatcherEvent[];
  startedAt: Date;
  isRunning: boolean;
  repoUrl?: string;
}

class DispatcherEvents extends EventEmitter {
  private events: DispatcherEvent[] = [];
  private maxEvents = 100;
  private startedAt: Date = new Date();
  private currentState: State = { control_cursor: 0, plans: {}, inbox: {} };
  private repoUrl?: string;

  start(): void {
    this.startedAt = new Date();
    this.events = [];
  }

  setRepoUrl(url: string | null): void {
    this.repoUrl = url ?? undefined;
    this.emit("update", this.getUIState());
  }

  setState(state: State): void {
    this.currentState = state;
    this.emit("update", this.getUIState());
  }

  log(type: DispatcherEvent["type"], message: string, planId?: string): void {
    const event: DispatcherEvent = {
      timestamp: new Date(),
      type,
      planId,
      message,
    };

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    this.emit("event", event);
    this.emit("update", this.getUIState());
  }

  info(message: string, planId?: string): void {
    this.log("info", message, planId);
  }

  success(message: string, planId?: string): void {
    this.log("success", message, planId);
  }

  warn(message: string, planId?: string): void {
    this.log("warning", message, planId);
  }

  error(message: string, planId?: string): void {
    this.log("error", message, planId);
  }

  getUIState(): DispatcherUIState {
    return {
      state: this.currentState,
      events: [...this.events],
      startedAt: this.startedAt,
      isRunning: true,
      repoUrl: this.repoUrl,
    };
  }

  getEvents(): DispatcherEvent[] {
    return [...this.events];
  }
}

export const dispatcherEvents = new DispatcherEvents();
