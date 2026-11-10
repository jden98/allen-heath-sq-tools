import { EventEmitter } from "node:events";
import { SQMixer } from "@allen-heath-sq-tools/api";
import type { SQMixerOptions } from "@allen-heath-sq-tools/api";
import { buildCatalog, validateValue } from "./catalog.ts";

export interface ModuleConfig {
  host: string;
  port: number;
  localInterface: string;
  reconnectMs: number;
}

export class MixerController extends EventEmitter {
  readonly catalog = buildCatalog();
  readonly targets = new Map(this.catalog.targets.map(target => [target.address, target]));
  readonly values = new Map<string, number | string>();
  mixer: SQMixer | undefined;
  private epoch = 0;
  private refreshTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(private readonly factory: (options: SQMixerOptions) => SQMixer = options => new SQMixer(options)) {
    super();
  }

  get connected(): boolean { return this.mixer?.connected ?? false; }

  start(config: ModuleConfig): void {
    this.stop();
    if (!config.host.trim()) {
      this.emit("status", "disconnected", "Enter the console IP address");
      return;
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
        !Number.isFinite(config.reconnectMs) || config.reconnectMs < 500) {
      this.emit("status", "error", "Invalid TCP port or reconnect interval");
      return;
    }
    this.open(config, this.epoch);
  }

  private open(config: ModuleConfig, epoch: number): void {
    if (epoch !== this.epoch) return;
    const mixer = this.factory({ host: config.host.trim(), port: config.port, localInterface: config.localInterface.trim() });
    this.mixer = mixer;
    const current = () => epoch === this.epoch && this.mixer === mixer;
    const lost = (message: string) => {
      if (!current()) return;
      this.mixer = undefined;
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      mixer.disconnect();
      this.clearValues();
      this.emit("status", "disconnected", message);
      this.reconnectTimer = setTimeout(() => this.open(config, epoch), config.reconnectMs);
    };
    mixer.on("disconnect", () => lost("Console disconnected; reconnecting"));
    mixer.on("error", (error: Error) => lost(error.message));
    mixer.on("connect", () => {
      if (!current()) return;
      this.emit("status", "ok", "Connected directly to console");
      this.emit("version", mixer.version);
      this.refresh();
      this.refreshTimer = setInterval(() => this.refresh(), 100);
    });
    mixer.on("scene-recall", (scene: number) => {
      if (current()) this.emit("scene", scene);
    });
    this.emit("status", "connecting", "Connecting to console TCP port");
    void mixer.connect().catch((error: Error) => lost(error.message));
  }

  refresh(): void {
    if (!this.connected || !this.mixer) return;
    const changed: Record<string, number | string> = {};
    for (const target of this.catalog.targets) {
      if (!target.entry.readable || !target.entry.get) continue;
      const result = target.entry.get(this.mixer, target.indices);
      let value = result?.[0];
      if (typeof value === "number" && !Number.isFinite(value)) {
        value = value === -Infinity && /\/(fader|send\/\d+|sendfx\/\d+)$/.test(target.address) ? -90 : undefined;
      }
      if (value === undefined) {
        if (this.values.delete(target.address)) changed[target.variableId] = "";
      } else if (!Object.is(this.values.get(target.address), value)) {
        this.values.set(target.address, value);
        changed[target.variableId] = value;
      }
    }
    if (Object.keys(changed).length) this.emit("values", changed);
  }

  write(address: string, args: unknown[], mode: "set" | "toggle" | "relative" = "set"): void {
    if (!this.connected || !this.mixer) throw new Error("Console is not connected");
    const target = this.targets.get(address);
    if (!target?.entry.writable || !target.entry.set) throw new Error("Parameter is not writable");
    if (args.length !== target.entry.setArgs.length) throw new Error("Incorrect argument count");
    if (mode !== "set") {
      this.refresh();
      const current = this.values.get(address);
      if (typeof current !== "number") throw new Error("Parameter state is unknown; set an explicit value first");
      if (target.entry.setArgs.length !== 1 || target.entry.setArgs[0].type === "s") throw new Error("Parameter is not numeric");
      if (mode === "toggle") {
        if (target.entry.setArgs[0].min !== 0 || target.entry.setArgs[0].max !== 1) throw new Error("Parameter is not boolean");
        args = [current === 0 ? 1 : 0];
      } else {
        const delta = Number(args[0]);
        if (!Number.isFinite(delta)) throw new Error("Adjustment must be finite");
        args = [current + delta];
      }
    }
    const values = args.map((value, index) => validateValue(target.entry.setArgs[index], value));
    target.entry.set(this.mixer, target.indices, values);
    this.refresh();
  }

  private clearValues(): void {
    this.values.clear();
    this.emit("values", Object.fromEntries(this.catalog.targets.filter(target => target.entry.readable)
      .map(target => [target.variableId, ""])));
  }

  stop(): void {
    this.epoch++;
    clearInterval(this.refreshTimer);
    clearTimeout(this.reconnectTimer);
    this.refreshTimer = undefined;
    this.reconnectTimer = undefined;
    const mixer = this.mixer;
    this.mixer = undefined;
    mixer?.disconnect();
    this.clearValues();
  }
}