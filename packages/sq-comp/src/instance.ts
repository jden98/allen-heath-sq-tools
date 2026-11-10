import { InstanceBase, InstanceStatus, Regex } from "@companion-module/base";
import type { SomeCompanionConfigField, CompanionFeedbackBooleanEvent } from "@companion-module/base";
import { MixerController } from "./controller.ts";
import type { ModuleConfig } from "./controller.ts";
import { buildActions, buildFeedbacks, buildPresets } from "./definitions.ts";

export class SQCompanionInstance extends InstanceBase<ModuleConfig> {
  private readonly controller = new MixerController();
  private scene: number | undefined;

  async init(config: ModuleConfig): Promise<void> {
    this.controller.on("values", (values: Record<string, number | string>) => {
      this.setVariableValues(values);
      this.checkFeedbacks();
    });
    this.controller.on("status", (status: string, message: string) => {
      const statuses: Record<string, InstanceStatus> = {
        ok: InstanceStatus.Ok, connecting: InstanceStatus.Connecting,
        disconnected: InstanceStatus.Disconnected, error: InstanceStatus.BadConfig,
      };
      this.updateStatus(statuses[status] ?? InstanceStatus.UnknownError, message);
      if (status !== "ok") {
        this.scene = undefined;
        this.setVariableValues({ connected: false, scene_current: "", firmware: "", model: "" });
      } else this.setVariableValues({ connected: true });
      this.checkFeedbacks();
    });
    this.controller.on("version", (version: { fwA: number; fwB: number; model: number }) => {
      this.setVariableValues({ firmware: `${version.fwA}.${version.fwB}`, model: version.model });
    });
    this.controller.on("scene", (scene: number) => {
      this.scene = scene;
      this.setVariableValues({ scene_current: scene });
      this.checkFeedbacks("scene_active");
    });
    this.setActionDefinitions(buildActions(this.controller, message => this.log("warn", message)));
    const feedbacks = buildFeedbacks(this.controller);
    feedbacks.scene_active!.callback = (feedback: CompanionFeedbackBooleanEvent) => this.controller.connected && this.scene === Number(feedback.options.n);
    this.setFeedbackDefinitions(feedbacks);
    this.setVariableDefinitions([
      { variableId: "connected", name: "Console TCP connection established" },
      { variableId: "firmware", name: "Console firmware" },
      { variableId: "model", name: "Console model protocol ID" },
      { variableId: "scene_current", name: "Last scene recalled while connected" },
      ...this.controller.catalog.targets.filter(target => target.entry.readable)
        .map(target => ({ variableId: target.variableId, name: `${target.address}: ${target.entry.description}` })),
    ]);
    this.setPresetDefinitions(buildPresets(this.controller));
    await this.configUpdated(config);
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    try {
      this.controller.start({ host: config.host ?? "", port: Number(config.port ?? 51326),
        localInterface: config.localInterface ?? "", reconnectMs: Number(config.reconnectMs ?? 3000) });
    } catch (error) {
      this.updateStatus(InstanceStatus.UnknownError, String(error));
      this.log("warn", `Connection setup failed: ${String(error)}`);
    }
  }

  getConfigFields(): SomeCompanionConfigField[] {
    return [
      { type: "textinput", id: "host", label: "Console IP address", width: 8, default: "", regex: Regex.IP },
      { type: "number", id: "port", label: "Console TCP port", width: 4, default: 51326, min: 1, max: 65535 },
      { type: "textinput", id: "localInterface", label: "Local interface IP (optional)", width: 8, default: "" },
      { type: "number", id: "reconnectMs", label: "Reconnect interval (ms)", width: 4, default: 3000, min: 500, max: 60000 },
    ];
  }

  async destroy(): Promise<void> {
    this.controller.stop();
    this.controller.removeAllListeners();
  }
}